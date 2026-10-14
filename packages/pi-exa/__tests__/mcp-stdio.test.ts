/**
 * MCP stdio wire tests for pi-exa.
 *
 * Builds the compiled MCP entry and spawns the real `bin/pi-exa.js`, the same
 * path `npx pi-exa` runs. bridgekit 0.19+ serves only the modern MCP
 * `2026-07-28` era, so modern clients must connect and legacy-era clients must
 * be rejected with `-32022`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(packageDir, "bin", "pi-exa.js");

type NegotiationMode = "auto" | "legacy" | { pin: "2026-07-28" };

describe("pi-exa MCP stdio server", () => {
  // Sandbox HOME + CWD so the server never reads real ~/.pi/agent/settings.json
  // or .pi/settings.json from the dev tree.
  let sandbox: string;

  beforeAll(() => {
    const build = spawnSync("pnpm", ["run", "build:mcp"], { cwd: packageDir, encoding: "utf-8" });
    if (build.status !== 0) {
      throw new Error(`build:mcp failed:\n${build.stdout}\n${build.stderr}`);
    }
    sandbox = mkdtempSync(join(tmpdir(), "pi-exa-mcp-stdio-"));
  }, 120_000);

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function connect(mode?: NegotiationMode) {
    const client = new Client(
      { name: "pi-exa-stdio-test", version: "0.0.0" },
      mode === undefined ? {} : { versionNegotiation: { mode } },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binPath],
      cwd: sandbox,
      env: { PATH: process.env.PATH ?? "", HOME: sandbox, EXA_API_KEY: "test-key" },
      stderr: "pipe",
    });
    return { client, connection: client.connect(transport) };
  }

  it.each<[string, NegotiationMode]>([
    ["pinned to 2026-07-28", { pin: "2026-07-28" }],
    ["auto", "auto"],
  ])(
    "serves the default tool surface to a modern client (%s)",
    async (_label, mode) => {
      const { client, connection } = connect(mode);
      try {
        await connection;
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(
          [
            "exa_research_reset",
            "exa_research_status",
            "exa_research_step",
            "exa_research_summary",
            "web_answer_exa",
            "web_fetch_exa",
            "web_find_similar_exa",
            "web_search_exa",
          ].sort(),
        );

        const result = await client.callTool({ name: "exa_research_status", arguments: {} });
        expect(result.isError).not.toBe(true);
      } finally {
        await client.close();
      }
    },
    30_000,
  );

  it.each<[string, NegotiationMode | undefined]>([
    ["SDK default", undefined],
    ["legacy", "legacy"],
  ])(
    "rejects a legacy-era client with -32022 (%s)",
    async (_label, mode) => {
      const { client, connection } = connect(mode);
      try {
        await expect(connection).rejects.toMatchObject({ code: -32022 });
      } finally {
        await client.close();
      }
    },
    30_000,
  );
});

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
interface PackageManifest {
  pi: { extensions: string[] };
  bin: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
  scripts: Record<string, string>;
  peerDependencies: Record<string, string>;
}
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageManifest;
afterEach(() => rmSync(join(packageRoot, "dist"), { recursive: true, force: true }));

describe("Agent Journal package", () => {
  it("publishes Pi source, Portable tools, MCP entrypoint, and stable bin wrapper", () => {
    expect(pkg.pi.extensions).toEqual(["./extensions/index.ts"]);
    expect(pkg.bin).toEqual({ "pi-agent-journal": "./bin/pi-agent-journal.js" });
    expect(pkg.exports).toHaveProperty("./mcp");
    expect(pkg.exports).toHaveProperty("./tools");
    expect(pkg.files).toEqual(expect.arrayContaining(["bin/", "dist/", "extensions/", "README.md"]));
    expect(pkg.scripts["build:mcp"]).toContain("tsconfig.mcp.json");
    expect(pkg.scripts.prepack).toBe("npm run build:mcp");
    expect(pkg.peerDependencies["@earendil-works/pi-coding-agent"]).toBe(">=0.80.6");
    const wrapper = readFileSync(join(packageRoot, "bin", "pi-agent-journal.js"), "utf8");
    expect(wrapper).toContain("runBinWrapper");
    expect(wrapper).toContain('mcpEntry: "dist/extensions/mcp-server.js"');
    expect(wrapper).toContain('buildScript: "build:mcp"');
  });

  it("covers existing, missing, failed, and missing-artifact wrapper integration paths", async () => {
    const internalUrl = pathToFileURL(
      join(repoRoot, "node_modules/@feniix/bridgekit/dist/src/bin-wrapper-internal.js"),
    ).href;
    const { runBinWrapperWithDeps } = (await import(internalUrl)) as {
      runBinWrapperWithDeps: (options: Record<string, unknown>, deps: Record<string, unknown>) => Promise<void>;
    };
    const createFixture = () => {
      const root = mkdtempSync(join(tmpdir(), "agent-journal-wrapper-"));
      mkdirSync(join(root, "bin"), { recursive: true });
      return {
        root,
        options: {
          metaUrl: pathToFileURL(join(root, "bin/pi-agent-journal.js")).href,
          mcpEntry: "dist/extensions/mcp-server.js",
          buildScript: "build:mcp",
          logPrefix: "pi-agent-journal",
        },
      };
    };
    const success = { status: 0, signal: null } as never;
    const failure = { status: 2, signal: null } as never;
    const exit = (code: number): never => {
      throw new Error(`exit:${code}`);
    };

    const existing = createFixture();
    mkdirSync(join(existing.root, "dist/extensions"), { recursive: true });
    writeFileSync(join(existing.root, "dist/extensions/mcp-server.js"), "export async function runServer() {}", "utf8");
    const existingSpawn = vi.fn(() => success);
    await runBinWrapperWithDeps(existing.options, { spawnSync: existingSpawn, exit });
    expect(existingSpawn).not.toHaveBeenCalled();
    rmSync(existing.root, { recursive: true, force: true });

    const missing = createFixture();
    const buildSpawn = vi.fn(() => {
      mkdirSync(join(missing.root, "dist/extensions"), { recursive: true });
      writeFileSync(
        join(missing.root, "dist/extensions/mcp-server.js"),
        "export async function runServer() {}",
        "utf8",
      );
      return success;
    });
    await runBinWrapperWithDeps(missing.options, { spawnSync: buildSpawn, exit });
    expect(buildSpawn).toHaveBeenCalledOnce();
    rmSync(missing.root, { recursive: true, force: true });

    const failed = createFixture();
    await expect(runBinWrapperWithDeps(failed.options, { spawnSync: () => failure, exit })).rejects.toThrow("exit:2");
    rmSync(failed.root, { recursive: true, force: true });

    const omitted = createFixture();
    await expect(runBinWrapperWithDeps(omitted.options, { spawnSync: () => success, exit })).rejects.toThrow("exit:1");
    rmSync(omitted.root, { recursive: true, force: true });
  });

  it("installs the real tarball and runs packed exports and MCP list-tools in isolation", () => {
    const fixture = mkdtempSync(join(tmpdir(), "agent-journal-packed-install-"));
    const tarballs = join(fixture, "tarballs");
    const app = join(fixture, "app");
    const home = join(fixture, "home");
    const store = join(fixture, "mcp-store");
    mkdirSync(tarballs, { recursive: true });
    mkdirSync(app, { recursive: true });
    mkdirSync(home, { recursive: true });
    try {
      rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
      const packed = spawnSync(
        "npm",
        ["pack", "--json", "--workspace", "packages/pi-agent-journal", "--pack-destination", tarballs, "--silent"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(packed.status, packed.stderr).toBe(0);
      const [{ filename }] = JSON.parse(packed.stdout) as [{ filename: string }];
      const tarball = join(tarballs, filename);
      writeFileSync(
        join(app, "package.json"),
        JSON.stringify({ name: "packed-fixture", private: true, type: "module" }),
      );
      const installed = spawnSync("npm", ["install", "--ignore-scripts", "--omit=peer", "--no-package-lock", tarball], {
        cwd: app,
        encoding: "utf8",
      });
      expect(installed.status, installed.stderr).toBe(0);

      const isolatedEnv = {
        ...process.env,
        HOME: home,
        NODE_PATH: "",
        AGENT_JOURNAL_MCP_STORAGE_DIR: store,
        AGENT_JOURNAL_STORAGE_DIR: join(fixture, "pi-store"),
      };
      const exportsResult = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          "const u=import.meta.resolve('@feniix/pi-agent-journal/tools'); const m=await import('@feniix/pi-agent-journal/mcp'); const t=await import('@feniix/pi-agent-journal/tools'); console.log(JSON.stringify({u,server:typeof m.runServer,tools:typeof t.createJournalTools}));",
        ],
        { cwd: app, encoding: "utf8", env: isolatedEnv },
      );
      expect(exportsResult.status, exportsResult.stderr).toBe(0);
      const resolved = JSON.parse(exportsResult.stdout) as { u: string; server: string; tools: string };
      expect(resolved.u).toContain(join(app, "node_modules", "@feniix", "pi-agent-journal"));
      expect(resolved.u).not.toContain(join(repoRoot, "node_modules"));
      expect(resolved).toMatchObject({ server: "function", tools: "function" });

      const protocolInput = `${[
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "packed-test", version: "1" },
          },
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]
        .map((message) => JSON.stringify(message))
        .join("\n")}\n`;
      const bin = join(app, "node_modules", ".bin", "pi-agent-journal");
      const mcp = spawnSync(bin, [], {
        cwd: app,
        encoding: "utf8",
        env: isolatedEnv,
        input: protocolInput,
        timeout: 20_000,
      });
      expect(mcp.status, mcp.stderr).toBe(0);
      const lines = mcp.stdout.trim().split("\n").filter(Boolean);
      const messages = lines.map(
        (line) => JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } },
      );
      expect(messages.find((message) => message.id === 2)?.result?.tools?.map((tool) => tool.name)).toEqual([
        "journal_record",
        "journal_inspect",
        "journal_checkpoint",
        "journal_session",
      ]);
      expect(lines).toHaveLength(messages.length);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 120_000);

  it("packs executable wrapper and built MCP artifacts from a clean dist", () => {
    rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
    const result = spawnSync(
      "npm",
      ["pack", "--dry-run", "--json", "--workspace", "packages/pi-agent-journal", "--silent"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const [packed] = JSON.parse(result.stdout) as [{ files: Array<{ path: string; mode: number }> }];
    const files = new Map(packed.files.map((item) => [item.path, item]));
    expect(files.get("bin/pi-agent-journal.js")?.mode).toBe(493);
    expect(files.get("dist/extensions/mcp-server.js")?.mode).toBe(493);
    expect(files.has("dist/extensions/tools.d.ts")).toBe(true);
    expect(pkg.scripts["evaluate:v2"]).toContain("evaluation/run.mjs");
    expect([...files.keys()].some((path) => path.startsWith("evaluation/"))).toBe(false);
    expect(
      [...files.keys()].some(
        (path) =>
          path.includes("evaluation-v2") || path.includes("evaluation-trace") || path.includes("evaluation-harness"),
      ),
    ).toBe(false);
    expect([...files.keys()].some((path) => /(?:raw|trial).*\.jsonl$/i.test(path))).toBe(false);
  }, 30_000);
});

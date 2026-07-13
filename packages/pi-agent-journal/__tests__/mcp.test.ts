import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePortableTool, type PortableTool } from "@feniix/bridgekit";
import { createMcpServer } from "@feniix/bridgekit/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TObject } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { JournalService } from "../extensions/journal-service.js";
import { createMcpServerOptions } from "../extensions/mcp-server.js";
import { JournalStorage } from "../extensions/storage.js";
import { createJournalTools } from "../extensions/tools.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function connect(piStore?: string, suppliedMcpStore?: string, workspaceRoot?: string) {
  const mcpStore = suppliedMcpStore ?? mkdtempSync(join(tmpdir(), "agent-journal-mcp-"));
  if (!suppliedMcpStore) roots.push(mcpStore);
  const options = createMcpServerOptions({
    storageDir: mcpStore,
    piStorageDir: piStore,
    workspaceRoot,
    version: "test",
  });
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "test" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, options };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !["id", "createdAt", "updatedAt", "closedAt", "activeCheckpointId", "fingerprint", "timestamp"].includes(key),
      )
      .map(([key, item]) => [key, normalize(item)]),
  );
}

describe("Agent Journal MCP server", () => {
  it("advertises exactly four manual tools and executes session operations", async () => {
    const { client, server } = await connect();
    try {
      expect((await client.listTools()).tools.map((item) => item.name)).toEqual([
        "journal_record",
        "journal_inspect",
        "journal_checkpoint",
        "journal_session",
      ]);
      expect(
        (await client.callTool({ name: "journal_session", arguments: { action: "create", session_id: "mcp" } }))
          .isError,
      ).toBeFalsy();
      expect(
        (
          await client.callTool({
            name: "journal_record",
            arguments: {
              session_id: "mcp",
              entries: [{ id: "first", type: "observation", content: "manual MCP state" }],
            },
          })
        ).isError,
      ).toBeFalsy();
      expect(
        (
          await client.callTool({
            name: "journal_record",
            arguments: {
              session_id: "mcp",
              entries: [
                {
                  id: "second",
                  type: "decision",
                  content: "alternative",
                  relationships: [{ type: "alternative-to", targetEntryId: "first" }],
                },
              ],
            },
          })
        ).isError,
      ).toBeFalsy();
      expect(
        (await client.callTool({ name: "journal_inspect", arguments: { session_id: "mcp", view: "current" } })).isError,
      ).toBeFalsy();
      expect(
        (
          await client.callTool({
            name: "journal_checkpoint",
            arguments: {
              session_id: "mcp",
              action: "create",
              objective: "Continue MCP work",
              status: "active",
              settled_decision_entry_ids: ["second"],
            },
          })
        ).isError,
      ).toBeFalsy();
      expect(
        (await client.callTool({ name: "journal_checkpoint", arguments: { session_id: "mcp", action: "resume" } }))
          .isError,
      ).toBeFalsy();
      expect(
        (await client.callTool({ name: "journal_session", arguments: { action: "status", session_id: "mcp" } }))
          .isError,
      ).toBeFalsy();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("matches Portable semantics across the full manual API while physically isolating the Pi store", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "agent-journal-parity-"));
    roots.push(fixture);
    const piStore = join(fixture, "pi-store");
    const mcpStore = join(fixture, "mcp-store");
    const portableStore = join(fixture, "portable-store");
    const workspace = join(fixture, "workspace");
    const sentinel = join(piStore, "sentinel.txt");
    const artifact = join(workspace, "evidence.txt");
    const secondArtifact = join(workspace, "second-evidence.txt");
    for (const directory of [piStore, mcpStore, portableStore, workspace]) {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
    }
    writeFileSync(sentinel, "PI STORE MUST REMAIN UNTOUCHED");
    writeFileSync(artifact, "original evidence");
    writeFileSync(secondArtifact, "second original evidence");
    const sentinelBytes = readFileSync(sentinel);
    const sentinelStat = statSync(sentinel);

    const portableStorage = new JournalStorage(portableStore);
    const portableService = new JournalService({ storage: portableStorage, workspaceRoot: workspace });
    const portableTools = createJournalTools({ storage: portableStorage, service: portableService });
    const portable = async (name: string, args: Record<string, unknown>) => {
      const selected = portableTools.find((candidate) => candidate.name === name) as PortableTool<TObject>;
      const result = await executePortableTool(selected, args, { host: "test" });
      return { isError: result.isError ?? false, structuredContent: result.structuredContent };
    };

    const { client, server, options } = await connect(piStore, mcpStore, workspace);
    const mcp = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError ?? false, structuredContent: result.structuredContent };
    };
    const parity = async (name: string, portableArgs: Record<string, unknown>, mcpArgs = portableArgs) => {
      const [left, right] = await Promise.all([portable(name, portableArgs), mcp(name, mcpArgs)]);
      expect(normalize(right)).toEqual(normalize(left));
      return { left, right };
    };

    try {
      await parity("journal_session", { action: "list", limit: 1 });
      await parity("journal_session", { action: "create", session_id: "parity" });

      const workspaceId = createHash("sha256").update(realpathSync(workspace)).digest("hex");
      const dependency = {
        kind: "file",
        path: "evidence.txt",
        workspaceId,
        observedHash: createHash("sha256").update("original evidence").digest("hex"),
        observedAt: "2026-07-12T00:00:00.000Z",
        originatingEntryId: "evidence",
        material: true,
      };
      const secondDependency = {
        ...dependency,
        path: "second-evidence.txt",
        observedHash: createHash("sha256").update("second original evidence").digest("hex"),
        originatingEntryId: "evidence-two",
      };
      const entries = [
        { id: "evidence", type: "evidence", content: "Repository evidence", dependencies: [dependency] },
        {
          id: "evidence-two",
          type: "evidence",
          content: "Second repository evidence",
          dependencies: [secondDependency],
        },
        { id: "decision", type: "decision", content: "Use the journal" },
        { id: "next", type: "next_action", content: "Run parity checks" },
      ];
      await parity("journal_record", { entries });

      const history = await parity("journal_inspect", { view: "history", limit: 2 });
      const historyCursor = history.left.structuredContent?.nextCursor as string;
      await parity("journal_inspect", { view: "history", limit: 2, cursor: historyCursor });
      const current = await parity("journal_inspect", { view: "current", limit: 2 });
      const currentCursor = current.left.structuredContent?.nextCursor as string;
      await parity("journal_inspect", { view: "current", limit: 2, cursor: currentCursor });

      await parity("journal_checkpoint", {
        action: "create",
        objective: "Prove MCP parity",
        status: "active",
        settled_decision_entry_ids: ["decision"],
        evidence_entry_ids: ["evidence", "evidence-two"],
        artifact_dependencies: [dependency, secondDependency],
        next_action_entry_id: "next",
      });
      writeFileSync(artifact, "changed evidence");
      writeFileSync(secondArtifact, "second changed evidence");
      const resumed = await parity("journal_checkpoint", { action: "resume" });
      expect(resumed.left.structuredContent).toMatchObject({
        freshness: [expect.objectContaining({ status: "stale" }), expect.objectContaining({ status: "stale" })],
        notices: [
          expect.objectContaining({ category: "stale", requiresJudgment: true }),
          expect.objectContaining({ category: "stale", requiresJudgment: true }),
        ],
      });
      const notices = await parity("journal_inspect", { view: "notices", limit: 1 });
      const noticesCursor = notices.left.structuredContent?.nextCursor as string;
      await parity("journal_inspect", { view: "notices", limit: 1, cursor: noticesCursor });
      await parity("journal_session", { action: "status" });
      await parity("journal_session", { action: "create", session_id: "second" });
      const listed = await parity("journal_session", { action: "list", limit: 1 });
      const listCursor = listed.left.structuredContent?.nextCursor as string;
      await parity("journal_session", { action: "list", limit: 1, cursor: listCursor });
      await parity("journal_session", { action: "select", session_id: "parity" });
      const validationError = await parity("journal_inspect", { view: "invalid" });
      expect(validationError.left).toMatchObject({
        isError: true,
        structuredContent: { kind: "validation", tool: "journal_inspect" },
      });
      const domainError = await parity("journal_record", {
        entries: [
          {
            id: "invalid-link",
            type: "observation",
            content: "Invalid relationship candidate",
            relationships: [{ type: "supersedes", targetEntryId: "absent" }],
          },
        ],
      });
      expect(domainError.left).toMatchObject({
        isError: true,
        structuredContent: { kind: "domain", tool: "journal_record" },
      });
      await parity("journal_session", { action: "close" });

      expect(options.instructions).toContain("does not observe host turns");
      expect(options.instructions).not.toMatch(
        /\b(?:will|does)\s+(?:automatically|autonomously)\s+(?:observe|record|inject)/i,
      );
      expect(readFileSync(sentinel)).toEqual(sentinelBytes);
      const after = statSync(sentinel);
      expect({ mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, birthtimeMs: after.birthtimeMs }).toEqual({
        mtimeMs: sentinelStat.mtimeMs,
        ctimeMs: sentinelStat.ctimeMs,
        birthtimeMs: sentinelStat.birthtimeMs,
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("rejects direct and aliased collisions with the Pi store", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-journal-collision-"));
    roots.push(root);
    expect(() => createMcpServerOptions({ storageDir: root, piStorageDir: root })).toThrow(/distinct/i);
    expect(() => createMcpServerOptions({ storageDir: join(root, "child", ".."), piStorageDir: root })).toThrow(
      /distinct/i,
    );
  });
});

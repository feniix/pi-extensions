import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalService } from "../extensions/journal-service.js";
import { JournalStorage } from "../extensions/storage.js";
import { createJournalTools } from "../extensions/tools.js";

let root: string;
let storage: JournalStorage;
let service: JournalService;
let workspace: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "agent-journal-tools-"));
  workspace = join(root, "workspace");
  mkdirSync(workspace);
  storage = new JournalStorage(join(root, "store"));
  await storage.createSession("work");
  service = new JournalService({
    storage,
    workspaceRoot: workspace,
    idGenerator: (() => {
      let i = 0;
      return () => `id-${++i}`;
    })(),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function tools(): PortableTool<TObject>[] {
  return createJournalTools({ storage, service, initialSessionId: "work" });
}
function tool(name: string): PortableTool<TObject> {
  const found = tools().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function hasUnsafeControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
  });
}

describe("Agent Journal portable tools", () => {
  it("exposes exactly four task-oriented tools with host metadata", () => {
    const result = tools();
    expect(result.map((item) => item.name)).toEqual([
      "journal_record",
      "journal_inspect",
      "journal_checkpoint",
      "journal_session",
    ]);
    for (const item of result) {
      expect(item.title).toBeTruthy();
      expect(item.description).not.toMatch(/thought|cognitive stage/i);
      expect(item.hostExtras?.mcp?.annotations?.openWorldHint).toBe(false);
    }
  });

  it("computes material file observations and recomputes forged public file provenance", async () => {
    writeFileSync(join(workspace, "state.txt"), "current\n");
    const record = tool("journal_record");
    const observed = await executePortableTool(
      record,
      {
        entries: [
          {
            id: "observed",
            type: "evidence",
            content: "Contract evidence",
            observe_files: [{ path: "state.txt", material: true }],
            dependencies: [
              {
                kind: "file",
                path: "state.txt",
                workspaceId: "forged",
                observedHash: "forged",
                observedAt: "forged",
                originatingEntryId: "observed",
                material: false,
              },
              {
                kind: "repository_state",
                value: "head-1",
                observedAt: "2026-07-13T00:00:00.000Z",
                originatingEntryId: "observed",
                material: false,
              },
            ],
          },
        ],
      },
      { host: "test" },
    );
    expect(observed.isError).toBeFalsy();
    const [entry] = (await storage.getSession("work")).entries;
    expect(entry.dependencies).toEqual([
      {
        kind: "repository_state",
        value: "head-1",
        observedAt: "2026-07-13T00:00:00.000Z",
        originatingEntryId: "observed",
        material: false,
      },
      {
        kind: "file",
        path: "state.txt",
        workspaceId: createHash("sha256").update(realpathSync(workspace)).digest("hex"),
        observedHash: createHash("sha256").update("current\n").digest("hex"),
        observedAt: expect.any(String),
        originatingEntryId: "observed",
        material: true,
      },
    ]);
    expect(JSON.stringify(entry)).not.toContain("forged");
  });

  it("canonicalizes forged checkpoint file provenance from the persisted originating entry", async () => {
    writeFileSync(join(workspace, "checkpoint.txt"), "bound\n");
    await executePortableTool(
      tool("journal_record"),
      {
        entries: [
          {
            id: "checkpoint-source",
            type: "evidence",
            content: "Checkpoint support",
            observe_files: [{ path: "checkpoint.txt", material: true }],
          },
        ],
      },
      { host: "test" },
    );
    const persistedEntry = (await storage.getSession("work")).entries[0];
    const forged = {
      kind: "file",
      path: "checkpoint.txt",
      workspaceId: "forged",
      observedHash: "forged",
      observedAt: "forged",
      originatingEntryId: "checkpoint-source",
      material: false,
    };
    const result = await executePortableTool(
      tool("journal_checkpoint"),
      {
        action: "create",
        objective: "Bind support",
        status: "paused",
        evidence_entry_ids: ["checkpoint-source"],
        artifact_dependencies: [forged],
      },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    const checkpoint = (await storage.getSession("work")).checkpoints[0];
    expect(checkpoint.artifactDependencies).toEqual([persistedEntry.dependencies[0]]);
    expect(JSON.stringify(checkpoint)).not.toContain("forged");
  });

  it("rejects unsafe observed files atomically without leaking candidate data", async () => {
    writeFileSync(join(workspace, "good.txt"), "safe\n");
    writeFileSync(join(workspace, ".env"), "PUBLIC=true\n");
    const token = `ghp_${"s".repeat(30)}`;
    writeFileSync(join(workspace, "payload.txt"), token);
    writeFileSync(join(workspace, "large.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
    mkdirSync(join(workspace, "directory"));
    symlinkSync("good.txt", join(workspace, "link.txt"));
    const record = tool("journal_record");
    for (const [index, path] of ["../outside", ".env", "payload.txt", "large.bin", "directory", "link.txt"].entries()) {
      const result = await executePortableTool(
        record,
        {
          entries: [
            {
              id: `good-${index}`,
              type: "evidence",
              content: "first",
              observe_files: [{ path: "good.txt", material: true }],
            },
            { id: `bad-${index}`, type: "evidence", content: "second", observe_files: [{ path, material: true }] },
          ],
        },
        { host: "test" },
      );
      expect(result.isError, path).toBe(true);
      expect(JSON.stringify(result)).not.toContain(token);
      expect((await storage.getSession("work")).entries, path).toEqual([]);
    }
  });

  it("guides Pi to observe only materially supporting files", () => {
    const record = tool("journal_record");
    expect(record.hostExtras?.pi?.promptGuidelines).toEqual(
      expect.arrayContaining([expect.stringMatching(/observe.*file.*material/i)]),
    );
  });

  it("records entries, inspects bounded history, and resumes a checkpoint", async () => {
    const factory = tools();
    const find = (name: string) => factory.find((item) => item.name === name) as PortableTool<TObject>;
    const recorded = await executePortableTool(
      find("journal_record"),
      {
        entries: [{ type: "decision", content: "Use a private local store" }],
      },
      { host: "test" },
    );
    expect(recorded.isError).toBeFalsy();
    expect(recorded.structuredContent).toMatchObject({ persisted: 1, sessionId: "work" });

    const history = await executePortableTool(find("journal_inspect"), { view: "history", limit: 1 }, { host: "test" });
    expect(history.structuredContent).toMatchObject({ returned: 1, hasMore: false });

    const entryId = (recorded.structuredContent?.entryIds as string[])[0];
    const created = await executePortableTool(
      find("journal_checkpoint"),
      {
        action: "create",
        objective: "Ship journal",
        status: "active",
        settled_decision_entry_ids: [entryId],
      },
      { host: "test" },
    );
    expect(created.isError).toBeFalsy();

    const resumed = await executePortableTool(find("journal_checkpoint"), { action: "resume" }, { host: "test" });
    expect(resumed.structuredContent).toMatchObject({ checkpoint: { objective: "Ship journal" } });
  });

  it("uses canonical alternative-to relationships through the public schema", async () => {
    const factory = tools();
    const record = factory.find((item) => item.name === "journal_record") as PortableTool<TObject>;
    const inspect = factory.find((item) => item.name === "journal_inspect") as PortableTool<TObject>;
    const first = await executePortableTool(
      record,
      { entries: [{ id: "first", type: "decision", content: "Option A" }] },
      { host: "test" },
    );
    expect(first.isError).toBeFalsy();
    const second = await executePortableTool(
      record,
      {
        entries: [
          {
            id: "second",
            type: "decision",
            content: "Option B",
            relationships: [{ type: "alternative-to", targetEntryId: "first" }],
          },
        ],
      },
      { host: "test" },
    );
    expect(second.isError).toBeFalsy();
    const current = await executePortableTool(inspect, { view: "current" }, { host: "test" });
    expect(current.structuredContent).toMatchObject({ unresolvedAlternatives: [["first", "second"]] });
  });

  it("hard-bounds current and resume results by items and UTF-8 bytes", async () => {
    const factory = tools();
    const find = (name: string) => factory.find((item) => item.name === name) as PortableTool<TObject>;
    const entries = Array.from({ length: 6 }, (_, index) => ({
      id: `large-${index}`,
      type: "decision",
      content: `${index}:${"😀".repeat(2400)}`,
    }));
    expect((await executePortableTool(find("journal_record"), { entries }, { host: "test" })).isError).toBeFalsy();
    const current = await executePortableTool(
      find("journal_inspect"),
      { view: "current", limit: 100 },
      { host: "test" },
    );
    expect(Buffer.byteLength(JSON.stringify(current.structuredContent), "utf8")).toBeLessThanOrEqual(32_000);
    expect(current.structuredContent).toMatchObject({ truncated: true, hasMore: true });

    expect(
      (
        await executePortableTool(
          find("journal_checkpoint"),
          {
            action: "create",
            objective: "Bounded",
            status: "active",
            settled_decision_entry_ids: entries.map((entry) => entry.id),
          },
          { host: "test" },
        )
      ).isError,
    ).toBeFalsy();
    const resumed = await executePortableTool(find("journal_checkpoint"), { action: "resume" }, { host: "test" });
    expect(Buffer.byteLength(JSON.stringify(resumed.structuredContent), "utf8")).toBeLessThanOrEqual(32_000);
    expect(resumed.structuredContent).toMatchObject({ truncation: { truncated: true } });
  });

  it("supports list/create/select/status/close through one session tool", async () => {
    const factory = tools();
    const session = factory.find((item) => item.name === "journal_session") as PortableTool<TObject>;
    expect(
      (await executePortableTool(session, { action: "create", session_id: "second" }, { host: "test" })).isError,
    ).toBeFalsy();
    expect(
      (await executePortableTool(session, { action: "select", session_id: "second" }, { host: "test" }))
        .structuredContent,
    ).toMatchObject({ selectedSessionId: "second" });
    expect(
      (await executePortableTool(session, { action: "status" }, { host: "test" })).structuredContent,
    ).toMatchObject({ sessionId: "second", counts: { entries: 0 } });
    expect((await executePortableTool(session, { action: "close" }, { host: "test" })).structuredContent).toMatchObject(
      { closed: true },
    );
    expect(
      (await executePortableTool(session, { action: "list", limit: 10 }, { host: "test" })).structuredContent,
    ).toMatchObject({
      sessions: expect.arrayContaining([
        expect.objectContaining({ sessionId: "work" }),
        expect.objectContaining({ sessionId: "second" }),
      ]),
    });
  });

  it("returns bounded status and finalizes a checkpoint before sealing close", async () => {
    const factory = tools();
    const record = factory.find((item) => item.name === "journal_record") as PortableTool<TObject>;
    const sessionTool = factory.find((item) => item.name === "journal_session") as PortableTool<TObject>;
    for (let index = 0; index < 10; index += 1) {
      expect(
        (
          await executePortableTool(
            record,
            { entries: [{ type: "observation", content: "😀".repeat(1900) }] },
            { host: "test" },
          )
        ).isError,
      ).toBeFalsy();
    }
    const status = await executePortableTool(sessionTool, { action: "status" }, { host: "test" });
    expect(status.isError).toBeFalsy();
    expect(Buffer.byteLength(JSON.stringify(status.structuredContent), "utf8")).toBeLessThan(32_000);
    expect(status.structuredContent).toMatchObject({ sessionId: "work", counts: { entries: 10 } });
    expect(status.structuredContent).not.toHaveProperty("session.entries");

    const closed = await executePortableTool(sessionTool, { action: "close" }, { host: "test" });
    expect(closed.isError).toBeFalsy();
    const persisted = await storage.getSession("work");
    expect(persisted.closedAt).not.toBeNull();
    expect(persisted.activeCheckpointId).not.toBeNull();
    expect(persisted.checkpoints.find((item) => item.id === persisted.activeCheckpointId)?.status).toBe("closed");
    await expect(service.record("work", { type: "observation", content: "too late" })).rejects.toThrow(/closed/i);
  });

  it("atomically includes a concurrently committed record in the final checkpoint or rejects it after sealing", async () => {
    const closing = service.closeSession("work");
    const recording = service.record("work", { id: "concurrent", type: "observation", content: "concurrent fact" });
    const [closeResult, recordResult] = await Promise.allSettled([closing, recording]);
    expect(closeResult.status).toBe("fulfilled");

    const persisted = await storage.getSession("work");
    const finalCheckpoint = persisted.checkpoints.find((item) => item.id === persisted.activeCheckpointId);
    expect(finalCheckpoint?.status).toBe("closed");
    if (recordResult.status === "fulfilled") {
      expect(finalCheckpoint?.supportEntryIds).toContain(recordResult.value.id);
    } else {
      expect(recordResult.reason).toMatchObject({ message: expect.stringMatching(/closed/i) });
    }
  });

  it("returns a bounded receipt for the largest valid identifier batch", async () => {
    const result = await executePortableTool(
      tool("journal_record"),
      {
        entries: Array.from({ length: 10 }, (_, index) => ({
          id: `${index}-${"x".repeat(254)}`,
          type: "observation",
          content: `fact ${index}`,
        })),
      },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")).toBeLessThan(32_000);
    expect(result.structuredContent).toMatchObject({ persisted: 10 });
  });

  it("rejects credentials in checkpoint and session actions without echoing bytes", async () => {
    const secret = `ghp_${"z".repeat(30)}`;
    const checkpoint = await executePortableTool(
      tool("journal_checkpoint"),
      { action: "create", objective: secret, status: "active" },
      { host: "test" },
    );
    const inspect = await executePortableTool(
      tool("journal_inspect"),
      { session_id: secret, view: "history" },
      { host: "test" },
    );
    const session = await executePortableTool(
      tool("journal_session"),
      { action: "create", session_id: secret },
      { host: "test" },
    );
    for (const result of [checkpoint, inspect, session]) {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it.each([
    {
      label: "missing relationship",
      entries: [
        { id: "first-valid", type: "observation", content: "first candidate" },
        {
          id: "second-invalid",
          type: "decision",
          content: "second candidate",
          relationships: [{ type: "supersedes", targetEntryId: "missing" }],
        },
      ],
      forbidden: ["first candidate", "second candidate"],
    },
    {
      label: "credential",
      entries: [
        { id: "first-valid", type: "observation", content: "first candidate" },
        { id: "second-secret", type: "evidence", content: `ghp_${"q".repeat(30)}` },
      ],
      forbidden: ["first candidate", `ghp_${"q".repeat(30)}`],
    },
  ])("persists none of a journal_record batch when a later entry has a $label", async ({ entries, forbidden }) => {
    const result = await executePortableTool(tool("journal_record"), { entries }, { host: "test" });
    expect(result.isError).toBe(true);
    expect((await storage.getSession("work")).entries).toEqual([]);
    for (const candidate of forbidden) expect(JSON.stringify(result)).not.toContain(candidate);
  });

  it("returns domain errors without echoing credential content", async () => {
    const secret = `sk-${"a".repeat(30)}`;
    const result = await executePortableTool(
      tool("journal_record"),
      {
        entries: [{ type: "evidence", content: secret }],
      },
      { host: "test" },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.structuredContent).toMatchObject({ kind: "domain", tool: "journal_record" });
  });

  it.each([
    ["journal_record", { entries: [] }],
    ["journal_inspect", { view: "everything" }],
    ["journal_checkpoint", { action: "replace" }],
    ["journal_session", { action: "delete" }],
  ])("classifies malformed %s input as a validation error", async (name, args) => {
    const result = await executePortableTool(tool(name), args, { host: "test" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ kind: "validation", tool: name });
  });

  it.each([
    ["journal_record", "recordBatch"],
    ["journal_inspect", "inspectCurrent"],
    ["journal_checkpoint", "resume"],
    ["journal_session", "listSessionsPage"],
  ] as const)("bounds and sanitizes %s handler failures as domain errors", async (name, method) => {
    const secret = `ghp_${"s".repeat(36)}`;
    const unsafe = `\u001b[31m\u0000${"failure".repeat(6_000)}\u001b[0m`;
    const target = method === "listSessionsPage" ? storage : service;
    const mocked = vi.spyOn(target as never, method as never) as unknown as {
      mockRejectedValueOnce: (error: Error) => void;
    };
    mocked.mockRejectedValueOnce(new Error(unsafe));
    const args: Record<string, unknown> = {
      journal_record: { entries: [{ type: "observation", content: "safe candidate" }] },
      journal_inspect: { view: "current" },
      journal_checkpoint: { action: "resume" },
      journal_session: { action: "list" },
    }[name] as Record<string, unknown>;
    const result = await executePortableTool(tool(name), args, { host: "test" });
    const encoded = JSON.stringify(result);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ kind: "domain", tool: name });
    expect(hasUnsafeControl(result.text)).toBe(false);
    expect(hasUnsafeControl((result.structuredContent?.error as string) ?? "")).toBe(false);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(32_000);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(32_000);

    mocked.mockRejectedValueOnce(new Error(`failure\n${secret}`));
    const secretResult = await executePortableTool(tool(name), args, { host: "test" });
    expect(JSON.stringify(secretResult)).not.toContain(secret);
  });

  it("redacts native absolute paths from tool-facing filesystem errors", async () => {
    const absolute = join(root, "sessions", "work.json");
    const error = new Error(`EACCES: permission denied, open '${absolute}'`) as NodeJS.ErrnoException;
    error.code = "EACCES";
    vi.spyOn(storage, "listSessionsPage").mockRejectedValueOnce(error);
    const result = await executePortableTool(tool("journal_session"), { action: "list" }, { host: "test" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain("work.json");
    expect(result.structuredContent).toMatchObject({ kind: "domain", tool: "journal_session" });
  });

  it("paginates oversized current entries and unresolved alternatives within one result budget", async () => {
    const maxId = (prefix: string, index: number) => `${prefix}-${index}-${"x".repeat(248 - String(index).length)}`;
    for (let index = 0; index < 100; index += 1) {
      const left = maxId("a", index);
      const right = maxId("b", index);
      await service.recordBatch("work", [
        { id: left, type: "observation", content: `left ${index}` },
        {
          id: right,
          type: "assumption",
          content: `right ${index}`,
          relationships: [{ type: "alternative-to", targetEntryId: left }],
        },
      ]);
    }

    const first = await executePortableTool(tool("journal_inspect"), { view: "current", limit: 100 }, { host: "test" });
    expect(first.isError).toBeFalsy();
    expect(Buffer.byteLength(JSON.stringify(first.structuredContent), "utf8")).toBeLessThanOrEqual(32_000);
    expect(first.structuredContent).toMatchObject({
      truncated: true,
      hasMore: true,
      alternativesTruncated: true,
      alternativesHasMore: true,
      nextCursor: expect.any(String),
      alternativesNextCursor: expect.any(String),
    });
    expect((first.structuredContent?.items as unknown[]).length).toBeGreaterThan(0);
    expect((first.structuredContent?.unresolvedAlternatives as unknown[]).length).toBeGreaterThan(0);

    const second = await executePortableTool(
      tool("journal_inspect"),
      { view: "current", limit: 100, cursor: first.structuredContent?.nextCursor },
      { host: "test" },
    );
    expect(second.isError).toBeFalsy();
    expect(second.structuredContent).not.toEqual(first.structuredContent);
    expect(Buffer.byteLength(JSON.stringify(second.structuredContent), "utf8")).toBeLessThanOrEqual(32_000);
  });
});

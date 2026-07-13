import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "../extensions/domain.js";
import { JournalService } from "../extensions/journal-service.js";
import { DEFAULT_JOURNAL_FILE_SYSTEM, JournalStorage, type JournalStorageFileSystem } from "../extensions/storage.js";

interface MutableEnvelope extends Record<string, unknown> {
  entries: unknown[];
  checkpoints: unknown[];
  activeCheckpointId: unknown;
  fingerprint?: string;
}

const entry = (id: string): JournalEntry => ({
  id,
  type: "observation",
  content: id,
  relationships: [],
  dependencies: [],
  timestamp: "2026-07-12T00:00:00.000Z",
});

describe("JournalStorage", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-journal-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("persists sessions and checkpoint heads across instances", async () => {
    const first = new JournalStorage(root);
    await first.createSession("work");
    await first.appendEntries("work", [entry("one")]);
    await first.saveCheckpoint("work", {
      id: "cp-1",
      objective: "ship",
      status: "active",
      settledDecisionEntryIds: [],
      openQuestions: [],
      evidenceEntryIds: [],
      artifactDependencies: [],
      nextActionEntryId: null,
      supportEntryIds: ["one"],
      createdAt: "2026-07-12T00:00:00.000Z",
    });
    const second = new JournalStorage(root);
    const loaded = await second.getSession("work");
    expect(loaded.entries.map((item) => item.id)).toEqual(["one"]);
    expect(loaded.activeCheckpointId).toBe("cp-1");
    expect(loaded.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("serializes concurrent appends without lost entries", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    await Promise.all(Array.from({ length: 20 }, (_, index) => storage.appendEntries("work", [entry(`e-${index}`)])));
    expect((await storage.getSession("work")).entries).toHaveLength(20);
  });

  it("preserves mixed record, deterministic append, checkpoint, and close invariants under concurrency", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    const service = new JournalService({ storage, workspaceRoot: process.cwd() });
    await service.record("work", { id: "anchor", type: "decision", content: "settled choice" });

    const explicit = Array.from({ length: 8 }, (_, index) =>
      service.record("work", { id: `explicit-${index}`, type: "observation", content: `fact ${index}` }),
    );
    const autonomous = Array.from({ length: 8 }, (_, index) =>
      storage.appendEntries("work", [entry(`autonomous-${index}`)]),
    );
    const checkpoint = service.createCheckpoint("work", {
      id: "explicit-checkpoint",
      objective: "ship",
      status: "active",
      settledDecisionEntryIds: ["anchor"],
    });
    const close = service.closeSession("work");
    const results = await Promise.allSettled([...explicit, ...autonomous, checkpoint, close]);
    expect(results.at(-1)?.status).toBe("fulfilled");

    const restarted = new JournalStorage(root);
    const session = await restarted.getSession("work");
    const ids = session.entries.map((item) => item.id);
    const finalCheckpoint = session.checkpoints.find((item) => item.id === session.activeCheckpointId);
    expect(finalCheckpoint?.status).toBe("closed");
    for (let index = 0; index < 16; index += 1) {
      const result = results[index];
      const id = index < 8 ? `explicit-${index}` : `autonomous-${index - 8}`;
      if (result.status === "fulfilled") {
        expect(ids.filter((candidate) => candidate === id)).toHaveLength(1);
        expect(finalCheckpoint?.supportEntryIds).toContain(id);
      } else {
        expect(result.reason).toMatchObject({ message: expect.stringMatching(/closed/i) });
      }
    }
    const entriesById = new Map(session.entries.map((item) => [item.id, item]));
    for (const saved of session.checkpoints) {
      expect(saved.supportEntryIds.every((id) => entriesById.has(id))).toBe(true);
      expect(saved.settledDecisionEntryIds.every((id) => entriesById.get(id)?.type === "decision")).toBe(true);
      expect(
        saved.evidenceEntryIds.every((id) => ["evidence", "validation"].includes(entriesById.get(id)?.type ?? "")),
      ).toBe(true);
      expect(saved.nextActionEntryId === null || entriesById.get(saved.nextActionEntryId)?.type === "next_action").toBe(
        true,
      );
    }
    expect((await new JournalStorage(root).getSession("work")).fingerprint).toBe(session.fingerprint);
  });

  it("uses restrictive permissions and atomic JSON envelopes", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    const file = join(root, "sessions", "work.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).schemaVersion).toBe(1);
    if (process.platform !== "win32") {
      expect(statSync(root).mode & 0o077).toBe(0);
      expect(statSync(file).mode & 0o077).toBe(0);
    }
  });

  it("paginates sessions and reports corrupt members without aborting enumeration", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("a");
    await storage.createSession("b");
    writeFileSync(join(root, "sessions", "broken.json"), "{broken", "utf8");
    const first = await storage.listSessionsPage({ limit: 1 });
    expect(first.sessions).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await storage.listSessionsPage({ limit: 10, cursor: first.nextCursor ?? undefined });
    expect([...first.sessions, ...second.sessions].map((item) => item.sessionId).sort()).toEqual(["a", "b"]);
    expect(second.diagnostics).toEqual([expect.objectContaining({ code: "invalid_session", sessionId: "broken" })]);
    expect(JSON.stringify(second)).not.toContain(root);
  });

  it("diagnoses a valid session changed by another writer", async () => {
    const first = new JournalStorage(root);
    await first.createSession("work");
    const second = new JournalStorage(root);
    await second.appendEntries("work", [entry("external")]);
    await expect(first.getSession("work")).rejects.toThrow(/outside this writer/i);
  });

  it("redacts absolute storage paths from native filesystem failures", async () => {
    const baseline = new JournalStorage(root);
    await baseline.createSession("work");
    const fileSystem: JournalStorageFileSystem = {
      ...DEFAULT_JOURNAL_FILE_SYSTEM,
      writeFile(path) {
        const error = new Error(`EACCES: permission denied, open '${path}'`) as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    };
    const failing = new JournalStorage(root, { fileSystem });
    let message = "";
    try {
      await failing.appendEntries("work", [entry("blocked")]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/filesystem.*write|write.*filesystem/i);
    expect(message).not.toContain(root);
    expect(message).not.toContain("work.json");
  });

  it.each([
    "write",
    "temp-fsync",
    "rename",
    "destination-chmod",
    "directory-fsync",
  ] as const)("recovers its mutation queue and cleans temporary files after a %s crash", async (stage) => {
    const baseline = new JournalStorage(root);
    await baseline.createSession("work");
    await baseline.appendEntries("work", [entry("published")]);
    let failed = false;
    const fileSystem: JournalStorageFileSystem = {
      ...DEFAULT_JOURNAL_FILE_SYSTEM,
      writeFile(path, value) {
        if (stage === "write" && !failed) {
          failed = true;
          throw new Error("injected write crash");
        }
        DEFAULT_JOURNAL_FILE_SYSTEM.writeFile(path, value);
      },
      chmod(path, mode) {
        if (stage === "destination-chmod" && path.endsWith("work.json") && !failed) {
          failed = true;
          throw new Error("injected chmod crash");
        }
        DEFAULT_JOURNAL_FILE_SYSTEM.chmod(path, mode);
      },
      syncPath(path) {
        const isTemp = path.includes(".tmp.");
        const isDirectory = path.endsWith("sessions");
        if (((stage === "temp-fsync" && isTemp) || (stage === "directory-fsync" && isDirectory)) && !failed) {
          failed = true;
          throw new Error("injected fsync crash");
        }
        DEFAULT_JOURNAL_FILE_SYSTEM.syncPath(path);
      },
      rename(from, to) {
        if (stage === "rename" && !failed) {
          failed = true;
          throw new Error("injected rename crash");
        }
        DEFAULT_JOURNAL_FILE_SYSTEM.rename(from, to);
      },
    };
    const crashing = new JournalStorage(root, { fileSystem });
    await expect(crashing.appendEntries("work", [entry("interrupted")])).rejects.toThrow(/injected/i);
    expect(() => JSON.parse(readFileSync(join(root, "sessions", "work.json"), "utf8"))).not.toThrow();
    expect(readdirSync(join(root, "sessions")).filter((name) => name.includes(".tmp."))).toEqual([]);

    await crashing.appendEntries("work", [entry("after-recovery")]);
    const restarted = new JournalStorage(root);
    const recovered = await restarted.getSession("work");
    expect(recovered.entries.filter((item) => item.id === "after-recovery")).toHaveLength(1);
    expect(recovered.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["malformed entry", (value: MutableEnvelope) => value.entries.push({ id: "bad" })],
    ["missing active checkpoint", (value: MutableEnvelope) => (value.activeCheckpointId = "absent")],
    [
      "checkpoint reference to absent entry",
      (value: MutableEnvelope) => {
        value.checkpoints.push({
          id: "forged-cp",
          objective: "forged",
          status: "active",
          settledDecisionEntryIds: [],
          openQuestions: [],
          evidenceEntryIds: [],
          artifactDependencies: [],
          nextActionEntryId: null,
          supportEntryIds: ["absent"],
          createdAt: "2026-07-12T00:00:00.000Z",
        });
        value.activeCheckpointId = "forged-cp";
      },
    ],
  ])("rejects a correctly fingerprinted envelope with %s and leaves it untouched", async (_label, mutate) => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    const path = join(root, "sessions", "work.json");
    const forged = JSON.parse(readFileSync(path, "utf8")) as MutableEnvelope;
    delete forged.fingerprint;
    mutate(forged);
    forged.fingerprint = createHash("sha256").update(JSON.stringify(forged)).digest("hex");
    const raw = JSON.stringify(forged, null, 2);
    writeFileSync(path, raw, "utf8");

    await expect(new JournalStorage(root).getSession("work")).rejects.toThrow(/invalid journal session/i);
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("reports corrupt sessions without erasing them", async () => {
    const sessions = join(root, "sessions");
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    writeFileSync(join(sessions, "work.json"), "{broken", "utf8");
    await expect(storage.getSession("work")).rejects.toThrow(/invalid journal session/i);
    expect(readFileSync(join(sessions, "work.json"), "utf8")).toBe("{broken");
  });

  it("appends notice resolution state without mutating the historical notice", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    const notice = {
      id: "notice-1",
      category: "stale" as const,
      safeSummary: "Material file dependency is stale",
      affectedIds: ["entry-1"],
      requiresJudgment: true,
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    await storage.appendNotice("work", notice);
    const before = await storage.getSession("work");
    await storage.resolveNotices("work", ["entry-1"]);
    const after = await storage.getSession("work");

    expect(after.notices).toEqual(before.notices);
    expect(after.notices[0]).toEqual(notice);
    expect(after.noticeResolutions).toEqual([
      expect.objectContaining({ noticeId: "notice-1", affectedIds: ["entry-1"] }),
    ]);
  });

  it("seals closed sessions against every subsequent mutation while keeping them readable", async () => {
    const storage = new JournalStorage(root);
    await storage.createSession("work");
    await storage.appendEntries("work", [entry("one")]);
    await storage.closeSession("work");
    await expect(storage.appendEntries("work", [entry("two")])).rejects.toThrow(/closed/i);
    await expect(
      storage.saveCheckpoint("work", {
        id: "after-close",
        objective: "invalid",
        status: "active",
        settledDecisionEntryIds: [],
        openQuestions: [],
        evidenceEntryIds: [],
        artifactDependencies: [],
        nextActionEntryId: null,
        supportEntryIds: [],
        createdAt: "2026-07-12T00:00:00.000Z",
      }),
    ).rejects.toThrow(/closed/i);
    await expect(
      storage.appendNotice("work", {
        id: "notice",
        category: "conflict",
        safeSummary: "invalid",
        affectedIds: [],
        requiresJudgment: true,
        createdAt: "2026-07-12T00:00:00.000Z",
      }),
    ).rejects.toThrow(/closed/i);
    expect((await storage.getSession("work")).entries.map((item) => item.id)).toEqual(["one"]);
  });

  it("enforces configured storage byte and line limits", async () => {
    const bytes = new JournalStorage(join(root, "bytes"), { maxBytes: 500 });
    await bytes.createSession("work");
    await expect(bytes.appendEntries("work", [entry("x".repeat(400))])).rejects.toThrow(/byte limit/i);

    const lines = new JournalStorage(join(root, "lines"), { maxLines: 20 });
    await lines.createSession("work");
    await expect(lines.appendEntries("work", [entry("one")])).rejects.toThrow(/line limit/i);
  });

  it("rejects traversal, symlinked stores, and legacy storage paths", () => {
    expect(() => new JournalStorage(join(root, ".mcp_sequential_thinking"))).toThrow(/legacy/i);
    const target = join(root, "target");
    mkdirSync(target);
    const linked = join(root, "linked");
    symlinkSync(target, linked);
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(() => new JournalStorage(linked)).toThrow(/symlink/i);
  });

  it("rejects a symlinked sessions directory", () => {
    const store = join(root, "store");
    const target = join(root, "target");
    mkdirSync(store);
    mkdirSync(target);
    symlinkSync(target, join(store, "sessions"));
    expect(() => new JournalStorage(store)).toThrow(/symlink/i);
  });

  it("rejects a symlinked session file", async () => {
    const storage = new JournalStorage(root);
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}", "utf8");
    symlinkSync(outside, join(root, "sessions", "work.json"));
    await expect(storage.getSession("work")).rejects.toThrow(/symlink/i);
  });
});

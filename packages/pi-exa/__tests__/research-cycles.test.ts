import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResearchCycles, projectResearchSummary, researchProjectId } from "../extensions/research-cycles.js";
import { agentRequestHash } from "../extensions/research-execution.js";
import { withResearchStorageLock } from "../extensions/research-storage-lock.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, rename: vi.fn(original.rename), open: vi.fn(original.open), unlink: vi.fn(original.unlink) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.unlink).mockReset();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("research storage availability regressions", () => {
  it("does not spend its contention deadline preparing an uncontended lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const file = await original.open(...args);
      if (String(args[0]).includes(".lock-owner-")) {
        const sync = file.sync.bind(file);
        vi.spyOn(file, "sync").mockImplementation(async () => {
          elapsed += 1100;
          await sync();
        });
      }
      return file;
    });
    const action = vi.fn(async () => "uncontended");
    await expect(withResearchStorageLock(root, action)).resolves.toBe("uncontended");
    expect(action).toHaveBeenCalledOnce();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it.each([
    false,
    true,
  ])("removes candidate links before the protected action, including failure=%s", async (failure) => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const action = withResearchStorageLock(root, async () => {
      expect(await fs.readdir(root)).toEqual([".lock"]);
      if (failure) throw new Error("protected action failed");
      return "success";
    });
    if (failure) await expect(action).rejects.toThrow("protected action failed");
    else await expect(action).resolves.toBe("success");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("recovers a proven dead transaction lock without dropping records", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("topic");
    const lock = join(root, "store", controller.projectId, ".lock");
    await writeFile(
      lock,
      JSON.stringify({
        kind: "research-storage-lock-v1",
        pid: 2147483647,
        token: "00000000-0000-4000-8000-000000000001",
      }),
      { mode: 0o600 },
    );
    expect((await controller.list()).map((record) => record.id)).toEqual([cycle.id]);
    await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains live and legacy unknown locks and names the lock requiring repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    await controller.start("topic");
    const lock = join(root, "store", controller.projectId, ".lock");
    const live = JSON.stringify({
      kind: "research-storage-lock-v1",
      pid: process.pid,
      token: "00000000-0000-4000-8000-000000000002",
    });
    await writeFile(lock, live, { mode: 0o600 });
    vi.spyOn(Date, "now").mockReturnValue(0);
    await expect(controller.list()).rejects.toThrow(lock);
    expect(await readFile(lock, "utf8")).toBe(live);
    await writeFile(lock, "");
    await expect(controller.list()).rejects.toThrow(lock);
    expect(await readFile(lock, "utf8")).toBe("");
  });

  it("serializes competing stale-lock reclaimers and recovers a crashed reclaimer", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const first = await createResearchCycles(options);
    const second = await createResearchCycles({ ...options, sessionId: "two" });
    await first.list();
    const directory = join(options.root, first.projectId);
    const token = "00000000-0000-4000-8000-000000000004";
    await writeFile(
      join(directory, ".lock"),
      JSON.stringify({
        kind: "research-storage-lock-v1",
        pid: 2147483647,
        token,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, `.lock.recovery-${token}`),
      JSON.stringify({
        kind: "research-storage-lock-v1",
        pid: 2147483647,
        token: "00000000-0000-4000-8000-000000000005",
      }),
      { mode: 0o600 },
    );
    const created = await Promise.all([first.start("first"), second.start("second")]);
    expect(created[0].id).not.toBe(created[1].id);
    expect(await first.list()).toHaveLength(2);
    expect((await fs.readdir(directory)).filter((name) => name.startsWith(".lock"))).toEqual([]);
  });

  it("discovers readable cycles with unreadable IDs while strict attribution listing remains closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("topic");
    const broken = "00000000-0000-4000-8000-000000000003";
    await writeFile(join(root, "store", controller.projectId, `${broken}.json`), "{PRIVATE_MALFORMED", { mode: 0o600 });
    expect(await controller.discover()).toMatchObject({ cycles: [{ id: cycle.id }], unreadableCycleIds: [broken] });
    await expect(controller.list()).rejects.toThrow("incomplete");
  });

  it("does not revoke a pending activation when archiving an unrelated saved cycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const old = await controller.start("old");
    await controller.archive();
    const pending = controller.start("active");
    const archived = controller.archive(old.id);
    expect((await pending).plan.topic).toBe("active");
    await archived;
    expect((await controller.status())?.plan.topic).toBe("active");
  });

  it("syncs the storage hierarchy once per controller, not on every read", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    await controller.start("topic");
    vi.mocked(fs.open).mockClear();
    await controller.status();
    await controller.list();
    const parent = dirname(root);
    expect(vi.mocked(fs.open).mock.calls.some(([path]) => String(path) === parent)).toBe(false);
  });
});

describe("durable research cycles", () => {
  async function readyAgent() {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: {
        goal: "answer",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const artifact = await controller.preview();
    await controller.grantBudget(cycle.id, 1, ["web_research_exa"]);
    const hash = agentRequestHash(artifact.request);
    await controller.grantUncertainty(cycle.id, "request", hash, 0.2);
    return { controller, cycle, artifact, hash, root };
  }

  it("coalesces repeated Agent observations without losing progress, output or conflicting receipts", async () => {
    const { controller, cycle, hash } = await readyAgent();
    const { attempt } = await controller.reserveAgent();
    const observer = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    (await observer.beforeCreate())();
    vi.mocked(fs.rename).mockClear();
    const pending = { id: "agent_dedup", status: "running", usage: { searches: 1 } } satisfies Parameters<
      typeof observer.raw
    >[1];
    await observer.raw("create", pending);
    expect(fs.rename).toHaveBeenCalledTimes(1);
    await observer.raw("get", structuredClone(pending));
    expect(fs.rename).toHaveBeenCalledTimes(1);
    await observer.raw("get", { ...pending, usage: { searches: 2 } });
    expect(fs.rename).toHaveBeenCalledTimes(2);
    const completed = {
      id: pending.id,
      status: "completed",
      usage: { searches: 2 },
      output: { structured: { answer: "original" } },
      costDollars: { total: 0.1 },
    } satisfies Parameters<typeof observer.raw>[1];
    await observer.raw("get", completed);
    expect(fs.rename).toHaveBeenCalledTimes(3);
    await observer.raw("get", completed);
    const ignoredUsage = { searches: 2, ignoredCounter: 99 };
    await observer.raw("get", { ...completed, usage: ignoredUsage });
    await controller.agentLifecycleObserver(cycle.id, attempt.id, hash).raw("get", completed);
    expect(fs.rename).toHaveBeenCalledTimes(3);
    await observer.raw("get", { ...completed, output: { structured: { answer: "updated" } } });
    expect(fs.rename).toHaveBeenCalledTimes(4);
    await observer.raw("get", {
      ...completed,
      output: { structured: { answer: "updated" } },
      costDollars: { total: 0.100001 },
    });
    expect(fs.rename).toHaveBeenCalledTimes(5);
    expect(await controller.inspect(cycle.id)).toMatchObject({
      status: "completed",
      attempts: [{ result: { taskOutput: { answer: "updated" }, usage: { searches: 2 } } }],
      ledger: [{ reportedMicros: 100000, conflictingMicros: [100001] }],
    });
    await observer.finish();
    await controller.detach();
  });

  it("serializes competing Agent intents and competing dispatch claims without granting a second SDK capability", async () => {
    const { controller, cycle, hash } = await readyAgent();
    const attempts = await Promise.allSettled([controller.reserveAgent(), controller.reserveAgent()]);
    const prepared = attempts.find((outcome) => outcome.status === "fulfilled");
    if (!prepared || prepared.status !== "fulfilled") throw new Error("Expected one prepared intent");
    expect(attempts.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const first = controller.agentLifecycleObserver(cycle.id, prepared.value.attempt.id, hash);
    const second = controller.agentLifecycleObserver(cycle.id, prepared.value.attempt.id, hash);
    const guards = await Promise.allSettled([first.beforeCreate(), second.beforeCreate()]);
    expect(guards.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const record = await controller.inspect(cycle.id);
    expect(record.attempts).toHaveLength(1);
    expect(record.ledger).toHaveLength(1);
    await controller.detach();
  });

  it.each([
    { originalDollars: 0.000123, incomingDollars: 0.000123, conflictingMicros: [] },
    { originalDollars: 0.000124, incomingDollars: 0.000123, conflictingMicros: [123] },
    { originalDollars: 0.000123, incomingDollars: 0.000122, conflictingMicros: [122] },
  ])("preserves historical rounding only for identical known terminal dollars $originalDollars -> $incomingDollars", async ({
    originalDollars,
    incomingDollars,
    conflictingMicros,
  }) => {
    const { controller, cycle, hash, root } = await readyAgent();
    const { attempt } = await controller.reserveAgent();
    const observer = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    (await observer.beforeCreate())();
    const reply = {
      id: "agent_legacy_receipt",
      status: "completed",
      output: { structured: { answer: "done" } },
      costDollars: { total: originalDollars },
    } satisfies Parameters<typeof observer.raw>[1];
    await observer.raw("create", reply);
    await observer.finish();
    await controller.detach();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    // Exact old converter result, with the original curated SDK dollar amount
    // and all authorization/attempt/operation metadata untouched.
    saved.ledger[0].reportedMicros = Math.ceil(originalDollars * 1_000_000);
    await writeFile(path, JSON.stringify(saved));
    const resumed = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "two" });
    await resumed.resume(cycle.id);
    const before = await resumed.inspect(cycle.id);
    await resumed.agentLifecycleObserver(cycle.id, attempt.id, hash).raw("get", {
      ...reply,
      costDollars: { total: incomingDollars },
    });
    const after = await resumed.inspect(cycle.id);
    expect(after.ledger[0]).toMatchObject({ reportedMicros: 124, status: "reported" });
    expect("conflictingMicros" in after.ledger[0] ? after.ledger[0].conflictingMicros : []).toEqual(conflictingMicros);
    expect(after.grants).toEqual(before.grants);
    expect(after.status).toBe("completed");
    if (!conflictingMicros.length) expect(after).toEqual(before);
    await resumed.detach();
  });

  it("releases only proven pre-SDK nondispatch and never erases the durable attempt or silently replaces it", async () => {
    const { controller, cycle, hash } = await readyAgent();
    const { attempt } = await controller.reserveAgent();
    const observer = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    await observer.finish();
    expect(await controller.inspect(cycle.id)).toMatchObject({
      status: "planning",
      attempts: [{ status: "not-dispatched" }],
      ledger: [{ status: "not-dispatched" }],
    });
    await expect(observer.beforeCreate()).rejects.toThrow("CYCLE_NOT_EXECUTABLE");
    await expect(controller.reserveAgent()).rejects.toThrow("AGENT_ATTEMPT_EXISTS");
    await controller.detach();
  });

  it("does not let an unclaimed observer release another observer's possible SDK submission", async () => {
    const { controller, cycle, hash } = await readyAgent();
    const { attempt } = await controller.reserveAgent();
    const first = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    (await first.beforeCreate())();
    await controller.agentLifecycleObserver(cycle.id, attempt.id, hash).finish();
    expect(await controller.inspect(cycle.id)).toMatchObject({
      status: "unknown",
      attempts: [{ status: "unknown" }],
      ledger: [{ status: "unknown" }],
    });
    await controller.detach();
  });

  it("persists local-invalid remote success and retries the original receipt after a transient durable-write failure", async () => {
    const { controller, cycle, hash } = await readyAgent();
    const { attempt } = await controller.reserveAgent();
    const observer = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    (await observer.beforeCreate())();
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("receipt denied"));
    await observer.raw("create", {
      id: "agent_run_one",
      status: "completed",
      output: { structured: { answer: 7 } },
      costDollars: { total: 0.1 },
    });
    await observer.finish();
    expect(await controller.inspect(cycle.id)).toMatchObject({
      status: "completed",
      attempts: [{ status: "completed", result: { processing: "failed" } }],
      ledger: [{ status: "reported", reportedMicros: 100_000 }],
    });
    await expect(controller.reserveAgent()).rejects.toThrow("CYCLE_NOT_EXECUTABLE");
    await controller.detach();
  });
  it("keeps an interrupted claimed Agent attempt unknown and accepts late completion without reactivating an archived cycle", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: { goal: "answer", taskSchema: { type: "object" } },
    });
    const artifact = await controller.preview();
    await controller.grantBudget(cycle.id, 1, ["web_research_exa"]);
    const hash = agentRequestHash(artifact.request);
    await controller.grantUncertainty(cycle.id, "request", hash, 0.2);
    const { attempt } = await controller.reserveAgent();
    const observer = controller.agentLifecycleObserver(cycle.id, attempt.id, hash);
    (await observer.beforeCreate())();
    await observer.finish();
    expect(await controller.inspect(cycle.id)).toMatchObject({
      status: "unknown",
      attempts: [{ status: "unknown" }],
      ledger: [{ status: "unknown" }],
    });
    await controller.archive();
    const newCycle = await controller.start("new question");
    await expect(observer.beforeCreate()).rejects.toThrow("detached");
    await observer.raw("create", {
      id: "agent_run_late",
      status: "completed",
      output: { structured: { answer: "late" } },
      costDollars: { total: 0.1 },
    });
    expect(await controller.inspect(cycle.id)).toMatchObject({
      archived: true,
      status: "completed",
      attempts: [{ status: "completed", result: { remoteId: "agent_run_late" } }],
      ledger: [{ status: "reported", reportedMicros: 100_000 }],
    });
    expect((await controller.inspect(cycle.id)).owner).toBeUndefined();
    expect(await controller.status()).toMatchObject({ id: newCycle.id, status: "planning", attempts: [] });
    await controller.detach();
  });
  it("freezes a single compiled Agent intent, preserves provisional exposure, and completes without changing criterion coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare execution",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      criteria: [{ id: "answer", label: "Supported answer" }],
      executionPlan: {
        goal: "answer the question",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const artifact = await controller.preview();
    const criteriaBefore = (await controller.inspect(cycle.id)).plan.criteria;
    await controller.grantBudget(cycle.id, 1, ["web_research_exa"]);
    const requestHash = agentRequestHash(artifact.request);
    await controller.grantUncertainty(cycle.id, "request", requestHash, 0.2);
    const prepared = await controller.reserveAgent({
      cycleId: cycle.id,
      expectedRevision: artifact.revision,
      artifactHash: artifact.hash,
    });
    expect(prepared.attempt).toMatchObject({ status: "intent", revision: 1, requestHash, artifact });
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([
      { status: "reserved", estimateMicros: 200_000 },
    ]);
    const observer = controller.agentLifecycleObserver(cycle.id, prepared.attempt.id, requestHash);
    (await observer.beforeCreate())();
    await observer.raw("create", { id: "agent_run_one", status: "queued", costDollars: { total: 0 } });
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([{ status: "reserved" }]);
    await observer.raw("get", {
      id: "agent_run_one",
      status: "completed",
      costDollars: { total: 0.1 },
      output: { structured: { answer: "result" } },
    });
    const completed = await controller.inspect(cycle.id);
    expect(completed).toMatchObject({
      status: "completed",
      revision: 1,
      attempts: [{ status: "completed", result: { processing: "validated", taskOutput: { answer: "result" } } }],
      ledger: [{ status: "reported", reportedMicros: 100_000 }],
    });
    expect(completed.plan.criteria).toEqual(criteriaBefore);
    await expect(controller.reserveAgent()).rejects.toThrow("CYCLE_NOT_EXECUTABLE");
    await controller.detach();
  });
  it.each([
    "detach",
    "archive",
  ] as const)("prevents candidate publication when %s revokes capture during temporary-file sync", async (action) => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (
        String(args[0]).startsWith(join(root, "store", controller.projectId, `${cycle.id}.json.`)) &&
        String(args[0]).endsWith(".tmp")
      ) {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementationOnce(async () => {
          enter();
          await hold;
          await sync();
        });
      }
      return handle;
    });
    const pending = controller.explorationEvidenceObserver(
      cycle.id,
      operation.id,
      operation.requestHash,
    )({
      results: [{ url: "https://example.com/revoked", title: "Revoked" }],
    });
    await entered;
    const ending = controller[action]();
    release();
    await expect(pending).rejects.toThrow("capture was detached before publication");
    await ending;
    expect((await controller.inspect(cycle.id)).candidates ?? []).toEqual([]);
    vi.mocked(fs.open).mockReset();
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.009 });
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([{ reportedMicros: 9_000 }]);
  });

  it("reports an already-published capture truthfully when archive revokes during directory sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (String(args[0]) === join(options.root, controller.projectId)) {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementationOnce(async () => {
          enter();
          await hold;
          await sync();
        });
      }
      return handle;
    });
    const pending = controller.explorationEvidenceObserver(
      cycle.id,
      operation.id,
      operation.requestHash,
    )({
      results: [{ url: "https://example.com/published", title: "Published" }],
    });
    await entered;
    const archiving = controller.archive();
    release();
    expect(await pending).toMatchObject({ captured: true });
    await archiving;
    expect(await controller.inspect(cycle.id)).toMatchObject({
      archived: true,
      candidates: [{ url: "https://example.com/published" }],
    });
  });
  it("refreshes candidate-owned metadata on explicit reselection while preserving curated source and selection notes", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const first = await controller.reserveExploration("web_search_exa", { query: "discover" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      first.operation.id,
      first.operation.requestHash,
    )({
      results: [{ url: "https://example.com/source", title: "Old title" }],
    });
    const candidate = (await controller.status())?.candidates?.[0];
    if (!candidate) throw new Error("Missing candidate");
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Select",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
      evidence: [{ candidateId: candidate.id, decision: "select", label: "Source", notes: "Curated selection note" }],
      executionPlan: { goal: "question", taskSchema: { type: "object" } },
    });
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Record source notes",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
      sources: [
        {
          id: candidate.id,
          title: "Old title",
          url: candidate.url,
          contentNotes: "Curated content note",
          qualityNotes: "Curated quality note",
        },
      ],
    });
    const before = await controller.preview();
    const second = await controller.reserveExploration("web_search_exa", { query: "fetch" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      second.operation.id,
      second.operation.requestHash,
    )({
      results: [{ url: candidate.url, title: "New title", text: "Unarchived body" }],
    });
    expect((await controller.preview()).hash).toBe(before.hash);
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Refresh selection",
      thought_number: 3,
      total_thoughts: 3,
      next_step_needed: false,
      evidence: [{ candidateId: candidate.id, decision: "select", label: "Source" }],
    });
    const selected = (await controller.preview()).selectedEvidence[0];
    expect(selected).toMatchObject({
      title: "New title",
      retrievalStatus: "fetched",
      notes: "Curated selection note",
      contentNotes: "Curated content note",
      qualityNotes: "Curated quality note",
      provenance: [{ operationId: first.operation.id }, { operationId: second.operation.id }],
    });
    expect(selected.retrievalEvidence).toContain(second.operation.id);
    expect(selected.retrievalEvidence).toContain("fetched");
    expect(selected.retrievalEvidence).not.toContain("discovered_only");
    await controller.detach();
  });
  it("rejects a same-step source collision without committing an unreadable cycle or consuming the step", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      operation.id,
      operation.requestHash,
    )({
      results: [{ url: "https://candidate.example", title: "Candidate" }],
    });
    const before = await controller.status();
    const candidate = before?.candidates?.[0];
    if (!candidate) throw new Error("Missing candidate");
    await expect(
      controller.recordStep({
        topic: "question",
        stage: "source_retrieval",
        note: "Select",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
        evidence: [{ candidateId: candidate.id, decision: "select", label: "Useful" }],
        sources: [{ id: candidate.id, title: "Conflicting source", url: "https://other.example" }],
      }),
    ).rejects.toThrow("Invalid candidate source reference");
    expect(await controller.status()).toEqual(before);
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Corrected selection",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      evidence: [{ candidateId: candidate.id, decision: "select", label: "Useful" }],
    });
    expect(await controller.status()).toMatchObject({
      revision: 1,
      candidates: [{ decision: "selected", sourceId: candidate.id }],
      plan: { sources: [{ id: candidate.id, url: candidate.url }] },
    });
    await controller.detach();
    await controller.resume(cycle.id);
    expect((await controller.status())?.revision).toBe(1);
    await controller.detach();
  });
  it("freezes returned candidate metadata before asynchronous storage work", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const response = { results: [{ url: "https://example.com/original", title: "Original", text: "body" }] };
    const pending = controller.explorationEvidenceObserver(cycle.id, operation.id, operation.requestHash)(response);
    response.results[0].url = "https://example.com/mutated";
    response.results[0].title = "Mutated";
    await pending;
    expect((await controller.status())?.candidates).toMatchObject([
      {
        url: "https://example.com/original",
        title: "Original",
      },
    ]);
    await controller.detach();
  });
  it("curates candidates and external sources into selected-only previews without processing rows or automatic coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    let controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      operation.id,
      operation.requestHash,
    )({
      results: [
        { url: "https://example.com/selected", title: "Selected", text: "RAW BODY" },
        { url: "https://example.com/unselected", title: "Unselected" },
      ],
    });
    const candidates = (await controller.status())?.candidates;
    if (!candidates?.[0]) throw new Error("Candidate missing");
    const selected = await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Explicit curation",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      evidence: [{ candidateId: candidates[0].id, decision: "select", label: "Useful source", notes: "Relevant fact" }],
      criteria: [{ label: "Criterion", category: "other" }],
      sources: [
        {
          id: "external",
          title: "External source",
          retrievalStatus: "fetched",
          retrievalEvidence: "Explicit filesystem read",
          contentNotes: "External note",
        },
      ],
      executionPlan: { goal: "question", taskSchema: { type: "object" } },
    });
    expect(selected.cycle.revision).toBe(1);
    expect(selected.cycle.plan.criteria[0].status).toBe("proposed");
    const preview = await controller.preview();
    expect(preview.selectedEvidence).toMatchObject([
      {
        url: candidates[0].url,
        notes: "Relevant fact",
        provenance: [{ operationId: operation.id }],
      },
    ]);
    expect(preview.input).toBeUndefined();
    expect(preview.request.query).not.toMatch(/RAW BODY|Unselected|External note/);
    const original = await controller.status();
    if (!original) throw new Error("Missing active cycle");
    const before = structuredClone(original);
    const summary = projectResearchSummary(original, { mode: "source_pack" });
    expect(summary.record.plan.sources).toHaveLength(1);
    expect(summary.record).not.toHaveProperty("candidates");
    expect(summary.selectedEvidence).toEqual(preview.selectedEvidence);
    expect(summary.text).toBe(await controller.summary({ mode: "source_pack" }));
    expect(original).toEqual(before);
    expect(await controller.summary({ mode: "source_pack" })).not.toContain("External note");
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.007 });
    await controller.detach();
    controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "two" });
    await controller.resume(cycle.id);
    expect((await controller.preview()).hash).toBe(preview.hash);
    const refreshed = await controller.reserveExploration("web_search_exa", { query: "newer retrieval" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      refreshed.operation.id,
      refreshed.operation.requestHash,
    )({
      results: [{ url: candidates[0].url, title: "New uncurated title", text: "New uncurated body" }],
    });
    expect((await controller.status())?.candidates?.[0].provenance).toHaveLength(2);
    expect((await controller.preview()).hash).toBe(preview.hash);
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Reject candidate and use external evidence",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      evidence: [{ candidateId: candidates[0].id, decision: "reject" }],
    });
    expect((await controller.preview()).selectedEvidence).toEqual([]);
    await controller.recordStep({
      topic: "question",
      stage: "source_retrieval",
      note: "Select external evidence",
      thought_number: 3,
      total_thoughts: 3,
      next_step_needed: false,
      executionPlan: { selectedEvidence: [{ sourceId: "external", label: "Filesystem evidence" }] },
    });
    expect((await controller.preview()).selectedEvidence).toMatchObject([
      {
        sourceId: "external",
        contentNotes: "External note",
        retrievalEvidence: "Explicit filesystem read",
      },
    ]);
    await controller.detach();
  });
  it("does not let an old capture capability modify archived or reattached evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const capture = controller.explorationEvidenceObserver(cycle.id, operation.id, operation.requestHash);
    await controller.archive();
    await capture({ results: [{ url: "https://example.com/late", text: "late" }] });
    await controller.resume(cycle.id);
    await capture({ results: [{ url: "https://example.com/reattached", text: "late" }] });
    expect((await controller.status())?.candidates ?? []).toEqual([]);
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.01 });
    expect((await controller.status())?.ledger).toMatchObject([{ status: "reported", reportedMicros: 10_000 }]);
    await controller.detach();
  });
  it("rejects restored candidate provenance copied from a different operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    await controller.explorationEvidenceObserver(
      cycle.id,
      operation.id,
      operation.requestHash,
    )({
      results: [{ url: "https://example.com/source" }],
    });
    await controller.detach();
    const saved = await controller.inspect(cycle.id);
    if (!saved.candidates?.[0]) throw new Error("Candidate missing");
    saved.candidates[0].provenance[0].requestHash = "f".repeat(64);
    await writeFile(join(options.root, controller.projectId, `${cycle.id}.json`), JSON.stringify(saved), {
      mode: 0o600,
    });
    const resumed = await createResearchCycles({ ...options, sessionId: "two" });
    await expect(resumed.resume(cycle.id)).rejects.toThrow("Invalid candidate provenance");
  });
  it("persists only operation-bound candidate metadata across explicit resume, without selecting or satisfying criteria", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const capture = controller.explorationEvidenceObserver(cycle.id, operation.id, operation.requestHash);
    await capture({ results: [{ url: "https://example.com/source", title: "Source", text: "never persist me" }] });
    const captured = await controller.status();
    expect(captured?.candidates).toMatchObject([
      {
        url: "https://example.com/source",
        decision: "candidate",
        retrievalStatus: "fetched",
        provenance: [
          { operationId: operation.id, tool: "web_search_exa", requestHash: operation.requestHash, revision: 0 },
        ],
      },
    ]);
    expect(captured?.plan.sources).toEqual([]);
    expect(captured?.executionPlan).toBeUndefined();
    expect(captured?.revision).toBe(0);
    await controller.detach();
    const resumed = await createResearchCycles({ ...options, sessionId: "two" });
    expect(await resumed.status()).toBeUndefined();
    expect((await resumed.resume(cycle.id)).candidates).toEqual(captured?.candidates);
    const stored = await readFile(join(options.root, controller.projectId, `${cycle.id}.json`), "utf8");
    expect(stored).not.toContain("never persist me");
    await resumed.detach();
  });
  it("retries directory durability even when the failed receipt replacement is already visible", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let fail = true;
    let syncs = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (String(args[0]) === join(options.root, controller.projectId)) {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          syncs++;
          if (fail) {
            fail = false;
            throw new Error("receipt directory sync failure");
          }
          await sync();
        });
      }
      return handle;
    });
    await expect(
      controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.003 }),
    ).rejects.toThrow("receipt directory sync failure");
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([{ reportedMicros: 3_000 }]);
    await expect(controller.reserveExploration("web_search_exa", { query: "another" })).rejects.toThrow(
      "ACCOUNTING_UNAVAILABLE",
    );
    const before = syncs;
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.003 });
    expect(syncs).toBeGreaterThan(before);
    await expect(controller.reserveExploration("web_search_exa", { query: "another" })).resolves.toBeDefined();
    await controller.detach();
  });

  it("rechecks scope/ceiling before SDK invocation and exposes a final generation fence", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "question" });
    await controller.grantBudget(cycle.id, 0);
    await expect(controller.explorationDispatchGuard(cycle.id, operation.id, operation.requestHash)).rejects.toThrow(
      "INSUFFICIENT_BALANCE",
    );
    await controller.grantBudget(cycle.id, 1, ["web_fetch_exa"]);
    await expect(controller.explorationDispatchGuard(cycle.id, operation.id, operation.requestHash)).rejects.toThrow(
      "SCOPE_APPROVAL_REQUIRED",
    );
    await controller.grantBudget(cycle.id, 1);
    const guard = await controller.explorationDispatchGuard(cycle.id, operation.id, operation.requestHash);
    const detaching = controller.detach();
    expect(guard).toThrow("activation was detached");
    await detaching;
    await controller.releaseUndispatchedExploration(cycle.id, operation.id, operation.requestHash);
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([{ status: "not-dispatched" }]);
  });

  it("shares one exact-request exception atomically between concurrent reservations", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1, ["web_answer_exa"]);
    let requestHash = "";
    try {
      await controller.reserveExploration("web_answer_exa", { query: "question" });
    } catch (error) {
      if (error instanceof Error && "requestHash" in error && typeof error.requestHash === "string")
        requestHash = error.requestHash;
    }
    await controller.grantUncertainty(cycle.id, "request", requestHash, 0.01);
    const results = await Promise.allSettled([
      controller.reserveExploration("web_answer_exa", { query: "question" }),
      controller.reserveExploration("web_answer_exa", { query: "question" }),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect((await controller.status())?.ledger).toHaveLength(1);
    await controller.detach();
  });

  it("persists exact-request uncertainty permission, consumes it once, and preserves it on resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const cycle = await controller.start("question");
    await controller.grantBudget(cycle.id, 1, ["web_answer_exa"]);
    let requestHash = "";
    try {
      await controller.reserveExploration("web_answer_exa", { query: "question" });
    } catch (error) {
      if (error instanceof Error && "requestHash" in error && typeof error.requestHash === "string")
        requestHash = error.requestHash;
    }
    expect(requestHash).toMatch(/^[a-f0-9]{64}$/);
    await controller.grantUncertainty(cycle.id, "request", requestHash, 0.01);
    await controller.detach();
    const restored = await createResearchCycles(options);
    await restored.resume(cycle.id);
    const reserved = await restored.reserveExploration("web_answer_exa", { query: "question" });
    expect(reserved.operation).toMatchObject({ estimateMicros: 10_000, requestPermissionId: expect.any(String) });
    await restored.reconcileExploration(cycle.id, reserved.operation.id, requestHash, { totalDollars: 0.001 });
    await expect(restored.reserveExploration("web_answer_exa", { query: "question" })).rejects.toThrow(
      "UNCERTAINTY_APPROVAL_REQUIRED",
    );
    await restored.detach();
  });

  it.each(["read", "commit", "release"])("fences a reservation detached during its %s", async (phase) => {
    const root = await mkdtemp(join(tmpdir(), "exa-reserve-fence-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await controller.grantBudget(cycle.id, 1);
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let entered = () => {};
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let armed = true;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (phase === "read" && armed && String(args[0]).endsWith(`${cycle.id}.json`)) {
        armed = false;
        entered();
        await blocked;
      }
      return handle;
    });
    vi.mocked(fs.rename).mockImplementation(async (...args) => {
      await original.rename(...args);
      if (phase === "commit" && armed && String(args[1]).endsWith(`${cycle.id}.json`)) {
        armed = false;
        entered();
        await blocked;
      }
    });
    vi.mocked(fs.unlink).mockImplementation(async (...args) => {
      await original.unlink(...args);
      if (phase === "release" && armed && String(args[0]).endsWith(".lock")) {
        armed = false;
        entered();
        await blocked;
      }
    });
    const reserving = controller.reserveExploration("web_search_exa", { query: "topic" });
    const rejected = expect(reserving).rejects.toThrow("activation was detached");
    await barrier;
    const detaching = controller.detach();
    release();
    const outcomes = await Promise.allSettled([rejected, detaching]);
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    expect(await controller.status()).toBeUndefined();
    const saved = await controller.inspect(cycle.id);
    expect(saved.owner).toBeUndefined();
    if (phase === "read") expect(saved.ledger).toEqual([]);
    else expect(saved.ledger).toMatchObject([{ status: "unknown" }]);
  });

  it.each([
    "grant-cycle",
    "grant-project",
    "ledger-cycle",
  ])("rejects restored accounting identity outside its containing cycle: %s", async (mismatch) => {
    const root = await mkdtemp(join(tmpdir(), "exa-accounting-identity-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await controller.grantBudget(cycle.id, 1);
    await controller.reserveExploration("web_search_exa", { query: "topic" });
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (mismatch === "grant-cycle") saved.grants[0].cycleId = "foreign-cycle";
    else if (mismatch === "grant-project") saved.grants[0].projectId = "foreign-project";
    else saved.ledger[0].cycleId = "foreign-cycle";
    const corrupted = JSON.stringify(saved);
    await writeFile(path, corrupted);
    await expect(controller.inspect(cycle.id)).rejects.toThrow("Accounting identity conflict");
    await expect(controller.reserveExploration("web_search_exa", { query: "new" })).rejects.toThrow(
      "Accounting identity conflict",
    );
    expect(await readFile(path, "utf8")).toBe(corrupted);
  });

  it("durably shares one operator ceiling between simultaneous exploratory reservations", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-accounting-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await expect(controller.reserveExploration("web_search_exa", { query: "topic" })).rejects.toThrow(
      "APPROVAL_REQUIRED",
    );
    await controller.grantBudget(cycle.id, 0.01, ["web_search_exa"]);
    const reservations = await Promise.allSettled([
      controller.reserveExploration("web_search_exa", { query: "one" }),
      controller.reserveExploration("web_search_exa", { query: "two" }),
    ]);
    expect(reservations.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(reservations.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect((await controller.status())?.ledger).toHaveLength(1);
    await controller.detach();
    const restored = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "next" });
    await restored.resume(cycle.id);
    await expect(restored.reserveExploration("web_search_exa", { query: "third" })).rejects.toThrow(
      "UNKNOWN_LIABILITY",
    );
    expect((await restored.status())?.grants).toHaveLength(1);
    await restored.detach();
  });

  it("reconciles a late receipt after archive without changing owner, plan or grants", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-late-cost-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await controller.grantBudget(cycle.id, 0.01);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "topic" });
    await controller.archive();
    const before = await controller.inspect(cycle.id);
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.002 });
    const after = await controller.inspect(cycle.id);
    expect(after.ledger).toMatchObject([{ status: "reported", estimateMicros: 7_000, reportedMicros: 2_000 }]);
    expect({ ...after, ledger: [] }).toEqual({ ...before, ledger: [] });
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.002 });
    expect(await controller.inspect(cycle.id)).toEqual(after);
    await expect(
      controller.reconcileExploration(cycle.id, operation.id, "WRONG HASH", { totalDollars: 0 }),
    ).rejects.toThrow("Operation identity conflict");
    expect(await controller.inspect(cycle.id)).toEqual(after);
  });

  it("keeps malformed and conflicting receipts as unknown liabilities before further spending", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-invalid-cost-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "topic" });
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: -1 });
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([{ status: "unknown" }]);
    await expect(controller.reserveExploration("web_search_exa", { query: "second" })).rejects.toThrow(
      "UNKNOWN_LIABILITY",
    );
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.001 });
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.002 });
    expect((await controller.inspect(cycle.id)).ledger).toMatchObject([
      {
        status: "reported",
        reportedMicros: 1_000,
        conflictingMicros: [2_000],
      },
    ]);
    await expect(controller.reserveExploration("web_search_exa", { query: "third" })).rejects.toThrow(
      "UNKNOWN_LIABILITY",
    );
    await controller.detach();
  });

  it("preserves genuine reported usage when later receipts are missing or malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-preserve-cost-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "operator" });
    const cycle = await controller.start("topic");
    await controller.grantBudget(cycle.id, 1);
    const { operation } = await controller.reserveExploration("web_search_exa", { query: "first" });
    await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, { totalDollars: 0.002 });
    const reported = await controller.inspect(cycle.id);
    for (const receipt of [{}, { totalDollars: -1 }, { totalDollars: Number.NaN }, { totalDollars: Infinity }]) {
      await controller.reconcileExploration(cycle.id, operation.id, operation.requestHash, receipt);
      expect(await controller.inspect(cycle.id)).toEqual(reported);
    }
    const next = await controller.reserveExploration("web_search_exa", { query: "second" });
    expect(next.assessment.reportedDollars).toBe(0.002);
    await controller.detach();
  });

  it("does not persist stale, rejected or invalid structured planning edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    await controller.start("topic");
    const input = {
      topic: "topic",
      stage: "framing" as const,
      note: "",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      executionPlan: { goal: "Research", taskSchema: { type: "object" } },
    };
    await controller.recordStep(input);
    const before = await controller.status();
    await expect(controller.recordStep({ ...input, expectedRevision: 0 })).rejects.toThrow("STALE_REVISION");
    await expect(controller.recordStep({ ...input, executionPlan: { goal: "IGNORED EDIT" } })).rejects.toThrow(
      "STEP_REJECTED",
    );
    await expect(
      controller.recordStep({
        ...input,
        thought_number: 2,
        executionPlan: { taskSchema: { type: "array" } },
      }),
    ).rejects.toThrow("INVALID_TASK_SCHEMA");
    await expect(
      controller.recordStep({
        ...input,
        thought_number: 2,
        executionPlan: { selectedEvidence: [{ sourceId: "S99", label: "Missing" }] },
      }),
    ).rejects.toThrow("UNKNOWN_EVIDENCE");
    expect(await controller.status()).toEqual(before);
  });

  it("replaces structured fields atomically and permits explicit removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    await controller.start("topic");
    const input = { topic: "topic", stage: "framing" as const, note: "", total_thoughts: 3, next_step_needed: true };
    await controller.recordStep({
      ...input,
      thought_number: 1,
      executionPlan: {
        goal: "Research",
        taskSchema: { type: "object" },
        previousRunId: "remote-one",
        input: { data: [{ name: "A" }], exclusion: [{ name: "B" }] },
        controls: { effort: "auto", budget: { maxCostDollars: 3 } },
      },
    });
    await controller.recordStep({
      ...input,
      thought_number: 2,
      executionPlan: {
        input: { data: [{ name: "C" }] },
        controls: {},
        previousRunId: null,
      },
    });
    const artifact = await controller.preview();
    expect(artifact.request.input).toEqual({ data: [{ name: "C" }] });
    expect(artifact.request.effort).toBe("medium");
    expect(artifact.request).not.toHaveProperty("budget");
    expect(artifact.request).not.toHaveProperty("previousRunId");
    await controller.recordStep({ ...input, thought_number: 3, executionPlan: { taskSchema: null } });
    await expect(controller.preview()).rejects.toThrow("MISSING_TASK_SCHEMA");
  });

  it("fails closed before exhausting the persisted plan revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const record = await controller.start("topic");
    const fixture = await controller.archive();
    fixture.revision = Number.MAX_SAFE_INTEGER;
    await writeFile(join(root, "store", controller.projectId, `${record.id}.json`), JSON.stringify(fixture));
    await controller.resume(record.id);
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("REVISION_EXHAUSTED");
    expect((await controller.status())?.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect((await controller.status())?.plan.steps).toHaveLength(0);
  });

  it("persists an execution plan and previews the same artifact after explicit resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const record = await controller.start("pricing");
    await controller.recordStep({
      topic: "pricing",
      stage: "framing",
      note: "DO_NOT_COMPILE_THIS",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      executionPlan: { goal: "Compare current prices", taskSchema: { type: "object" } },
      expectedRevision: 0,
    });
    const preview = await controller.preview({ cycleId: record.id, expectedRevision: 1 });
    expect(preview).toMatchObject({ artifactVersion: 1, revision: 1, brief: { goal: "Compare current prices" } });
    expect(JSON.stringify(preview)).not.toContain("DO_NOT_COMPILE_THIS");
    await controller.detach();
    const restarted = await createResearchCycles({ ...options, sessionId: "two" });
    await restarted.resume(record.id);
    expect((await restarted.preview()).hash).toBe(preview.hash);
    await restarted.recordStep({
      topic: "pricing",
      stage: "criteria_discovery",
      note: "",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      executionPlan: { constraints: ["Official sources"] },
      expectedRevision: 1,
    });
    const changed = await restarted.preview();
    expect(changed.brief.goal).toBe("Compare current prices");
    expect(changed.hash).not.toBe(preview.hash);
    await expect(restarted.preview({ artifactHash: preview.hash })).rejects.toThrow("STALE_ARTIFACT");
  });

  it("retains a failed-start lease until explicit cleanup, even after replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const competitor = await createResearchCycles({ ...options, sessionId: "two" });
    const existing = await competitor.start("existing");
    await competitor.archive();
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let fail = true;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        if (fail && String(args[0]) === join(options.root, controller.projectId)) {
          fail = false;
          throw new Error("post-replacement sync failure");
        }
        await sync();
      });
      return handle;
    });
    await expect(controller.start("first")).rejects.toThrow("post-replacement sync failure");
    expect(await controller.status()).toBeUndefined();
    const records = await controller.list();
    expect(records).toHaveLength(2);
    const failed = records.find((record) => record.plan.topic === "first");
    if (!failed) throw new Error("Missing failed-start record");
    await expect(controller.start("second")).rejects.toThrow("detach");
    await expect(controller.resume(existing.id)).rejects.toThrow("Detach");
    await controller.detach();
    expect((await competitor.resume(failed.id)).id).toBe(failed.id);
  });

  it("fails before overflowing generated IDs or changing the durable plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("topic");
    const fixture = await controller.archive();
    fixture.plan.nextCriterionId = Number.MAX_SAFE_INTEGER;
    await writeFile(join(root, "store", controller.projectId, `${cycle.id}.json`), JSON.stringify(fixture));
    await controller.resume(cycle.id);
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
        criteria: [{ label: "A" }, { label: "B" }, { label: "C" }],
      }),
    ).rejects.toThrow("ID");
    expect((await controller.status())?.plan.criteria).toEqual([]);
    expect((await controller.status())?.plan.nextCriterionId).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("fences pending start and resume when detached", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "one" };
    const controller = await createResearchCycles(options);
    const pending = controller.start("topic");
    const detached = controller.detach();
    await Promise.allSettled([pending, detached]);
    expect(await controller.status()).toBeUndefined();
    const records = await controller.list();
    expect(records.every((record) => !record.owner)).toBe(true);
    const cycle = await controller.start("resume");
    await controller.detach();
    const resume = controller.resume(cycle.id);
    const detachment = controller.detach();
    await Promise.allSettled([resume, detachment]);
    expect(await controller.status()).toBeUndefined();
    expect((await controller.inspect(cycle.id)).owner).toBeUndefined();
    const competitor = await createResearchCycles({ ...options, sessionId: "two" });
    expect((await competitor.resume(cycle.id)).id).toBe(cycle.id);
  });

  it("fences resume already inside durable replacement when detached", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("topic");
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let entered!: () => void;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => {
      entered();
      await released;
      return original.rename(...args);
    });
    const resume = controller.resume(cycle.id);
    await barrier;
    const detached = controller.detach();
    release();
    await Promise.allSettled([resume, detached]);
    expect(await controller.status()).toBeUndefined();
    expect((await controller.inspect(cycle.id)).owner).toBeUndefined();
  });

  it("syncs storage ancestors and fails closed when a directory sync fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    const synced: string[] = [];
    let fail = false;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        synced.push(String(args[0]));
        if (fail && String(args[0]) === root) throw new Error("directory sync failed");
        await sync();
      });
      return handle;
    });
    const store = join(root, "new", "nested", "store");
    const controller = await createResearchCycles({ root: store, cwd: root, sessionId: "one" });
    await controller.start("topic");
    expect(synced).toEqual(expect.arrayContaining([root, join(root, "new"), dirname(store), store]));
    await controller.detach();
    fail = true;
    const fresh = await createResearchCycles({ root: store, cwd: root, sessionId: "two" });
    await expect(fresh.start("unsafe")).rejects.toThrow("directory sync failed");
    expect(await fresh.status()).toBeUndefined();
    fail = false;
    expect((await fresh.start("retry after repaired initialization")).plan.topic).toBe(
      "retry after repaired initialization",
    );
  });

  it("ignores inherited Git repository-location overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const exec = promisify(execFile);
    await exec("git", ["init", "--quiet", a]);
    await exec("git", ["init", "--quiet", b]);
    const expected = await Promise.all([researchProjectId(a), researchProjectId(b), researchProjectId(root)]);
    vi.stubEnv("GIT_DIR", join(a, ".git"));
    vi.stubEnv("GIT_WORK_TREE", a);
    vi.stubEnv("GIT_COMMON_DIR", join(a, ".git"));
    expect(await Promise.all([researchProjectId(a), researchProjectId(b), researchProjectId(root)])).toEqual(expected);
  });

  it("rejects stale counters before ownership writes and recomputes restored diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "one" });
    const cycle = await controller.start("topic");
    await controller.recordStep({
      topic: "topic",
      stage: "framing",
      note: "",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ label: "Original", status: "supported", evidenceRefs: ["S1"] }],
      sources: [{ id: "S1", title: "Evidence", url: "https://example.test" }],
    });
    const fixture = await controller.archive();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    fixture.plan.nextCriterionId = 1;
    const invalid = JSON.stringify(fixture);
    await writeFile(path, invalid);
    await expect(controller.resume(cycle.id)).rejects.toThrow("snapshot");
    expect(await readFile(path, "utf8")).toBe(invalid);
    fixture.plan.nextCriterionId = 2;
    fixture.plan.criteria.push({ ...fixture.plan.criteria[0], label: "Duplicate identity" });
    await writeFile(path, JSON.stringify(fixture));
    await expect(controller.resume(cycle.id)).rejects.toThrow("snapshot");
    fixture.plan.criteria.pop();
    fixture.plan.sources = [];
    fixture.plan.criteria[0].evidenceIssues = [];
    await writeFile(path, JSON.stringify(fixture));
    const restored = await controller.resume(cycle.id);
    expect(restored.plan.criteria[0].evidenceIssues).toContain("Unresolved evidence ref: S1");
    expect(await controller.summary()).toContain("0/1 supported");
  });

  it("serializes racing step writes and explicitly rejects a duplicate sequence", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await controller.start("topic");
    const updates = await Promise.all(
      ["one", "two"].map((label) =>
        controller.recordStep({
          topic: "topic",
          stage: "framing",
          note: label,
          thought_number: 1,
          total_thoughts: 1,
          next_step_needed: false,
          criteria: [{ label }],
        }),
      ),
    );
    expect(updates.filter((update) => update.warnings.some((warning) => warning.includes("Duplicate")))).toHaveLength(
      1,
    );
    const durable = await controller.status();
    expect(durable?.revision).toBe(1);
    expect(durable?.plan.steps).toHaveLength(1);
    expect(durable?.plan.criteria).toHaveLength(1);
  });

  it("does not expose mutable runtime ownership through returned records", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    const resumed = await controller.resume(cycle.id);
    if (!resumed.owner) throw new Error("Expected owned cycle");
    resumed.owner.token = "tampered";
    expect((await controller.status())?.id).toBe(cycle.id);
  });

  it("uses the Git common directory across worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-git-"));
    roots.push(root);
    const exec = promisify(execFile);
    await exec("git", ["init", "--quiet", root]);
    // An unborn linked-worktree fixture avoids commits or Git identity overrides.
    const linked = join(root, "linked");
    const metadata = join(root, ".git", "worktrees", "linked");
    await mkdir(linked);
    await mkdir(metadata, { recursive: true });
    await writeFile(join(linked, ".git"), `gitdir: ${metadata}\n`);
    await writeFile(join(metadata, "commondir"), "../..\n");
    await writeFile(join(metadata, "HEAD"), "ref: refs/heads/linked\n");
    await writeFile(join(metadata, "gitdir"), `${join(linked, ".git")}\n`);
    expect(await researchProjectId(linked)).toBe(await researchProjectId(root));
  });

  it("recovers a verified dead local owner without making a completed cycle editable", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "new-session" });
    const cycle = await controller.start("topic");
    const archived = await controller.archive();
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    const fixture = {
      ...archived,
      status: "completed",
      owner: { sessionId: "dead-session", token: "dead-token", pid: Number(stdout) },
    };
    await writeFile(join(root, "store", controller.projectId, `${cycle.id}.json`), JSON.stringify(fixture));
    const resumed = await controller.resume(cycle.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.owner?.sessionId).toBe("new-session");
    expect(await controller.summary()).toContain("Status: completed");
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("not editable");
    expect((await controller.archive()).status).toBe("completed");
    expect(await controller.inspect(cycle.id)).toMatchObject({ status: "completed", archived: true });
  });

  it("retains unknown attempts, ledger, and grants when archived or resumed", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    const archived = await controller.archive();
    const fixture = {
      ...archived,
      status: "unknown",
      attempts: [{ id: "attempt-one", status: "unknown", runId: "remote-one" }],
      ledger: [{ kind: "unknown", attemptId: "attempt-one" }],
      grants: [{ source: "command", budget: 1 }],
    };
    await writeFile(join(root, "store", controller.projectId, `${cycle.id}.json`), JSON.stringify(fixture));
    const resumed = await controller.resume(cycle.id);
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("not editable");
    const reset = await controller.archive();
    expect(reset.status).toBe("unknown");
    expect(reset.attempts).toEqual(resumed.attempts);
    expect(reset.ledger).toEqual(fixture.ledger);
    expect(reset.grants).toEqual(fixture.grants);
  });

  it("rejects unsupported records and traversal without changing disk state", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    await controller.detach();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    const future = JSON.stringify({ ...cycle, schemaVersion: 2 });
    await writeFile(path, future);
    await expect(controller.resume(cycle.id)).rejects.toThrow("unsupported");
    await expect(controller.inspect("../secret")).rejects.toThrow("Invalid research cycle ID");
    expect(await readFile(path, "utf8")).toBe(future);
  });

  it("does not advance a revision when durable replacement fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await controller.start("topic");
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("disk failure"));
    await expect(
      controller.recordStep({
        topic: "topic",
        stage: "framing",
        note: "private",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("disk failure");
    const stored = await controller.status();
    expect(stored?.revision).toBe(0);
    expect(stored?.plan.steps).toHaveLength(0);
  });

  it("enforces runtime ownership and keeps projects isolated", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    const otherProject = await mkdtemp(join(tmpdir(), "exa-project-"));
    roots.push(root, otherProject);
    const options = { root: join(root, "store"), cwd: root, sessionId: "session" };
    const first = await createResearchCycles(options);
    const cycle = await first.start("topic");
    const competitor = await createResearchCycles(options);
    await expect(competitor.resume(cycle.id)).rejects.toThrow("live");
    const outsider = await createResearchCycles({ ...options, cwd: otherProject });
    expect(await outsider.list()).toEqual([]);
    await expect(outsider.resume(cycle.id)).rejects.toThrow();
    await first.detach();
    await competitor.resume(cycle.id);
    await expect(
      first.recordStep({
        topic: "topic",
        stage: "framing",
        note: "old owner",
        thought_number: 1,
        total_thoughts: 1,
        next_step_needed: false,
      }),
    ).rejects.toThrow("No active");
  });

  it("archives without raw planning notes and stores private records", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const cycle = await controller.start("topic");
    await controller.recordStep({
      topic: "topic",
      stage: "framing",
      note: "PRIVATE_CHATTER_SENTINEL",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
    });
    const archived = await controller.archive();
    expect(archived.archived).toBe(true);
    expect(archived.owner).toBeUndefined();
    expect(archived.grants).toEqual([]);
    expect(await controller.status()).toBeUndefined();
    const path = join(root, "store", controller.projectId, `${cycle.id}.json`);
    expect(await readFile(path, "utf8")).not.toContain("PRIVATE_CHATTER_SENTINEL");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "store", controller.projectId))).mode & 0o777).toBe(0o700);
    await controller.resume(cycle.id);
    expect((await controller.status())?.revision).toBe(1);
  });

  it("permits only one active cycle when start commands race", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    const results = await Promise.allSettled([controller.start("one"), controller.start("two")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await controller.list()).toHaveLength(1);
  });

  it("refuses a symlink storage root rather than writing outside its namespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const outside = await mkdtemp(join(tmpdir(), "exa-outside-"));
    roots.push(outside);
    await symlink(outside, join(root, "store"));
    const controller = await createResearchCycles({ root: join(root, "store"), cwd: root, sessionId: "session" });
    await expect(controller.start("topic")).rejects.toThrow("directory");
    expect(await controller.status()).toBeUndefined();
  });

  it("requires explicit resume after restart and retains curated planning state", async () => {
    const root = await mkdtemp(join(tmpdir(), "exa-cycles-"));
    roots.push(root);
    const options = { root: join(root, "store"), cwd: root, sessionId: "session-one" };
    const first = await createResearchCycles(options);
    const cycle = await first.start("pricing");
    await first.recordStep({
      topic: "pricing",
      stage: "framing",
      note: "Private raw planning chatter",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
      criteria: [{ label: "Official price" }],
      sources: [{ title: "Pricing", url: "https://example.com/pricing" }],
      assumptions: ["Price may vary"],
    });
    await first.detach();
    const restarted = await createResearchCycles({ ...options, sessionId: "session-two" });
    expect(await restarted.status()).toBeUndefined();
    const resumed = await restarted.resume(cycle.id);
    expect(resumed.revision).toBe(1);
    expect(resumed.plan.criteria[0].label).toBe("Official price");
    expect(resumed.plan.sources[0].url).toBe("https://example.com/pricing");
    expect(resumed.plan.assumptions).toEqual(["Price may vary"]);
    expect(await restarted.summary({ mode: "execution_plan" })).toContain("Official price");
    const next = await restarted.recordStep({
      topic: "pricing",
      stage: "criteria_discovery",
      note: "Another private note",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      criteria: [{ label: "Coverage" }],
    });
    expect(next.cycle.revision).toBe(2);
    expect(next.criteria.map((criterion) => criterion.id)).toEqual(["C1", "C2"]);
  });
});

import { execFile } from "node:child_process";

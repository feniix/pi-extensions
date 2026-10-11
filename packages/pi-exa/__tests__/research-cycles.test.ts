import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResearchCycles, researchProjectId } from "../extensions/research-cycles.js";
import { withResearchStorageLock } from "../extensions/research-storage-lock.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, rename: vi.fn(original.rename), open: vi.fn(original.open) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
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

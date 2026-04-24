import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTask,
  addWorker,
  appendConductorEvent,
  assignTaskToWorker,
  completeTaskRun,
  createConductorGate,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
  finishWorkerRun,
  getConductorProjectDir,
  mutateRun,
  queryConductorEvents,
  readRun,
  reconcileRunLeases,
  recordRunHeartbeat,
  recordTaskCompletion,
  recordTaskProgress,
  resolveConductorGate,
  setWorkerLifecycle,
  setWorkerRunSessionId,
  setWorkerRuntimeState,
  startTaskRun,
  startWorkerRun,
  validateRunRecord,
  writeRun,
} from "../extensions/storage.js";

describe("storage helpers", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (conductorHome && existsSync(conductorHome)) {
      rmSync(conductorHome, { recursive: true, force: true });
    }
  });
  it("creates an empty control-plane record", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    expect(run.projectKey).toBe("abc");
    expect(run.repoRoot).toBe("/tmp/repo");
    expect(run.schemaVersion).toBe(1);
    expect(run.revision).toBe(0);
    expect(run.workers).toEqual([]);
    expect(run.tasks).toEqual([]);
    expect(run.runs).toEqual([]);
    expect(run.gates).toEqual([]);
    expect(run.artifacts).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it("builds a conductor project dir", () => {
    const dir = getConductorProjectDir("abc");
    expect(dir).toBe(join(conductorHome, "projects", "abc"));
  });

  it("creates and assigns durable task records without changing worker outcome state", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add task ledger", prompt: "Implement durable tasks" });

    const withWorker = addWorker(run, worker);
    const withTask = addTask(withWorker, task);
    const assigned = assignTaskToWorker(withTask, task.taskId, worker.workerId);

    expect(assigned.tasks[0]).toMatchObject({
      taskId: "task-1",
      title: "Add task ledger",
      prompt: "Implement durable tasks",
      state: "assigned",
      assignedWorkerId: "worker-1",
      revision: 1,
      activeRunId: null,
      runIds: [],
    });
    expect(assigned.workers[0]?.lifecycle).toBe("idle");
    expect(assigned.workers[0]?.currentTask).toBeNull();
  });

  it("starts and completes durable task runs without storing outcome on worker lifecycle", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add task ledger", prompt: "Implement durable tasks" });
    const assigned = assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId);

    const running = startTaskRun(assigned, {
      runId: "run-1",
      taskId: task.taskId,
      workerId: worker.workerId,
      backend: "native",
      leaseExpiresAt: "2026-04-24T12:00:00.000Z",
    });

    expect(running.tasks[0]).toMatchObject({ state: "running", activeRunId: "run-1", runIds: ["run-1"] });
    expect(running.runs[0]).toMatchObject({ runId: "run-1", status: "running", taskRevision: 1 });
    expect(running.workers[0]?.lifecycle).toBe("running");

    const completed = completeTaskRun(running, {
      runId: "run-1",
      status: "succeeded",
      completionSummary: "Implemented durable task runs",
    });

    expect(completed.tasks[0]).toMatchObject({ state: "completed", activeRunId: null });
    expect(completed.runs[0]).toMatchObject({
      status: "succeeded",
      completionSummary: "Implemented durable task runs",
    });
    expect(completed.workers[0]?.lifecycle).toBe("idle");
    expect(completed.events.map((event) => event.type)).toContain("run.completed");
  });

  it("records run heartbeats and reconciles expired leases", () => {
    let run = addWorker(
      createEmptyRun("abc", "/repo"),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    const running = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });

    const heartbeat = recordRunHeartbeat(running, {
      runId: "run-1",
      leaseExpiresAt: "2026-04-24T02:00:00.000Z",
    });
    expect(heartbeat.runs[0]).toMatchObject({ leaseExpiresAt: "2026-04-24T02:00:00.000Z" });
    expect(heartbeat.runs[0]?.lastHeartbeatAt).toBeTruthy();
    expect(heartbeat.events.map((event) => event.type)).toContain("run.heartbeat");

    const reconciled = reconcileRunLeases(heartbeat, { now: "2026-04-24T02:00:01.000Z" });
    expect(reconciled.runs[0]).toMatchObject({ status: "stale", finishedAt: "2026-04-24T02:00:01.000Z" });
    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(reconciled.workers[0]?.lifecycle).toBe("idle");
    expect(reconciled.events.map((event) => event.type)).toContain("run.lease_expired");
  });

  it("creates and resolves gates with events", () => {
    const run = createEmptyRun("abc", "/repo");

    const gated = createConductorGate(run, {
      gateId: "gate-1",
      type: "approval_required",
      resourceRefs: { projectKey: "abc", taskId: "task-1" },
      requestedDecision: "Approve cleanup?",
    });

    expect(gated.gates).toHaveLength(1);
    expect(gated.gates[0]).toMatchObject({ gateId: "gate-1", status: "open", requestedDecision: "Approve cleanup?" });
    expect(gated.events.map((event) => event.type)).toContain("gate.created");

    const resolved = resolveConductorGate(gated, {
      gateId: "gate-1",
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "safe to proceed",
    });

    expect(resolved.gates[0]).toMatchObject({ status: "approved", resolutionReason: "safe to proceed" });
    expect(resolved.events.map((event) => event.type)).toContain("gate.resolved");
  });

  it("prevents parent agents from approving high-risk gates", () => {
    const run = createConductorGate(createEmptyRun("abc", "/repo"), {
      gateId: "gate-1",
      type: "destructive_cleanup",
      resourceRefs: { projectKey: "abc", workerId: "worker-1" },
      requestedDecision: "Approve worker cleanup?",
    });

    expect(() =>
      resolveConductorGate(run, {
        gateId: "gate-1",
        status: "approved",
        actor: { type: "parent_agent", id: "parent" },
        resolutionReason: "I think it is safe",
      }),
    ).toThrow(/human.*destructive_cleanup/i);

    const rejected = resolveConductorGate(run, {
      gateId: "gate-1",
      status: "rejected",
      actor: { type: "parent_agent", id: "parent" },
      resolutionReason: "Not safe yet",
    });
    expect(rejected.gates[0]?.status).toBe("rejected");
  });

  it("queries events with filters and pagination", () => {
    let run = createEmptyRun("abc", "/repo");
    run = appendConductorEvent(run, {
      actor: { type: "test", id: "suite" },
      type: "task.created",
      resourceRefs: { projectKey: "abc", taskId: "task-1" },
      payload: {},
    });
    run = appendConductorEvent(run, {
      actor: { type: "test", id: "suite" },
      type: "task.progress",
      resourceRefs: { projectKey: "abc", taskId: "task-1", runId: "run-1" },
      payload: {},
    });
    run = appendConductorEvent(run, {
      actor: { type: "test", id: "suite" },
      type: "task.progress",
      resourceRefs: { projectKey: "abc", taskId: "task-2", runId: "run-2" },
      payload: {},
    });

    const page = queryConductorEvents(run, { taskId: "task-1", afterSequence: 1, limit: 1 });

    expect(page.events.map((event) => event.sequence)).toEqual([2]);
    expect(page.lastSequence).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(queryConductorEvents(run, { type: "task.progress", limit: 1 }).hasMore).toBe(true);
  });

  it("audits duplicate completion after terminal runs without changing task state", () => {
    let run = addWorker(
      createEmptyRun("abc", "/repo"),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });
    run = recordTaskCompletion(run, {
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      completionSummary: "done",
    });

    const audited = recordTaskCompletion(run, {
      runId: "run-1",
      taskId: "task-1",
      status: "failed",
      completionSummary: "late failure",
    });

    expect(audited.tasks[0]).toMatchObject({ state: "completed" });
    expect(audited.runs[0]).toMatchObject({ status: "succeeded", completionSummary: "done" });
    expect(audited.events.at(-1)).toMatchObject({ type: "task.completion_rejected" });
  });

  it("audits late progress after terminal runs without changing task state", () => {
    let run = addWorker(
      createEmptyRun("abc", "/repo"),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });
    run = completeTaskRun(run, { runId: "run-1", status: "succeeded", completionSummary: "done" });

    const audited = recordTaskProgress(run, { runId: "run-1", taskId: "task-1", progress: "late progress" });

    expect(audited.tasks[0]).toMatchObject({ state: "completed", latestProgress: null });
    expect(audited.events.at(-1)).toMatchObject({ type: "task.progress_rejected" });
  });

  it("rejects unsafe local artifact refs", () => {
    let run = addWorker(
      createEmptyRun("abc", "/repo"),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });

    expect(() =>
      recordTaskProgress(run, {
        runId: "run-1",
        taskId: "task-1",
        progress: "captured log",
        artifact: { type: "log", ref: "../outside.log" },
      }),
    ).toThrow(/unsafe artifact ref/i);
  });

  it("records scoped child progress and completion artifacts", () => {
    let run = addWorker(
      createEmptyRun("abc", "/repo"),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });

    const withProgress = recordTaskProgress(run, {
      runId: "run-1",
      taskId: "task-1",
      progress: "tests passing",
      artifact: { type: "log", ref: "progress://run-1/1", metadata: { step: 1 } },
    });

    expect(withProgress.tasks.find((entry) => entry.taskId === "task-1")?.latestProgress).toBe("tests passing");
    expect(withProgress.artifacts).toHaveLength(1);
    expect(withProgress.artifacts[0]?.resourceRefs).toMatchObject({ taskId: "task-1", runId: "run-1" });
    expect(withProgress.runs.find((entry) => entry.runId === "run-1")?.artifactIds).toContain(
      withProgress.artifacts[0]?.artifactId,
    );
    expect(withProgress.events.map((event) => event.type)).toContain("run.progress_reported");

    const completed = recordTaskCompletion(withProgress, {
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      completionSummary: "implemented and verified",
      artifact: { type: "completion_report", ref: "completion://run-1", metadata: { checks: "ok" } },
    });

    expect(completed.tasks.find((entry) => entry.taskId === "task-1")?.state).toBe("completed");
    expect(completed.artifacts).toHaveLength(2);
    expect(completed.artifacts[1]?.type).toBe("completion_report");
    expect(completed.runs.find((entry) => entry.runId === "run-1")?.completionSummary).toBe("implemented and verified");
  });

  it("creates a worker record with default lifecycle metadata", () => {
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    expect(worker.workerId).toBe("worker-1");
    expect(worker.name).toBe("backend");
    expect(worker.lifecycle).toBe("idle");
    expect(worker.currentTask).toBeNull();
    expect(worker.recoverable).toBe(false);
    expect(worker.summary.stale).toBe(false);
    expect(worker.pr.prCreationAttempted).toBe(false);
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeNull();
    expect(worker.runtime.lastResumedAt).toBeNull();
    expect(worker.lastRun).toBeNull();
  });

  it("appends events with monotonic sequence and revision metadata", () => {
    const run = createEmptyRun("abc", "/tmp/repo");

    const first = appendConductorEvent(run, {
      actor: { type: "system", id: "test" },
      type: "project.created",
      resourceRefs: { projectKey: "abc" },
      payload: { reason: "test" },
    });
    const second = appendConductorEvent(first, {
      actor: { type: "parent_agent", id: "parent" },
      type: "task.created",
      resourceRefs: { taskId: "task-1" },
      payload: {},
    });

    expect(first.revision).toBe(1);
    expect(first.events[0]).toMatchObject({ sequence: 1, projectRevision: 1, type: "project.created" });
    expect(second.revision).toBe(2);
    expect(second.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(second.events[1]).toMatchObject({ projectRevision: 2, type: "task.created" });
  });

  it("throws a clear diagnostic for corrupt persisted JSON", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    mkdirSync(run.storageDir, { recursive: true });
    writeFileSync(join(run.storageDir, "run.json"), "{not json", "utf-8");

    expect(() => readRun("abc")).toThrow(/Failed to read conductor state for project abc/i);
  });

  it("validates resource identity and reference invariants", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });

    expect(() => validateRunRecord({ ...run, workers: [worker, worker] })).toThrow(/Duplicate workerId worker-1/i);
    expect(() => validateRunRecord({ ...run, tasks: [{ ...task, assignedWorkerId: "missing-worker" }] })).toThrow(
      /references missing worker missing-worker/i,
    );
    expect(() =>
      validateRunRecord({
        ...run,
        workers: [worker],
        tasks: [task],
        runs: [
          {
            runId: "run-1",
            taskId: "missing-task",
            workerId: worker.workerId,
            taskRevision: 1,
            status: "running",
            backend: "native",
            backendRunId: null,
            sessionId: null,
            leaseGeneration: 1,
            leaseStartedAt: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            startedAt: null,
            finishedAt: null,
            completionSummary: null,
            errorMessage: null,
            artifactIds: [],
            gateIds: [],
          },
        ],
      }),
    ).toThrow(/references missing task missing-task/i);
  });

  it("serializes per-project mutations so concurrent updates do not clobber each other", async () => {
    const seed = createEmptyRun("abc", "/tmp/repo");
    writeRun(seed);
    let releaseFirstMutation: () => void = () => undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirstMutation = resolve;
    });

    const first = mutateRun("abc", "/tmp/repo", async (current) => {
      await firstCanFinish;
      return addTask(current, createTaskRecord({ taskId: "task-1", title: "One", prompt: "First" }));
    });
    const second = mutateRun("abc", "/tmp/repo", (current) =>
      addTask(current, createTaskRecord({ taskId: "task-2", title: "Two", prompt: "Second" })),
    );

    releaseFirstMutation();
    await Promise.all([first, second]);

    expect(readRun("abc")?.tasks.map((task) => task.taskId)).toEqual(["task-1", "task-2"]);
  });

  it("writes state atomically without leaving temporary files", () => {
    const run = createEmptyRun("abc", "/tmp/repo");

    writeRun(run);

    expect(existsSync(join(run.storageDir, "run.json"))).toBe(true);
    expect(readdirSync(run.storageDir).filter((entry) => entry.includes(".tmp"))).toEqual([]);
  });

  it("normalizes missing lastRun when reading older persisted workers", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    mkdirSync(run.storageDir, { recursive: true });
    const path = join(run.storageDir, "run.json");
    const legacyWorker = JSON.parse(JSON.stringify(worker)) as Record<string, unknown>;
    delete legacyWorker.lastRun;
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...run,
          workers: [legacyWorker],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const persisted = readRun("abc");
    expect(persisted?.workers[0]?.lastRun).toBeNull();
  });

  it("marks an existing summary stale when the worker lifecycle changes", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    worker.summary.text = "Half done";
    worker.summary.updatedAt = new Date().toISOString();

    const updated = setWorkerLifecycle({ ...run, workers: [worker] }, worker.workerId, "running");
    expect(updated.workers[0]?.summary.stale).toBe(true);
  });

  it("marks a worker as running and persists lastRun metadata when a run starts", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.summary.text = "Half done";
    worker.summary.updatedAt = new Date().toISOString();

    const updated = startWorkerRun({ ...run, workers: [worker] }, worker.workerId, {
      task: "implement status output",
      sessionId: "run-session-1",
    });

    expect(updated.workers[0]?.lifecycle).toBe("running");
    expect(updated.workers[0]?.currentTask).toBe("implement status output");
    expect(updated.workers[0]?.summary.stale).toBe(true);
    expect(updated.workers[0]?.lastRun).toMatchObject({
      task: "implement status output",
      status: null,
      finishedAt: null,
      errorMessage: null,
      sessionId: "run-session-1",
    });
    expect(updated.workers[0]?.lastRun?.startedAt).toBeTruthy();
  });

  it("requires an active run before attaching a run session id", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });

    expect(() => setWorkerRunSessionId({ ...run, workers: [worker] }, worker.workerId, "run-session-1")).toThrow(
      /does not have an active lastRun/i,
    );
  });

  it("completes a run with success, aborted, and error lifecycle semantics", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const started = startWorkerRun({ ...run, workers: [worker] }, worker.workerId, {
      task: "implement status output",
      sessionId: "run-session-1",
    });

    const succeeded = finishWorkerRun(started, worker.workerId, { status: "success" });
    expect(succeeded.workers[0]?.lifecycle).toBe("idle");
    expect(succeeded.workers[0]?.lastRun?.status).toBe("success");
    expect(succeeded.workers[0]?.lastRun?.finishedAt).toBeTruthy();

    const aborted = finishWorkerRun(started, worker.workerId, { status: "aborted" });
    expect(aborted.workers[0]?.lifecycle).toBe("idle");
    expect(aborted.workers[0]?.lastRun?.status).toBe("aborted");

    const errored = finishWorkerRun(started, worker.workerId, {
      status: "error",
      errorMessage: "model unavailable",
    });
    expect(errored.workers[0]?.lifecycle).toBe("blocked");
    expect(errored.workers[0]?.lastRun?.status).toBe("error");
    expect(errored.workers[0]?.lastRun?.errorMessage).toBe("model unavailable");
  });

  it("does not persist sessionFile inside worker.runtime", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/original-session.jsonl",
    });

    const updated = setWorkerRuntimeState({ ...run, workers: [worker] }, worker.workerId, {
      sessionFile: "/tmp/new-session.jsonl",
      sessionId: "session-123",
      lastResumedAt: "2026-04-20T00:00:00.000Z",
    });

    expect(updated.workers[0]?.sessionFile).toBe("/tmp/new-session.jsonl");
    expect(updated.workers[0]?.runtime.sessionId).toBe("session-123");
    expect("sessionFile" in (updated.workers[0]?.runtime ?? {})).toBe(false);
  });

  it("adds a worker and updates the run timestamp", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    const updated = addWorker(run, worker);
    expect(updated.workers).toHaveLength(1);
    expect(updated.workers[0]?.name).toBe("backend");
    expect(updated.updatedAt >= run.updatedAt).toBe(true);
  });

  it("rejects duplicate worker names within a project", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });

    const updated = addWorker(run, worker);
    expect(() =>
      addWorker(
        updated,
        createWorkerRecord({
          workerId: "worker-2",
          name: "backend",
          branch: "conductor/backend-2",
          worktreePath: "/tmp/repo/.worktrees/backend-2",
          sessionFile: null,
        }),
      ),
    ).toThrow(/already exists/i);
  });
});

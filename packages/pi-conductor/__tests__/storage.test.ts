import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveProjectKey } from "../extensions/project-key.js";
import {
  addConductorArtifact,
  addTask,
  addWorker,
  appendConductorEvent,
  assignTaskToWorker,
  cancelTaskRun,
  completeTaskRun,
  createConductorGate,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
  getConductorProjectDir,
  mutateRun,
  queryConductorArtifacts,
  queryConductorEvents,
  readArtifactContentForRepo,
  readRun,
  reconcileRunLeases,
  recordRunHeartbeat,
  recordTaskCompletion,
  recordTaskProgress,
  resolveConductorGate,
  setWorkerRuntimeState,
  startTaskRun,
  updateTask,
  validateRunRecord,
  writeRun,
} from "../extensions/storage.js";
import { normalizeProjectRecord } from "../extensions/storage-normalize.js";

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

  it("validates event sequence ordering", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const first = appendConductorEvent(run, {
      actor: { type: "system", id: "test" },
      type: "project.created",
      resourceRefs: { projectKey: "abc" },
      payload: {},
    });
    const event = first.events[0];
    if (!event) {
      throw new Error("expected event");
    }
    const invalid = {
      ...first,
      events: [event, { ...event, eventId: "event-duplicate", sequence: 1 }],
    };

    expect(() => validateRunRecord(invalid)).toThrow(/Event sequence/i);
  });

  it("validates event runtime shape", () => {
    const run = appendConductorEvent(createEmptyRun("abc", "/tmp/repo"), {
      actor: { type: "system", id: "test" },
      type: "project.created",
      resourceRefs: { projectKey: "abc" },
      payload: {},
    });
    const event = run.events[0];
    if (!event) {
      throw new Error("expected event");
    }

    expect(() => validateRunRecord({ ...run, events: [{ ...event, type: "not.real" } as never] })).toThrow(
      /invalid event type/i,
    );
    expect(() =>
      validateRunRecord({ ...run, events: [{ ...event, actor: { type: "robot", id: "test" } } as never] }),
    ).toThrow(/invalid actor type/i);
    expect(() => validateRunRecord({ ...run, events: [{ ...event, payload: "not-object" } as never] })).toThrow(
      /invalid payload/i,
    );
  });

  it("rejects malformed persisted event records on read", () => {
    const run = appendConductorEvent(createEmptyRun("abc", "/tmp/repo"), {
      actor: { type: "system", id: "test" },
      type: "project.created",
      resourceRefs: { projectKey: "abc" },
      payload: {},
    });
    const event = run.events[0];
    if (!event) {
      throw new Error("expected event");
    }
    mkdirSync(getConductorProjectDir("abc"), { recursive: true });
    writeFileSync(
      join(getConductorProjectDir("abc"), "run.json"),
      JSON.stringify({ ...run, events: [{ ...event, type: "not.real" }] }),
    );

    expect(() => readRun("abc")).toThrow(/Failed to read conductor state.*invalid event type/i);
  });

  it("validates event resource references", () => {
    const run = appendConductorEvent(createEmptyRun("abc", "/tmp/repo"), {
      actor: { type: "system", id: "test" },
      type: "worker.created",
      resourceRefs: { projectKey: "abc", workerId: "missing-worker" },
      payload: {},
    });

    expect(() => validateRunRecord(run)).toThrow(/Event .* references missing worker missing-worker/i);
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
    expect(running.runs[0]).toMatchObject({
      runId: "run-1",
      status: "running",
      taskRevision: 1,
      runtime: {
        mode: "headless",
        status: "running",
        sessionId: null,
        cleanupStatus: "not_required",
      },
    });
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
      runtime: { status: "exited_success", cleanupStatus: "not_required" },
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
    expect(heartbeat.runs[0]?.runtime.heartbeatAt).toBeTruthy();
    expect(heartbeat.events.map((event) => event.type)).toContain("run.heartbeat");

    const reconciled = reconcileRunLeases(heartbeat, { now: "2026-04-24T02:00:01.000Z" });
    expect(reconciled.runs[0]).toMatchObject({
      status: "stale",
      finishedAt: "2026-04-24T02:00:01.000Z",
      runtime: { status: "exited_error", finishedAt: "2026-04-24T02:00:01.000Z" },
    });
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

  it("updates non-running tasks by incrementing revision and rejects active task edits", () => {
    let run = addTask(
      createEmptyRun("abc", "/repo"),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );

    const updated = updateTask(run, { taskId: "task-1", title: "Build v2", prompt: "Do it carefully" });

    expect(updated.tasks[0]).toMatchObject({ title: "Build v2", prompt: "Do it carefully", revision: 2 });
    expect(updated.events.map((event) => event.type)).toContain("task.updated");

    run = addWorker(
      updated,
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: "/repo/.worktrees/backend",
        sessionFile: "/tmp/session.jsonl",
      }),
    );
    run = assignTaskToWorker(run, "task-1", "worker-1");
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });

    expect(() => updateTask(run, { taskId: "task-1", prompt: "late edit" })).toThrow(/active run/i);
  });

  it("cancels an active task run without inventing completion", () => {
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

    const canceled = cancelTaskRun(run, { runId: "run-1", reason: "Parent agent stopped superseded work" });

    expect(canceled.runs[0]).toMatchObject({
      status: "aborted",
      errorMessage: "Parent agent stopped superseded work",
      runtime: { status: "aborted", cleanupStatus: "not_required" },
    });
    expect(canceled.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });
    expect(canceled.workers[0]?.lifecycle).toBe("idle");
    expect(canceled.events.map((event) => event.type)).toContain("run.canceled");
  });

  it("deduplicates child progress and completion by idempotency key", () => {
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

    const progressed = recordTaskProgress(run, {
      runId: "run-1",
      taskId: "task-1",
      progress: "halfway",
      idempotencyKey: "progress-1",
    });
    const duplicateProgress = recordTaskProgress(progressed, {
      runId: "run-1",
      taskId: "task-1",
      progress: "halfway replay",
      idempotencyKey: "progress-1",
    });
    expect(duplicateProgress.events).toHaveLength(progressed.events.length);
    expect(duplicateProgress.tasks[0]?.latestProgress).toBe("halfway");

    const completed = recordTaskCompletion(duplicateProgress, {
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      completionSummary: "done",
      idempotencyKey: "complete-1",
    });
    const duplicateCompletion = recordTaskCompletion(completed, {
      runId: "run-1",
      taskId: "task-1",
      status: "failed",
      completionSummary: "late replay",
      idempotencyKey: "complete-1",
    });

    expect(duplicateCompletion.events).toHaveLength(completed.events.length);
    expect(duplicateCompletion.runs[0]).toMatchObject({ status: "succeeded", completionSummary: "done" });
  });

  it("deduplicates child progress artifacts by idempotency key", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    let run = addWorker(
      createEmptyRun(deriveProjectKey(repoRoot), repoRoot),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: repoRoot,
        sessionFile: null,
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

    const progressed = recordTaskProgress(run, {
      runId: "run-1",
      taskId: "task-1",
      progress: "halfway",
      idempotencyKey: "progress-note-1",
      artifact: { type: "note", ref: "progress-note" },
    });
    const duplicateProgress = recordTaskProgress(progressed, {
      runId: "run-1",
      taskId: "task-1",
      progress: "halfway replay",
      idempotencyKey: "progress-note-1",
      artifact: { type: "note", ref: "progress-note-replay" },
    });

    expect(duplicateProgress.artifacts).toHaveLength(progressed.artifacts.length);
    expect(duplicateProgress.tasks[0]?.artifactIds).toEqual(progressed.tasks[0]?.artifactIds);
    expect(duplicateProgress.runs[0]?.artifactIds).toEqual(progressed.runs[0]?.artifactIds);
  });

  it("deduplicates child completion artifacts by idempotency key", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    let run = addWorker(
      createEmptyRun(deriveProjectKey(repoRoot), repoRoot),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: repoRoot,
        sessionFile: null,
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

    const completed = recordTaskCompletion(run, {
      runId: "run-1",
      taskId: "task-1",
      status: "succeeded",
      completionSummary: "done",
      idempotencyKey: "completion-note-1",
      artifact: { type: "note", ref: "completion-note" },
    });
    const duplicateCompletion = recordTaskCompletion(completed, {
      runId: "run-1",
      taskId: "task-1",
      status: "failed",
      completionSummary: "late replay",
      idempotencyKey: "completion-note-1",
      artifact: { type: "note", ref: "completion-note-replay" },
    });

    expect(duplicateCompletion.artifacts).toHaveLength(completed.artifacts.length);
    expect(duplicateCompletion.tasks[0]?.artifactIds).toEqual(completed.tasks[0]?.artifactIds);
    expect(duplicateCompletion.runs[0]?.artifactIds).toEqual(completed.runs[0]?.artifactIds);
  });

  it("validates child note refs before writing captured content", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    let run = addWorker(
      createEmptyRun(deriveProjectKey(repoRoot), repoRoot),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: repoRoot,
        sessionFile: null,
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
        progress: "orphan me",
        artifact: { type: "note", ref: "../unsafe-note" },
      }),
    ).toThrow("Unsafe artifact ref");
    expect(existsSync(join(run.storageDir, "artifacts"))).toBe(false);
  });

  it("validates child completion note refs before writing captured content", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    let run = addWorker(
      createEmptyRun(deriveProjectKey(repoRoot), repoRoot),
      createWorkerRecord({
        workerId: "worker-1",
        name: "backend",
        branch: "conductor/backend",
        worktreePath: repoRoot,
        sessionFile: null,
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
      recordTaskCompletion(run, {
        runId: "run-1",
        taskId: "task-1",
        status: "succeeded",
        completionSummary: "orphan me",
        artifact: { type: "note", ref: "../unsafe-note" },
      }),
    ).toThrow("Unsafe artifact ref");
    expect(existsSync(join(run.storageDir, "artifacts"))).toBe(false);
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

  it("queries artifacts with filters and pagination", () => {
    let run = createEmptyRun("abc", "/repo");
    run = addConductorArtifact(run, {
      artifactId: "artifact-1",
      type: "log",
      ref: "progress://run-1/1",
      resourceRefs: { taskId: "task-1", runId: "run-1" },
      producer: { type: "child_run", id: "run-1" },
    });
    run = addConductorArtifact(run, {
      artifactId: "artifact-2",
      type: "completion_report",
      ref: "completion://run-1",
      resourceRefs: { taskId: "task-1", runId: "run-1" },
      producer: { type: "child_run", id: "run-1" },
    });

    const page = queryConductorArtifacts(run, { taskId: "task-1", type: "log", limit: 1 });

    expect(page.artifacts.map((artifact) => artifact.artifactId)).toEqual(["artifact-1"]);
    expect(page.lastIndex).toBe(1);
    expect(page.hasMore).toBe(false);
    expect(queryConductorArtifacts(run, { limit: 1 }).hasMore).toBe(true);
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
    expect(withProgress.tasks.find((entry) => entry.taskId === "task-1")?.artifactIds).toContain(
      withProgress.artifacts[0]?.artifactId,
    );
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
    expect(completed.tasks.find((entry) => entry.taskId === "task-1")?.artifactIds).toEqual(
      completed.artifacts.map((artifact) => artifact.artifactId),
    );
    expect(completed.runs.find((entry) => entry.runId === "run-1")?.completionSummary).toBe("implemented and verified");
  });

  it("normalizes legacy task artifact ids from task-scoped artifact refs", () => {
    let run = addTask(
      createEmptyRun("abc", "/repo"),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-legacy-note",
      type: "note",
      ref: "note://legacy",
      resourceRefs: { taskId: "task-1", runId: "run-legacy" },
      producer: { type: "child_run", id: "run-legacy" },
      metadata: { summary: "legacy" },
    });
    const legacyRun = {
      ...run,
      tasks: run.tasks.map((task) => (task.taskId === "task-1" ? { ...task, artifactIds: [] } : task)),
    };

    const normalized = normalizeProjectRecord(legacyRun);

    expect(normalized.tasks.find((task) => task.taskId === "task-1")?.artifactIds).toEqual(["artifact-legacy-note"]);
  });

  it("reads metadata-only note artifacts with bounded diagnostics", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-legacy",
      type: "note",
      ref: "note://legacy-summary",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "child_run", id: "run-legacy" },
      metadata: { summary: "legacy summary", details: "more details" },
    });
    writeRun(run);

    const content = readArtifactContentForRepo(repoRoot, "artifact-note-legacy", { maxBytes: 24 });

    expect(content).toMatchObject({
      artifactId: "artifact-note-legacy",
      ref: "note://legacy-summary",
      truncated: true,
      diagnostic: "Metadata-only note artifact has no readable content file",
    });
    expect(content.content).toBe('{\n  "metadata": {\n    "s');
  });

  it("reads legacy child note artifacts with relative refs as metadata-only diagnostics", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-relative-legacy",
      type: "note",
      ref: "relative-legacy-note",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "child_run", id: "run-legacy" },
      metadata: { summary: "legacy relative note" },
    });
    writeRun(run);

    expect(readArtifactContentForRepo(repoRoot, "artifact-note-relative-legacy")).toMatchObject({
      content: expect.stringContaining("legacy relative note"),
      diagnostic: "Metadata-only note artifact has no readable content file",
      contentSource: "metadata_fallback",
    });
  });

  it("rejects untrusted captured note content refs in persisted metadata", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-untrusted-ref",
      type: "note",
      ref: "note-ref",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "child_run", id: "run-legacy" },
      metadata: { conductorNoteContentRef: "run.json" },
    });
    writeRun(run);

    expect(() => readArtifactContentForRepo(repoRoot, "artifact-note-untrusted-ref")).toThrow(
      "untrusted captured note content ref",
    );
  });

  it("rejects symlinked captured note content refs", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-symlink-ref",
      type: "note",
      ref: "note-ref",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "child_run", id: "run-legacy" },
      metadata: { conductorNoteContentRef: "artifacts/artifact-note-symlink-ref.txt" },
    });
    writeRun(run);
    mkdirSync(join(run.storageDir, "artifacts"), { recursive: true });
    const target = join(tmpdir(), "pi-conductor-symlink-target.txt");
    writeFileSync(target, "outside storage", "utf-8");
    symlinkSync(target, join(run.storageDir, "artifacts", "artifact-note-symlink-ref.txt"));

    expect(() => readArtifactContentForRepo(repoRoot, "artifact-note-symlink-ref")).toThrow("Unsafe captured note ref");
  });

  it("keeps system external note refs external instead of metadata fallbacks", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-external-system",
      type: "note",
      ref: "https://example.com/note",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "system", id: "test" },
      metadata: { summary: "external note" },
    });
    writeRun(run);

    expect(readArtifactContentForRepo(repoRoot, "artifact-note-external-system")).toMatchObject({
      content: null,
      diagnostic: "Artifact ref is external or virtual",
      contentSource: "none",
    });
  });

  it("reports missing local note files as missing artifacts", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    let run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    run = addConductorArtifact(run, {
      artifactId: "artifact-note-missing",
      type: "note",
      ref: "missing-note.txt",
      resourceRefs: { taskId: "task-1" },
      producer: { type: "system", id: "test" },
      metadata: { summary: "metadata exists" },
    });
    writeRun(run);

    expect(readArtifactContentForRepo(repoRoot, "artifact-note-missing")).toMatchObject({
      artifactId: "artifact-note-missing",
      ref: "missing-note.txt",
      content: null,
      truncated: false,
      diagnostic: "Artifact file is missing",
    });
  });

  it("degrades legacy artifacts without metadata to bounded diagnostics", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    const projectKey = deriveProjectKey(repoRoot);
    const run = addTask(
      createEmptyRun(projectKey, repoRoot),
      createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
    );
    writeRun({
      ...run,
      artifacts: [
        {
          artifactId: "artifact-note-no-metadata",
          type: "note",
          ref: "note://legacy-no-metadata",
          resourceRefs: { projectKey, taskId: "task-1" },
          producer: { type: "child_run", id: "run-legacy" },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as never,
      ],
    });

    expect(readArtifactContentForRepo(repoRoot, "artifact-note-no-metadata", { maxBytes: 10 })).toMatchObject({
      content: '{\n  "metad',
      truncated: true,
      diagnostic: "Metadata-only note artifact has no readable content file",
    });
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
    expect(worker.recoverable).toBe(false);
    expect(worker.pr.prCreationAttempted).toBe(false);
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeNull();
    expect(worker.runtime.lastResumedAt).toBeNull();
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

  it("normalizes legacy run attempts without runtime metadata", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const legacy = {
      ...run,
      workers: [worker],
      tasks: [{ ...task, assignedWorkerId: worker.workerId, activeRunId: "run-1", runIds: ["run-1"] }],
      runs: [
        {
          runId: "run-1",
          taskId: task.taskId,
          workerId: worker.workerId,
          taskRevision: 1,
          status: "running",
          backend: "native",
          backendRunId: null,
          sessionId: "session-1",
          leaseGeneration: 1,
          leaseStartedAt: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: null,
          completionSummary: null,
          errorMessage: null,
          artifactIds: [],
          gateIds: [],
        },
      ],
    };

    const projectDir = getConductorProjectDir("abc");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "run.json"), `${JSON.stringify(legacy, null, 2)}\n`, "utf-8");

    const persisted = readRun("abc");
    expect(persisted?.runs[0]?.runtime).toMatchObject({
      mode: "headless",
      status: "running",
      sessionId: "session-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      cleanupStatus: "not_required",
    });
  });

  it("normalizes persisted runtime metadata that predates runner nonce fields", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const running = startTaskRun(
      assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
      {
        runId: "run-1",
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "native",
        leaseExpiresAt: "2026-01-01T00:15:00.000Z",
      },
    );
    const { contractPath: _contractPath, nonceHash: _nonceHash, ...legacyRuntime } = running.runs[0]?.runtime ?? {};

    const projectDir = getConductorProjectDir("abc");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "run.json"),
      `${JSON.stringify({ ...running, runs: [{ ...running.runs[0], runtime: legacyRuntime }] }, null, 2)}\n`,
      "utf-8",
    );

    const persisted = readRun("abc");
    expect(persisted?.runs[0]?.runtime).toMatchObject({ contractPath: null, nonceHash: null });
  });

  it("rejects malformed runtime metadata", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const running = startTaskRun(
      assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
      {
        runId: "run-1",
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "native",
        leaseExpiresAt: "2026-04-24T01:00:00.000Z",
      },
    );
    const runtime = running.runs[0]?.runtime;
    if (!runtime) throw new Error("expected runtime");

    expect(() =>
      validateRunRecord({
        ...running,
        runs: [{ ...running.runs[0], runtime: { ...runtime, mode: "bogus" } } as never],
      }),
    ).toThrow(/runtime\.mode has invalid value/i);
    expect(() =>
      validateRunRecord({
        ...running,
        runs: [{ ...running.runs[0], runtime: { ...runtime, diagnostics: "not-an-array" } } as never],
      }),
    ).toThrow(/runtime\.diagnostics must be an array of strings/i);
    const { diagnostics: _diagnostics, ...partialRuntime } = runtime;
    expect(() =>
      validateRunRecord({
        ...running,
        runs: [{ ...running.runs[0], runtime: partialRuntime } as never],
      }),
    ).toThrow(/runtime missing required field diagnostics/i);
    expect(() =>
      validateRunRecord({
        ...running,
        runs: [
          {
            ...running.runs[0],
            runtime: { ...runtime, mode: "tmux", tmux: { socketPath: "/tmp/socket", sessionName: "s" } },
          } as never,
        ],
      }),
    ).toThrow(/runtime\.tmux missing required field windowId/i);
    expect(() =>
      validateRunRecord({
        ...running,
        runs: [
          {
            ...running.runs[0],
            runtime: {
              ...runtime,
              mode: "tmux",
              tmux: { socketPath: "/tmp/socket", sessionName: "s", windowId: "w", paneId: "%1" },
              viewerStatus: "pending",
              cleanupStatus: "pending",
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("lets canonical terminal run state win over stale runtime metadata", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: null,
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const running = startTaskRun(
      assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
      {
        runId: "run-1",
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "native",
        leaseExpiresAt: "2026-04-24T01:00:00.000Z",
      },
    );
    const canceled = cancelTaskRun(running, { runId: "run-1", reason: "stop" });
    const corrupted = {
      ...canceled,
      runs: canceled.runs.map((attempt) =>
        attempt.runId === "run-1"
          ? { ...attempt, runtime: { ...attempt.runtime, status: "running", finishedAt: null } }
          : attempt,
      ),
    };
    const projectDir = getConductorProjectDir("abc");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "run.json"), `${JSON.stringify(corrupted, null, 2)}\n`, "utf-8");

    const persisted = readRun("abc");
    expect(persisted?.runs[0]?.runtime).toMatchObject({ status: "aborted", finishedAt: canceled.runs[0]?.finishedAt });
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
            runtime: {
              mode: "headless",
              status: "running",
              sessionId: null,
              cwd: null,
              command: null,
              contractPath: null,
              nonceHash: null,
              runnerPid: null,
              processGroupId: null,
              tmux: null,
              logPath: null,
              viewerCommand: null,
              viewerStatus: "not_applicable",
              diagnostics: [],
              heartbeatAt: null,
              cleanupStatus: "not_required",
              startedAt: null,
              finishedAt: null,
            },
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

  it("rejects persisted workers missing required fields", () => {
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
    const incompleteWorker = JSON.parse(JSON.stringify(worker)) as Record<string, unknown>;
    delete incompleteWorker.runtime;
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...run,
          workers: [incompleteWorker],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    expect(() => readRun("abc")).toThrow(/missing required field runtime/);
  });

  it("rejects persisted workers with unsupported worker-owned run fields", () => {
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
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...run,
          workers: [{ ...worker, workerRunShadow: { status: "running" } }],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    expect(() => readRun("abc")).toThrow(/unsupported field workerRunShadow/);
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

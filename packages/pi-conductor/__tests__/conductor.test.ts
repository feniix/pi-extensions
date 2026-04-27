import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  cancelActiveWorkForRepo,
  cancelTaskRunForRepo,
  createFollowUpTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  delegateTaskForRepo,
  getOrCreateRunForRepo,
  reconcileProjectForRepo,
  retryTaskForRepo,
  runParallelWorkForRepo,
  runTaskForRepo,
  runWorkForRepo,
  startTaskRunForRepo,
  updateTaskForRepo,
} from "../extensions/conductor.js";

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe("conductor service", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;

    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
    if (existsSync(conductorHome)) {
      rmSync(conductorHome, { recursive: true, force: true });
    }
  });

  it("creates and persists an empty run for a repo", () => {
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.repoRoot).toBe(repoDir);
    expect(run.workers).toEqual([]);
    expect(readFileSync(join(run.storageDir, "run.json"), "utf-8")).toContain("projectKey");
  });

  it("creates and assigns durable tasks through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, {
      title: "Add task ledger",
      prompt: "Implement durable task records",
    });

    expect(task.title).toBe("Add task ledger");
    expect(task.state).toBe("ready");

    const assigned = assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    expect(assigned.state).toBe("assigned");
    expect(assigned.assignedWorkerId).toBe(worker.workerId);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks).toHaveLength(1);
    expect(run.tasks[0]?.taskId).toBe(task.taskId);
    expect(run.events.map((event) => event.type)).toEqual(["worker.created", "task.created", "task.assigned"]);
  });

  it("lets allowed child runs create follow-up tasks", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Primary", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, {
      taskId: task.taskId,
      workerId: worker.workerId,
      allowFollowUpTasks: true,
    });

    expect(started.taskContract.allowFollowUpTasks).toBe(true);
    const followUp = createFollowUpTaskForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      title: "Follow-up",
      prompt: "Do more",
    });

    expect(followUp).toMatchObject({ title: "Follow-up", prompt: "Do more", state: "ready" });
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks).toHaveLength(2);
    expect(run.events.map((event) => event.type)).toContain("task.followup_created");
  });

  it("fails closed when an unsupported backend is requested", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Subagent task", prompt: "Do it elsewhere" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    expect(() =>
      startTaskRunForRepo(repoDir, {
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "pi-subagents",
        inspectBackends: () => ({
          native: {
            available: true,
            canonicalStateOwner: "conductor",
            capabilities: {
              canStartRun: true,
              canRunForeground: true,
              supportsScopedChildTools: true,
              requiresReviewOnExit: true,
            },
            diagnostic: null,
          },
          piSubagents: {
            available: false,
            canonicalStateOwner: "conductor",
            capabilities: {
              canStartRun: false,
              canRunForeground: false,
              supportsScopedChildTools: false,
              requiresReviewOnExit: true,
            },
            diagnostic: "not installed in test",
          },
        }),
      }),
    ).toThrow(/pi-subagents backend unavailable/i);

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks[0]).toMatchObject({ state: "assigned", activeRunId: null });
    expect(run.events.at(-1)).toMatchObject({ type: "backend.unavailable" });
  });

  it("starts an assigned durable task run through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Add run ledger", prompt: "Implement durable runs" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: 300 });

    expect(started.run.taskId).toBe(task.taskId);
    expect(started.run.workerId).toBe(worker.workerId);
    expect(started.run.status).toBe("running");
    expect(started.taskContract).toMatchObject({
      taskId: task.taskId,
      runId: started.run.runId,
      goal: "Implement durable runs",
      explicitCompletionTools: true,
    });

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks[0]).toMatchObject({ state: "running", activeRunId: started.run.runId });
  });

  it("does not start two active runs on the same worker", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const first = createTaskForRepo(repoDir, { title: "First", prompt: "Do first work" });
    const second = createTaskForRepo(repoDir, { title: "Second", prompt: "Do second work" });
    assignTaskForRepo(repoDir, first.taskId, worker.workerId);
    assignTaskForRepo(repoDir, second.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: first.taskId, workerId: worker.workerId });

    expect(() => startTaskRunForRepo(repoDir, { taskId: second.taskId, workerId: worker.workerId })).toThrow(
      /cannot start another run/i,
    );
  });

  it("delegates a task through the parent-agent happy path", async () => {
    const delegated = await delegateTaskForRepo(repoDir, {
      title: "Happy path",
      prompt: "Implement the happy path",
      workerName: "backend",
      startRun: true,
      leaseSeconds: 300,
    });

    expect(delegated.worker.name).toBe("backend");
    expect(delegated.task).toMatchObject({
      title: "Happy path",
      state: "running",
      assignedWorkerId: delegated.worker.workerId,
    });
    expect(delegated.run).toMatchObject({
      taskId: delegated.task.taskId,
      workerId: delegated.worker.workerId,
      status: "running",
    });
    expect(delegated.taskContract).toMatchObject({ taskId: delegated.task.taskId, runId: delegated.run?.runId });

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.tasks).toHaveLength(1);
    expect(run.runs).toHaveLength(1);
  });

  it("cancels active conductor work without requiring run IDs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Cancelable", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });

    const canceled = cancelActiveWorkForRepo(repoDir, { reason: "human pressed escape" });

    expect(canceled.canceledRuns).toEqual([started.run.runId]);
    expect(canceled.canceledTasks).toEqual([task.taskId]);
    expect(canceled.project.runs[0]).toMatchObject({ status: "aborted", errorMessage: "human pressed escape" });
    expect(canceled.project.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });
    expect(canceled.project.workers[0]).toMatchObject({ lifecycle: "idle" });
  });

  it("does not start parallel work when the orchestration signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let startedCount = 0;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [
          { title: "First shard", prompt: "Do first shard" },
          { title: "Second shard", prompt: "Do second shard" },
        ],
      },
      controller.signal,
      async (root, taskId) => {
        startedCount += 1;
        return runTaskForRepo(root, taskId, controller.signal);
      },
    );

    expect(startedCount).toBe(0);
    expect(result.canceledTasks).toHaveLength(2);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.tasks.map((task) => task.state)).toEqual(["canceled", "canceled"]);
    expect(run.runs).toHaveLength(0);
  });

  it("runs parallel work under one abortable orchestration boundary", async () => {
    const controller = new AbortController();
    let startedCount = 0;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [
          { title: "First shard", prompt: "Do first shard" },
          { title: "Second shard", prompt: "Do second shard" },
        ],
      },
      controller.signal,
      async (root, taskId) => {
        const started = startTaskRunForRepo(root, { taskId });
        startedCount += 1;
        if (startedCount === 2) controller.abort();
        return {
          workerName: started.run.workerId,
          status: "aborted",
          finalText: null,
          errorMessage: null,
          sessionId: null,
        };
      },
    );

    expect(result.tasks.map((task) => task.title)).toEqual(["First shard", "Second shard"]);
    expect(result.canceledRuns).toHaveLength(2);
    expect(result.canceledTasks).toHaveLength(2);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers.map((worker) => worker.lifecycle)).toEqual(["idle", "idle"]);
    expect(run.tasks.map((task) => task.state)).toEqual(["canceled", "canceled"]);
    expect(run.runs.map((attempt) => attempt.status)).toEqual(["aborted", "aborted"]);
  });

  it("aborts live parallel runners when active work is canceled", async () => {
    let runnerSignal: AbortSignal | undefined;

    const result = await runParallelWorkForRepo(
      repoDir,
      {
        workerPrefix: "parallel",
        tasks: [{ title: "Cancelable shard", prompt: "Do cancelable shard" }],
      },
      undefined,
      async (_root, _taskId, signal) => {
        runnerSignal = signal;
        const canceled = cancelActiveWorkForRepo(repoDir, { reason: "human asked to stop" });
        expect(canceled.canceledTasks).toHaveLength(1);
        expect(runnerSignal?.aborted).toBe(true);
        return {
          workerName: "parallel-1",
          status: "aborted",
          finalText: null,
          errorMessage: "human asked to stop",
          sessionId: null,
        };
      },
    );

    expect(result.canceledTasks).toHaveLength(1);
    expect(runnerSignal?.aborted).toBe(true);
  });

  it("rejects duplicate worker names for parallel work before dispatch", async () => {
    await expect(
      runParallelWorkForRepo(repoDir, {
        tasks: [
          { title: "First shard", prompt: "Do first shard", workerName: "same-worker" },
          { title: "Second shard", prompt: "Do second shard", workerName: "same-worker" },
        ],
      }),
    ).rejects.toThrow(/duplicate parallel worker name/i);
  });

  it("rejects parallel reuse of a busy worker", async () => {
    const worker = await createWorkerForRepo(repoDir, "busy-worker");
    const task = createTaskForRepo(repoDir, { title: "Busy task", prompt: "Keep the worker busy" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    await expect(
      runParallelWorkForRepo(repoDir, {
        tasks: [{ title: "New shard", prompt: "Do new shard", workerName: "busy-worker" }],
      }),
    ).rejects.toThrow(/not idle/i);
  });

  it("runs small natural-language work as one conductor worker by default", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Fix the typo in README.md",
        tasks: [{ title: "Fix README typo", prompt: "Fix the typo in README.md", writeScope: ["README.md"] }],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      reason: expect.stringMatching(/single/i),
    });
    expect(result.tasks.map((task) => task.title)).toEqual(["Fix README typo"]);
    expect(result.parallel).toBeNull();
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.tasks).toHaveLength(1);
  });

  it("routes independent scoped work items to parallel workers", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Deep dive these independent pi-conductor areas in parallel",
        maxWorkers: 3,
        tasks: [
          { title: "Inspect README", prompt: "Inspect README.md", writeScope: ["README.md"] },
          { title: "Inspect tests", prompt: "Inspect tests", writeScope: ["__tests__/"] },
          { title: "Inspect runtime", prompt: "Inspect runtime", writeScope: ["extensions/runtime.ts"] },
        ],
      },
      undefined,
      async (_root, taskId) => ({
        workerName: taskId,
        status: "success",
        finalText: "done",
        errorMessage: null,
        sessionId: null,
      }),
    );

    expect(result.decision).toMatchObject({
      mode: "parallel",
      reason: expect.stringMatching(/independent/i),
    });
    expect(result.parallel?.results).toHaveLength(3);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers.map((worker) => worker.name)).toEqual(["run-work-1", "run-work-2", "run-work-3"]);
  });

  it("does not split work with overlapping write scopes", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Split the runtime refactor across workers",
        tasks: [
          { title: "Refactor runtime setup", prompt: "Refactor runtime setup", writeScope: ["extensions/runtime.ts"] },
          { title: "Refactor runtime tests", prompt: "Refactor runtime tests", writeScope: ["extensions/runtime.ts"] },
        ],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      riskFlags: expect.arrayContaining(["overlapping_write_scope"]),
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.prompt).toContain("Refactor runtime setup");
    expect(result.tasks[0]?.prompt).toContain("Refactor runtime tests");
  });

  it("does not split work with nested write scopes", async () => {
    const result = await runWorkForRepo(
      repoDir,
      {
        request: "Split the runtime refactor across workers",
        tasks: [
          { title: "Refactor extensions", prompt: "Refactor extension modules", writeScope: ["extensions/"] },
          {
            title: "Refactor runtime",
            prompt: "Refactor runtime module",
            writeScope: ["extensions/runtime.ts"],
          },
        ],
      },
      undefined,
      async () => ({ workerName: "single", status: "success", finalText: "done", errorMessage: null, sessionId: null }),
    );

    expect(result.decision).toMatchObject({
      mode: "single",
      riskFlags: expect.arrayContaining(["overlapping_write_scope"]),
    });
    expect(result.tasks).toHaveLength(1);
  });

  it("plans dependent work as an objective instead of parallel fan-out", async () => {
    const result = await runWorkForRepo(repoDir, {
      request: "Implement the feature, then verify it",
      execute: false,
      tasks: [
        { title: "Implement feature", prompt: "Implement the feature in the package", writeScope: ["extensions/"] },
        {
          title: "Verify feature",
          prompt: "Verify the feature after implementation",
          writeScope: ["__tests__/"],
          dependsOn: ["Implement feature"],
        },
      ],
    });

    expect(result.decision).toMatchObject({
      mode: "objective",
      reason: expect.stringMatching(/depend/i),
    });
    expect(result.objective?.tasks.map((task) => task.title)).toEqual(["Implement feature", "Verify feature"]);
    expect(result.parallel).toBeNull();
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.objectives).toHaveLength(1);
    expect(run.tasks[1]?.dependsOnTaskIds).toEqual([run.tasks[0]?.taskId]);
  });

  it("updates durable tasks through conductor service helpers", () => {
    const task = createTaskForRepo(repoDir, { title: "Original", prompt: "Do it" });

    const updated = updateTaskForRepo(repoDir, { taskId: task.taskId, title: "Updated", prompt: "Do it better" });

    expect(updated).toMatchObject({ title: "Updated", prompt: "Do it better", revision: 2 });
    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("task.updated");
  });

  it("cancels and retries task runs through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Retry task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    const canceled = cancelTaskRunForRepo(repoDir, {
      runId: started.run.runId,
      reason: "superseded attempt",
    });
    expect(canceled.runs[0]).toMatchObject({ status: "aborted" });
    expect(canceled.tasks[0]).toMatchObject({ state: "canceled", activeRunId: null });

    const retried = retryTaskForRepo(repoDir, { taskId: task.taskId, leaseSeconds: 300 });
    expect(retried.run.runId).not.toBe(started.run.runId);
    expect(retried.run).toMatchObject({ taskId: task.taskId, workerId: worker.workerId, status: "running" });
    expect(retried.taskContract).toMatchObject({ taskId: task.taskId, runId: retried.run.runId });
    expect(getOrCreateRunForRepo(repoDir).tasks[0]?.runIds).toHaveLength(2);
  });

  it("reconciles project leases and persists safe state transitions", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Lease task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: -1 });

    const reconciled = reconcileProjectForRepo(repoDir, { now: "2999-01-01T00:00:00.000Z" });

    expect(reconciled.runs[0]).toMatchObject({ status: "stale" });
    expect(reconciled.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(getOrCreateRunForRepo(repoDir).events.map((event) => event.type)).toContain("run.lease_expired");
  });

  it("supports read-only project reconciliation dry runs", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Lease task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId, leaseSeconds: -1 });

    const preview = reconcileProjectForRepo(repoDir, { now: "2999-01-01T00:00:00.000Z", dryRun: true });

    expect(preview.runs[0]).toMatchObject({ status: "stale" });
    expect(preview.tasks[0]).toMatchObject({ state: "needs_review" });
    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.runs[0]).toMatchObject({ status: "running" });
    expect(persisted.tasks[0]).toMatchObject({ state: "running" });
    expect(persisted.events.map((event) => event.type)).not.toContain("run.lease_expired");
  });

  it("creates a worker, worktree, and persisted worker record", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
    const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
    expect(worker.name).toBe("backend");
    expect(worker.branch).toBe("conductor/backend");
    expect(worker.worktreePath).toBeTruthy();
    expect(existsSync(worktreePath)).toBe(true);
    expect(worker.sessionFile).toBeTruthy();
    expect(existsSync(sessionFile)).toBe(true);
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeTruthy();

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.workers[0]?.name).toBe("backend");
    expect(run.workers[0]?.sessionFile).toBeTruthy();
    expect(run.workers[0]?.runtime.sessionId).toBeTruthy();
  });
});

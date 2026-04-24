import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  cancelTaskRunForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  delegateTaskForRepo,
  getOrCreateRunForRepo,
  reconcileProjectForRepo,
  retryTaskForRepo,
  startTaskRunForRepo,
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
    expect(run.events.map((event) => event.type)).toEqual(["task.created", "task.assigned"]);
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

  it("cancels and retries task runs through conductor service helpers", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Retry task", prompt: "Do it" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, workerId: worker.workerId });

    const canceled = cancelTaskRunForRepo(repoDir, {
      runId: started.run.runId,
      reason: "obsolete attempt",
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

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
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

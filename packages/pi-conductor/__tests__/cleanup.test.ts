import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createGateForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
} from "../extensions/conductor.js";

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe("cleanup flows", () => {
  let repoDir: string;
  let conductorHome: string;

  function approveCleanupGate(workerId: string): void {
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId },
      requestedDecision: "Approve worker cleanup",
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "cleanup approved",
    });
  }

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

  it("rejects destructive cleanup approvals scoped to the wrong operation", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve wrong operation",
      operation: "create_worker_pr",
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "approved",
    });

    expect(() => removeWorkerForRepo(repoDir, "backend")).toThrow(/destructive_cleanup/i);
  });

  it("refuses cleanup when a worker still has assigned work", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
    const task = createTaskForRepo(repoDir, { title: "Pending", prompt: "Do pending work" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    approveCleanupGate(worker.workerId);

    expect(() => removeWorkerForRepo(repoDir, "backend")).toThrow(/not idle and ready/);
    expect(existsSync(worktreePath)).toBe(true);
  });

  it("removes a worker record and its worktree", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
    expect(existsSync(worktreePath)).toBe(true);
    approveCleanupGate(worker.workerId);
    const removed = removeWorkerForRepo(repoDir, "backend");
    expect(removed.workerId).toBe(worker.workerId);
    expect(existsSync(worktreePath)).toBe(false);
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(0);
    expect(run.archivedWorkers.map((entry) => entry.workerId)).toContain(worker.workerId);
    expect(run.events.map((event) => event.type)).toContain("gate.used");
  });

  it("removes the persisted session file when cleaning up a worker", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
    expect(existsSync(sessionFile)).toBe(true);
    approveCleanupGate(worker.workerId);
    removeWorkerForRepo(repoDir, "backend");
    expect(existsSync(sessionFile)).toBe(false);
  });

  it("removes the worker branch so the same worker name can be recreated", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const branch = requireValue(worker.branch, "worker branch missing");
    expect(execSync(`git branch --list ${branch}`, { cwd: repoDir, encoding: "utf-8" }).trim()).toContain(branch);
    approveCleanupGate(worker.workerId);
    removeWorkerForRepo(repoDir, "backend");
    expect(execSync(`git branch --list ${branch}`, { cwd: repoDir, encoding: "utf-8" }).trim()).toBe("");

    const recreated = await createWorkerForRepo(repoDir, "backend");
    expect(recreated.branch).toBe(worker.branch);
  });
});

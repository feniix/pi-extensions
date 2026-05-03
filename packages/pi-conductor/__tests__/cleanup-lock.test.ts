import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const worktreeMockState = vi.hoisted(() => ({
  onRemoveManagedWorktree: null as null | (() => void),
  onRemoveManagedBranch: null as null | (() => void),
}));

vi.mock("../extensions/worktrees.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/worktrees.js")>();
  return {
    ...actual,
    removeManagedWorktree(repoRoot: string, worktreePath: string): void {
      worktreeMockState.onRemoveManagedWorktree?.();
      actual.removeManagedWorktree(repoRoot, worktreePath);
    },
    removeManagedBranch(repoRoot: string, branch: string): void {
      worktreeMockState.onRemoveManagedBranch?.();
      actual.removeManagedBranch(repoRoot, branch);
    },
  };
});

import {
  assignTaskForRepo,
  createGateForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  recoverWorkerForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("cleanup lock boundaries", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    worktreeMockState.onRemoveManagedWorktree = null;
    worktreeMockState.onRemoveManagedBranch = null;
    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    worktreeMockState.onRemoveManagedWorktree = null;
    worktreeMockState.onRemoveManagedBranch = null;
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  function approveCleanupGate(workerId: string): void {
    const run = getOrCreateRunForRepo(repoDir);
    const generation =
      run.tasks.filter((task) => task.assignedWorkerId === workerId).length +
      run.runs.filter((entry) => entry.workerId === workerId).length;
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId },
      requestedDecision: "Approve worker cleanup",
      targetRevision: generation,
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "cleanup approved",
    });
  }

  it("does not hold the conductor state lock while deleting worker resources", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const generation = getOrCreateRunForRepo(repoDir).runs.filter((entry) => entry.workerId === worker.workerId).length;
    const gate = createGateForRepo(repoDir, {
      type: "destructive_cleanup",
      resourceRefs: { workerId: worker.workerId },
      requestedDecision: "Approve worker cleanup",
      targetRevision: generation,
    });
    resolveGateForRepo(repoDir, {
      gateId: gate.gateId,
      status: "approved",
      actor: { type: "human", id: "reviewer" },
      resolutionReason: "cleanup approved",
    });

    worktreeMockState.onRemoveManagedWorktree = () => {
      const concurrentTask = createTaskForRepo(repoDir, { title: "Concurrent task", prompt: "Prove lock is free" });
      expect(() => assignTaskForRepo(repoDir, concurrentTask.taskId, worker.workerId)).toThrow(/cannot be assigned/);
    };

    removeWorkerForRepo(repoDir, "backend");

    const after = getOrCreateRunForRepo(repoDir);
    expect(after.tasks.map((task) => task.title)).toContain("Concurrent task");
    expect(after.workers).toHaveLength(0);
    expect(after.archivedWorkers.map((entry) => entry.workerId)).toContain(worker.workerId);
  });

  it("leaves partial cleanup failures reserved, non-assignable, and retryable", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    approveCleanupGate(worker.workerId);
    let failBranchRemoval = true;
    worktreeMockState.onRemoveManagedBranch = () => {
      if (failBranchRemoval) {
        failBranchRemoval = false;
        throw new Error("branch deletion failed once");
      }
    };

    expect(() => removeWorkerForRepo(repoDir, "backend")).toThrow(/branch deletion failed once/);

    const afterFailure = getOrCreateRunForRepo(repoDir);
    const reservedWorker = afterFailure.workers.find((entry) => entry.workerId === worker.workerId);
    expect(reservedWorker?.lifecycle).toBe("broken");
    expect(reservedWorker?.recoverable).toBe(true);
    expect(afterFailure.events.map((event) => event.type)).toContain("worker.cleanup_failed");
    const task = createTaskForRepo(repoDir, { title: "Do not assign", prompt: "Worker is mid-cleanup" });
    expect(() => assignTaskForRepo(repoDir, task.taskId, worker.workerId)).toThrow(/cannot be assigned/);

    const removed = removeWorkerForRepo(repoDir, "backend");
    expect(removed.workerId).toBe(worker.workerId);
    const afterRetry = getOrCreateRunForRepo(repoDir);
    expect(afterRetry.workers.map((entry) => entry.workerId)).not.toContain(worker.workerId);
    expect(afterRetry.archivedWorkers.map((entry) => entry.workerId)).toContain(worker.workerId);
  });

  it("rejects recovery while cleanup is reserved outside the state lock", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    approveCleanupGate(worker.workerId);
    let recoveryResult: Promise<unknown> | undefined;
    worktreeMockState.onRemoveManagedWorktree = () => {
      recoveryResult = recoverWorkerForRepo(repoDir, "backend").then(
        () => new Error("recovery unexpectedly succeeded"),
        (error) => error,
      );
    };

    removeWorkerForRepo(repoDir, "backend");

    expect(recoveryResult).toBeDefined();
    const recoveryError = await recoveryResult;
    expect(recoveryError).toBeInstanceOf(Error);
    expect((recoveryError as Error).message).toMatch(/reserved for destructive cleanup/);
  });

  it("finalizes an already-reserved cleanup retry", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    approveCleanupGate(worker.workerId);
    const run = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...run,
      workers: run.workers.map((entry) =>
        entry.workerId === worker.workerId ? { ...entry, lifecycle: "broken", recoverable: true } : entry,
      ),
    });

    const removed = removeWorkerForRepo(repoDir, "backend");

    expect(removed.workerId).toBe(worker.workerId);
    const after = getOrCreateRunForRepo(repoDir);
    expect(after.workers.map((entry) => entry.workerId)).not.toContain(worker.workerId);
    expect(after.archivedWorkers.map((entry) => entry.workerId)).toContain(worker.workerId);
    expect(after.gates.find((entry) => entry.resourceRefs.workerId === worker.workerId)?.usedAt).not.toBeNull();
  });
});

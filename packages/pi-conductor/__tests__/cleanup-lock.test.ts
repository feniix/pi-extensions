import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const worktreeMockState = vi.hoisted(() => ({
  onRemoveManagedWorktree: null as null | (() => void),
}));

vi.mock("../extensions/worktrees.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/worktrees.js")>();
  return {
    ...actual,
    removeManagedWorktree(repoRoot: string, worktreePath: string): void {
      worktreeMockState.onRemoveManagedWorktree?.();
      actual.removeManagedWorktree(repoRoot, worktreePath);
    },
  };
});

import {
  assignTaskForRepo,
  createGateForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  removeWorkerForRepo,
  resolveGateForRepo,
} from "../extensions/conductor.js";

describe("cleanup lock boundaries", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    worktreeMockState.onRemoveManagedWorktree = null;
    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    worktreeMockState.onRemoveManagedWorktree = null;
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

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
});

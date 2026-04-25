import { execSync } from "node:child_process";
import {
  createWorktree,
  defaultWorktreeRoot,
  findCurrentWorktree,
  pruneWorktrees,
  removeWorktree,
  resolveWorktreePath,
} from "@feniix/worktrees-core";
import { buildBranchName, normalizeWorkerSlug } from "./workers.js";

function execGit(cwd: string, command: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function getCurrentBranch(repoRoot: string): string {
  const branch = findCurrentWorktree(repoRoot)?.branch;
  if (!branch) {
    throw new Error("Unable to determine current branch");
  }
  return branch;
}

export function planWorktreePath(repoRoot: string, workerName: string): string {
  const directoryName = normalizeWorkerSlug(workerName) ?? "worker";
  return resolveWorktreePath(directoryName, defaultWorktreeRoot(repoRoot));
}

export function createManagedWorktree(
  repoRoot: string,
  input: { workerId: string; workerName: string },
): { branch: string; baseBranch: string; worktreePath: string } {
  const baseBranch = getCurrentBranch(repoRoot);
  const branch = buildBranchName(input.workerId, input.workerName);
  const worktreePath = planWorktreePath(repoRoot, input.workerName);
  createWorktree({
    cwd: repoRoot,
    path: worktreePath,
    branch,
    from: baseBranch,
    createBranch: true,
  });
  return { branch, baseBranch, worktreePath };
}

export function recreateManagedWorktree(
  repoRoot: string,
  input: { workerName: string; branch: string },
): { branch: string; worktreePath: string } {
  const worktreePath = planWorktreePath(repoRoot, input.workerName);
  pruneWorktrees(repoRoot);
  createWorktree({
    cwd: repoRoot,
    path: worktreePath,
    branch: input.branch,
    createBranch: false,
  });
  return { branch: input.branch, worktreePath };
}

export function removeManagedWorktree(repoRoot: string, worktreePath: string): void {
  pruneWorktrees(repoRoot);
  try {
    removeWorktree({ cwd: repoRoot, path: worktreePath, force: true, validateOnForce: true });
  } catch {
    pruneWorktrees(repoRoot);
  }
}

export function removeManagedBranch(repoRoot: string, branch: string): void {
  try {
    execGit(repoRoot, `git branch -D ${shellQuote(branch)}`);
  } catch {
    // Ignore missing or already-removed branches during cleanup.
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

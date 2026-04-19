import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { ensureDir } from "./storage.js";
import { buildBranchName, normalizeWorkerSlug } from "./workers.js";

function execGit(cwd: string, command: string): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function getCurrentBranch(repoRoot: string): string {
  const branch = execGit(repoRoot, "git branch --show-current");
  if (!branch) {
    throw new Error("Unable to determine current branch");
  }
  return branch;
}

export function planWorktreePath(repoRoot: string, workerName: string): string {
  const repoParent = dirname(repoRoot);
  const repoBase = repoRoot.split("/").filter(Boolean).at(-1) ?? "repo";
  const slug = normalizeWorkerSlug(workerName) ?? "worker";
  return join(repoParent, ".pi-conductor-worktrees", repoBase, slug);
}

export function createManagedWorktree(
  repoRoot: string,
  input: { workerId: string; workerName: string },
): { branch: string; baseBranch: string; worktreePath: string } {
  const baseBranch = getCurrentBranch(repoRoot);
  const branch = buildBranchName(input.workerId, input.workerName);
  const worktreePath = planWorktreePath(repoRoot, input.workerName);
  ensureDir(dirname(worktreePath));
  execGit(repoRoot, `git worktree add ${shellQuote(worktreePath)} -b ${shellQuote(branch)} ${shellQuote(baseBranch)}`);
  return { branch, baseBranch, worktreePath };
}

export function recreateManagedWorktree(
  repoRoot: string,
  input: { workerName: string; branch: string },
): { branch: string; worktreePath: string } {
  const worktreePath = planWorktreePath(repoRoot, input.workerName);
  ensureDir(dirname(worktreePath));
  execGit(repoRoot, "git worktree prune");
  execGit(repoRoot, `git worktree add ${shellQuote(worktreePath)} ${shellQuote(input.branch)}`);
  return { branch: input.branch, worktreePath };
}

export function removeManagedWorktree(repoRoot: string, worktreePath: string): void {
  execGit(repoRoot, "git worktree prune");
  try {
    execGit(repoRoot, `git worktree remove --force ${shellQuote(worktreePath)}`);
  } catch {
    execGit(repoRoot, "git worktree prune");
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

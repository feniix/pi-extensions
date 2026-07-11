/**
 * Git and GitHub CLI execution utilities
 */

import { type ExecSyncOptionsWithStringEncoding, execSync } from "node:child_process";

export interface GitWorktreeRecord {
  /** Canonical absolute path reported by Git for this worktree. */
  worktreeRoot: string;
  /** Commit checked out by this worktree. */
  head: string;
  /** Full ref name, when the worktree has an attached branch. */
  branch?: string;
  detached: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
  /** Present on records returned by getWorktreeContext. */
  isActive?: boolean;
}

export interface GitHeadState {
  commit: string;
  branch?: string;
  detached: boolean;
}

export interface GitWorktreeContext {
  worktreeRoot: string;
  /** Worktree-private Git directory. */
  privateGitDir: string;
  /** Backwards-friendly alias for privateGitDir. */
  gitDir: string;
  commonGitDir: string;
  isLinkedWorktree: boolean;
  head: GitHeadState;
  worktrees: GitWorktreeRecord[];
  activeWorktree: GitWorktreeRecord;
  activeWorktreeIndex: number;
}

// =============================================================================
// Session Start Git Context
// =============================================================================

export function isGitRepo(cwd?: string): boolean {
  try {
    return execGit("git rev-parse --is-inside-work-tree", cwd) === "true";
  } catch {
    return false;
  }
}

export function getCurrentBranch(cwd?: string): string {
  const branch = execGit("git branch --show-current", cwd);
  if (branch) return branch;
  const sha = execGit("git rev-parse --short HEAD", cwd);
  return sha ? `Detached HEAD at ${sha}` : "unknown";
}

export function getWorkingTreeStatus(cwd?: string): string {
  const output = execGit("git status --porcelain", cwd);
  if (!output) return "clean";

  const lines = output.split("\n").filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const modified = lines.length - untracked;

  const parts: string[] = [];
  if (modified) parts.push(`${modified} modified`);
  if (untracked) parts.push(`${untracked} untracked`);
  return parts.length ? parts.join(", ") : "clean";
}

export function parseVersion(tag: string): number[] {
  return tag
    .replace(/^v/, "")
    .split(".")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n));
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function getTagInfo(cwd?: string): string {
  const output = execGit('git tag -l "v*"', cwd);
  if (!output) return "No version tags found";

  const tags = output.split("\n").filter(Boolean);
  if (tags.length === 0) return "No version tags found";

  tags.sort((a, b) => compareVersions(parseVersion(a), parseVersion(b)));
  const latest = tags.at(-1) ?? tags[0];

  try {
    const count = execGit(`git rev-list ${latest}..HEAD --count`, cwd);
    if (count !== null) return `Tag: ${latest} (${count} unreleased commits)`;
  } catch {
    // Fall through
  }
  return `Tag: ${latest}`;
}

export function getGitContext(cwd?: string): string {
  if (!isGitRepo(cwd)) return "";

  const branch = getCurrentBranch(cwd);
  const status = getWorkingTreeStatus(cwd);
  const tagInfo = getTagInfo(cwd);

  return `[devtools] Branch: ${branch} | Status: ${status} | ${tagInfo}`;
}

/** Parse the stable NUL-delimited output of `git worktree list --porcelain -z`. */
export function parseWorktreeList(output: string): GitWorktreeRecord[] {
  const records: GitWorktreeRecord[] = [];
  let current: Partial<GitWorktreeRecord> | undefined;

  const finishRecord = () => {
    if (!current) return;
    if (current.worktreeRoot === undefined || current.head === undefined) {
      throw new Error("Invalid git worktree porcelain record: missing worktree or HEAD");
    }
    records.push({
      worktreeRoot: current.worktreeRoot,
      head: current.head,
      ...(current.branch === undefined ? {} : { branch: current.branch }),
      detached: current.detached ?? false,
      locked: current.locked ?? false,
      ...(current.lockedReason === undefined ? {} : { lockedReason: current.lockedReason }),
      prunable: current.prunable ?? false,
      ...(current.prunableReason === undefined ? {} : { prunableReason: current.prunableReason }),
    });
    current = undefined;
  };

  for (const field of output.split("\0")) {
    if (field === "") {
      finishRecord();
      continue;
    }

    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? undefined : field.slice(separator + 1);

    if (key === "worktree") {
      finishRecord();
      current = { worktreeRoot: value };
      continue;
    }
    if (!current) throw new Error("Invalid git worktree porcelain record: field before worktree");

    switch (key) {
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        current.branch = value;
        break;
      case "detached":
        current.detached = true;
        break;
      case "locked":
        current.locked = true;
        if (value !== undefined) current.lockedReason = value;
        break;
      case "prunable":
        current.prunable = true;
        if (value !== undefined) current.prunableReason = value;
        break;
    }
  }
  finishRecord();
  return records;
}

/** Discover the active checkout and the repository's shared worktree inventory. */
export function getWorktreeContext(cwd?: string): GitWorktreeContext {
  const worktreeRoot = execGit("git rev-parse --path-format=absolute --show-toplevel", cwd);
  const gitDir = execGit("git rev-parse --path-format=absolute --git-dir", cwd);
  const commonGitDir = execGit("git rev-parse --path-format=absolute --git-common-dir", cwd);
  const parsedWorktrees = parseWorktreeList(execGit("git worktree list --porcelain -z", cwd));
  const activeWorktreeIndex = parsedWorktrees.findIndex((record) => record.worktreeRoot === worktreeRoot);
  if (activeWorktreeIndex === -1) {
    throw new Error(`Git worktree inventory does not contain active root: ${worktreeRoot}`);
  }

  const worktrees = parsedWorktrees.map((record, index) => ({ ...record, isActive: index === activeWorktreeIndex }));
  const activeWorktree = worktrees[activeWorktreeIndex];
  if (!activeWorktree) throw new Error(`Git worktree inventory does not contain active root: ${worktreeRoot}`);

  return {
    worktreeRoot,
    privateGitDir: gitDir,
    gitDir,
    commonGitDir,
    isLinkedWorktree: gitDir !== commonGitDir,
    head: {
      commit: activeWorktree.head,
      ...(activeWorktree.branch === undefined ? {} : { branch: activeWorktree.branch }),
      detached: activeWorktree.detached,
    },
    worktrees,
    activeWorktree,
    activeWorktreeIndex,
  };
}

const REPOSITORY_ROUTING_ENV_VARS = [
  "GH_REPO",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE",
] as const;

function commandOptions(cwd?: string): ExecSyncOptionsWithStringEncoding {
  const env = cwd === undefined ? undefined : { ...process.env };
  if (env) {
    for (const name of REPOSITORY_ROUTING_ENV_VARS) delete env[name];
  }
  return {
    ...(cwd === undefined ? {} : { cwd, env }),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  };
}

export function execGit(command: string, cwd?: string): string {
  try {
    return execSync(command, commandOptions(cwd)).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git error: ${message}`);
  }
}

export function execGh(command: string, cwd?: string): string {
  try {
    return execSync(command, commandOptions(cwd)).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`gh error: ${message}`);
  }
}

export function getDefaultBranch(cwd?: string): string {
  try {
    const ref = execGit("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'", cwd);
    if (ref) return ref;
  } catch {
    // Fall through to network call
  }

  try {
    const remoteHead = execGit("git remote show origin 2>/dev/null | grep 'HEAD branch' | sed 's/.*: //'", cwd);
    if (remoteHead) return remoteHead.trim();
  } catch {
    // Fall through to fallback
  }

  return "main";
}

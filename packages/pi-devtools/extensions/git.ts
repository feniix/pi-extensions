/**
 * Git and GitHub CLI execution utilities
 */

import { execSync } from "node:child_process";

// =============================================================================
// Session Start Git Context
// =============================================================================

export function isGitRepo(): boolean {
  try {
    return execGit("rev-parse --is-inside-work-tree") === "true";
  } catch {
    return false;
  }
}

export function getCurrentBranch(): string {
  const branch = execGit("branch --show-current");
  if (branch) return branch;
  const sha = execGit("rev-parse --short HEAD");
  return sha ? `Detached HEAD at ${sha}` : "unknown";
}

export function getWorkingTreeStatus(): string {
  const output = execGit("status --porcelain");
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

export function getTagInfo(): string {
  const output = execGit('tag -l "v*"');
  if (!output) return "No version tags found";

  const tags = output.split("\n").filter(Boolean);
  if (tags.length === 0) return "No version tags found";

  tags.sort((a, b) => compareVersions(parseVersion(a), parseVersion(b)));
  const latest = tags.at(-1) ?? tags[0];

  try {
    const count = execGit(`rev-list ${latest}..HEAD --count`);
    if (count !== null) return `Tag: ${latest} (${count} unreleased commits)`;
  } catch {
    // Fall through
  }
  return `Tag: ${latest}`;
}

export function getGitContext(): string {
  if (!isGitRepo()) return "";

  const branch = getCurrentBranch();
  const status = getWorkingTreeStatus();
  const tagInfo = getTagInfo();

  return `[devtools] Branch: ${branch} | Status: ${status} | ${tagInfo}`;
}

export function execGit(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git error: ${message}`);
  }
}

export function execGh(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`gh error: ${message}`);
  }
}

export function getDefaultBranch(): string {
  try {
    const ref = execGit("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'");
    if (ref) return ref;
  } catch {
    // Fall through to network call
  }

  try {
    const remoteHead = execGit("git remote show origin 2>/dev/null | grep 'HEAD branch' | sed 's/.*: //'");
    if (remoteHead) return remoteHead.trim();
  } catch {
    // Fall through to fallback
  }

  return "main";
}

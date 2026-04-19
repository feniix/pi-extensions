import { execSync } from "node:child_process";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function execInCwd(cwd: string, command: string, label: string): string {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} error: ${message}`);
  }
}

function execOrNull(cwd: string, command: string): string | null {
  try {
    return execInCwd(cwd, command, "git");
  } catch {
    return null;
  }
}

export function validatePushPreconditions(repoRoot: string): void {
  const remoteUrl = execOrNull(repoRoot, "git remote get-url origin");
  if (!remoteUrl) {
    throw new Error("Git remote 'origin' is not configured for this repository");
  }
}

export function validatePrPreconditions(repoRoot: string): void {
  validatePushPreconditions(repoRoot);
  try {
    execSync("command -v gh", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
    });
    execInCwd(repoRoot, "gh --version", "gh");
  } catch {
    throw new Error("GitHub CLI (gh) is not installed or not available on PATH");
  }
  try {
    execInCwd(repoRoot, "gh auth status", "gh");
  } catch {
    throw new Error("GitHub CLI (gh) is not authenticated");
  }
}

export function getPreferredBaseBranch(repoRoot: string): string {
  const currentBranch = execInCwd(repoRoot, "git branch --show-current", "git");
  if (currentBranch && !currentBranch.startsWith("conductor/")) {
    try {
      const remoteMatch = execInCwd(repoRoot, `git ls-remote --heads origin ${shellQuote(currentBranch)}`, "git");
      if (remoteMatch.includes(`refs/heads/${currentBranch}`)) {
        return currentBranch;
      }
    } catch {
      // fall through
    }
  }
  try {
    const originHead = execInCwd(
      repoRoot,
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'",
      "git",
    );
    if (originHead) {
      return originHead;
    }
  } catch {
    // fall through
  }
  return "main";
}

export function commitAllChanges(worktreePath: string, message: string): void {
  execInCwd(worktreePath, "git add -A", "git");
  execInCwd(worktreePath, `git commit -m ${shellQuote(message)}`, "git");
}

export function pushBranchToOrigin(worktreePath: string, branch: string): void {
  execInCwd(worktreePath, `git push -u origin ${shellQuote(branch)}`, "git");
}

export function createPullRequest(input: {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  title: string;
  body: string;
}): { url: string | null; number: number | null } {
  const base = getPreferredBaseBranch(input.repoRoot);
  const output = execInCwd(
    input.worktreePath,
    `gh pr create --base ${shellQuote(base)} --head ${shellQuote(input.branch)} --title ${shellQuote(input.title)} --body ${shellQuote(input.body)}`,
    "gh",
  );
  const url =
    output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("http")) ?? null;
  const match = url?.match(/\/pull\/(\d+)/);
  return {
    url,
    number: match ? Number.parseInt(match[1] ?? "", 10) : null,
  };
}

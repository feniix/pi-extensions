import { execGit, getDefaultBranch, getWorktreeContext } from "./git.js";
import { errorResult, shellQuote, successResult, type ToolResult } from "./shared.js";

type RepoStatus = {
  staged: string[];
  modified: string[];
  untracked: string[];
};

export function createBranchTool(branchName: string, switchBranch = true, cwd?: string): ToolResult {
  try {
    if (switchBranch) {
      execGit(`git checkout -b ${shellQuote(branchName)}`, cwd);
      return successResult(`Created and switched to branch: ${branchName}`, { branch: branchName, switched: true });
    }

    execGit(`git branch ${shellQuote(branchName)}`, cwd);
    return successResult(`Created branch: ${branchName}`, { branch: branchName, switched: false });
  } catch (error) {
    return errorResult("Failed to create branch", error);
  }
}

export function commitTool(message: string, files?: string[], noVerify = false, cwd?: string): ToolResult {
  try {
    const branch = execGit("git branch --show-current", cwd);
    if (!branch) {
      return errorResult("Not on a branch (detached HEAD state)", "detached_head");
    }

    if (files && files.length > 0) {
      for (const file of files) {
        execGit(`git add -- ${shellQuote(file)}`, cwd);
      }
    } else {
      execGit("git add -A", cwd);
    }

    const stagedAfter = execGit("git diff --cached --name-only", cwd).split("\n").filter(Boolean);
    if (stagedAfter.length === 0) {
      return errorResult("No files staged. Please stage files first or pass specific files.", "no_files_staged");
    }

    const verifyFlag = noVerify ? "--no-verify" : "";
    execGit(`git commit ${verifyFlag} -m ${shellQuote(message)}`, cwd);

    return successResult(`Committed: ${message}\n\nFiles staged: ${stagedAfter.length}`, {
      message,
      stagedFiles: stagedAfter,
    });
  } catch (error) {
    return errorResult("Commit failed", error);
  }
}

export function pushTool(branch?: string, setUpstream = true, cwd?: string): ToolResult {
  try {
    const activeBranch = execGit("git branch --show-current", cwd);
    if (!activeBranch) {
      return errorResult("Not on a branch (detached HEAD state)", "detached_head");
    }
    const targetBranch = branch || activeBranch;
    const upstreamFlag = setUpstream ? "-u" : "";

    execGit(`git push ${upstreamFlag} origin ${shellQuote(targetBranch)}`, cwd);
    return successResult(`Pushed ${targetBranch} to origin`, { branch: targetBranch });
  } catch (error) {
    return errorResult("Push failed", error);
  }
}

function parseRepoStatus(statusOutput: string): RepoStatus {
  return statusOutput
    .split("\n")
    .filter(Boolean)
    .reduce<RepoStatus>(
      (status, line) => {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const file = line.slice(3);

        if (indexStatus === "?" && workTreeStatus === "?") {
          status.untracked.push(file);
          return status;
        }

        if (indexStatus !== " " && indexStatus !== "?") {
          status.staged.push(file);
        }
        if (workTreeStatus !== " " && workTreeStatus !== "?") {
          status.modified.push(file);
        }
        return status;
      },
      { staged: [], modified: [], untracked: [] },
    );
}

function hasRepoChanges(status: RepoStatus): boolean {
  return status.staged.length > 0 || status.modified.length > 0 || status.untracked.length > 0;
}

function formatRepoInfo(
  branch: string | undefined,
  defaultBranch: string,
  status: RepoStatus,
  worktreeRoot: string,
  isLinkedWorktree: boolean,
  headCommit: string,
): string {
  const headLabel = branch ?? `Detached HEAD at ${headCommit.slice(0, 12)}`;
  return `Repository Info:\n- Current branch: ${headLabel}\n- Default branch: ${defaultBranch}\n- Worktree root: ${worktreeRoot}\n- Linked worktree: ${isLinkedWorktree}\n- HEAD commit: ${headCommit}\n- Has changes: ${hasRepoChanges(status)}\n- Staged: ${status.staged.length}\n- Modified: ${status.modified.length}\n- Untracked: ${status.untracked.length}`;
}

export function repoInfoTool(cwd?: string): ToolResult {
  try {
    const worktree = getWorktreeContext(cwd);
    const branch = worktree.head.branch?.replace(/^refs\/heads\//, "");
    const defaultBranch = getDefaultBranch(cwd);
    const status = parseRepoStatus(execGit("git status --porcelain", cwd));
    return successResult(
      formatRepoInfo(
        branch,
        defaultBranch,
        status,
        worktree.worktreeRoot,
        worktree.isLinkedWorktree,
        worktree.head.commit,
      ),
      {
        branch,
        defaultBranch,
        hasChanges: hasRepoChanges(status),
        staged: status.staged,
        modified: status.modified,
        untracked: status.untracked,
        worktreeRoot: worktree.worktreeRoot,
        privateGitDir: worktree.privateGitDir,
        gitDir: worktree.gitDir,
        commonGitDir: worktree.commonGitDir,
        isLinkedWorktree: worktree.isLinkedWorktree,
        head: worktree.head,
        worktrees: worktree.worktrees,
        activeWorktree: worktree.activeWorktree,
        activeWorktreeIndex: worktree.activeWorktreeIndex,
      },
    );
  } catch (error) {
    return errorResult("Failed to get repo info", error);
  }
}

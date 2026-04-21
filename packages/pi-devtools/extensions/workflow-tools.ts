import { execGit, getDefaultBranch } from "./git.js";
import { errorResult, shellQuote, successResult, type ToolResult } from "./shared.js";

type RepoStatus = {
  staged: string[];
  modified: string[];
  untracked: string[];
};

export function createBranchTool(branchName: string, switchBranch = true): ToolResult {
  try {
    if (switchBranch) {
      execGit(`git checkout -b ${shellQuote(branchName)}`);
      return successResult(`Created and switched to branch: ${branchName}`, { branch: branchName, switched: true });
    }

    execGit(`git branch ${shellQuote(branchName)}`);
    return successResult(`Created branch: ${branchName}`, { branch: branchName, switched: false });
  } catch (error) {
    return errorResult("Failed to create branch", error);
  }
}

export function commitTool(message: string, files?: string[], noVerify = false): ToolResult {
  try {
    const branch = execGit("git branch --show-current");
    if (!branch) {
      return errorResult("Not on a branch (detached HEAD state)", "detached_head");
    }

    if (files && files.length > 0) {
      for (const file of files) {
        execGit(`git add -- ${shellQuote(file)}`);
      }
    } else {
      execGit("git add -A");
    }

    const stagedAfter = execGit("git diff --cached --name-only").split("\n").filter(Boolean);
    if (stagedAfter.length === 0) {
      return errorResult("No files staged. Please stage files first or pass specific files.", "no_files_staged");
    }

    const verifyFlag = noVerify ? "--no-verify" : "";
    execGit(`git commit ${verifyFlag} -m ${shellQuote(message)}`);

    return successResult(`Committed: ${message}\n\nFiles staged: ${stagedAfter.length}`, {
      message,
      stagedFiles: stagedAfter,
    });
  } catch (error) {
    return errorResult("Commit failed", error);
  }
}

export function pushTool(branch?: string, setUpstream = true): ToolResult {
  try {
    const currentBranch = branch || execGit("git branch --show-current");
    const upstreamFlag = setUpstream ? "-u" : "";

    execGit(`git push ${upstreamFlag} origin ${shellQuote(currentBranch)}`);
    return successResult(`Pushed ${currentBranch} to origin`, { branch: currentBranch });
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

function formatRepoInfo(branch: string, defaultBranch: string, status: RepoStatus): string {
  return `Repository Info:\n- Current branch: ${branch}\n- Default branch: ${defaultBranch}\n- Has changes: ${hasRepoChanges(status)}\n- Staged: ${status.staged.length}\n- Modified: ${status.modified.length}\n- Untracked: ${status.untracked.length}`;
}

export function repoInfoTool(): ToolResult {
  try {
    const branch = execGit("git branch --show-current");
    if (!branch) {
      return errorResult("Not on a branch (detached HEAD state)", "detached_head");
    }

    const defaultBranch = getDefaultBranch();
    const status = parseRepoStatus(execGit("git status --porcelain"));
    return successResult(formatRepoInfo(branch, defaultBranch, status), {
      branch,
      defaultBranch,
      hasChanges: hasRepoChanges(status),
      staged: status.staged,
      modified: status.modified,
      untracked: status.untracked,
    });
  } catch (error) {
    return errorResult("Failed to get repo info", error);
  }
}

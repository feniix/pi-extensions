import { execGh, execGit, type GitWorktreeRecord, getDefaultBranch, getWorktreeContext } from "./git.js";
import { errorResult, shellQuote, successResult, type ToolResult } from "./shared.js";

type PullRequestInfo = {
  title?: string;
  url?: string;
  state?: string;
  mergedAt?: string | null;
  headRefName?: string;
  headRefOid?: string;
  headRepository?: {
    name?: string;
    nameWithOwner?: string;
  } | null;
  headRepositoryOwner?: {
    login?: string;
  } | null;
  isCrossRepository?: boolean;
};

type RepositoryInfo = {
  nameWithOwner?: string;
  url?: string;
};

type RemoteCleanup =
  | { status: "not_requested" }
  | { status: "deleted"; repository: string; ref: string }
  | { status: "skipped"; reason: string; ref?: string }
  | { status: "failed"; repository: string; ref: string; error: string };

type RetainingWorktree = {
  path: string;
  state: "current" | "linked" | "locked" | "prunable";
  isActive: boolean;
  locked: boolean;
  prunable: boolean;
  lockedReason?: string;
  prunableReason?: string;
};

type LocalCleanup =
  | { status: "not_requested" }
  | { status: "deleted"; branch: string }
  | { status: "retained"; branch: string; reason: string; worktrees?: RetainingWorktree[] }
  | { status: "skipped"; branch?: string; reason: string }
  | { status: "failed"; branch: string; error: string };

type CiCheck = {
  name?: string;
  state?: string;
  link?: string;
  workflow?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string;
  url?: string;
};

export function createPrTool(
  title: string,
  body?: string,
  base?: string,
  draft = false,
  assignees?: string[],
  cwd?: string,
): ToolResult {
  try {
    const targetBase = base || getDefaultBranch(cwd);
    const headBranch = execGit("git branch --show-current", cwd);
    if (!headBranch) {
      return errorResult("Not on a branch (detached HEAD state)", "detached_head");
    }

    let command = `gh pr create --title ${shellQuote(title)} --base ${shellQuote(targetBase)} --head ${shellQuote(headBranch)}`;
    command += ` --body ${shellQuote(body ?? "")}`;
    if (draft) {
      command += " --draft";
    }
    if (assignees && assignees.length > 0) {
      command += ` --assignee ${shellQuote(assignees.join(","))}`;
    }

    const prUrl = execGh(command, cwd);
    return successResult(`Created PR: ${prUrl}\n\nTitle: ${title}\nBase: ${targetBase} <-- ${headBranch}`, {
      prUrl,
      title,
      base: targetBase,
      head: headBranch,
    });
  } catch (error) {
    return errorResult("Failed to create PR", error);
  }
}

function detectCurrentPrNumber(cwd?: string): number | undefined {
  const branch = execGit("git branch --show-current", cwd);
  if (!branch) {
    throw new Error("Not on a branch (detached HEAD state)");
  }
  const prs = execGh(`gh pr list --head ${shellQuote(branch)} --state open --json number,title`, cwd);
  if (!prs) {
    return undefined;
  }

  const parsed = JSON.parse(prs) as Array<{ number?: number }>;
  const prNumber = parsed[0]?.number;
  return typeof prNumber === "number" ? prNumber : undefined;
}

function getPullRequestInfo(prNumber: number, cwd?: string): PullRequestInfo {
  const fields = "title,url,state,mergedAt,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository";
  return JSON.parse(execGh(`gh pr view ${prNumber} --json ${fields}`, cwd)) as PullRequestInfo;
}

function getActiveRepositoryInfo(cwd?: string): { info?: RepositoryInfo; error?: string } {
  try {
    return { info: JSON.parse(execGh("gh repo view --json nameWithOwner,url", cwd)) as RepositoryInfo };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function buildMergeCommand(prNumber: number, squash: boolean, commitTitle?: string, commitMessage?: string): string {
  const commandParts = [`gh pr merge ${prNumber}`, squash ? "--squash" : "--merge"];

  if (squash && commitTitle) {
    commandParts.push(`--subject ${shellQuote(commitTitle)}`);
  }
  if (squash && commitMessage) {
    commandParts.push(`--body ${shellQuote(commitMessage)}`);
  }

  return commandParts.join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authoritativeHeadRepository(prData: PullRequestInfo): string | undefined {
  if (!prData.headRepository) return undefined;
  if (prData.headRepository.nameWithOwner) return prData.headRepository.nameWithOwner;

  const owner = prData.headRepositoryOwner?.login;
  const name = prData.headRepository.name;
  return owner && name ? `${owner}/${name}` : undefined;
}

function validatedRepositoryHost(urlValue: string | undefined, repository: string | undefined): string | undefined {
  if (!urlValue || !repository) return undefined;
  try {
    const url = new URL(urlValue);
    const urlRepository = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname ||
      urlRepository.toLowerCase() !== repository.toLowerCase()
    ) {
      return undefined;
    }
    return url.hostname;
  } catch {
    return undefined;
  }
}

function validatedPullRequestHost(urlValue: string | undefined): string | undefined {
  if (!urlValue) return undefined;
  try {
    const url = new URL(urlValue);
    const path = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.search ||
      url.hash ||
      path.length !== 4 ||
      path[2] !== "pull" ||
      !/^\d+$/.test(path[3])
    ) {
      return undefined;
    }
    return url.hostname;
  } catch {
    return undefined;
  }
}

function cleanupRemoteHead(
  prData: PullRequestInfo,
  activeRepository: RepositoryInfo | undefined,
  activeRepositoryError: string | undefined,
  cwd?: string,
): RemoteCleanup {
  const headRefName = prData.headRefName;
  if (!headRefName) return { status: "skipped", reason: "missing_head_ref_metadata" };
  const ref = `refs/heads/${headRefName}`;
  const repository = authoritativeHeadRepository(prData);
  if (!repository) return { status: "skipped", reason: "missing_head_repository_metadata", ref };
  if (!prData.headRefOid) return { status: "skipped", reason: "missing_head_ref_oid_metadata", ref };
  if (activeRepositoryError) return { status: "skipped", reason: "active_repository_lookup_failed", ref };

  const prHost = validatedPullRequestHost(prData.url);
  const activeHost = validatedRepositoryHost(activeRepository?.url, activeRepository?.nameWithOwner);
  if (!prHost) return { status: "skipped", reason: "missing_or_invalid_pr_url", ref };
  if (!activeHost) return { status: "skipped", reason: "missing_or_invalid_active_repository_url", ref };
  if (prHost.toLowerCase() !== activeHost.toLowerCase()) {
    return { status: "skipped", reason: "repository_hostname_mismatch", ref };
  }

  const encodedRef = encodeURIComponent(`heads/${headRefName}`);
  const hostnameArg = `--hostname ${shellQuote(prHost)}`;
  try {
    const currentRef = JSON.parse(
      execGh(`gh api ${hostnameArg} ${shellQuote(`repos/${repository}/git/ref/${encodedRef}`)}`, cwd),
    ) as { object?: { sha?: string } };
    if (!currentRef.object?.sha) return { status: "skipped", reason: "missing_remote_ref_oid", ref };
    if (currentRef.object.sha !== prData.headRefOid) {
      return { status: "skipped", reason: "remote_ref_oid_mismatch", ref };
    }
    execGh(`gh api ${hostnameArg} --method DELETE ${shellQuote(`repos/${repository}/git/refs/${encodedRef}`)}`, cwd);
    return { status: "deleted", repository, ref };
  } catch (error) {
    return { status: "failed", repository, ref, error: errorMessage(error) };
  }
}

function retainingWorktree(record: GitWorktreeRecord): RetainingWorktree {
  let state: RetainingWorktree["state"] = record.isActive ? "current" : "linked";
  if (record.locked) state = "locked";
  if (record.prunable) state = "prunable";

  return {
    path: record.worktreeRoot,
    state,
    isActive: record.isActive ?? false,
    locked: record.locked,
    prunable: record.prunable,
    ...(record.lockedReason === undefined ? {} : { lockedReason: record.lockedReason }),
    ...(record.prunableReason === undefined ? {} : { prunableReason: record.prunableReason }),
  };
}

function cleanupLocalHead(
  prData: PullRequestInfo,
  activeRepository: RepositoryInfo | undefined,
  activeRepositoryError: string | undefined,
  cwd?: string,
): LocalCleanup {
  const branch = prData.headRefName;
  if (!branch) return { status: "skipped", reason: "missing_head_ref_metadata" };

  const headRepository = authoritativeHeadRepository(prData);
  if (!headRepository) {
    return { status: "skipped", branch, reason: "missing_head_repository_metadata" };
  }
  if (prData.isCrossRepository === undefined) {
    return { status: "skipped", branch, reason: "missing_cross_repository_metadata" };
  }
  if (prData.isCrossRepository) {
    return { status: "skipped", branch, reason: "cross_repository_head" };
  }
  if (activeRepositoryError) {
    return { status: "failed", branch, error: activeRepositoryError };
  }
  if (!activeRepository?.nameWithOwner) {
    return { status: "skipped", branch, reason: "missing_active_repository_metadata" };
  }
  if (headRepository.toLowerCase() !== activeRepository.nameWithOwner.toLowerCase()) {
    return { status: "skipped", branch, reason: "repository_identity_mismatch" };
  }
  const prHost = validatedPullRequestHost(prData.url);
  const activeHost = validatedRepositoryHost(activeRepository.url, activeRepository.nameWithOwner);
  if (!prHost) return { status: "skipped", branch, reason: "missing_or_invalid_pr_url" };
  if (!activeHost) return { status: "skipped", branch, reason: "missing_or_invalid_active_repository_url" };
  if (prHost.toLowerCase() !== activeHost.toLowerCase()) {
    return { status: "skipped", branch, reason: "repository_hostname_mismatch" };
  }
  if (!prData.headRefOid) return { status: "skipped", branch, reason: "missing_head_ref_oid_metadata" };

  try {
    const branchRef = `refs/heads/${branch}`;
    const occupied = getWorktreeContext(cwd).worktrees.filter((record) => record.branch === branchRef);
    if (occupied.length > 0) {
      return {
        status: "retained",
        branch,
        reason: "branch_occupied_by_worktree",
        worktrees: occupied.map(retainingWorktree),
      };
    }

    const localOid = execGit(`git rev-parse --verify ${shellQuote(`${branchRef}^{commit}`)}`, cwd);
    if (localOid !== prData.headRefOid) {
      return { status: "retained", branch, reason: "local_ref_oid_mismatch" };
    }
    execGit(`git branch --delete -- ${shellQuote(branch)}`, cwd);
    return { status: "deleted", branch };
  } catch (error) {
    return { status: "failed", branch, error: errorMessage(error) };
  }
}

function cleanupLabel(kind: "Remote" | "Local", cleanup: RemoteCleanup | LocalCleanup): string {
  switch (cleanup.status) {
    case "not_requested":
      return `${kind} cleanup: not requested`;
    case "deleted":
      return `${kind} cleanup: deleted`;
    case "retained":
      return cleanup.worktrees
        ? `${kind} cleanup: retained by ${cleanup.worktrees.map(({ path, state }) => `${path} (${state})`).join(", ")}`
        : `${kind} cleanup: retained (${cleanup.reason})`;
    case "skipped":
      return `${kind} cleanup: skipped (${cleanup.reason})`;
    case "failed":
      return `${kind} cleanup failed: ${cleanup.error}`;
  }
}

function formatMergeResult(
  prNumber: number,
  squash: boolean,
  prData: PullRequestInfo,
  remoteCleanup: RemoteCleanup,
  localCleanup: LocalCleanup,
): ToolResult {
  const mergeType = squash ? "squash-merged" : "merged";
  const mergeLabel = `${mergeType.charAt(0).toUpperCase() + mergeType.slice(1)} PR #${prNumber}`;
  const titleSuffix = prData.title ? `: ${prData.title}` : "";
  const urlSuffix = prData.url ? `\n${prData.url}` : "";
  const cleanupText = `\n${cleanupLabel("Remote", remoteCleanup)}\n${cleanupLabel("Local", localCleanup)}`;
  const deletedBranch = remoteCleanup.status === "deleted" && localCleanup.status === "deleted";
  const cleanupComplete =
    (remoteCleanup.status === "not_requested" && localCleanup.status === "not_requested") || deletedBranch;
  const mergeContract = {
    mergeStatus: "merged",
    state: prData.state ?? null,
    remoteCleanup,
    localCleanup,
    cleanupComplete,
  };

  return successResult(
    `${mergeLabel}${titleSuffix}${urlSuffix}${cleanupText}\nMerge contract: ${JSON.stringify(mergeContract)}`,
    {
      prNumber,
      ...mergeContract,
      mergedAt: prData.mergedAt,
      mergeType,
      deletedBranch,
      cleanupSummary: `remote ${remoteCleanup.status}; local ${localCleanup.status}`,
    },
  );
}

function formatUnknownMergeResult(prNumber: number, prData: PullRequestInfo, error: unknown): ToolResult {
  const confirmationError = errorMessage(error);
  const remoteCleanup: RemoteCleanup = { status: "skipped", reason: "merge_confirmation_failed" };
  const localCleanup: LocalCleanup = { status: "skipped", reason: "merge_confirmation_failed" };
  const mergeContract = {
    mergeStatus: "unknown",
    state: null,
    remoteCleanup,
    localCleanup,
    cleanupComplete: false,
  };
  return successResult(
    `Merge command was accepted for PR #${prNumber}, but the resulting PR state could not be confirmed; cleanup was not run.\nMerge contract: ${JSON.stringify(mergeContract)}`,
    {
      prNumber,
      ...mergeContract,
      title: prData.title,
      url: prData.url,
      confirmationError,
      deletedBranch: false,
      cleanupSummary: "remote skipped; local skipped",
    },
  );
}

function formatPendingMergeResult(prNumber: number, prData: PullRequestInfo): ToolResult {
  const titleSuffix = prData.title ? `: ${prData.title}` : "";
  const urlSuffix = prData.url ? `\n${prData.url}` : "";
  const remoteCleanup: RemoteCleanup = { status: "skipped", reason: "merge_not_confirmed" };
  const localCleanup: LocalCleanup = { status: "skipped", reason: "merge_not_confirmed" };
  const mergeContract = {
    mergeStatus: "pending",
    state: prData.state ?? null,
    remoteCleanup,
    localCleanup,
    cleanupComplete: false,
  };
  return successResult(
    `Merge command accepted for PR #${prNumber}${titleSuffix}, but the authoritative PR state is ${prData.state ?? "unknown"}; merge is pending and cleanup was not run.${urlSuffix}\nMerge contract: ${JSON.stringify(mergeContract)}`,
    {
      prNumber,
      ...mergeContract,
      mergedAt: prData.mergedAt,
      deletedBranch: false,
      cleanupSummary: "remote skipped; local skipped",
    },
  );
}

export function mergePrTool(
  prNumber?: number,
  squash = false,
  deleteBranch = true,
  commitTitle?: string,
  commitMessage?: string,
  cwd?: string,
): ToolResult {
  try {
    const num = prNumber ?? detectCurrentPrNumber(cwd);
    if (!num) {
      return errorResult("No PR number provided and could not detect current PR.", "no_pr_found");
    }

    const prData = getPullRequestInfo(num, cwd);
    if (prData.state !== "OPEN") {
      return errorResult(`PR #${num} is not open (state: ${prData.state})`, "pr_not_open", { state: prData.state });
    }

    execGh(buildMergeCommand(num, squash, commitTitle, commitMessage), cwd);

    let mergedPrData: PullRequestInfo;
    try {
      mergedPrData = getPullRequestInfo(num, cwd);
    } catch (error) {
      return formatUnknownMergeResult(num, prData, error);
    }
    if (mergedPrData.state !== "MERGED") {
      return formatPendingMergeResult(num, mergedPrData);
    }

    const activeRepository = deleteBranch ? getActiveRepositoryInfo(cwd) : {};
    const remoteCleanup: RemoteCleanup = deleteBranch
      ? cleanupRemoteHead(mergedPrData, activeRepository.info, activeRepository.error, cwd)
      : { status: "not_requested" };
    const localCleanup: LocalCleanup = deleteBranch
      ? cleanupLocalHead(mergedPrData, activeRepository.info, activeRepository.error, cwd)
      : { status: "not_requested" };
    return formatMergeResult(num, squash, mergedPrData, remoteCleanup, localCleanup);
  } catch (error) {
    return errorResult("Failed to merge PR", error);
  }
}

function getCiCheckCommand(prNumber?: number, branch?: string, cwd?: string): string {
  if (prNumber) {
    return `gh pr checks ${prNumber} --json name,state,link,workflow`;
  }

  const targetBranch = branch ?? execGit("git branch --show-current", cwd);
  if (!targetBranch) {
    throw new Error("Not on a branch (detached HEAD state)");
  }
  return `gh run list --branch ${shellQuote(targetBranch)} --limit 5 --json workflowName,status,conclusion,url`;
}

function formatCiCheck(check: CiCheck): string {
  const status = check.conclusion ?? check.state ?? check.status ?? "unknown";
  const name = check.name ?? check.workflowName ?? check.workflow ?? "Unknown workflow";
  const link = check.link ?? check.url;
  return `- ${name}: ${status}${link ? ` (${link})` : ""}`;
}

export function checkCiTool(prNumber?: number, branch?: string, cwd?: string): ToolResult {
  try {
    const checks = execGh(getCiCheckCommand(prNumber, branch, cwd), cwd);
    if (!checks) {
      return successResult("No CI runs found for this PR/branch.", { checks: [] });
    }

    const parsedChecks = JSON.parse(checks) as CiCheck[];
    if (!Array.isArray(parsedChecks) || parsedChecks.length === 0) {
      return successResult("No CI runs found for this PR/branch.", { checks: [] });
    }

    return successResult(`CI Status:\n${parsedChecks.map(formatCiCheck).join("\n")}`, { checks: parsedChecks });
  } catch (error) {
    return errorResult("Failed to check CI", error);
  }
}

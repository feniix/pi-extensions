import { execGh, execGit, getDefaultBranch } from "./git.js";
import { errorResult, shellQuote, successResult, type ToolResult } from "./shared.js";

type PullRequestInfo = {
  title?: string;
  url?: string;
  state?: string;
};

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
): ToolResult {
  try {
    const targetBase = base || getDefaultBranch();
    const headBranch = execGit("git branch --show-current");

    let command = `gh pr create --title ${shellQuote(title)} --base ${shellQuote(targetBase)}`;
    if (body) {
      command += ` --body ${shellQuote(body)}`;
    }
    if (draft) {
      command += " --draft";
    }
    if (assignees && assignees.length > 0) {
      command += ` --assignee ${shellQuote(assignees.join(","))}`;
    }

    const prUrl = execGh(command);
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

function detectCurrentPrNumber(): number | undefined {
  const branch = execGit("git branch --show-current");
  const prs = execGh(`gh pr list --head ${shellQuote(branch)} --state open --json number,title`);
  if (!prs) {
    return undefined;
  }

  const parsed = JSON.parse(prs) as Array<{ number?: number }>;
  const prNumber = parsed[0]?.number;
  return typeof prNumber === "number" ? prNumber : undefined;
}

function getPullRequestInfo(prNumber: number): PullRequestInfo {
  return JSON.parse(execGh(`gh pr view ${prNumber} --json title,url,state`)) as PullRequestInfo;
}

function buildMergeCommand(
  prNumber: number,
  squash: boolean,
  deleteBranch: boolean,
  commitTitle?: string,
  commitMessage?: string,
): string {
  const commandParts = [`gh pr merge ${prNumber}`, squash ? "--squash" : "--merge"];

  if (squash && commitTitle) {
    commandParts.push(`--title ${shellQuote(commitTitle)}`);
  }
  if (squash && commitMessage) {
    commandParts.push(`--body ${shellQuote(commitMessage)}`);
  }
  if (deleteBranch) {
    commandParts.push("--delete-branch");
  }

  return commandParts.join(" ");
}

function formatMergeResult(prNumber: number, squash: boolean, deleteBranch: boolean, prData: PullRequestInfo): ToolResult {
  const mergeType = squash ? "squash-merged" : "merged";
  const mergeLabel = `${mergeType.charAt(0).toUpperCase() + mergeType.slice(1)} PR #${prNumber}`;
  const titleSuffix = prData.title ? `: ${prData.title}` : "";
  const urlSuffix = prData.url ? `\n${prData.url}` : "";

  return successResult(`${mergeLabel}${titleSuffix}${urlSuffix}`, {
    prNumber,
    mergeType,
    deletedBranch: deleteBranch,
  });
}

export function mergePrTool(
  prNumber?: number,
  squash = false,
  deleteBranch = true,
  commitTitle?: string,
  commitMessage?: string,
): ToolResult {
  try {
    const num = prNumber ?? detectCurrentPrNumber();
    if (!num) {
      return {
        content: [{ type: "text", text: "No PR number provided and could not detect current PR." }],
        isError: true,
        details: { error: "no_pr_found" },
      };
    }

    const prData = getPullRequestInfo(num);
    if (prData.state !== "OPEN") {
      return {
        content: [{ type: "text", text: `PR #${num} is not open (state: ${prData.state})` }],
        isError: true,
        details: { error: "pr_not_open", state: prData.state },
      };
    }

    execGh(buildMergeCommand(num, squash, deleteBranch, commitTitle, commitMessage));
    return formatMergeResult(num, squash, deleteBranch, prData);
  } catch (error) {
    return errorResult("Failed to merge PR", error);
  }
}

function getCiCheckCommand(prNumber?: number, branch?: string): string {
  if (prNumber) {
    return `gh pr checks ${prNumber} --json name,state,link,workflow`;
  }

  const targetBranch = branch ?? execGit("git branch --show-current");
  return `gh run list --branch ${shellQuote(targetBranch)} --limit 5 --json workflowName,status,conclusion,url`;
}

function formatCiCheck(check: CiCheck): string {
  const status = check.conclusion ?? check.state ?? check.status ?? "unknown";
  const name = check.name ?? check.workflowName ?? check.workflow ?? "Unknown workflow";
  const link = check.link ?? check.url;
  return `- ${name}: ${status}${link ? ` (${link})` : ""}`;
}

export function checkCiTool(prNumber?: number, branch?: string): ToolResult {
  try {
    const checks = execGh(getCiCheckCommand(prNumber, branch));
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

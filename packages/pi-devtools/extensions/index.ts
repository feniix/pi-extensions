/**
 * Devtools Extension for pi
 *
 * Provides Git workflow tools, PR operations, and release automation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getGitContext } from "./git.js";
import { checkCiTool, createPrTool, mergePrTool } from "./pull-request-tools.js";
import {
  analyzeCommitsTool,
  bumpVersion,
  bumpVersionTool,
  createReleaseTool,
  getLatestTagTool,
  parseConventionalCommit,
} from "./release-tools.js";
import {
  bumpVersionParams,
  checkCiParams,
  commitParams,
  createBranchParams,
  createPrParams,
  createReleaseParams,
  emptyParams,
  mergePrParams,
  pushParams,
} from "./tool-params.js";
import { commitTool, createBranchTool, pushTool, repoInfoTool } from "./workflow-tools.js";

export {
  analyzeCommitsTool,
  bumpVersion,
  bumpVersionTool,
  checkCiTool,
  commitTool,
  createBranchTool,
  createPrTool,
  createReleaseTool,
  getLatestTagTool,
  mergePrTool,
  parseConventionalCommit,
  pushTool,
  repoInfoTool,
  // Backwards-compat alias — existing consumers may reference getRepoInfo
  repoInfoTool as getRepoInfo,
};

export const toolDefinitions = [
  {
    name: "devtools_create_branch",
    label: "Create Branch",
    description: "Create a new git branch and optionally switch to it",
    parameters: createBranchParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const { branchName, switchBranch = true } = params as { branchName: string; switchBranch?: boolean };
      return createBranchTool(branchName, switchBranch);
    },
  },
  {
    name: "devtools_commit",
    label: "Git Commit",
    description: "Stage files and create a commit with conventional format",
    parameters: commitParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const { message, files, noVerify = false } = params as { message: string; files?: string[]; noVerify?: boolean };
      return commitTool(message, files, noVerify);
    },
  },
  {
    name: "devtools_push",
    label: "Git Push",
    description: "Push branch to remote with upstream tracking",
    parameters: pushParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const { branch, setUpstream = true } = params as { branch?: string; setUpstream?: boolean };
      return pushTool(branch, setUpstream);
    },
  },
  {
    name: "devtools_create_pr",
    label: "Create PR",
    description: "Create a GitHub pull request",
    parameters: createPrParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const typed = params as { title: string; body?: string; base?: string; draft?: boolean; assignees?: string[] };
      return createPrTool(typed.title, typed.body, typed.base, typed.draft, typed.assignees);
    },
  },
  {
    name: "devtools_merge_pr",
    label: "Merge PR",
    description: "Merge a pull request (optionally delete source branch)",
    parameters: mergePrParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const typed = params as {
        prNumber?: number;
        squash?: boolean;
        deleteBranch?: boolean;
        commitTitle?: string;
        commitMessage?: string;
      };
      return mergePrTool(
        typed.prNumber,
        typed.squash ?? false,
        typed.deleteBranch ?? true,
        typed.commitTitle,
        typed.commitMessage,
      );
    },
  },
  {
    name: "devtools_squash_merge_pr",
    label: "Squash Merge PR",
    description: "Squash-merge a pull request (optionally delete source branch)",
    parameters: mergePrParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const typed = params as {
        prNumber?: number;
        deleteBranch?: boolean;
        commitTitle?: string;
        commitMessage?: string;
      };
      return mergePrTool(typed.prNumber, true, typed.deleteBranch ?? true, typed.commitTitle, typed.commitMessage);
    },
  },
  {
    name: "devtools_check_ci",
    label: "Check CI",
    description: "Check GitHub Actions CI status for a PR or branch",
    parameters: checkCiParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const { prNumber, branch } = params as { prNumber?: number; branch?: string };
      return checkCiTool(prNumber, branch);
    },
  },
  {
    name: "devtools_get_repo_info",
    label: "Repo Info",
    description: "Get current branch, default branch, and git status",
    parameters: emptyParams,
    execute: async () => repoInfoTool(),
  },
  {
    name: "devtools_get_latest_tag",
    label: "Latest Tag",
    description: "Get the latest version tag from git",
    parameters: emptyParams,
    execute: async () => getLatestTagTool(),
  },
  {
    name: "devtools_analyze_commits",
    label: "Analyze Commits",
    description: "Analyze commits since last tag to determine version bump type",
    parameters: emptyParams,
    execute: async () => analyzeCommitsTool(),
  },
  {
    name: "devtools_bump_version",
    label: "Bump Version",
    description: "Update version in package.json",
    parameters: bumpVersionParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const { newVersion, file = "package.json" } = params as { newVersion: string; file?: string };
      return bumpVersionTool(newVersion, file);
    },
  },
  {
    name: "devtools_create_release",
    label: "Create Release",
    description: "Create a GitHub release with changelog",
    parameters: createReleaseParams,
    execute: async (_toolCallId: string, params: unknown) => {
      const typed = params as { tag: string; title: string; body?: string; draft?: boolean; prerelease?: boolean };
      return createReleaseTool(typed.tag, typed.title, typed.body, typed.draft, typed.prerelease);
    },
  },
] as const;

export default function devtoolsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    const context = getGitContext();
    if (context) {
      console.log(context);
    }
  });

  for (const tool of toolDefinitions) {
    pi.registerTool(tool);
  }
}

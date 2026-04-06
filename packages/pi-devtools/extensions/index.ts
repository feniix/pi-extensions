/**
 * Devtools Extension for pi
 *
 * Provides Git workflow tools, PR operations, and release automation.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Types
// =============================================================================

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}

// =============================================================================
// Utility Functions
// =============================================================================

function execGit(command: string): string {
	try {
		return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Git error: ${message}`);
	}
}

function execGh(command: string): string {
	try {
		return execSync(command, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`gh error: ${message}`);
	}
}

function parseConventionalCommit(message: string): { type: string; scope?: string; breaking: boolean } {
	const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
	if (!match) {
		return { type: "other", breaking: false };
	}
	return {
		type: match[1].toLowerCase(),
		scope: match[2],
		breaking: !!match[3] || message.includes("BREAKING CHANGE"),
	};
}

function bumpVersion(version: string, type: "major" | "minor" | "patch"): string {
	const parts = version.replace(/^v/, "").split(".").map(Number);
	if (parts.length !== 3 || parts.some(Number.isNaN)) {
		throw new Error(`Invalid version format: ${version}`);
	}

	const [major, minor, patch] = parts;
	switch (type) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
	}
}

function getDefaultBranch(): string {
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

// =============================================================================
// Tool Parameters
// =============================================================================

const createBranchParams = Type.Object({
	branchName: Type.String({ description: "Name of the branch to create (e.g., feature/add-login)" }),
	switchBranch: Type.Optional(Type.Boolean({ description: "Whether to switch to the new branch (default: true)" })),
});

const commitParams = Type.Object({
	message: Type.String({ description: "Commit message (conventional format: type: description)" }),
	files: Type.Optional(Type.Array(Type.String(), { description: "Specific files to commit (default: all staged)" })),
	noVerify: Type.Optional(Type.Boolean({ description: "Skip pre-commit hooks (default: false)" })),
});

const pushParams = Type.Object({
	branch: Type.Optional(Type.String({ description: "Branch to push (default: current)" })),
	setUpstream: Type.Optional(Type.Boolean({ description: "Set upstream tracking (default: true)" })),
});

const createPrParams = Type.Object({
	title: Type.String({ description: "PR title" }),
	body: Type.Optional(Type.String({ description: "PR body/description" })),
	base: Type.Optional(Type.String({ description: "Target branch (default: default branch)" })),
	draft: Type.Optional(Type.Boolean({ description: "Create as draft PR (default: false)" })),
	assignees: Type.Optional(Type.Array(Type.String(), { description: "Assignees (GitHub usernames)" })),
});

const mergePrParams = Type.Object({
	prNumber: Type.Optional(Type.Integer({ description: "PR number (default: current branch PR)" })),
	squash: Type.Optional(Type.Boolean({ description: "Squash merge (default: false)" })),
	deleteBranch: Type.Optional(Type.Boolean({ description: "Delete source branch after merge (default: true)" })),
	commitTitle: Type.Optional(Type.String({ description: "Title for the squash commit" })),
	commitMessage: Type.Optional(Type.String({ description: "Message for the squash commit" })),
});

const checkCiParams = Type.Object({
	prNumber: Type.Optional(Type.Integer({ description: "PR number (default: current branch PR)" })),
	branch: Type.Optional(Type.String({ description: "Branch to check (default: current)" })),
});

const bumpVersionParams = Type.Object({
	newVersion: Type.String({ description: "New version (e.g., 1.2.3)" }),
	file: Type.Optional(Type.String({ description: "File to update (default: package.json)" })),
});

const createReleaseParams = Type.Object({
	tag: Type.String({ description: "Version tag (e.g., v1.2.3)" }),
	title: Type.String({ description: "Release title" }),
	body: Type.Optional(Type.String({ description: "Release notes/changelog" })),
	draft: Type.Optional(Type.Boolean({ description: "Create as draft (default: false)" })),
	prerelease: Type.Optional(Type.Boolean({ description: "Mark as prerelease (default: false)" })),
});

// =============================================================================
// Tool Implementations
// =============================================================================

function createBranchTool(branchName: string, switchBranch = true): ToolResult {
	try {
		execGit(`git checkout ${switchBranch ? "-b" : "-b"} ${branchName}`);
		return {
			content: [{ type: "text", text: `Created and switched to branch: ${branchName}` }],
			details: { branch: branchName },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create branch: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function commitTool(message: string, files?: string[], noVerify = false): ToolResult {
	try {
		// Get current status
		const branch = execGit("git branch --show-current");
		if (!branch) {
			return {
				content: [{ type: "text", text: "Not on a branch (detached HEAD state)" }],
				isError: true,
				details: { error: "detached_head" },
			};
		}

		// Stage files
		if (files && files.length > 0) {
			for (const file of files) {
				execGit(`git add ${file}`);
			}
		} else {
			execGit("git add -A");
		}

		// Verify staged files
		const stagedAfter = execGit("git diff --cached --name-only").split("\n").filter(Boolean);

		if (stagedAfter.length === 0) {
			return {
				content: [{ type: "text", text: "No files staged. Please stage files first or pass specific files." }],
				isError: true,
				details: { error: "no_files_staged" },
			};
		}

		// Commit
		const verifyFlag = noVerify ? "--no-verify" : "";
		const escapedMessage = message.replace(/"/g, '\\"');
		execGit(`git commit ${verifyFlag} -m "${escapedMessage}"`);

		return {
			content: [{ type: "text", text: `Committed: ${message}\n\nFiles staged: ${stagedAfter.length}` }],
			details: { message, stagedFiles: stagedAfter },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Commit failed: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function pushTool(branch?: string, setUpstream = true): ToolResult {
	try {
		const currentBranch = branch || execGit("git branch --show-current");
		const upstreamFlag = setUpstream ? "-u" : "";

		execGit(`git push ${upstreamFlag} origin ${currentBranch}`);

		return {
			content: [{ type: "text", text: `Pushed ${currentBranch} to origin` }],
			details: { branch: currentBranch },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Push failed: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function createPrTool(title: string, body?: string, base?: string, draft = false, assignees?: string[]): ToolResult {
	try {
		const defaultBranch = getDefaultBranch();
		const targetBase = base || defaultBranch;
		const headBranch = execGit("git branch --show-current");

		let command = `gh pr create --title "${title.replace(/"/g, '\\"')}" --base ${targetBase}`;

		if (body) {
			command += ` --body "${body.replace(/"/g, '\\"')}"`;
		}

		if (draft) {
			command += " --draft";
		}

		if (assignees && assignees.length > 0) {
			command += ` --assignee "${assignees.join(",")}"`;
		}

		const prUrl = execGh(command);

		return {
			content: [
				{ type: "text", text: `Created PR: ${prUrl}\n\nTitle: ${title}\nBase: ${targetBase} <-- ${headBranch}` },
			],
			details: { prUrl, title, base: targetBase, head: headBranch },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create PR: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function mergePrTool(
	prNumber?: number,
	squash = false,
	deleteBranch = true,
	commitTitle?: string,
	commitMessage?: string,
): ToolResult {
	try {
		let num = prNumber;
		if (!num) {
			const branch = execGit("git branch --show-current");
			const prs = execGh(`gh pr list --head ${branch} --state open --json number,title -q '.[]'`);
			if (prs) {
				const prData = JSON.parse(prs);
				if (prData.length > 0) {
					num = prData[0].number;
				}
			}
		}

		if (!num) {
			return {
				content: [{ type: "text", text: "No PR number provided and could not detect current PR." }],
				isError: true,
				details: { error: "no_pr_found" },
			};
		}

		// Get PR info before merging
		const prInfo = execGh(`gh pr view ${num} --json title,url,state`);
		const prData = JSON.parse(prInfo);

		if (prData.state !== "OPEN") {
			return {
				content: [{ type: "text", text: `PR #${num} is not open (state: ${prData.state})` }],
				isError: true,
				details: { error: "pr_not_open", state: prData.state },
			};
		}

		// Build merge command
		let command = `gh pr merge ${num}`;
		if (squash) {
			command += " --squash";
			if (commitTitle) {
				command += ` --title "${commitTitle.replace(/"/g, '\\"')}"`;
			}
			if (commitMessage) {
				command += ` --body "${commitMessage.replace(/"/g, '\\"')}"`;
			}
		} else {
			command += " --merge";
		}

		if (deleteBranch) {
			command += " --delete-branch";
		}

		execGh(command);

		const mergeType = squash ? "squash-merged" : "merged";
		return {
			content: [
				{
					type: "text",
					text: `${mergeType.charAt(0).toUpperCase() + mergeType.slice(1)} PR #${num}: ${prData.title}\n${prData.url}`,
				},
			],
			details: { prNumber: num, mergeType, deletedBranch: deleteBranch },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to merge PR: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function checkCiTool(prNumber?: number, branch?: string): ToolResult {
	try {
		let checkCommand: string;

		if (prNumber) {
			checkCommand = `gh run list --pr ${prNumber} --limit 5`;
		} else if (branch) {
			checkCommand = `gh run list --branch ${branch} --limit 5`;
		} else {
			const currentBranch = execGit("git branch --show-current");
			checkCommand = `gh run list --branch ${currentBranch} --limit 5`;
		}

		const runs = execGh(checkCommand);

		if (!runs) {
			return {
				content: [{ type: "text", text: "No CI runs found for this PR/branch." }],
				details: { checks: [] },
			};
		}

		const lines = runs.split("\n").filter(Boolean);
		const checkSummary = lines
			.map((line) => {
				const parts = line.split(/\s+/);
				const status = parts[parts.length - 1];
				const name = parts.slice(0, -1).join(" ");
				return `- ${name}: ${status}`;
			})
			.join("\n");

		return {
			content: [{ type: "text", text: `CI Status:\n${checkSummary}` }],
			details: { rawOutput: runs },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to check CI: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

const getRepoInfo = repoInfoTool;

function repoInfoTool(): ToolResult {
	try {
		const branch = execGit("git branch --show-current");
		if (!branch) {
			return {
				content: [{ type: "text", text: "Not on a branch (detached HEAD state)" }],
				isError: true,
				details: { error: "detached_head" },
			};
		}

		const defaultBranch = getDefaultBranch();
		const statusOutput = execGit("git status --porcelain");
		const lines = statusOutput.split("\n").filter(Boolean);

		const staged: string[] = [];
		const modified: string[] = [];
		const untracked: string[] = [];

		for (const line of lines) {
			const indexStatus = line[0];
			const workTreeStatus = line[1];
			const file = line.slice(3);

			if (indexStatus === "?" && workTreeStatus === "?") {
				untracked.push(file);
			} else if (indexStatus !== " " && indexStatus !== "?") {
				staged.push(file);
			}
			if (workTreeStatus !== " " && workTreeStatus !== "?") {
				modified.push(file);
			}
		}

		return {
			content: [
				{
					type: "text",
					text: `Repository Info:\n- Current branch: ${branch}\n- Default branch: ${defaultBranch}\n- Has changes: ${staged.length > 0 || modified.length > 0 || untracked.length > 0}\n- Staged: ${staged.length}\n- Modified: ${modified.length}\n- Untracked: ${untracked.length}`,
				},
			],
			details: {
				branch,
				defaultBranch,
				hasChanges: staged.length > 0 || modified.length > 0 || untracked.length > 0,
				staged,
				modified,
				untracked,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to get repo info: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

// =============================================================================
// Release Tools
// =============================================================================

function getLatestTagTool(): ToolResult {
	try {
		const tags = execGit("git tag -l 'v*' 'V*' | sort -rV | head -1");

		if (!tags) {
			return {
				content: [{ type: "text", text: "No version tags found." }],
				details: { tag: null },
			};
		}

		const commitCount = execGit(`git log ${tags}..HEAD --oneline | wc -l`).trim();

		return {
			content: [{ type: "text", text: `Latest tag: ${tags}\nCommits since: ${commitCount}` }],
			details: { tag: tags, commitsSince: parseInt(commitCount, 10) },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to get latest tag: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function analyzeCommitsTool(): ToolResult {
	try {
		const tags = execGit("git tag -l 'v*' 'V*' | sort -rV | head -1");

		let commitsSince: string[];
		let currentVersion = "0.0.0";

		if (tags) {
			currentVersion = tags.replace(/^v/, "");
			commitsSince = execGit(`git log ${tags}..HEAD --format="%s"`).split("\n").filter(Boolean);
		} else {
			commitsSince = execGit(`git log --format="%s" -n 100`).split("\n").filter(Boolean);
		}

		if (commitsSince.length === 0) {
			return {
				content: [{ type: "text", text: "No commits to analyze." }],
				details: { type: "patch", commits: [], currentVersion, newVersion: currentVersion },
			};
		}

		// Analyze commit types
		const commitAnalysis = commitsSince.map((msg) => ({
			message: msg,
			...parseConventionalCommit(msg),
		}));

		let bumpType: "major" | "minor" | "patch" = "patch";

		for (const commit of commitAnalysis) {
			if (commit.breaking || commit.type.endsWith("!")) {
				bumpType = "major";
				break;
			}
			if (commit.type === "feat") {
				bumpType = "minor";
			}
		}

		const newVersion = bumpVersion(currentVersion, bumpType);

		// Group commits by type
		const grouped = commitAnalysis.reduce(
			(acc, c) => {
				const key = c.type === "feat" ? "features" : c.type === "fix" ? "fixes" : "other";
				if (!acc[key]) acc[key] = [];
				acc[key].push(c.message);
				return acc;
			},
			{} as Record<string, string[]>,
		);

		const summary = Object.entries(grouped)
			.map(
				([type, msgs]) =>
					`### ${type.charAt(0).toUpperCase() + type.slice(1)}\n${msgs.map((m) => `- ${m}`).join("\n")}`,
			)
			.join("\n\n");

		return {
			content: [
				{
					type: "text",
					text: `Commit Analysis:\n\n${summary}\n\n**Version:** ${currentVersion} → ${newVersion} (${bumpType} bump)`,
				},
			],
			details: { type: bumpType, commits: commitAnalysis, currentVersion, newVersion },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to analyze commits: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function bumpVersionTool(newVersion: string, file = "package.json"): ToolResult {
	try {
		if (!existsSync(file)) {
			return {
				content: [{ type: "text", text: `File not found: ${file}` }],
				isError: true,
				details: { error: "file_not_found" },
			};
		}

		const content = readFileSync(file, "utf-8");
		const pkg = JSON.parse(content);

		if (typeof pkg.version !== "string") {
			return {
				content: [{ type: "text", text: `No version field found in ${file}` }],
				isError: true,
				details: { error: "no_version_field" },
			};
		}

		const oldVersion = pkg.version;
		pkg.version = newVersion;

		writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

		return {
			content: [{ type: "text", text: `Updated ${file}: ${oldVersion} → ${newVersion}` }],
			details: { oldVersion, newVersion, file },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to update version: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

function createReleaseTool(tag: string, title: string, body?: string, draft = false, prerelease = false): ToolResult {
	try {
		let command = `gh release create ${tag} --title "${title.replace(/"/g, '\\"')}"`;

		if (body) {
			command += ` --notes "${body.replace(/"/g, '\\"')}"`;
		}

		if (draft) {
			command += " --draft";
		}

		if (prerelease) {
			command += " --prerelease";
		}

		const releaseUrl = execGh(command);

		return {
			content: [{ type: "text", text: `Created release: ${releaseUrl}\n\nTag: ${tag}\nTitle: ${title}` }],
			details: { tag, title, releaseUrl },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to create release: ${message}` }],
			isError: true,
			details: { error: message },
		};
	}
}

// =============================================================================
// Exports
// =============================================================================

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
getRepoInfo,
mergePrTool,
parseConventionalCommit,
pushTool,
repoInfoTool,
};

export { execGit, execGh };

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function devtoolsExtension(pi: ExtensionAPI) {
	// Register devtools_create_branch
	pi.registerTool({
		name: "devtools_create_branch",
		label: "Create Branch",
		description: "Create a new git branch and optionally switch to it",
		parameters: createBranchParams,
		async execute(_toolCallId, params) {
			const { branchName, switchBranch = true } = params as { branchName: string; switchBranch?: boolean };
			return createBranchTool(branchName, switchBranch);
		},
	});

	// Register devtools_commit
	pi.registerTool({
		name: "devtools_commit",
		label: "Git Commit",
		description: "Stage files and create a commit with conventional format",
		parameters: commitParams,
		async execute(_toolCallId, params) {
			const { message, files, noVerify = false } = params as { message: string; files?: string[]; noVerify?: boolean };
			return commitTool(message, files, noVerify);
		},
	});

	// Register devtools_push
	pi.registerTool({
		name: "devtools_push",
		label: "Git Push",
		description: "Push branch to remote with upstream tracking",
		parameters: pushParams,
		async execute(_toolCallId, params) {
			const { branch, setUpstream = true } = params as { branch?: string; setUpstream?: boolean };
			return pushTool(branch, setUpstream);
		},
	});

	// Register devtools_create_pr
	pi.registerTool({
		name: "devtools_create_pr",
		label: "Create PR",
		description: "Create a GitHub pull request",
		parameters: createPrParams,
		async execute(_toolCallId, params) {
			const typed = params as { title: string; body?: string; base?: string; draft?: boolean; assignees?: string[] };
			return createPrTool(typed.title, typed.body, typed.base, typed.draft, typed.assignees);
		},
	});

	// Register devtools_merge_pr
	pi.registerTool({
		name: "devtools_merge_pr",
		label: "Merge PR",
		description: "Merge a pull request (optionally delete source branch)",
		parameters: mergePrParams,
		async execute(_toolCallId, params) {
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
	});

	// Register devtools_squash_merge_pr
	pi.registerTool({
		name: "devtools_squash_merge_pr",
		label: "Squash Merge PR",
		description: "Squash-merge a pull request (optionally delete source branch)",
		parameters: mergePrParams,
		async execute(_toolCallId, params) {
			const typed = params as {
				prNumber?: number;
				deleteBranch?: boolean;
				commitTitle?: string;
				commitMessage?: string;
			};
			return mergePrTool(typed.prNumber, true, typed.deleteBranch ?? true, typed.commitTitle, typed.commitMessage);
		},
	});

	// Register devtools_check_ci
	pi.registerTool({
		name: "devtools_check_ci",
		label: "Check CI",
		description: "Check GitHub Actions CI status for a PR or branch",
		parameters: checkCiParams,
		async execute(_toolCallId, params) {
			const { prNumber, branch } = params as { prNumber?: number; branch?: string };
			return checkCiTool(prNumber, branch);
		},
	});

	// Register devtools_get_repo_info
	pi.registerTool({
		name: "devtools_get_repo_info",
		label: "Repo Info",
		description: "Get current branch, default branch, and git status",
		parameters: Type.Object({}),
		async execute() {
			return repoInfoTool();
		},
	});

	// Register devtools_get_latest_tag
	pi.registerTool({
		name: "devtools_get_latest_tag",
		label: "Latest Tag",
		description: "Get the latest version tag from git",
		parameters: Type.Object({}),
		async execute() {
			return getLatestTagTool();
		},
	});

	// Register devtools_analyze_commits
	pi.registerTool({
		name: "devtools_analyze_commits",
		label: "Analyze Commits",
		description: "Analyze commits since last tag to determine version bump type",
		parameters: Type.Object({}),
		async execute() {
			return analyzeCommitsTool();
		},
	});

	// Register devtools_bump_version
	pi.registerTool({
		name: "devtools_bump_version",
		label: "Bump Version",
		description: "Update version in package.json",
		parameters: bumpVersionParams,
		async execute(_toolCallId, params) {
			const { newVersion, file = "package.json" } = params as { newVersion: string; file?: string };
			return bumpVersionTool(newVersion, file);
		},
	});

	// Register devtools_create_release
	pi.registerTool({
		name: "devtools_create_release",
		label: "Create Release",
		description: "Create a GitHub release with changelog",
		parameters: createReleaseParams,
		async execute(_toolCallId, params) {
			const typed = params as { tag: string; title: string; body?: string; draft?: boolean; prerelease?: boolean };
			return createReleaseTool(typed.tag, typed.title, typed.body, typed.draft, typed.prerelease);
		},
	});
}

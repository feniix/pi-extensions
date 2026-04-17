/**
 * Git data: branch, worktree name, dirty file count.
 */

import { execSync } from "node:child_process";

import type { GitData } from "../types.js";

/** Git command cache: key is "command|cwd" */
const cache = new Map<string, string | null>();

function runGit(command: string, cwd: string): string | null {
	const key = `${command}|${cwd}`;
	if (cache.has(key)) return cache.get(key) ?? null;

	try {
		const output = execSync(`git ${command}`, {
			encoding: "utf8",
			cwd,
			timeout: 3000,
		}).trim();
		const result = output.length > 0 ? output : null;
		cache.set(key, result);
		return result;
	} catch {
		cache.set(key, null);
		return null;
	}
}

/** Parse the worktree name from `git rev-parse --git-dir` output. */
function parseWorktreeName(gitDir: string): string | null {
	// Normalize backslashes for consistent parsing
	const normalized = gitDir.replace(/\\/g, "/");

	// Main worktree: .git or /path/to/.git
	if (normalized.endsWith("/.git") || normalized === ".git") {
		return "main";
	}

	// Linked worktree: .../.git/worktrees/<name>
	const worktreesMarker = "/.git/worktrees/";
	const worktreesIdx = normalized.lastIndexOf(worktreesMarker);
	if (worktreesIdx !== -1) {
		const name = normalized.slice(worktreesIdx + worktreesMarker.length);
		return name.length > 0 ? name : null;
	}

	// Bare repo worktree: .../worktrees/<name>
	const bareMarker = "/worktrees/";
	const bareIdx = normalized.lastIndexOf(bareMarker);
	if (bareIdx === -1) return null;
	const name = normalized.slice(bareIdx + bareMarker.length);
	return name.length > 0 ? name : null;
}

/** Count dirty (uncommitted) files using `git status --porcelain`. */
function getDirtyCount(cwd: string): number {
	const output = runGit("status --porcelain", cwd);
	if (!output) return 0;
	return output.split("\n").filter((line) => line.length >= 2).length;
}

/** Collect all git data for a given working directory. */
export async function getGitData(cwd: string): Promise<GitData> {
	// Check if inside a work tree
	const insideWorktree = runGit("rev-parse --is-inside-work-tree", cwd);
	if (insideWorktree !== "true") {
		return { branch: null, worktree: null, dirty: 0 };
	}

	const [branch, gitDir, dirty] = await Promise.all([
		Promise.resolve(runGit("branch --show-current", cwd)),
		Promise.resolve(runGit("rev-parse --git-dir", cwd)),
		Promise.resolve(getDirtyCount(cwd)),
	]);

	return {
		branch: branch || null,
		worktree: gitDir ? parseWorktreeName(gitDir) : null,
		dirty,
	};
}

/** Clear the git command cache (useful for testing). */
export function clearGitCache(): void {
	cache.clear();
}

import { basename, normalize } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { GitSnapshot, WorktreeEntry } from "./types.js";

const GIT_TIMEOUT_MS = 3_000;

export function parseDirtyCountFromPorcelain(stdout: string): number {
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0).length;
}

export function parseWorktreeListPorcelain(stdout: string): WorktreeEntry[] {
	const records = stdout
		.trim()
		.split(/\r?\n\r?\n/)
		.filter((record) => record.trim().length > 0);
	const entries: WorktreeEntry[] = [];

	for (const record of records) {
		let path: string | null = null;
		let branch: string | null = null;

		for (const line of record.split(/\r?\n/)) {
			if (line.startsWith("worktree ")) {
				path = line.slice("worktree ".length).trim();
			} else if (line.startsWith("branch ")) {
				branch = line.slice("branch ".length).trim();
			}
		}

		if (path) {
			entries.push({ path, branch });
		}
	}

	return entries;
}

export function isLinkedWorktreeGitDir(gitDir: string): boolean {
	const normalized = gitDir.replace(/\\/g, "/");
	return normalized.includes("/worktrees/") || normalized.startsWith(".git/worktrees/");
}

export function normalizeBranchName(branchRef: string | null): string | null {
	if (!branchRef) {
		return null;
	}
	if (branchRef.startsWith("refs/heads/")) {
		return branchRef.slice("refs/heads/".length);
	}
	return branchRef;
}

export function getWorktreeLabelForPath(
	entries: ReadonlyArray<WorktreeEntry>,
	currentTopLevel: string,
	gitDir: string,
): string {
	if (!isLinkedWorktreeGitDir(gitDir)) {
		return "none";
	}

	const normalizedTopLevel = normalize(currentTopLevel);
	const match = entries.find((entry) => normalize(entry.path) === normalizedTopLevel);
	if (!match) {
		return "none";
	}

	const branchName = normalizeBranchName(match.branch);
	if (branchName) {
		return basename(branchName);
	}

	return basename(match.path) || "none";
}

async function runGit(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | null> {
	try {
		const result = await pi.exec("git", args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
		});
		if (result.code !== 0) {
			return null;
		}
		const stdout = result.stdout.trim();
		return stdout.length > 0 ? stdout : "";
	} catch {
		return null;
	}
}

export async function getGitSnapshot(pi: ExtensionAPI, cwd: string): Promise<GitSnapshot> {
	const insideWorkTree = await runGit(pi, cwd, ["rev-parse", "--is-inside-work-tree"]);
	if (insideWorkTree !== "true") {
		return {
			repoName: null,
			dirtyCount: null,
			worktreeLabel: "none",
		};
	}

	const topLevel = await runGit(pi, cwd, ["rev-parse", "--show-toplevel"]);
	const gitDir = await runGit(pi, cwd, ["rev-parse", "--git-dir"]);
	const dirtyOutput = await runGit(pi, cwd, ["--no-optional-locks", "status", "--porcelain"]);
	const worktreeOutput = await runGit(pi, cwd, ["worktree", "list", "--porcelain"]);

	const repoName = topLevel ? basename(topLevel) : null;
	const dirtyCount = dirtyOutput === null ? null : parseDirtyCountFromPorcelain(dirtyOutput);
	const worktreeEntries = worktreeOutput ? parseWorktreeListPorcelain(worktreeOutput) : [];
	const worktreeLabel = topLevel && gitDir ? getWorktreeLabelForPath(worktreeEntries, topLevel, gitDir) : "none";

	return {
		repoName,
		dirtyCount,
		worktreeLabel,
	};
}

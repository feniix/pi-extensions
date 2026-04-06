/**
 * Git and GitHub CLI execution utilities
 */

import { execSync } from "node:child_process";

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

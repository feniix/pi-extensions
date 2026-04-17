/**
 * Session data: cwd, repo root, transcript path.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Find the most recently modified .jsonl file under a directory. */
function findJsonlInDir(dir: string): string | null {
	if (!existsSync(dir)) return null;
	try {
		const result = execSync(`ls -t "${dir}"/*.jsonl 2>/dev/null | head -1`, {
			encoding: "utf8",
			timeout: 2000,
		})
			.trim()
			.split("\n")[0];
		return result || null;
	} catch {
		return null;
	}
}

/**
 * Encode a cwd into the pi session directory name format.
 * e.g. /Users/feniix/src/spantree/pi-extensions
 *   → --Users-feniix-src-spantree-pi-extensions--
 */
function encodeCwdForPi(cwd: string): string {
	// Strip leading slash, replace remaining slashes with dashes, wrap in --
	const stripped = cwd.startsWith("/") ? cwd.slice(1) : cwd;
	return `--${stripped.replace(/\//g, "-")}--`;
}

/** Find the transcript path for the current session. */
export function findTranscriptPath(repoRoot: string | null, cwd: string): string | null {
	const candidates: string[] = [];

	// pi session directory for the current cwd
	const piSessionsDir = join(homedir(), ".pi", "agent", "sessions");
	const encodedCwd = encodeCwdForPi(cwd);
	candidates.push(join(piSessionsDir, encodedCwd));

	// Also check .claude locations for Claude Code sessions (if they exist)
	if (repoRoot) {
		candidates.push(`${repoRoot}/.claude/project/transcripts`);
	}
	candidates.push(join(homedir(), ".claude", "projects", "transcripts"));

	const telemetry = process.env.CLAUDE_TELEMETRY;
	if (telemetry) {
		candidates.push(join(telemetry, "transcripts"));
	}

	for (const dir of candidates) {
		const found = findJsonlInDir(dir);
		if (found) return found;
	}

	return null;
}

/** Get git repo root directory (null if not in a repo). */
export function getRepoRoot(cwd: string): string | null {
	try {
		const output = execSync("git rev-parse --show-toplevel", {
			encoding: "utf8",
			cwd,
			timeout: 2000,
		}).trim();
		return output.length > 0 ? output : null;
	} catch {
		return null;
	}
}

/** Get the repo name (last segment of repo root). */
export function getRepoName(repoRoot: string | null): string | null {
	if (!repoRoot) return null;
	const parts = repoRoot.split("/");
	return parts[parts.length - 1] || null;
}

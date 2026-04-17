import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findTranscriptPath, getRepoName, getRepoRoot } from "../../src/data/session.js";

describe("session data", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = join(tmpdir(), `pi-statusline-session-${randomUUID()}`);
		mkdirSync(repoDir, { recursive: true });
		execSync("git init", { cwd: repoDir });
		execSync("git config user.email test@test.com", { cwd: repoDir });
		execSync("git config user.name Test", { cwd: repoDir });
		writeFileSync(join(repoDir, "README.md"), "# test\n");
		execSync("git add .", { cwd: repoDir });
		execSync("git commit -m initial", { cwd: repoDir });
	});

	afterEach(() => {
		rmSync(repoDir, { recursive: true, force: true });
	});

	describe("getRepoRoot", () => {
		it("returns the repo root for a git directory", () => {
			const root = getRepoRoot(repoDir);
			expect(root).not.toBeNull();
			const repoName = repoDir.split("/").pop();
			expect(root?.endsWith(repoName ?? "")).toBe(true);
		});

		it("returns null for non-git directory", () => {
			const nonGitDir = join(tmpdir(), `non-git-${randomUUID()}`);
			mkdirSync(nonGitDir, { recursive: true });
			try {
				const root = getRepoRoot(nonGitDir);
				expect(root).toBeNull();
			} finally {
				rmSync(nonGitDir, { recursive: true, force: true });
			}
		});
	});

	describe("getRepoName", () => {
		it("returns the last path segment", () => {
			const name = getRepoName(repoDir);
			expect(name).toBe(repoDir.split("/").pop());
		});

		it("returns null for null input", () => {
			expect(getRepoName(null)).toBeNull();
		});
	});

	describe("findTranscriptPath", () => {
		it("returns null when no transcript exists", () => {
			const path = findTranscriptPath(repoDir, repoDir);
			expect(path).toBeNull();
		});

		it("finds transcript in .claude/project/transcripts", () => {
			const transcriptDir = join(repoDir, ".claude", "project", "transcripts");
			mkdirSync(transcriptDir, { recursive: true });
			writeFileSync(join(transcriptDir, "conversation.jsonl"), '{"type":"user"}\n');
			const path = findTranscriptPath(repoDir, repoDir);
			expect(path).toContain("conversation.jsonl");
		});

		it("returns null when repoRoot is null", () => {
			const path = findTranscriptPath(null, repoDir);
			expect(path).toBeNull();
		});
	});
});

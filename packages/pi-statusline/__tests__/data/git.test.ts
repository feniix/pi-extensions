import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearGitCache, getGitData } from "../../src/data/git.js";

describe("git data", () => {
	let repoDir: string;

	beforeEach(() => {
		clearGitCache();
		repoDir = join(tmpdir(), `pi-statusline-test-${randomUUID()}`);
		mkdirSync(repoDir, { recursive: true });

		// Initialize a git repo
		execSync("git init", { cwd: repoDir });
		execSync("git config user.email test@test.com", { cwd: repoDir });
		execSync("git config user.name Test", { cwd: repoDir });

		// Create initial commit (git branch requires at least one commit)
		writeFileSync(join(repoDir, "README.md"), "# test\n");
		execSync("git add .", { cwd: repoDir });
		execSync("git commit -m initial", { cwd: repoDir });
	});

	afterEach(() => {
		clearGitCache();
		rmSync(repoDir, { recursive: true, force: true });
	});

	it("returns the current branch", async () => {
		const data = await getGitData(repoDir);
		expect(data.branch).toBe("main");
	});

	it("returns 'main' as worktree for main repo", async () => {
		const data = await getGitData(repoDir);
		expect(data.worktree).toBe("main");
	});

	it("returns 0 dirty files for clean repo", async () => {
		const data = await getGitData(repoDir);
		expect(data.dirty).toBe(0);
	});

	it("increments dirty count when files are modified", async () => {
		writeFileSync(join(repoDir, "test.txt"), "hello");
		const data = await getGitData(repoDir);
		expect(data.dirty).toBe(1);
	});

	it("increments dirty count when files are added", async () => {
		writeFileSync(join(repoDir, "new.txt"), "content");
		execSync("git add new.txt", { cwd: repoDir });
		const data = await getGitData(repoDir);
		expect(data.dirty).toBe(1);
	});

	it("returns null branch in non-git directory", async () => {
		const nonGitDir = join(tmpdir(), `non-git-${randomUUID()}`);
		mkdirSync(nonGitDir, { recursive: true });
		try {
			const data = await getGitData(nonGitDir);
			expect(data.branch).toBeNull();
			expect(data.worktree).toBeNull();
			expect(data.dirty).toBe(0);
		} finally {
			rmSync(nonGitDir, { recursive: true, force: true });
		}
	});
});

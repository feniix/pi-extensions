import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execGh, execGit, getDefaultBranch } from "../extensions/git.js";

describe("pi-devtools git integration", () => {
	let tempDir: string;

	beforeEach(() => {
		// Create a unique temp directory for each test
		tempDir = `/tmp/vitest-git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(tempDir, { recursive: true });

		// Initialize git repo
		execSync("git init", { cwd: tempDir, stdio: "pipe" });
		execSync("git config user.email 'test@test.com'", { cwd: tempDir, stdio: "pipe" });
		execSync("git config user.name 'Test User'", { cwd: tempDir, stdio: "pipe" });
	});

	afterEach(() => {
		// Clean up temp directory
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("execGit", () => {
		it("executes git command successfully in temp repo", () => {
			const result = execGit(`git -C ${tempDir} status`);
			expect(result).toBeDefined();
		});

		it("throws error for invalid command", () => {
			expect(() => execGit("git invalid-command")).toThrow("Git error");
		});

		it("throws error when not in a git repo", () => {
			// Create a non-git directory
			const nonGitDir = `/tmp/non-git-${Date.now()}`;
			mkdirSync(nonGitDir, { recursive: true });
			try {
				expect(() => execGit(`git -C ${nonGitDir} status`)).toThrow();
			} finally {
				rmSync(nonGitDir, { recursive: true, force: true });
			}
		});
	});

	describe("getDefaultBranch", () => {
		it("returns main when symbolic-ref exists", () => {
			// Create initial commit so we can set HEAD
			writeFileSync(join(tempDir, "test.txt"), "test");
			execSync("git add .", { cwd: tempDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tempDir, stdio: "pipe" });

			// Create a fake origin with main branch
			const originDir = `${tempDir}-origin`;
			mkdirSync(originDir, { recursive: true });
			execSync("git init --bare", { cwd: originDir, stdio: "pipe" });
			execSync(`git remote add origin ${originDir}`, { cwd: tempDir, stdio: "pipe" });
			execSync("git push -u origin main", { cwd: tempDir, stdio: "pipe" });

			// Now getDefaultBranch should work
			const result = getDefaultBranch();
			expect(result).toBeTruthy();
		});

		it("falls back to main when remote lookup fails", () => {
			const result = getDefaultBranch();
			// Should return main as fallback
			expect(result).toBe("main");
		});
	});

	describe("createBranchTool integration", () => {
		it("creates a branch", () => {
			// Create initial commit
			writeFileSync(join(tempDir, "test.txt"), "test");
			execSync("git add .", { cwd: tempDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tempDir, stdio: "pipe" });

			// Test creating a branch
			const result = execGit(`git -C ${tempDir} checkout -b feature/test`);

			// Verify branch exists
			const branches = execGit(`git -C ${tempDir} branch`);
			expect(branches).toContain("feature/test");
		});
	});

	describe("commitTool integration", () => {
		it("stages files successfully", () => {
			// Create and stage a file
			writeFileSync(join(tempDir, "test.txt"), "test content");
			execSync(`git -C ${tempDir} add .`, { stdio: "pipe" });

			// Verify staged files
			const staged = execGit(`git -C ${tempDir} diff --cached --name-only`);
			expect(staged).toContain("test.txt");
		});
	});

	describe("repoInfoTool integration", () => {
		it("gets current branch", () => {
			const branch = execGit(`git -C ${tempDir} branch --show-current`);
			expect(branch).toBe("main");
		});

		it("gets status output", () => {
			writeFileSync(join(tempDir, "newfile.txt"), "content");

			const status = execGit(`git -C ${tempDir} status --porcelain`);
			expect(status).toContain("newfile.txt");
		});
	});

	describe("getLatestTagTool integration", () => {
		it("returns empty when no tags", () => {
			const tags = execGit(`git -C ${tempDir} tag -l 'v*' | sort -rV | head -1`);
			expect(tags).toBe("");
		});

		it("returns latest tag", () => {
			// Create initial commit
			writeFileSync(join(tempDir, "test.txt"), "test");
			execSync("git add .", { cwd: tempDir, stdio: "pipe" });
			execSync("git commit -m 'initial'", { cwd: tempDir, stdio: "pipe" });

			// Create a tag
			execSync(`git -C ${tempDir} tag v1.0.0`);

			const tags = execGit(`git -C ${tempDir} tag -l 'v*' | sort -rV | head -1`);
			expect(tags).toBe("v1.0.0");
		});
	});

	describe("parseConventionalCommit integration", () => {
		it("parses conventional commits from log", () => {
			// Create commits with conventional format
			writeFileSync(join(tempDir, "feat.txt"), "feat");
			execSync("git add .", { cwd: tempDir, stdio: "pipe" });
			execSync(`git -C ${tempDir} commit -m "feat: add new feature"`, { stdio: "pipe" });

			writeFileSync(join(tempDir, "fix.txt"), "fix");
			execSync("git add .", { cwd: tempDir, stdio: "pipe" });
			execSync(`git -C ${tempDir} commit -m "fix: fix bug"`, { stdio: "pipe" });

			const commits = execGit(`git -C ${tempDir} log --format="%s" -n 2`);
			expect(commits).toContain("feat: add new feature");
			expect(commits).toContain("fix: fix bug");
		});
	});
});

describe("execGh", () => {
	it("executes gh command successfully when authenticated", () => {
		// gh is installed and authenticated in this environment
		const result = execGh("gh auth status");
		// Should not throw and should return some output
		expect(result).toBeDefined();
	});
});

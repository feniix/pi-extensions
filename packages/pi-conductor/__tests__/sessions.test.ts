import { execSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerSessionLink } from "../extensions/sessions.js";

describe("session linkage", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
		execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
		writeFileSync(join(repoDir, "README.md"), "hello");
		execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
		execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
	});

	afterEach(() => {
		if (repoDir && existsSync(repoDir)) {
			rmSync(repoDir, { recursive: true, force: true });
		}
	});

	it("creates a persisted pi session file for a worker worktree", async () => {
		const sessionFile = await createWorkerSessionLink(repoDir);
		expect(sessionFile).toBeTruthy();
		expect(existsSync(sessionFile!)).toBe(true);
	});
});

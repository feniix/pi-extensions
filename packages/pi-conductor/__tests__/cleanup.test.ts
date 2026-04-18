import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerForRepo, getOrCreateRunForRepo, removeWorkerForRepo } from "../extensions/conductor.js";

function requireValue<T>(value: T | null | undefined): T {
	if (value == null) {
		throw new Error("Expected value to be present in test");
	}
	return value;
}

describe("cleanup flows", () => {
	let repoDir: string;
	let conductorHome: string;

	beforeEach(() => {
		repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
		conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
		process.env.PI_CONDUCTOR_HOME = conductorHome;
		execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
		writeFileSync(join(repoDir, "README.md"), "hello");
		execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
		execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
	});

	afterEach(() => {
		delete process.env.PI_CONDUCTOR_HOME;
		if (existsSync(repoDir)) {
			rmSync(repoDir, { recursive: true, force: true });
		}
		if (existsSync(conductorHome)) {
			rmSync(conductorHome, { recursive: true, force: true });
		}
	});

	it("removes a worker record and its worktree", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const worktreePath = requireValue(worker.worktreePath);
		expect(existsSync(worktreePath)).toBe(true);
		const removed = removeWorkerForRepo(repoDir, "backend");
		expect(removed.workerId).toBe(worker.workerId);
		expect(existsSync(worktreePath)).toBe(false);
		expect(getOrCreateRunForRepo(repoDir).workers).toHaveLength(0);
	});

	it("removes the persisted session file when cleaning up a worker", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const sessionFile = requireValue(worker.sessionFile);
		expect(existsSync(sessionFile)).toBe(true);
		removeWorkerForRepo(repoDir, "backend");
		expect(existsSync(sessionFile)).toBe(false);
	});

	it("removes the worker branch so the same worker name can be recreated", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const branch = requireValue(worker.branch);
		expect(execSync(`git branch --list ${branch}`, { cwd: repoDir, encoding: "utf-8" }).trim()).toContain(branch);
		removeWorkerForRepo(repoDir, "backend");
		expect(execSync(`git branch --list ${branch}`, { cwd: repoDir, encoding: "utf-8" }).trim()).toBe("");

		const recreated = await createWorkerForRepo(repoDir, "backend");
		expect(recreated.branch).toBe(branch);
	});
});

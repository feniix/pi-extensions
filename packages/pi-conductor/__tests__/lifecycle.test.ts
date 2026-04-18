import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createWorkerForRepo,
	getOrCreateRunForRepo,
	resumeWorkerForRepo,
	updateWorkerLifecycleForRepo,
} from "../extensions/conductor.js";

describe("worker lifecycle flows", () => {
	let repoDir: string;
	let conductorHome: string;

	beforeEach(() => {
		repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
		conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
		process.env.PI_CONDUCTOR_HOME = conductorHome;
		execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
		writeFileSync(join(repoDir, "README.md"), "hello\n");
		execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
		execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
	});

	afterEach(() => {
		delete process.env.PI_CONDUCTOR_HOME;
		for (const dir of [repoDir, conductorHome]) {
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("resumes a healthy worker using its persisted worktree and session linkage", async () => {
		const created = await createWorkerForRepo(repoDir, "backend");
		const resumed = resumeWorkerForRepo(repoDir, "backend");
		expect(resumed.workerId).toBe(created.workerId);
		expect(resumed.worktreePath).toBe(created.worktreePath);
		expect(resumed.sessionFile).toBe(created.sessionFile);
	});

	it("updates a worker lifecycle to blocked, ready_for_pr, and done", async () => {
		await createWorkerForRepo(repoDir, "backend");
		expect(updateWorkerLifecycleForRepo(repoDir, "backend", "blocked").lifecycle).toBe("blocked");
		expect(updateWorkerLifecycleForRepo(repoDir, "backend", "ready_for_pr").lifecycle).toBe("ready_for_pr");
		expect(updateWorkerLifecycleForRepo(repoDir, "backend", "done").lifecycle).toBe("done");
		expect(getOrCreateRunForRepo(repoDir).workers[0]?.lifecycle).toBe("done");
	});
});

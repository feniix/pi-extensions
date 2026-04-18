import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createWorkerForRepo,
	getOrCreateRunForRepo,
	reconcileWorkerHealth,
	recoverWorkerForRepo,
} from "../extensions/conductor.js";

function requireValue<T>(value: T | null | undefined, message: string): T {
	if (value == null) {
		throw new Error(message);
	}
	return value;
}

describe("recovery flows", () => {
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

	it("marks a worker broken and recoverable when its session file is missing", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
		rmSync(sessionFile, { force: true });
		const updated = reconcileWorkerHealth(getOrCreateRunForRepo(repoDir));
		expect(updated.workers[0]?.lifecycle).toBe("broken");
		expect(updated.workers[0]?.recoverable).toBe(true);
	});

	it("recreates a missing session file during recovery", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
		rmSync(sessionFile, { force: true });
		const recovered = await recoverWorkerForRepo(repoDir, "backend");
		const recoveredSessionFile = requireValue(recovered.sessionFile, "recovered session file missing");
		expect(recovered.sessionFile).toBeTruthy();
		expect(existsSync(recoveredSessionFile)).toBe(true);
		expect(recovered.lifecycle).toBe("idle");
		expect(recovered.recoverable).toBe(false);
	});

	it("recreates a missing worktree during recovery", async () => {
		const worker = await createWorkerForRepo(repoDir, "backend");
		const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
		rmSync(worktreePath, { recursive: true, force: true });
		const recovered = await recoverWorkerForRepo(repoDir, "backend");
		const recoveredWorktreePath = requireValue(recovered.worktreePath, "recovered worktree missing");
		const recoveredSessionFile = requireValue(recovered.sessionFile, "recovered session file missing");
		expect(recovered.worktreePath).toBeTruthy();
		expect(existsSync(recoveredWorktreePath)).toBe(true);
		expect(recovered.sessionFile).toBeTruthy();
		expect(existsSync(recoveredSessionFile)).toBe(true);
		expect(recovered.lifecycle).toBe("idle");
	});
});

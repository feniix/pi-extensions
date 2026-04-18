import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConductorCommand } from "../extensions/commands.js";
import { getOrCreateRunForRepo } from "../extensions/conductor.js";

describe("PR preparation flow", () => {
	let repoDir: string;
	let bareRemoteDir: string;
	let conductorHome: string;
	let fakeBinDir: string;
	let originalPath: string | undefined;

	beforeEach(() => {
		repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
		bareRemoteDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
		conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
		fakeBinDir = mkdtempSync(join(tmpdir(), "pi-conductor-bin-"));
		originalPath = process.env.PATH;
		process.env.PI_CONDUCTOR_HOME = conductorHome;
		process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;

		execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
		execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
		writeFileSync(join(repoDir, "README.md"), "hello");
		execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
		execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });

		execSync("git init --bare", { cwd: bareRemoteDir, stdio: "pipe" });
		execSync(`git remote add origin ${bareRemoteDir}`, { cwd: repoDir, stdio: "pipe" });
		execSync("git push -u origin main", { cwd: repoDir, stdio: "pipe" });
	});

	afterEach(() => {
		delete process.env.PI_CONDUCTOR_HOME;
		process.env.PATH = originalPath;
		for (const dir of [repoDir, bareRemoteDir, conductorHome, fakeBinDir]) {
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function writeFakeGhScript(content: string): void {
		const path = join(fakeBinDir, "gh");
		writeFileSync(path, `#!/bin/sh\n${content}\n`, { encoding: "utf-8", mode: 0o755 });
	}

	async function createChangedWorker(): Promise<string> {
		await runConductorCommand(repoDir, "start backend");
		const worker = getOrCreateRunForRepo(repoDir).workers[0];
		if (!worker?.worktreePath) {
			throw new Error("worker worktree missing in test setup");
		}
		writeFileSync(join(worker.worktreePath, "backend.txt"), "backend changes\n", "utf-8");
		return worker.worktreePath;
	}

	it("commits worker changes and persists commit state", async () => {
		const worktreePath = await createChangedWorker();
		const text = await runConductorCommand(repoDir, "commit backend feat: add backend worker");
		expect(text).toContain("committed worker backend");

		const run = getOrCreateRunForRepo(repoDir);
		expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
		expect(run.workers[0]?.pr.pushSucceeded).toBe(false);

		const log = execSync("git log -1 --pretty=%s", { cwd: worktreePath, encoding: "utf-8" }).trim();
		expect(log).toBe("feat: add backend worker");
	});

	it("pushes a worker branch and persists push state", async () => {
		await createChangedWorker();
		await runConductorCommand(repoDir, "commit backend feat: add backend worker");
		const text = await runConductorCommand(repoDir, "push backend");
		expect(text).toContain("pushed worker backend");

		const run = getOrCreateRunForRepo(repoDir);
		expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
		const remoteHead = execSync("git ls-remote --heads origin conductor/backend", { cwd: repoDir, encoding: "utf-8" }).trim();
		expect(remoteHead).toContain("refs/heads/conductor/backend");
	});

	it("creates a pull request and persists PR metadata", async () => {
		writeFakeGhScript("echo 'https://github.com/example/repo/pull/123'");
		await createChangedWorker();
		await runConductorCommand(repoDir, "commit backend feat: add backend worker");
		await runConductorCommand(repoDir, "push backend");
		const text = await runConductorCommand(repoDir, "pr backend Backend worker PR");
		expect(text).toContain("created PR for backend");
		expect(text).toContain("pull/123");

		const run = getOrCreateRunForRepo(repoDir);
		expect(run.workers[0]?.pr.prCreationAttempted).toBe(true);
		expect(run.workers[0]?.pr.number).toBe(123);
		expect(run.workers[0]?.pr.url).toContain("pull/123");
	});

	it("persists partial PR state when gh pr create fails", async () => {
		writeFakeGhScript("echo 'gh pr create failed' >&2\nexit 1");
		await createChangedWorker();
		await runConductorCommand(repoDir, "commit backend feat: add backend worker");
		await runConductorCommand(repoDir, "push backend");

		await expect(runConductorCommand(repoDir, "pr backend Backend worker PR")).rejects.toThrow();

		const run = getOrCreateRunForRepo(repoDir);
		expect(run.workers[0]?.pr.commitSucceeded).toBe(true);
		expect(run.workers[0]?.pr.pushSucceeded).toBe(true);
		expect(run.workers[0]?.pr.prCreationAttempted).toBe(true);
		expect(run.workers[0]?.pr.url).toBeNull();
	});
});

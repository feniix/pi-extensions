import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConductorCommand } from "../extensions/commands.js";

describe("runConductorCommand", () => {
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

	it("returns status for the current repo", () => {
		const text = runConductorCommand(repoDir, "status");
		expect(text).toContain("workers: 0");
	});

	it("creates a worker from the start subcommand", () => {
		const text = runConductorCommand(repoDir, "start backend");
		expect(text).toContain("created worker");
		expect(text).toContain("backend");

		const status = runConductorCommand(repoDir, "status");
		expect(status).toContain("workers: 1");
		expect(status).toContain("backend");
	});

	it("updates a worker task through the task subcommand", () => {
		runConductorCommand(repoDir, "start backend");
		const text = runConductorCommand(repoDir, "task backend implement status command");
		expect(text).toContain("updated task for backend");

		const status = runConductorCommand(repoDir, "status");
		expect(status).toContain("task=implement status command");
	});

	it("shows help for unknown subcommands", () => {
		const text = runConductorCommand(repoDir, "wat");
		expect(text).toContain("usage:");
	});
});

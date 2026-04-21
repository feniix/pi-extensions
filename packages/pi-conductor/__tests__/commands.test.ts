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

  it("returns status for the current repo", async () => {
    const text = await runConductorCommand(repoDir, "status");
    expect(text).toContain("workers: 0");
  });

  it("creates a worker from the start subcommand", async () => {
    const text = await runConductorCommand(repoDir, "start backend");
    expect(text).toContain("created worker");
    expect(text).toContain("backend");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("workers: 1");
    expect(status).toContain("backend");
  });

  it("updates a worker task through the task subcommand", async () => {
    await runConductorCommand(repoDir, "start backend");
    const text = await runConductorCommand(repoDir, "task backend implement status command");
    expect(text).toContain("updated task for backend");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("task=implement status command");
  });

  it("shows an error for run without a worker name or task", async () => {
    const text = await runConductorCommand(repoDir, "run backend");
    expect(text).toContain("error: missing worker name or task");
  });

  it("refreshes a worker summary from its session", async () => {
    await runConductorCommand(repoDir, "start backend");
    const text = await runConductorCommand(repoDir, "summarize backend");
    expect(text).toContain("refreshed summary for backend");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("summary=fresh:");
  });

  it("resumes a healthy worker through the resume subcommand", async () => {
    await runConductorCommand(repoDir, "start backend");
    const text = await runConductorCommand(repoDir, "resume backend");
    expect(text).toContain("resumed worker backend");
    expect(text).toContain("session=");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("runtime=session_manager");
    expect(status).toContain("lastResumedAt=");
  });

  it("updates a worker lifecycle through the state subcommand", async () => {
    await runConductorCommand(repoDir, "start backend");
    const text = await runConductorCommand(repoDir, "state backend ready_for_pr");
    expect(text).toContain("updated worker backend state to ready_for_pr");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("state=ready_for_pr");
  });

  it("cleans up a worker through the cleanup subcommand", async () => {
    await runConductorCommand(repoDir, "start backend");
    const text = await runConductorCommand(repoDir, "cleanup backend");
    expect(text).toContain("removed worker backend");

    const status = await runConductorCommand(repoDir, "status");
    expect(status).toContain("workers: 0");
  });

  it("shows help for unknown subcommands", async () => {
    const text = await runConductorCommand(repoDir, "wat");
    expect(text).toContain("usage:");
  });
});

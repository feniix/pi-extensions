import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function runPiConductorCommand(repoDir: string, conductorHome: string, command: string): string {
  const piBin = resolve(process.cwd(), "node_modules/.bin/pi");
  const extensionPath = resolve(process.cwd(), "packages/pi-conductor/extensions/index.ts");

  const result = spawnSync(
    piBin,
    [
      "--offline",
      "--no-session",
      "--no-extensions",
      "--model",
      "google/gemini-2.5-flash",
      "-e",
      extensionPath,
      "-p",
      command,
    ],
    {
      cwd: repoDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "test-key",
        PI_CONDUCTOR_HOME: conductorHome,
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(`pi command failed: ${result.stderr || result.stdout}`);
  }

  return `${result.stdout}\n${result.stderr}`.trim();
}

describe("pi-conductor CLI e2e", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    repoDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));

    execSync("git init -b main", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: repoDir, stdio: "pipe" });
    writeFileSync(join(repoDir, "README.md"), "hello\n");
    execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
    execSync("git commit -m 'initial commit'", { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(() => {
    for (const dir of [repoDir, conductorHome]) {
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("executes /conductor status through the real pi CLI", () => {
    const output = runPiConductorCommand(repoDir, conductorHome, "/conductor status");

    expect(output).toContain("projectKey:");
    expect(output).toContain("workers: 0");
  });

  it("creates, resumes, and inspects a worker through the real pi CLI", () => {
    const created = runPiConductorCommand(repoDir, conductorHome, "/conductor start backend");
    expect(created).toContain("created worker backend");

    const resumed = runPiConductorCommand(repoDir, conductorHome, "/conductor resume backend");
    expect(resumed).toContain("resumed worker backend");

    const status = runPiConductorCommand(repoDir, conductorHome, "/conductor status");
    expect(status).toContain("workers: 1");
    expect(status).toContain("backend");
    expect(status).toContain("runtime=session_manager");
    expect(status).toContain("lastResumedAt=");
    expect(status).toContain("worktree=");
    expect(status).toContain("session=");
  });

  it("summarizes and cleans up a worker through the real pi CLI", () => {
    const created = runPiConductorCommand(repoDir, conductorHome, "/conductor start backend");
    expect(created).toContain("created worker backend");

    const summarized = runPiConductorCommand(repoDir, conductorHome, "/conductor summarize backend");
    expect(summarized).toContain("refreshed summary for backend");

    const statusWithSummary = runPiConductorCommand(repoDir, conductorHome, "/conductor status");
    expect(statusWithSummary).toContain("summary=fresh:");

    const cleanedUp = runPiConductorCommand(repoDir, conductorHome, "/conductor cleanup backend");
    expect(cleanedUp).toContain("removed worker backend");

    const finalStatus = runPiConductorCommand(repoDir, conductorHome, "/conductor status");
    expect(finalStatus).toContain("workers: 0");
  });
});

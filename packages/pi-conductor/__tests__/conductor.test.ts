import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerForRepo, getOrCreateRunForRepo } from "../extensions/conductor.js";

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe("conductor service", () => {
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

  it("creates and persists an empty run for a repo", () => {
    const run = getOrCreateRunForRepo(repoDir);
    expect(run.repoRoot).toBe(repoDir);
    expect(run.workers).toEqual([]);
    expect(readFileSync(join(run.storageDir, "run.json"), "utf-8")).toContain("projectKey");
  });

  it("creates a worker, worktree, and persisted worker record", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const worktreePath = requireValue(worker.worktreePath, "worker worktree missing");
    const sessionFile = requireValue(worker.sessionFile, "worker session file missing");
    expect(worker.name).toBe("backend");
    expect(worker.branch).toBe("conductor/backend");
    expect(worker.worktreePath).toBeTruthy();
    expect(existsSync(worktreePath)).toBe(true);
    expect(worker.sessionFile).toBeTruthy();
    expect(existsSync(sessionFile)).toBe(true);
    expect(worker.runtime.backend).toBe("session_manager");
    expect(worker.runtime.sessionId).toBeTruthy();

    const run = getOrCreateRunForRepo(repoDir);
    expect(run.workers).toHaveLength(1);
    expect(run.workers[0]?.name).toBe("backend");
    expect(run.workers[0]?.sessionFile).toBeTruthy();
    expect(run.workers[0]?.runtime.sessionId).toBeTruthy();
  });
});

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkerForRepo,
  getOrCreateRunForRepo,
  recoverWorkerForRepo,
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
    const resumed = await resumeWorkerForRepo(repoDir, "backend");
    expect(resumed.workerId).toBe(created.workerId);
    expect(resumed.worktreePath).toBe(created.worktreePath);
    expect(resumed.sessionFile).toBe(created.sessionFile);
    expect(resumed.runtime.sessionId).toBe(created.runtime.sessionId);
    expect(resumed.runtime.lastResumedAt).toBeTruthy();
  });

  it("updates a worker lifecycle to blocked, ready_for_pr, and done", async () => {
    await createWorkerForRepo(repoDir, "backend");
    expect(updateWorkerLifecycleForRepo(repoDir, "backend", "blocked").lifecycle).toBe("blocked");
    expect(updateWorkerLifecycleForRepo(repoDir, "backend", "ready_for_pr").lifecycle).toBe("ready_for_pr");
    expect(updateWorkerLifecycleForRepo(repoDir, "backend", "done").lifecycle).toBe("done");
    expect(getOrCreateRunForRepo(repoDir).workers[0]?.lifecycle).toBe("done");
  });

  it("preserves interrupted lastRun metadata when lifecycle is manually reset or recovered", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const run = getOrCreateRunForRepo(repoDir);
    const existingWorker = run.workers[0];
    if (!existingWorker) {
      throw new Error("expected worker to exist");
    }
    run.workers[0] = {
      ...existingWorker,
      lifecycle: "running",
      lastRun: {
        task: "half finished task",
        status: null,
        startedAt: "2026-04-21T00:00:00.000Z",
        finishedAt: null,
        errorMessage: null,
        sessionId: "run-session-stuck",
      },
    };

    const { writeRun } = await import("../extensions/storage.js");
    writeRun(run);

    const reset = updateWorkerLifecycleForRepo(repoDir, "backend", "idle");
    expect(reset.lifecycle).toBe("idle");
    expect(reset.lastRun?.finishedAt).toBeNull();
    expect(reset.lastRun?.status).toBeNull();
    expect(reset.lastRun?.sessionId).toBe("run-session-stuck");

    if (worker.sessionFile && existsSync(worker.sessionFile)) {
      rmSync(worker.sessionFile, { force: true });
    }
    const recovered = await recoverWorkerForRepo(repoDir, "backend");
    expect(recovered.lifecycle).toBe("idle");
    expect(recovered.lastRun?.finishedAt).toBeNull();
    expect(recovered.lastRun?.status).toBeNull();
    expect(recovered.lastRun?.sessionId).toBe("run-session-stuck");
  });
});

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { recordRuntimeMetadataForRun } from "../extensions/runtime-artifacts.js";
import { cancelTaskRunForRepo as cancelTaskRunStateForRepo } from "../extensions/task-service.js";

describe("runtime artifact metadata merging", () => {
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
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not let stale running runtime metadata overwrite terminal cancellation cleanup", async () => {
    const worker = await createWorkerForRepo(repoDir, "runtime-worker");
    const task = createTaskForRepo(repoDir, { title: "Race", prompt: "Run" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    const canceled = cancelTaskRunStateForRepo(repoDir, { runId: started.run.runId, reason: "stop" });

    const merged = recordRuntimeMetadataForRun({
      run: canceled,
      runId: started.run.runId,
      taskId: task.taskId,
      workerId: worker.workerId,
      runtimeMode: "tmux",
      metadata: { status: "running", cleanupStatus: "pending", diagnostics: ["late pane metadata"] },
    });

    expect(merged.runs[0]).toMatchObject({
      status: "aborted",
      runtime: { status: "aborted", cleanupStatus: "not_required" },
    });
    expect(merged.runs[0]?.runtime.diagnostics).toContain("late pane metadata");
  });
});

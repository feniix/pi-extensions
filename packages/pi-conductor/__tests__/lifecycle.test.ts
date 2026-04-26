import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  recordTaskCompletionForRepo,
  startTaskRunForRepo,
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

  it("emits lifecycle events for implicit durable task run transitions", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Durable task", prompt: "Implement a durable task" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    recordTaskCompletionForRepo(repoDir, {
      runId: started.run.runId,
      taskId: task.taskId,
      status: "succeeded",
      completionSummary: "done",
    });

    const lifecycleEvents = getOrCreateRunForRepo(repoDir).events.filter(
      (event) => event.type === "worker.lifecycle_changed",
    );
    expect(lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceRefs: expect.objectContaining({ workerId: worker.workerId }),
          payload: expect.objectContaining({ previousLifecycle: "idle", lifecycle: "running", name: "backend" }),
        }),
        expect.objectContaining({
          resourceRefs: expect.objectContaining({ workerId: worker.workerId }),
          payload: expect.objectContaining({ previousLifecycle: "running", lifecycle: "idle", name: "backend" }),
        }),
      ]),
    );
  });
});

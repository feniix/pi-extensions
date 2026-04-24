import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignTaskForRepo,
  createTaskForRepo,
  dispatchTaskRunForRepo,
  getOrCreateRunForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("conductor backend dispatch wrapper", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  function addWorker() {
    writeFileSync(join(repoRoot, "session.jsonl"), "", "utf-8");
    const run = getOrCreateRunForRepo(repoRoot);
    const now = new Date().toISOString();
    writeRun({
      ...run,
      workers: [
        {
          workerId: "worker-1",
          name: "worker",
          branch: null,
          worktreePath: repoRoot,
          sessionFile: join(repoRoot, "session.jsonl"),
          runtime: { backend: "session_manager", sessionId: null, lastResumedAt: null },
          currentTask: null,
          lifecycle: "idle",
          recoverable: false,
          lastRun: null,
          summary: { text: null, updatedAt: null, stale: false },
          pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }

  it("dispatches pi-subagents runs through an injected dispatcher", async () => {
    addWorker();
    const task = createTaskForRepo(repoRoot, { title: "Dispatch", prompt: "Run externally" });
    assignTaskForRepo(repoRoot, task.taskId, "worker-1");

    const result = await dispatchTaskRunForRepo(repoRoot, {
      taskId: task.taskId,
      backend: "pi-subagents",
      resolvePackage: () => "/tmp/pi-subagents/package.json",
      dispatcher: async () => ({ ok: true, backendRunId: "sub-run-1", diagnostic: null }),
    });

    expect(result.run).toMatchObject({ backend: "pi-subagents", backendRunId: "sub-run-1", status: "running" });
    expect(getOrCreateRunForRepo(repoRoot).events.at(-1)).toMatchObject({
      type: "external_operation.succeeded",
      resourceRefs: { taskId: task.taskId, workerId: "worker-1", runId: result.run.runId },
      payload: { operation: "dispatch_task_run", backend: "pi-subagents", dispatchBackendRunId: "sub-run-1" },
    });
  });
});

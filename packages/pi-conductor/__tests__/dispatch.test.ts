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
          lifecycle: "idle",
          recoverable: false,
          pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }

  it("marks a started pi-subagents run failed when dispatcher throws", async () => {
    addWorker();
    const task = createTaskForRepo(repoRoot, { title: "Dispatch failure", prompt: "Run externally" });
    assignTaskForRepo(repoRoot, task.taskId, "worker-1");

    await expect(
      dispatchTaskRunForRepo(repoRoot, {
        taskId: task.taskId,
        backend: "pi-subagents",
        resolvePackage: () => "/tmp/pi-subagents/package.json",
        dispatcher: async () => {
          throw new Error("transport exploded");
        },
      }),
    ).rejects.toThrow(/transport exploded/i);

    const persisted = getOrCreateRunForRepo(repoRoot);
    expect(persisted.tasks[0]).toMatchObject({ state: "failed", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "failed", completionSummary: "transport exploded" });
    expect(persisted.events.map((event) => event.type)).toContain("backend.dispatch_failed");
  });

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
      type: "backend.dispatch_succeeded",
      resourceRefs: { taskId: task.taskId, workerId: "worker-1", runId: result.run.runId },
      payload: { operation: "dispatch_task_run", backend: "pi-subagents", dispatchBackendRunId: "sub-run-1" },
    });
  });
});

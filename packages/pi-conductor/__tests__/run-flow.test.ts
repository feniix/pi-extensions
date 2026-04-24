import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  preflightWorkerRunRuntime: vi.fn(),
  runWorkerPromptRuntime: vi.fn(),
}));

vi.mock("../extensions/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/runtime.js")>();
  return {
    ...actual,
    preflightWorkerRunRuntime: runtimeMocks.preflightWorkerRunRuntime,
    runWorkerPromptRuntime: runtimeMocks.runWorkerPromptRuntime,
  };
});

import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  runTaskForRepo,
  runWorkerForRepo,
  updateWorkerLifecycleForRepo,
  updateWorkerTaskForRepo,
} from "../extensions/conductor.js";

describe("worker run flows", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.preflightWorkerRunRuntime.mockResolvedValue(undefined);
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValue({
      status: "success",
      finalText: "implemented status output",
      errorMessage: null,
      sessionId: "run-session-1",
    });

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

  it("runs a task in an existing worker session lineage and records success metadata", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    updateWorkerTaskForRepo(repoDir, "backend", "old task");

    const result = await runWorkerForRepo(repoDir, "backend", "implement status output");

    expect(result).toMatchObject({
      workerName: "backend",
      status: "success",
      finalText: "implemented status output",
    });
    expect(runtimeMocks.preflightWorkerRunRuntime).toHaveBeenCalledWith({
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
    });
    expect(runtimeMocks.runWorkerPromptRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: worker.worktreePath,
        sessionFile: worker.sessionFile,
        task: "implement status output",
      }),
    );

    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.currentTask).toBe("implement status output");
    expect(persisted?.lastRun).toMatchObject({
      task: "implement status output",
      status: "success",
      errorMessage: null,
      sessionId: "run-session-1",
    });
  });

  it("runs a durable assigned task with scoped child progress and completion", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Durable task", prompt: "Implement the durable flow" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(
      async ({ taskContract, onConductorProgress, onConductorComplete }) => {
        expect(taskContract).toMatchObject({ taskId: task.taskId, goal: "Implement the durable flow" });
        await onConductorProgress?.({
          runId: taskContract.runId,
          taskId: task.taskId,
          progress: "halfway",
          artifact: { type: "log", ref: "progress://halfway" },
        });
        await onConductorComplete?.({
          runId: taskContract.runId,
          taskId: task.taskId,
          status: "succeeded",
          completionSummary: "done with evidence",
          artifact: { type: "completion_report", ref: "completion://done" },
        });
        return { status: "success", finalText: "done", errorMessage: null, sessionId: "run-session-durable" };
      },
    );

    const result = await runTaskForRepo(repoDir, task.taskId);

    expect(result.status).toBe("success");
    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "completed", latestProgress: "halfway", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "succeeded", completionSummary: "done with evidence" });
    expect(persisted.artifacts.map((artifact) => artifact.type)).toEqual(["log", "completion_report"]);
    expect(persisted.events.map((event) => event.type)).toContain("run.progress_reported");
    expect(persisted.events.map((event) => event.type)).toContain("run.completed");
  });

  it("requires review when a durable task run exits without explicit child completion", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Review task", prompt: "Do work" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValueOnce({
      status: "success",
      finalText: "I think it is done",
      errorMessage: null,
      sessionId: "run-session-review",
    });

    await runTaskForRepo(repoDir, task.taskId);

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks[0]).toMatchObject({ state: "needs_review", activeRunId: null });
    expect(persisted.runs[0]).toMatchObject({ status: "partial", completionSummary: "I think it is done" });
    expect(persisted.gates[0]).toMatchObject({ type: "needs_review", status: "open" });
  });

  it("fails fast on preflight without mutating currentTask or lifecycle", async () => {
    await createWorkerForRepo(repoDir, "backend");
    updateWorkerTaskForRepo(repoDir, "backend", "old task");
    runtimeMocks.preflightWorkerRunRuntime.mockRejectedValueOnce(new Error("No usable model configured"));

    await expect(runWorkerForRepo(repoDir, "backend", "new task")).rejects.toThrow("No usable model configured");

    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.currentTask).toBe("old task");
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.lastRun).toBeNull();
    expect(runtimeMocks.runWorkerPromptRuntime).not.toHaveBeenCalled();
  });

  it("persists the execution session id as soon as the runtime session is created", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(async ({ onSessionReady }) => {
      await onSessionReady?.("run-session-early");
      const duringRun = getOrCreateRunForRepo(repoDir).workers[0];
      expect(duringRun?.lifecycle).toBe("running");
      expect(duringRun?.lastRun?.finishedAt).toBeNull();
      expect(duringRun?.lastRun?.sessionId).toBe("run-session-early");
      return {
        status: "success",
        finalText: "done",
        errorMessage: null,
        sessionId: "run-session-early",
      };
    });

    await runWorkerForRepo(repoDir, "backend", "record session id early");
  });

  it("does not drop concurrent conductor state when persisting early session id", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(async ({ onSessionReady }) => {
      const concurrentTask = createTaskForRepo(repoDir, {
        title: "Concurrent task",
        prompt: "Preserve this task while recording session id",
      });

      await onSessionReady?.("run-session-early");

      const duringRun = getOrCreateRunForRepo(repoDir);
      expect(duringRun.tasks.some((entry) => entry.taskId === concurrentTask.taskId)).toBe(true);
      expect(duringRun.workers[0]?.lastRun?.sessionId).toBe("run-session-early");

      return { status: "success", finalText: "done", errorMessage: null, sessionId: "run-session-early" };
    });

    await runWorkerForRepo(repoDir, "backend", "record session id without stale write");

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks).toHaveLength(1);
    expect(persisted.tasks[0]?.title).toBe("Concurrent task");
  });

  it("does not drop conductor state added while finishing a worker run", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(async () => {
      const concurrentTask = createTaskForRepo(repoDir, {
        title: "Runtime-added task",
        prompt: "Preserve this task when finishing worker run",
      });

      expect(getOrCreateRunForRepo(repoDir).tasks.some((entry) => entry.taskId === concurrentTask.taskId)).toBe(true);
      return { status: "success", finalText: "done", errorMessage: null, sessionId: "run-session-finish" };
    });

    await runWorkerForRepo(repoDir, "backend", "finish without stale write");

    const persisted = getOrCreateRunForRepo(repoDir);
    expect(persisted.tasks).toHaveLength(1);
    expect(persisted.tasks[0]?.title).toBe("Runtime-added task");
    expect(persisted.workers[0]?.lastRun).toMatchObject({ status: "success", sessionId: "run-session-finish" });
  });

  it("marks errored runs blocked and persists the run error message", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValueOnce({
      status: "error",
      finalText: null,
      errorMessage: "model crashed",
      sessionId: "run-session-2",
    });

    const result = await runWorkerForRepo(repoDir, "backend", "dangerous task");

    expect(result.status).toBe("error");
    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("blocked");
    expect(persisted?.lastRun).toMatchObject({
      status: "error",
      errorMessage: "model crashed",
      sessionId: "run-session-2",
    });
  });

  it("returns aborted runs to idle and preserves aborted metadata", async () => {
    await createWorkerForRepo(repoDir, "backend");
    runtimeMocks.runWorkerPromptRuntime.mockResolvedValueOnce({
      status: "aborted",
      finalText: "stopped early",
      errorMessage: null,
      sessionId: "run-session-3",
    });

    const result = await runWorkerForRepo(repoDir, "backend", "abortable task");

    expect(result.status).toBe("aborted");
    const persisted = getOrCreateRunForRepo(repoDir).workers[0];
    expect(persisted?.lifecycle).toBe("idle");
    expect(persisted?.lastRun).toMatchObject({
      task: "abortable task",
      status: "aborted",
      sessionId: "run-session-3",
    });
  });

  it("rejects already running workers and workers with missing session files", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    updateWorkerLifecycleForRepo(repoDir, "backend", "running");
    await expect(runWorkerForRepo(repoDir, "backend", "task")).rejects.toThrow(/already running/i);

    updateWorkerLifecycleForRepo(repoDir, "backend", "idle");
    if (worker.sessionFile) {
      unlinkSync(worker.sessionFile);
    }
    await expect(runWorkerForRepo(repoDir, "backend", "task")).rejects.toThrow(/recover the worker first/i);
  });
});

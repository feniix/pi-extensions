import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    getWorkerRunRuntimeBackend: vi.fn((mode = "headless") => {
      if (mode !== "headless") throw new Error(`${mode} runtime is not implemented yet`);
      return {
        mode,
        preflight: runtimeMocks.preflightWorkerRunRuntime,
        run: runtimeMocks.runWorkerPromptRuntime,
      };
    }),
  };
});

import {
  assignTaskForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  runTaskForRepo,
} from "../extensions/conductor.js";

describe("durable task run flows", () => {
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

  it("forwards cancellation signals from tool callers into the worker runtime", async () => {
    const worker = await createWorkerForRepo(repoDir, "backend");
    const task = createTaskForRepo(repoDir, { title: "Cancelable task", prompt: "Do cancellable work" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);

    const controller = new AbortController();
    let runtimeSignal: AbortSignal | undefined;
    runtimeMocks.runWorkerPromptRuntime.mockImplementationOnce(async (input) => {
      runtimeSignal = input.signal;
      expect(runtimeSignal).not.toBe(controller.signal);
      expect(runtimeSignal?.aborted).toBe(false);
      controller.abort();
      expect(runtimeSignal?.aborted).toBe(true);
      return { status: "success", finalText: "done", errorMessage: null, sessionId: "run-session-cancelable" };
    });

    await runTaskForRepo(repoDir, task.taskId, controller.signal);

    expect(runtimeMocks.runWorkerPromptRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "Do cancellable work",
        worktreePath: worker.worktreePath,
        sessionFile: worker.sessionFile,
      }),
    );
    expect(runtimeSignal?.aborted).toBe(true);
  });
});

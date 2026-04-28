import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CancelTmuxResult = { cleanupStatus: "succeeded" | "failed"; diagnostic: string | null };

const tmuxMocks = vi.hoisted(() => ({
  cancelTmuxRuntime: vi.fn(
    async (): Promise<CancelTmuxResult> => ({
      cleanupStatus: "succeeded",
      diagnostic: "killed detached tmux",
    }),
  ),
}));

vi.mock("../extensions/tmux-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/tmux-runtime.js")>();
  return { ...actual, cancelTmuxRuntime: tmuxMocks.cancelTmuxRuntime };
});

import {
  assignTaskForRepo,
  cancelActiveWorkForRepo,
  cancelActiveWorkForRepoWithRuntimeCleanup,
  cancelTaskRunForRepo,
  cancelTaskRunForRepoWithRuntimeCleanup,
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  runParallelWorkForRepo,
  startTaskRunForRepo,
} from "../extensions/conductor.js";
import { cleanupCanceledTmuxRunForRepo } from "../extensions/runtime-cancel.js";
import { writeRun } from "../extensions/storage.js";

describe("tmux durable cancellation", () => {
  let repoDir: string;
  let conductorHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function createPersistedTmuxRun(runtimeMode: "tmux" | "iterm-tmux" = "tmux") {
    const worker = await createWorkerForRepo(repoDir, "tmux-worker");
    const task = createTaskForRepo(repoDir, { title: "Detached tmux", prompt: "Run visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId });
    const project = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...project,
      runs: project.runs.map((run) =>
        run.runId === started.run.runId
          ? {
              ...run,
              runtime: {
                ...run.runtime,
                mode: runtimeMode,
                cleanupStatus: "pending",
                tmux: { socketPath: "/tmp/tmux.sock", sessionName: "detached", windowId: "@1", paneId: "%2" },
              },
            }
          : run,
      ),
    });
    return started;
  }

  it("keeps the exported cancel helper synchronous for existing callers", async () => {
    const started = await createPersistedTmuxRun();

    const canceled = cancelTaskRunForRepo(repoDir, { runId: started.run.runId, reason: "sync caller" });

    expect(canceled).not.toHaveProperty("then");
    expect(canceled.runs[0]).toMatchObject({ status: "aborted" });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
  });

  it("releases workers when cancellation wins before launch metadata exists", async () => {
    const worker = await createWorkerForRepo(repoDir, "prelaunch-worker");
    const task = createTaskForRepo(repoDir, { title: "Prelaunch", prompt: "Run visibly" });
    assignTaskForRepo(repoDir, task.taskId, worker.workerId);
    const started = startTaskRunForRepo(repoDir, { taskId: task.taskId, runtimeMode: "tmux" });

    const canceled = await cancelTaskRunForRepoWithRuntimeCleanup(repoDir, {
      runId: started.run.runId,
      reason: "cancel before launch metadata",
    });

    expect(canceled.runs[0]).toMatchObject({ runtime: { cleanupStatus: "succeeded" } });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("releases workers when cleanup proves a starting session is absent", async () => {
    tmuxMocks.cancelTmuxRuntime.mockResolvedValueOnce({
      cleanupStatus: "succeeded" as const,
      diagnostic: "tmux session starting already absent",
    });
    const started = await createPersistedTmuxRun();
    const project = getOrCreateRunForRepo(repoDir);
    writeRun({
      ...project,
      runs: project.runs.map((run) =>
        run.runId === started.run.runId
          ? { ...run, runtime: { ...run.runtime, status: "starting", cleanupStatus: "pending" } }
          : run,
      ),
    });

    const canceled = await cancelTaskRunForRepoWithRuntimeCleanup(repoDir, {
      runId: started.run.runId,
      reason: "cancel during tmux start",
    });

    expect(canceled.workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("kills persisted tmux runtime resources when no live abort handle exists", async () => {
    const started = await createPersistedTmuxRun();

    const canceled = await cancelTaskRunForRepoWithRuntimeCleanup(repoDir, {
      runId: started.run.runId,
      reason: "stop detached",
    });

    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: expect.objectContaining({ mode: "tmux" }) }),
    );
    expect(canceled.runs[0]).toMatchObject({
      status: "aborted",
      runtime: { cleanupStatus: "succeeded", diagnostics: expect.arrayContaining(["killed detached tmux"]) },
    });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("kills persisted iterm-tmux runtime resources when no live abort handle exists", async () => {
    const started = await createPersistedTmuxRun("iterm-tmux");

    const canceled = await cancelTaskRunForRepoWithRuntimeCleanup(repoDir, {
      runId: started.run.runId,
      reason: "stop detached viewer run",
    });

    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: expect.objectContaining({ mode: "iterm-tmux" }) }),
    );
    expect(canceled.runs[0]).toMatchObject({ status: "aborted", runtime: { cleanupStatus: "succeeded" } });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "idle", recoverable: false });
  });

  it("does not overwrite newer active worker state when async tmux cleanup finishes", async () => {
    let finishCleanup: ((result: CancelTmuxResult) => void) | undefined;
    tmuxMocks.cancelTmuxRuntime.mockImplementationOnce(
      () =>
        new Promise<CancelTmuxResult>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const started = await createPersistedTmuxRun();
    const runToClean = getOrCreateRunForRepo(repoDir).runs[0];
    if (!runToClean) throw new Error("expected tmux run to clean");
    const cleanupPromise = cleanupCanceledTmuxRunForRepo({
      repoRoot: repoDir,
      runId: started.run.runId,
      run: runToClean,
    });
    const latest = getOrCreateRunForRepo(repoDir);
    const existingTask = latest.tasks[0];
    const existingRun = latest.runs[0];
    if (!existingTask || !existingRun) throw new Error("expected existing task and run");
    const newerTask = { ...existingTask, taskId: "task-newer", activeRunId: "run-newer", runIds: ["run-newer"] };
    const newerRun = { ...existingRun, runId: "run-newer", taskId: "task-newer", status: "running" as const };
    writeRun({
      ...latest,
      tasks: [...latest.tasks, newerTask],
      runs: [...latest.runs, newerRun],
      workers: latest.workers.map((worker) =>
        worker.workerId === latest.workers[0]?.workerId
          ? { ...worker, lifecycle: "running" as const, recoverable: false }
          : worker,
      ),
    });

    finishCleanup?.({ cleanupStatus: "succeeded", diagnostic: "late cleanup" });
    const cleaned = await cleanupPromise;

    expect(cleaned.workers[0]).toMatchObject({ lifecycle: "running", recoverable: false });
    expect(cleaned.runs.find((run) => run.runId === started.run.runId)).toMatchObject({
      runtime: { cleanupStatus: "succeeded" },
    });
  });

  it("keeps workers out of the idle pool when tmux cleanup fails", async () => {
    tmuxMocks.cancelTmuxRuntime.mockResolvedValueOnce({
      cleanupStatus: "failed" as const,
      diagnostic: "pane command verification failed before cancel: zsh",
    });
    const started = await createPersistedTmuxRun();

    const canceled = await cancelTaskRunForRepoWithRuntimeCleanup(repoDir, {
      runId: started.run.runId,
      reason: "stop detached",
    });

    expect(canceled.runs[0]).toMatchObject({ runtime: { cleanupStatus: "failed" } });
    expect(canceled.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
  });

  it("keeps the exported bulk cancel helper synchronous for existing callers", async () => {
    await createPersistedTmuxRun();

    const canceled = cancelActiveWorkForRepo(repoDir, { reason: "sync bulk caller" });

    expect(canceled).not.toHaveProperty("then");
    expect(canceled.project.runs[0]).toMatchObject({ status: "aborted" });
    expect(canceled.project.workers[0]).toMatchObject({ lifecycle: "broken", recoverable: true });
  });

  it("cleans up tmux runs when parallel orchestration is aborted", async () => {
    const controller = new AbortController();

    const result = await runParallelWorkForRepo(
      repoDir,
      { tasks: [{ title: "Visible shard", prompt: "Run visibly" }], runtimeMode: "tmux" },
      controller.signal,
      async (root, taskId) => {
        const started = startTaskRunForRepo(root, { taskId, runtimeMode: "tmux" });
        const project = getOrCreateRunForRepo(root);
        writeRun({
          ...project,
          runs: project.runs.map((run) =>
            run.runId === started.run.runId
              ? {
                  ...run,
                  runtime: {
                    ...run.runtime,
                    mode: "tmux",
                    cleanupStatus: "pending",
                    tmux: { socketPath: "/tmp/tmux.sock", sessionName: "parallel", windowId: "@1", paneId: "%2" },
                  },
                }
              : run,
          ),
        });
        controller.abort();
        return {
          workerName: "parallel-worker-1",
          status: "aborted",
          finalText: null,
          errorMessage: null,
          sessionId: null,
        };
      },
    );

    expect(result.canceledRuns).toHaveLength(1);
    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledTimes(1);
    expect(getOrCreateRunForRepo(repoDir).runs[0]).toMatchObject({ runtime: { cleanupStatus: "succeeded" } });
  });

  it("kills persisted tmux runtime resources during bulk active-work cancellation", async () => {
    await createPersistedTmuxRun();

    const canceled = await cancelActiveWorkForRepoWithRuntimeCleanup(repoDir, { reason: "stop all detached" });

    expect(tmuxMocks.cancelTmuxRuntime).toHaveBeenCalledTimes(1);
    expect(canceled.project.runs[0]).toMatchObject({
      status: "aborted",
      runtime: { cleanupStatus: "succeeded", diagnostics: expect.arrayContaining(["killed detached tmux"]) },
    });
  });
});

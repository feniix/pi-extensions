import { describe, expect, it } from "vitest";
import { createRunRuntimeMetadata } from "../extensions/runtime-metadata.js";
import { formatRunStatus } from "../extensions/status.js";
import {
  addTask,
  addWorker,
  assignTaskToWorker,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
  startTaskRun,
} from "../extensions/storage.js";
import type {
  RunRecord,
  RunRuntimeCleanupStatus,
  RunRuntimeStatus,
  RunRuntimeViewerStatus,
  RunStatus,
} from "../extensions/types.js";

function createVisibleStatusRun(input: {
  runStatus: RunStatus;
  runtimeStatus: RunRuntimeStatus;
  viewerStatus: RunRuntimeViewerStatus;
  cleanupStatus?: RunRuntimeCleanupStatus;
  diagnostic: string;
  finished?: boolean;
}): RunRecord {
  const run = createEmptyRun("abc", "/tmp/repo");
  const worker = createWorkerRecord({
    workerId: "worker-1",
    name: "backend",
    branch: "conductor/backend",
    worktreePath: "/tmp/repo/.worktrees/backend",
    sessionFile: "/tmp/session.jsonl",
  });
  const task = createTaskRecord({ taskId: "task-1", title: "Add ledger", prompt: "Implement tasks" });
  const withRun = startTaskRun(
    assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
    {
      runId: "run-1",
      taskId: task.taskId,
      workerId: worker.workerId,
      backend: "native",
      runtimeMode: "iterm-tmux",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    },
  );
  return {
    ...withRun,
    tasks: withRun.tasks.map((entry) =>
      entry.taskId === task.taskId ? { ...entry, latestProgress: "editing files" } : entry,
    ),
    runs: withRun.runs.map((entry) =>
      entry.runId === "run-1"
        ? {
            ...entry,
            status: input.runStatus,
            finishedAt: input.finished ? "2026-04-24T00:01:00.000Z" : null,
            runtime: {
              ...createRunRuntimeMetadata({ mode: "iterm-tmux", status: input.runtimeStatus }),
              viewerStatus: input.viewerStatus,
              viewerCommand: "tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'",
              logPath: "/tmp/pi-conductor/runtime/run-1/runner.log",
              heartbeatAt: "2026-04-24T00:00:00.000Z",
              cleanupStatus: input.cleanupStatus ?? "pending",
              diagnostics: [input.diagnostic],
            },
          }
        : entry,
    ),
  };
}

describe("formatRunStatus", () => {
  it("formats an empty run", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const text = formatRunStatus(run);
    expect(text).toContain("projectKey: abc");
    expect(text).toContain("workers: 0");
    expect(text).toContain("tasks: 0");
    expect(text).toContain("runs: 0");
    expect(text).toContain("events: 0");
    expect(text).toContain("visibleRuns: none active");
  });

  it("includes concise durable task resource status", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add ledger", prompt: "Implement tasks" });
    const withTask = assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId);

    const text = formatRunStatus(withTask);

    expect(text).toContain("tasks: 1");
    expect(text).toContain("events: 3");
    expect(text).toContain(
      "- task Add ledger [task-1] state=assigned assignedWorker=worker-1 activeRun=none latestProgress=none",
    );
  });

  it("includes run runtime metadata", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add ledger", prompt: "Implement tasks" });
    const withRun = startTaskRun(
      assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
      {
        runId: "run-1",
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "native",
        leaseExpiresAt: "2026-04-24T01:00:00.000Z",
      },
    );

    const text = formatRunStatus(withRun);

    expect(text).toContain("- run run-1 task=task-1 worker=worker-1 status=running backend=native");
    expect(text).toContain("runtimeMode=headless runtimeStatus=running viewer=not_applicable cleanup=not_required");
  });

  it("surfaces supervised runtime viewer and cancellation guidance", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const task = createTaskRecord({ taskId: "task-1", title: "Add ledger", prompt: "Implement tasks" });
    const withRun = startTaskRun(
      assignTaskToWorker(addTask(addWorker(run, worker), task), task.taskId, worker.workerId),
      {
        runId: "run-1",
        taskId: task.taskId,
        workerId: worker.workerId,
        backend: "native",
        runtimeMode: "iterm-tmux",
        leaseExpiresAt: "2026-04-24T01:00:00.000Z",
      },
    );
    const withRuntime = {
      ...withRun,
      tasks: withRun.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, latestProgress: "editing files" } : entry,
      ),
      runs: withRun.runs.map((entry) =>
        entry.runId === "run-1"
          ? {
              ...entry,
              runtime: {
                ...createRunRuntimeMetadata({ mode: "iterm-tmux", status: "running" }),
                viewerStatus: "warning" as const,
                viewerCommand: "tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'",
                logPath: "/tmp/pi-conductor/runtime/run-1/runner.log",
                heartbeatAt: "2026-04-24T00:00:00.000Z",
                diagnostics: ["iTerm2 viewer launch failed; attach manually with the tmux command"],
              },
            }
          : entry,
      ),
    };

    const text = formatRunStatus(withRuntime);

    expect(text).toContain("visibleRuns: 1 active");
    expect(text).toContain("latestProgress=editing files");
    expect(text).toContain("viewer=warning");
    expect(text).toContain("viewerCommand=tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'");
    expect(text).toContain("log=/tmp/pi-conductor/runtime/run-1/runner.log");
    expect(text).toContain('cancel=conductor_cancel_task_run({"runId":"run-1","reason":"<reason>"})');
  });

  it.each([
    {
      name: "starting",
      runStatus: "starting" as const,
      runtimeStatus: "starting" as const,
      viewerStatus: "pending" as const,
      diagnostic: "tmux session pi-cond-run prepared",
      visibleRuns: "visibleRuns: 1 active",
      cancel: true,
    },
    {
      name: "running/viewable",
      runStatus: "running" as const,
      runtimeStatus: "running" as const,
      viewerStatus: "opened" as const,
      diagnostic: "iTerm2 viewer opened",
      visibleRuns: "visibleRuns: 1 active",
      cancel: true,
    },
    {
      name: "running/no viewer",
      runStatus: "running" as const,
      runtimeStatus: "running" as const,
      viewerStatus: "warning" as const,
      diagnostic: "iTerm2 viewer launch failed; attach manually with the tmux command",
      visibleRuns: "visibleRuns: 1 active",
      cancel: true,
    },
    {
      name: "missing session",
      runStatus: "stale" as const,
      runtimeStatus: "exited_error" as const,
      viewerStatus: "warning" as const,
      diagnostic: "tmux session missing during reconciliation: can't find session",
      visibleRuns: "visibleRuns: none active",
      finished: true,
      cancel: false,
    },
    {
      name: "runner exited without completion",
      runStatus: "partial" as const,
      runtimeStatus: "exited_success" as const,
      viewerStatus: "opened" as const,
      diagnostic: "tmux runner exited after fallback completion",
      visibleRuns: "visibleRuns: none active",
      finished: true,
      cancel: false,
    },
    {
      name: "canceled",
      runStatus: "aborted" as const,
      runtimeStatus: "aborted" as const,
      viewerStatus: "opened" as const,
      cleanupStatus: "succeeded" as const,
      diagnostic: "tmux session cleanup succeeded",
      visibleRuns: "visibleRuns: none active",
      finished: true,
      cancel: false,
    },
    {
      name: "cleanup failed",
      runStatus: "aborted" as const,
      runtimeStatus: "aborted" as const,
      viewerStatus: "opened" as const,
      cleanupStatus: "failed" as const,
      diagnostic: "tmux pane command verification failed before cancel: zsh",
      visibleRuns: "visibleRuns: none active",
      finished: true,
      cancel: false,
    },
  ])("covers visible runtime status table state: $name", (state) => {
    const text = formatRunStatus(createVisibleStatusRun(state));

    expect(text).toContain(state.visibleRuns);
    expect(text).toContain(`status=${state.runStatus}`);
    expect(text).toContain(`runtimeStatus=${state.runtimeStatus}`);
    expect(text).toContain(`viewer=${state.viewerStatus}`);
    expect(text).toContain("viewerCommand=tmux -S '/tmp/tmux.sock' attach-session -r -t 'pi-cond-run'");
    expect(text).toContain("log=/tmp/pi-conductor/runtime/run-1/runner.log");
    expect(text).toContain("latestProgress=editing files");
    expect(text).toContain(`diagnostic=${state.diagnostic}`);
    if (state.cleanupStatus) {
      expect(text).toContain(`cleanup=${state.cleanupStatus}`);
    }
    const cancelCommand = 'cancel=conductor_cancel_task_run({"runId":"run-1","reason":"<reason>"})';
    if (state.cancel) {
      expect(text).toContain(cancelCommand);
    } else {
      expect(text).not.toContain(cancelCommand);
    }
  });

  it("includes worker runtime and PR state", () => {
    const run = createEmptyRun("abc", "/tmp/repo");
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/tmp/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    worker.pr.url = "https://github.com/example/repo/pull/123";
    worker.runtime.sessionId = "session-123";
    worker.runtime.lastResumedAt = "2026-04-20T00:00:00.000Z";

    worker.pr.commitSucceeded = true;
    worker.pr.pushSucceeded = true;
    worker.pr.prCreationAttempted = true;

    const text = formatRunStatus({ ...run, workers: [worker] });
    expect(text).toContain("health=healthy");
    expect(text).toContain("worktree=/tmp/repo/.worktrees/backend");
    expect(text).toContain("session=/tmp/session.jsonl");
    expect(text).toContain("runtime=session_manager");
    expect(text).toContain("sessionId=session-123");
    expect(text).toContain("lastResumedAt=2026-04-20T00:00:00.000Z");
    expect(text).toContain("pr=https://github.com/example/repo/pull/123");
    expect(text).toContain("commit=true");
    expect(text).toContain("push=true");
    expect(text).toContain("prAttempted=true");
    expect(text).toContain("recoverable=false");
  });
});

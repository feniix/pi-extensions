import { getOrCreateRunForRepo } from "./repo-run.js";
import { isTerminalRunStatus } from "./run-status.js";
import type { RunAttemptRecord, RunRuntimeMetadata, RunRuntimeMode } from "./types.js";

export type RunWorkRuntimeSummary = {
  taskId: string;
  runId: string;
  status: RunAttemptRecord["status"];
  runtimeMode: RunRuntimeMode;
  runtimeStatus: RunRuntimeMetadata["status"];
  viewerStatus: RunRuntimeMetadata["viewerStatus"];
  viewerCommand: string | null;
  logPath: string | null;
  diagnostic: string | null;
  latestProgress: string | null;
  cancelCommand: string | null;
  cancelTool: {
    name: "conductor_cancel_task_run";
    params: { runId: string; reason: string };
  } | null;
};

export function summarizeRunWorkRuntime(repoRoot: string, taskIds: string[]): RunWorkRuntimeSummary[] {
  const run = getOrCreateRunForRepo(repoRoot);
  const taskIdSet = new Set(taskIds);
  return run.runs
    .filter((attempt) => taskIdSet.has(attempt.taskId))
    .map((attempt) => {
      const task = run.tasks.find((entry) => entry.taskId === attempt.taskId);
      const isActive = !attempt.finishedAt && !isTerminalRunStatus(attempt.status);
      return {
        taskId: attempt.taskId,
        runId: attempt.runId,
        status: attempt.status,
        runtimeMode: attempt.runtime.mode,
        runtimeStatus: attempt.runtime.status,
        viewerStatus: attempt.runtime.viewerStatus,
        viewerCommand: attempt.runtime.viewerCommand,
        logPath: attempt.runtime.logPath,
        diagnostic: attempt.runtime.diagnostics.at(-1) ?? null,
        latestProgress: task?.latestProgress ?? null,
        cancelCommand: isActive
          ? `conductor_cancel_task_run({"runId":"${attempt.runId}","reason":"Parent requested cancellation"})`
          : null,
        cancelTool: isActive
          ? {
              name: "conductor_cancel_task_run",
              params: { runId: attempt.runId, reason: "Parent requested cancellation" },
            }
          : null,
      };
    });
}

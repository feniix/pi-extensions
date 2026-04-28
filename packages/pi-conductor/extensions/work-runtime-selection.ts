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
};

function hasExecutionIntent(request: string): boolean {
  return /\b(run|start|execute|launch|do|implement|fix|build|ship|create|work on)\b/i.test(request);
}

function hasStatusOnlyIntent(request: string): boolean {
  return (
    /\b(show|list|display|view|inspect|status)\b/i.test(request) &&
    /\b(current|active|existing|all)?\s*(workers|runs|tasks|project|status)\b/i.test(request) &&
    !hasExecutionIntent(request)
  );
}

function hasVisibleSupervisionIntent(request: string): boolean {
  return (
    hasExecutionIntent(request) &&
    /\b(show|open|watch|view|supervise|visible|viewer|terminal|pane)\b/i.test(request) &&
    /\b(worker|workers|run|runs|session|sessions|pane|panes|terminal|output|progress)\b/i.test(request)
  );
}

export function selectRuntimeModeForWork(input: {
  request: string;
  explicitRuntimeMode?: RunRuntimeMode;
}): RunRuntimeMode | undefined {
  if (input.explicitRuntimeMode) {
    return input.explicitRuntimeMode;
  }
  const request = input.request.trim();
  if (!request || hasStatusOnlyIntent(request)) {
    return undefined;
  }
  if (/\biterm(?:2)?\b|\biterm-tmux\b/i.test(request)) {
    return "iterm-tmux";
  }
  if (/\btmux\b/i.test(request)) {
    return "tmux";
  }
  return hasVisibleSupervisionIntent(request) ? "iterm-tmux" : undefined;
}

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
        cancelCommand: isActive ? `conductor_cancel_task_run({"runId":"${attempt.runId}","reason":"<reason>"})` : null,
      };
    });
}

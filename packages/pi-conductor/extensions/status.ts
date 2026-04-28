import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import { formatRunRuntimeSummary } from "./runtime-metadata.js";
import { getConductorProjectDir } from "./storage.js";
import type { RunAttemptRecord, RunRecord, WorkerRecord } from "./types.js";

function getWorkerHealth(worker: WorkerRecord): "healthy" | "broken" {
  if (worker.lifecycle === "broken") {
    return "broken";
  }
  return "healthy";
}

function isActiveRun(attempt: RunAttemptRecord): boolean {
  return !attempt.finishedAt && !isTerminalRunStatus(attempt.status);
}

function runsForStatusOutput(runs: RunAttemptRecord[]): { visible: RunAttemptRecord[]; omittedCount: number } {
  const activeRuns = runs.filter(isActiveRun);
  const recentTerminalRuns = runs.filter((attempt) => !isActiveRun(attempt)).slice(-10);
  const visibleRunIds = new Set([...activeRuns, ...recentTerminalRuns].map((attempt) => attempt.runId));
  return {
    visible: runs.filter((attempt) => visibleRunIds.has(attempt.runId)),
    omittedCount: runs.length - visibleRunIds.size,
  };
}

export function formatRunStatus(run: RunRecord): string {
  const activeVisibleRuns = run.runs.filter(
    (attempt) => isActiveRun(attempt) && isTmuxRuntimeMode(attempt.runtime.mode),
  );
  const lines = [
    `projectKey: ${run.projectKey}`,
    `repoRoot: ${run.repoRoot}`,
    `storageDir: ${getConductorProjectDir(run.projectKey)}`,
    `workers: ${run.workers.length}`,
    `tasks: ${run.tasks.length}`,
    `runs: ${run.runs.length}`,
    `gates: ${run.gates.length}`,
    `artifacts: ${run.artifacts.length}`,
    `events: ${run.events.length}`,
    `activeVisibleRuns: ${activeVisibleRuns.length === 0 ? "none" : activeVisibleRuns.length}`,
  ];

  for (const task of run.tasks) {
    lines.push(
      `- task ${task.title} [${task.taskId}] ` +
        `state=${task.state} ` +
        `assignedWorker=${task.assignedWorkerId ?? "none"} ` +
        `activeRun=${task.activeRunId ?? "none"} ` +
        `latestProgress=${task.latestProgress ?? "none"}`,
    );
  }

  const runStatusOutput = runsForStatusOutput(run.runs);
  for (const attempt of runStatusOutput.visible) {
    const cancelCommand = isActiveRun(attempt)
      ? ` cancel=conductor_cancel_task_run({"runId":"${attempt.runId}","reason":"<reason>"})`
      : "";
    lines.push(
      `- run ${attempt.runId} ` +
        `task=${attempt.taskId} ` +
        `worker=${attempt.workerId} ` +
        `status=${attempt.status} ` +
        `backend=${attempt.backend} ` +
        formatRunRuntimeSummary(attempt.runtime) +
        cancelCommand,
    );
  }
  if (runStatusOutput.omittedCount > 0) {
    lines.push(
      `- runs omitted: ${runStatusOutput.omittedCount} older terminal run(s); use conductor_list_runs for full history`,
    );
  }

  for (const worker of run.workers) {
    lines.push(
      `- ${worker.name} [${worker.workerId}] ` +
        `health=${getWorkerHealth(worker)} ` +
        `state=${worker.lifecycle} ` +
        `recoverable=${worker.recoverable} ` +
        `branch=${worker.branch ?? "none"} ` +
        `worktree=${worker.worktreePath ?? "none"} ` +
        `session=${worker.sessionFile ?? "none"} ` +
        `runtime=${worker.runtime.backend} ` +
        `sessionId=${worker.runtime.sessionId ?? "none"} ` +
        `lastResumedAt=${worker.runtime.lastResumedAt ?? "none"} ` +
        `pr=${worker.pr.url ?? "none"} ` +
        `commit=${worker.pr.commitSucceeded} ` +
        `push=${worker.pr.pushSucceeded} ` +
        `prAttempted=${worker.pr.prCreationAttempted}`,
    );
  }

  return lines.join("\n");
}

import { getConductorProjectDir } from "./storage.js";
import type { RunRecord, WorkerRecord } from "./types.js";

function getWorkerHealth(worker: WorkerRecord): "healthy" | "stale" | "broken" {
  if (worker.lifecycle === "broken") {
    return "broken";
  }
  if (worker.summary.stale || worker.lifecycle === "done") {
    return "stale";
  }
  return "healthy";
}

function formatLastRunStatus(worker: WorkerRecord): string {
  if (!worker.lastRun) {
    return "lastRun=none";
  }

  const status =
    worker.lastRun.status ??
    (worker.lifecycle === "running" && worker.lastRun.finishedAt === null ? "running" : "unknown");
  return [
    `lastRun=${status}`,
    `runTask=${worker.lastRun.task}`,
    `runSessionId=${worker.lastRun.sessionId ?? "none"}`,
    `runStartedAt=${worker.lastRun.startedAt}`,
    `runFinishedAt=${worker.lastRun.finishedAt ?? "none"}`,
    `runError=${worker.lastRun.errorMessage ?? "none"}`,
  ].join(" ");
}

export function formatRunStatus(run: RunRecord): string {
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

  for (const worker of run.workers) {
    const summary = worker.summary.text
      ? `${worker.summary.stale ? "stale" : "fresh"}: ${worker.summary.text}`
      : "none";
    lines.push(
      `- ${worker.name} [${worker.workerId}] ` +
        `health=${getWorkerHealth(worker)} ` +
        `state=${worker.lifecycle} ` +
        `recoverable=${worker.recoverable} ` +
        `task=${worker.currentTask ?? "none"} ` +
        `branch=${worker.branch ?? "none"} ` +
        `worktree=${worker.worktreePath ?? "none"} ` +
        `session=${worker.sessionFile ?? "none"} ` +
        `runtime=${worker.runtime.backend} ` +
        `sessionId=${worker.runtime.sessionId ?? "none"} ` +
        `lastResumedAt=${worker.runtime.lastResumedAt ?? "none"} ` +
        `pr=${worker.pr.url ?? "none"} ` +
        `commit=${worker.pr.commitSucceeded} ` +
        `push=${worker.pr.pushSucceeded} ` +
        `prAttempted=${worker.pr.prCreationAttempted} ` +
        `summary=${summary} ` +
        `${formatLastRunStatus(worker)}`,
    );
  }

  return lines.join("\n");
}

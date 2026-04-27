import { formatRunRuntimeSummary } from "./runtime-metadata.js";
import { getConductorProjectDir } from "./storage.js";
import type { RunRecord, WorkerRecord } from "./types.js";

function getWorkerHealth(worker: WorkerRecord): "healthy" | "broken" {
  if (worker.lifecycle === "broken") {
    return "broken";
  }
  return "healthy";
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

  for (const attempt of run.runs) {
    lines.push(
      `- run ${attempt.runId} ` +
        `task=${attempt.taskId} ` +
        `worker=${attempt.workerId} ` +
        `status=${attempt.status} ` +
        `backend=${attempt.backend} ` +
        formatRunRuntimeSummary(attempt.runtime),
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

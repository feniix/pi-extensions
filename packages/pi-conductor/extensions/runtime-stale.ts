import type { RunAttemptRecord, RunRecord, WorkerLifecycleState } from "./types.js";

export function markRunAttemptStale(input: {
  run: RunRecord;
  attempt: RunAttemptRecord;
  now: string;
  diagnostic: string;
  workerLifecycle?: WorkerLifecycleState;
  workerRecoverable?: boolean;
}): RunRecord {
  const workerLifecycle = input.workerLifecycle ?? "broken";
  const workerRecoverable = input.workerRecoverable ?? true;
  return {
    ...input.run,
    tasks: input.run.tasks.map((task) =>
      task.taskId === input.attempt.taskId && task.activeRunId === input.attempt.runId
        ? { ...task, state: "needs_review" as const, activeRunId: null, updatedAt: input.now }
        : task,
    ),
    workers: input.run.workers.map((worker) =>
      worker.workerId === input.attempt.workerId
        ? { ...worker, lifecycle: workerLifecycle, recoverable: workerRecoverable, updatedAt: input.now }
        : worker,
    ),
    runs: input.run.runs.map((entry) =>
      entry.runId === input.attempt.runId
        ? {
            ...entry,
            status: "stale" as const,
            runtime: {
              ...entry.runtime,
              status: "exited_error" as const,
              diagnostics: [...entry.runtime.diagnostics, input.diagnostic],
              finishedAt: input.now,
              cleanupStatus: entry.runtime.cleanupStatus === "pending" ? "failed" : entry.runtime.cleanupStatus,
            },
            finishedAt: input.now,
            leaseExpiresAt: null,
            errorMessage: input.diagnostic,
          }
        : entry,
    ),
    updatedAt: input.now,
  };
}

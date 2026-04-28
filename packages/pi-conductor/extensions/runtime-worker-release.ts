import { mutateRepoRunSync } from "./repo-run.js";
import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import type { RunRecord, WorkerLifecycleState } from "./types.js";

export function releaseTerminalTmuxWorkerForRepo(input: {
  repoRoot: string;
  runId: string;
  diagnostic?: string;
  cleanupStatus?: "succeeded" | "failed";
  workerLifecycle?: WorkerLifecycleState;
  workerRecoverable?: boolean;
}): RunRecord {
  const now = new Date().toISOString();
  return mutateRepoRunSync(input.repoRoot, (latest) => {
    const attempt = latest.runs.find((entry) => entry.runId === input.runId);
    if (
      !attempt ||
      !isTmuxRuntimeMode(attempt.runtime.mode) ||
      (!attempt.finishedAt && !isTerminalRunStatus(attempt.status))
    ) {
      return latest;
    }
    const effectiveCleanupStatus = input.cleanupStatus ?? attempt.runtime.cleanupStatus;
    const workerLifecycle = input.workerLifecycle ?? (effectiveCleanupStatus === "failed" ? "broken" : "idle");
    const workerRecoverable = input.workerRecoverable ?? effectiveCleanupStatus === "failed";
    const hasNewerActiveRun = latest.runs.some(
      (entry) =>
        entry.workerId === attempt.workerId &&
        entry.runId !== attempt.runId &&
        !entry.finishedAt &&
        !isTerminalRunStatus(entry.status),
    );
    return {
      ...latest,
      workers: latest.workers.map((worker) => {
        if (worker.workerId !== attempt.workerId || hasNewerActiveRun) return worker;
        return { ...worker, lifecycle: workerLifecycle, recoverable: workerRecoverable, updatedAt: now };
      }),
      runs: latest.runs.map((entry) =>
        entry.runId === attempt.runId
          ? {
              ...entry,
              runtime: {
                ...entry.runtime,
                cleanupStatus:
                  entry.runtime.cleanupStatus === "pending"
                    ? (input.cleanupStatus ?? "succeeded")
                    : entry.runtime.cleanupStatus,
                diagnostics: input.diagnostic
                  ? [...entry.runtime.diagnostics, input.diagnostic]
                  : entry.runtime.diagnostics,
              },
              updatedAt: now,
            }
          : entry,
      ),
      updatedAt: now,
    };
  });
}

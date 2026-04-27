import { execFileSync } from "node:child_process";
import type { RunAttemptRecord, RunRecord } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActiveRunAttempt(run: RunAttemptRecord): boolean {
  return !["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    run.status,
  );
}

export function reconcileTmuxRuntimeState(run: RunRecord, input: { now?: string } = {}): RunRecord {
  let current = run;
  const now = input.now ?? new Date().toISOString();
  for (const attempt of current.runs.filter(
    (entry) => isActiveRunAttempt(entry) && entry.runtime.mode === "tmux" && entry.runtime.tmux?.socketPath,
  )) {
    try {
      execFileSync(
        "tmux",
        ["-S", attempt.runtime.tmux?.socketPath ?? "", "has-session", "-t", attempt.runtime.tmux?.sessionName ?? ""],
        { stdio: "ignore", timeout: 5000 },
      );
      current = {
        ...current,
        runs: current.runs.map((entry) =>
          entry.runId === attempt.runId ? { ...entry, leaseExpiresAt: null, updatedAt: now } : entry,
        ),
        updatedAt: now,
      };
    } catch (error) {
      const diagnostic = `tmux session missing during project reconciliation: ${errorMessage(error)}`;
      current = {
        ...current,
        tasks: current.tasks.map((task) =>
          task.taskId === attempt.taskId && task.activeRunId === attempt.runId
            ? { ...task, state: "needs_review" as const, activeRunId: null, updatedAt: now }
            : task,
        ),
        workers: current.workers.map((worker) =>
          worker.workerId === attempt.workerId
            ? { ...worker, lifecycle: "broken" as const, recoverable: true, updatedAt: now }
            : worker,
        ),
        runs: current.runs.map((entry) =>
          entry.runId === attempt.runId
            ? {
                ...entry,
                status: "stale" as const,
                runtime: {
                  ...entry.runtime,
                  status: "exited_error" as const,
                  diagnostics: [...entry.runtime.diagnostics, diagnostic],
                  finishedAt: now,
                  cleanupStatus: entry.runtime.cleanupStatus === "pending" ? "failed" : entry.runtime.cleanupStatus,
                },
                finishedAt: now,
                leaseExpiresAt: null,
                errorMessage: diagnostic,
              }
            : entry,
        ),
        updatedAt: now,
      };
    }
  }
  return current;
}

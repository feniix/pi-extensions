import { mutateRepoRunSync } from "./repo-run.js";
import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import { cancelTmuxRuntime } from "./tmux-runtime.js";
import type { RunAttemptRecord, RunRecord } from "./types.js";

export async function cleanupCanceledTmuxRunForRepo(input: {
  repoRoot: string;
  runId: string;
  run: RunAttemptRecord;
}): Promise<RunRecord> {
  const cleanup = await cancelTmuxRuntime({ runtime: input.run.runtime });
  const hasLaunchMetadata = Boolean(input.run.runtime.tmux?.socketPath && input.run.runtime.tmux.sessionName);
  const cleanupOnlyProvedAbsent = /absent|missing|not found|no server|can't find/i.test(cleanup.diagnostic ?? "");
  return mutateRepoRunSync(input.repoRoot, (latest) => {
    const latestRun = latest.runs.find((entry) => entry.runId === input.runId);
    const hasNewerActiveRun = latest.runs.some(
      (entry) =>
        entry.workerId === input.run.workerId && entry.runId !== input.runId && !isTerminalRunStatus(entry.status),
    );
    const mayReleaseWorker =
      latestRun?.status === "aborted" &&
      isTmuxRuntimeMode(latestRun.runtime.mode) &&
      !hasNewerActiveRun &&
      (!hasLaunchMetadata || cleanupOnlyProvedAbsent || cleanup.cleanupStatus === "succeeded");
    return {
      ...latest,
      workers: latest.workers.map((entry) => {
        if (entry.workerId !== input.run.workerId || hasNewerActiveRun) return entry;
        return cleanup.cleanupStatus === "succeeded" && mayReleaseWorker
          ? { ...entry, lifecycle: "idle" as const, recoverable: false, updatedAt: new Date().toISOString() }
          : { ...entry, lifecycle: "broken" as const, recoverable: true, updatedAt: new Date().toISOString() };
      }),
      runs: latest.runs.map((entry) =>
        entry.runId === input.runId
          ? {
              ...entry,
              runtime: {
                ...entry.runtime,
                cleanupStatus: cleanup.cleanupStatus,
                diagnostics: cleanup.diagnostic
                  ? [...entry.runtime.diagnostics, cleanup.diagnostic]
                  : entry.runtime.diagnostics,
              },
            }
          : entry,
      ),
    };
  });
}

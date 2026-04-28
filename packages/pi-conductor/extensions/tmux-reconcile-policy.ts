import { markRunAttemptStale } from "./runtime-stale.js";
import type { RunAttemptRecord, RunRecord } from "./types.js";

export type TmuxReconciliationAction = "unchanged" | "lease_cleared" | "diagnostic" | "stale";

export function tmuxPaneCommandChanged(input: {
  recordedCommand: string | null;
  currentCommand: string | null;
}): boolean {
  return Boolean(
    input.currentCommand && input.recordedCommand && !input.recordedCommand.includes(input.currentCommand),
  );
}

export function tmuxAliveHeartbeatDiagnostic(runnerPid: number | null): string {
  return `tmux runner heartbeat stale but runner pid ${runnerPid} is still alive`;
}

export function tmuxHeartbeatIsStale(input: {
  heartbeatAt: string | null | undefined;
  now: string;
  staleHeartbeatMs: number;
}): boolean {
  if (!input.heartbeatAt) return false;
  return Date.parse(input.now) - Date.parse(input.heartbeatAt) > input.staleHeartbeatMs;
}

export function decideTmuxHeartbeatReconciliation(input: {
  attempt: RunAttemptRecord;
  now: string;
  staleHeartbeatMs: number;
  runnerAlive: boolean;
}): { action: "none" | "append_diagnostic" | "mark_stale"; diagnostic?: string } {
  if (
    !tmuxHeartbeatIsStale({
      heartbeatAt: input.attempt.runtime.heartbeatAt,
      now: input.now,
      staleHeartbeatMs: input.staleHeartbeatMs,
    })
  ) {
    return { action: "none" };
  }
  if (input.runnerAlive) {
    const diagnostic = tmuxAliveHeartbeatDiagnostic(input.attempt.runtime.runnerPid);
    return {
      action: input.attempt.runtime.diagnostics.includes(diagnostic) ? "none" : "append_diagnostic",
      diagnostic,
    };
  }
  return {
    action: "mark_stale",
    diagnostic: `tmux runner heartbeat stale and runner pid ${input.attempt.runtime.runnerPid ?? "unknown"} is not alive`,
  };
}

function appendRuntimeDiagnostic(input: {
  run: RunRecord;
  attempt: RunAttemptRecord;
  now: string;
  diagnostic: string;
}): RunRecord {
  return {
    ...input.run,
    runs: input.run.runs.map((entry) =>
      entry.runId === input.attempt.runId
        ? {
            ...entry,
            leaseExpiresAt: null,
            runtime: { ...entry.runtime, diagnostics: [...entry.runtime.diagnostics, input.diagnostic] },
            updatedAt: input.now,
          }
        : entry,
    ),
    updatedAt: input.now,
  };
}

function clearTmuxLease(input: { run: RunRecord; attempt: RunAttemptRecord; now: string }): RunRecord {
  return {
    ...input.run,
    runs: input.run.runs.map((entry) =>
      entry.runId === input.attempt.runId ? { ...entry, leaseExpiresAt: null, updatedAt: input.now } : entry,
    ),
    updatedAt: input.now,
  };
}

export function applyTmuxReconciliationState(input: {
  run: RunRecord;
  attempt: RunAttemptRecord;
  now: string;
  staleHeartbeatMs: number;
  runnerAlive: boolean;
  currentPaneCommand: string | null;
  paneChangedDiagnostic: (currentPaneCommand: string) => string;
  missingSessionDiagnostic?: string;
}): { run: RunRecord; action: TmuxReconciliationAction; diagnostic?: string } {
  if (input.missingSessionDiagnostic) {
    return {
      run: markRunAttemptStale({
        run: input.run,
        attempt: input.attempt,
        now: input.now,
        diagnostic: input.missingSessionDiagnostic,
      }),
      action: "stale",
      diagnostic: input.missingSessionDiagnostic,
    };
  }

  if (
    tmuxPaneCommandChanged({
      recordedCommand: input.attempt.runtime.command,
      currentCommand: input.currentPaneCommand,
    })
  ) {
    const diagnostic = input.paneChangedDiagnostic(input.currentPaneCommand ?? "unknown");
    return {
      run: markRunAttemptStale({ run: input.run, attempt: input.attempt, now: input.now, diagnostic }),
      action: "stale",
      diagnostic,
    };
  }

  const heartbeatDecision = decideTmuxHeartbeatReconciliation({
    attempt: input.attempt,
    now: input.now,
    staleHeartbeatMs: input.staleHeartbeatMs,
    runnerAlive: input.runnerAlive,
  });
  if (heartbeatDecision.action === "append_diagnostic" && heartbeatDecision.diagnostic) {
    return {
      run: appendRuntimeDiagnostic({
        run: input.run,
        attempt: input.attempt,
        now: input.now,
        diagnostic: heartbeatDecision.diagnostic,
      }),
      action: "diagnostic",
      diagnostic: heartbeatDecision.diagnostic,
    };
  }
  if (heartbeatDecision.action === "mark_stale" && heartbeatDecision.diagnostic) {
    return {
      run: markRunAttemptStale({
        run: input.run,
        attempt: input.attempt,
        now: input.now,
        diagnostic: heartbeatDecision.diagnostic,
      }),
      action: "stale",
      diagnostic: heartbeatDecision.diagnostic,
    };
  }

  return { run: clearTmuxLease({ run: input.run, attempt: input.attempt, now: input.now }), action: "lease_cleared" };
}

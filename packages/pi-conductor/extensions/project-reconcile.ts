import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import { reconcileRunLeases } from "./storage.js";
import { applyTmuxReconciliationState, tmuxHeartbeatIsStale } from "./tmux-reconcile-policy.js";
import type { RunAttemptRecord, RunRecord } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TMUX_PROJECT_STALE_HEARTBEAT_MS = 5 * 60 * 1000;

function isActiveRunAttempt(run: RunAttemptRecord): boolean {
  return !isTerminalRunStatus(run.status);
}

function isRunnerPidAlive(runnerPid: number | null | undefined): boolean {
  if (runnerPid === null || runnerPid === undefined) return false;
  try {
    execFileSync("ps", ["-p", String(runnerPid), "-o", "pid="], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function reconcileTmuxRuntimeState(run: RunRecord, input: { now?: string } = {}): RunRecord {
  let current = run;
  const now = input.now ?? new Date().toISOString();
  for (const attempt of current.runs.filter(
    (entry) => isActiveRunAttempt(entry) && isTmuxRuntimeMode(entry.runtime.mode) && entry.runtime.tmux?.socketPath,
  )) {
    if (
      attempt.runtime.status === "starting" &&
      !tmuxHeartbeatIsStale({
        heartbeatAt: attempt.runtime.heartbeatAt,
        now,
        staleHeartbeatMs: TMUX_PROJECT_STALE_HEARTBEAT_MS,
      })
    ) {
      current = {
        ...current,
        runs: current.runs.map((entry) =>
          entry.runId === attempt.runId ? { ...entry, leaseExpiresAt: null, updatedAt: now } : entry,
        ),
        updatedAt: now,
      };
      continue;
    }
    try {
      execFileSync(
        "tmux",
        ["-S", attempt.runtime.tmux?.socketPath ?? "", "has-session", "-t", attempt.runtime.tmux?.sessionName ?? ""],
        { stdio: "ignore", timeout: 5000 },
      );
      const currentPaneCommand = execFileSync(
        "tmux",
        [
          "-S",
          attempt.runtime.tmux?.socketPath ?? "",
          "display-message",
          "-p",
          "-t",
          attempt.runtime.tmux?.paneId ?? attempt.runtime.tmux?.sessionName ?? "",
          "#{pane_current_command}",
        ],
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      current = applyTmuxReconciliationState({
        run: current,
        attempt,
        now,
        staleHeartbeatMs: TMUX_PROJECT_STALE_HEARTBEAT_MS,
        runnerAlive: isRunnerPidAlive(attempt.runtime.runnerPid),
        currentPaneCommand,
        paneChangedDiagnostic: (command) => `tmux pane command changed during project reconciliation to ${command}`,
      }).run;
    } catch (error) {
      current = applyTmuxReconciliationState({
        run: current,
        attempt,
        now,
        staleHeartbeatMs: TMUX_PROJECT_STALE_HEARTBEAT_MS,
        runnerAlive: false,
        currentPaneCommand: null,
        paneChangedDiagnostic: (command) => `tmux pane command changed during project reconciliation to ${command}`,
        missingSessionDiagnostic: `tmux session missing during project reconciliation: ${errorMessage(error)}`,
      }).run;
    }
  }
  return current;
}

function cleanupPersistedStaleTmuxSessions(repoRoot: string, persisted: RunRecord): RunRecord {
  let current = persisted;
  for (const attempt of persisted.runs) {
    if (
      attempt.status !== "stale" ||
      !isTmuxRuntimeMode(attempt.runtime.mode) ||
      !attempt.errorMessage?.includes("heartbeat") ||
      attempt.runtime.cleanupStatus === "succeeded" ||
      !attempt.runtime.tmux?.socketPath ||
      !attempt.runtime.tmux.sessionName
    ) {
      continue;
    }
    let cleanupStatus: "succeeded" | "failed" = "succeeded";
    let diagnostic = `tmux session ${attempt.runtime.tmux.sessionName} cleanup succeeded after stale heartbeat`;
    try {
      execFileSync(
        "tmux",
        ["-S", attempt.runtime.tmux.socketPath, "kill-session", "-t", attempt.runtime.tmux.sessionName],
        { stdio: "ignore", timeout: 5000 },
      );
    } catch (error) {
      const message = errorMessage(error);
      if (/can't find session|no server running|not found/i.test(message)) {
        diagnostic = message;
      } else {
        cleanupStatus = "failed";
        diagnostic = `tmux stale heartbeat cleanup failed: ${message}`;
      }
    }
    current = mutateRepoRunSync(repoRoot, (latest) => ({
      ...latest,
      runs: latest.runs.map((entry) =>
        entry.runId === attempt.runId
          ? {
              ...entry,
              runtime: {
                ...entry.runtime,
                cleanupStatus,
                diagnostics: [...entry.runtime.diagnostics, diagnostic],
              },
            }
          : entry,
      ),
    }));
  }
  return current;
}

export function reconcileProjectForRepo(repoRoot: string, input: { now?: string; dryRun?: boolean } = {}): RunRecord {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const base = getOrCreateRunForRepo(repoRoot);
    const reconciled = reconcileRunLeases(reconcileTmuxRuntimeState(reconcileWorkerHealth(base), input), input);
    if (input.dryRun) return reconciled;
    let changedDuringReconcile = false;
    const persisted = mutateRepoRunSync(repoRoot, (latest) => {
      if (latest.updatedAt === base.updatedAt) return reconciled;
      changedDuringReconcile = true;
      return latest;
    });
    if (!changedDuringReconcile) return cleanupPersistedStaleTmuxSessions(repoRoot, persisted);
  }
  throw new Error("Project reconciliation could not persist because concurrent updates kept changing conductor state");
}

export function reconcileWorkerHealth(run: RunRecord): RunRecord {
  const workers = run.workers.map((worker) => {
    const worktreeMissing = !worker.worktreePath || !existsSync(worker.worktreePath);
    const sessionMissing = !worker.sessionFile || !existsSync(worker.sessionFile);
    if (!worktreeMissing && !sessionMissing) return worker;
    return { ...worker, lifecycle: "broken" as const, recoverable: true, updatedAt: new Date().toISOString() };
  });
  return { ...run, workers, updatedAt: new Date().toISOString() };
}

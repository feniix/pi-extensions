import type {
  PersistedRunAttemptRecord,
  RunAttemptRecord,
  RunRuntimeMetadata,
  RunRuntimeMode,
  RunRuntimeStatus,
} from "./types.js";

export function createRunRuntimeMetadata(input: {
  mode: RunRuntimeMode;
  status?: RunRuntimeStatus;
  sessionId?: string | null;
  cwd?: string | null;
  command?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  diagnostics?: string[];
}): RunRuntimeMetadata {
  return {
    mode: input.mode,
    status: input.status ?? "unknown",
    sessionId: input.sessionId ?? null,
    cwd: input.cwd ?? null,
    command: input.command ?? null,
    contractPath: null,
    nonceHash: null,
    runnerPid: null,
    processGroupId: null,
    tmux: null,
    logPath: null,
    viewerCommand: null,
    viewerStatus: input.mode === "headless" ? "not_applicable" : "pending",
    diagnostics: input.diagnostics ?? [],
    heartbeatAt: null,
    cleanupStatus: input.mode === "headless" ? "not_required" : "pending",
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
  };
}

function mapLegacyBackendToRuntimeMode(_backend: RunAttemptRecord["backend"] | undefined): RunRuntimeMode {
  return "headless";
}

export function mapRunStatusToRuntimeStatus(status: RunAttemptRecord["status"] | undefined): RunRuntimeStatus {
  switch (status) {
    case "running":
    case "starting":
    case "queued":
    case "dispatch_pending":
    case "completing":
      return "running";
    case "succeeded":
    case "partial":
    case "blocked":
      return "exited_success";
    case "aborted":
    case "interrupted":
      return "aborted";
    case "failed":
    case "stale":
    case "unknown_dispatch":
      return "exited_error";
    default:
      return "unknown";
  }
}

function isTerminalRunStatus(status: RunAttemptRecord["status"] | undefined): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status ?? "",
  );
}

export function normalizeRunRuntimeMetadata(run: PersistedRunAttemptRecord): RunRuntimeMetadata {
  const runtime = run.runtime
    ? {
        mode: run.runtime.mode,
        status: run.runtime.status,
        sessionId: run.runtime.sessionId ?? run.sessionId ?? null,
        cwd: run.runtime.cwd ?? null,
        command: run.runtime.command ?? null,
        contractPath: run.runtime.contractPath ?? null,
        nonceHash: run.runtime.nonceHash ?? null,
        runnerPid: run.runtime.runnerPid ?? null,
        processGroupId: run.runtime.processGroupId ?? null,
        tmux: run.runtime.tmux ?? null,
        logPath: run.runtime.logPath ?? null,
        viewerCommand: run.runtime.viewerCommand ?? null,
        viewerStatus: run.runtime.viewerStatus ?? (run.runtime.mode === "headless" ? "not_applicable" : "pending"),
        diagnostics: run.runtime.diagnostics ?? [],
        heartbeatAt: run.runtime.heartbeatAt ?? run.lastHeartbeatAt ?? null,
        cleanupStatus: run.runtime.cleanupStatus ?? (run.runtime.mode === "headless" ? "not_required" : "pending"),
        startedAt: run.runtime.startedAt ?? run.startedAt ?? null,
        finishedAt: run.runtime.finishedAt ?? run.finishedAt ?? null,
      }
    : createRunRuntimeMetadata({
        mode: mapLegacyBackendToRuntimeMode(run.backend),
        status: mapRunStatusToRuntimeStatus(run.status),
        sessionId: run.sessionId ?? null,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
      });

  if (isTerminalRunStatus(run.status)) {
    return {
      ...runtime,
      status: mapRunStatusToRuntimeStatus(run.status),
      finishedAt: run.finishedAt ?? runtime.finishedAt,
      cleanupStatus: runtime.mode === "headless" ? "not_required" : runtime.cleanupStatus,
    };
  }

  return runtime;
}

export function formatRunRuntimeSummary(runtime: RunRuntimeMetadata): string {
  const diagnostics = runtime.diagnostics.at(-1);
  return [
    `runtimeMode=${runtime.mode}`,
    `runtimeStatus=${runtime.status}`,
    `viewer=${runtime.viewerStatus}`,
    `cleanup=${runtime.cleanupStatus}`,
    `log=${runtime.logPath ?? "none"}`,
    `heartbeat=${runtime.heartbeatAt ?? "none"}`,
    diagnostics ? `diagnostic=${diagnostics}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

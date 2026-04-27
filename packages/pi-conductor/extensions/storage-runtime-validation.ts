import type { RunRuntimeCleanupStatus, RunRuntimeMode, RunRuntimeStatus, RunRuntimeViewerStatus } from "./types.js";

const runRuntimeModes = new Set<RunRuntimeMode>(["headless", "tmux", "iterm-tmux"]);
const runRuntimeStatuses = new Set<RunRuntimeStatus>([
  "unavailable",
  "starting",
  "running",
  "exited_success",
  "exited_error",
  "aborted",
  "unknown",
]);
const runRuntimeViewerStatuses = new Set<RunRuntimeViewerStatus>([
  "not_applicable",
  "pending",
  "opened",
  "warning",
  "unavailable",
]);
const runRuntimeCleanupStatuses = new Set<RunRuntimeCleanupStatus>(["not_required", "pending", "succeeded", "failed"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRequiredKeys(value: unknown, keys: readonly string[], context: string): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${context} is not an object`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${context} missing required field ${key}`);
    }
  }
}

function assertStringEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  context: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`${context} has invalid value ${String(value)}`);
  }
}

function assertNullableString(value: unknown, context: string): void {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${context} must be a string or null`);
  }
}

function assertNullableNumber(value: unknown, context: string): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${context} must be a finite number or null`);
  }
}

function assertStringArray(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${context} must be an array of strings`);
  }
}

export function assertRunRuntimeMetadata(runtime: unknown, context: string): void {
  assertRequiredKeys(
    runtime,
    [
      "mode",
      "status",
      "sessionId",
      "cwd",
      "command",
      "runnerPid",
      "processGroupId",
      "tmux",
      "logPath",
      "viewerCommand",
      "viewerStatus",
      "diagnostics",
      "heartbeatAt",
      "cleanupStatus",
      "startedAt",
      "finishedAt",
    ],
    context,
  );
  if (!isPlainRecord(runtime)) {
    throw new Error(`${context} is not an object`);
  }
  assertStringEnum(runtime.mode, runRuntimeModes, `${context}.mode`);
  assertStringEnum(runtime.status, runRuntimeStatuses, `${context}.status`);
  assertStringEnum(runtime.viewerStatus, runRuntimeViewerStatuses, `${context}.viewerStatus`);
  assertStringEnum(runtime.cleanupStatus, runRuntimeCleanupStatuses, `${context}.cleanupStatus`);
  assertNullableString(runtime.sessionId, `${context}.sessionId`);
  assertNullableString(runtime.cwd, `${context}.cwd`);
  assertNullableString(runtime.command, `${context}.command`);
  assertNullableNumber(runtime.runnerPid, `${context}.runnerPid`);
  assertNullableNumber(runtime.processGroupId, `${context}.processGroupId`);
  assertNullableString(runtime.logPath, `${context}.logPath`);
  assertNullableString(runtime.viewerCommand, `${context}.viewerCommand`);
  assertStringArray(runtime.diagnostics, `${context}.diagnostics`);
  assertNullableString(runtime.heartbeatAt, `${context}.heartbeatAt`);
  assertNullableString(runtime.startedAt, `${context}.startedAt`);
  assertNullableString(runtime.finishedAt, `${context}.finishedAt`);

  if (runtime.tmux !== null) {
    assertRequiredKeys(runtime.tmux, ["socketPath", "sessionName", "windowId", "paneId"], `${context}.tmux`);
    if (!isPlainRecord(runtime.tmux)) {
      throw new Error(`${context}.tmux is not an object`);
    }
    assertNullableString(runtime.tmux.socketPath, `${context}.tmux.socketPath`);
    assertNullableString(runtime.tmux.sessionName, `${context}.tmux.sessionName`);
    assertNullableString(runtime.tmux.windowId, `${context}.tmux.windowId`);
    assertNullableString(runtime.tmux.paneId, `${context}.tmux.paneId`);
  }
}

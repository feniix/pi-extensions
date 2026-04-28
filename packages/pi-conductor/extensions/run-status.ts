import type { RunAttemptRecord } from "./types.js";

export const TERMINAL_RUN_STATUSES = [
  "succeeded",
  "partial",
  "blocked",
  "failed",
  "aborted",
  "stale",
  "interrupted",
  "unknown_dispatch",
] as const;

export function isTerminalRunStatus(status: string | undefined): status is RunAttemptRecord["status"] {
  return TERMINAL_RUN_STATUSES.includes(status as (typeof TERMINAL_RUN_STATUSES)[number]);
}

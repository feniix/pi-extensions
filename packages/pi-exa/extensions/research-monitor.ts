/**
 * Host-owned background monitoring records and policy for approved Agent runs.
 *
 * The monitor observes one saved run with bounded, non-overlapping GETs. It has
 * no create, continuation, retry, replacement or cancel authority. Remote
 * lifecycle (the attempt result), local monitoring state and completion-notice
 * delivery are independent dimensions: a paused monitor is not a failed run and
 * a sent notice is not a delivered one.
 */

import { type Static, Type } from "typebox";

export const COMPLETION_NOTICE_TYPE = "exa-research-completion";

/** Numeric design gates settled by #171. */
export interface MonitorBounds {
  getDeadlineMs: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitterRatio: number;
  maxConsecutiveTransientErrors: number;
  maxSilenceMs: number;
  maxMonitorMs: number;
}

export const DEFAULT_MONITOR_BOUNDS: MonitorBounds = {
  getDeadlineMs: 15_000,
  initialDelayMs: 5_000,
  backoffFactor: 1.5,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
  maxConsecutiveTransientErrors: 8,
  maxSilenceMs: 10 * 60_000,
  maxMonitorMs: 3 * 60 * 60_000,
};

const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const monitorPauseReasons = [
  "AUTH",
  "NOT_FOUND",
  "TRANSIENT_EXHAUSTED",
  "MONITOR_LIFETIME",
  "SHUTDOWN",
  "RESTART",
  "DETACHED",
  "ARCHIVED",
  "REGISTRATION_FAILED",
  "STORAGE",
] as const;
export type MonitorPauseReason = (typeof monitorPauseReasons)[number];

export const completionNoticeSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled")]),
    processing: Type.Union([
      Type.Literal("pending"),
      Type.Literal("validated"),
      Type.Literal("failed"),
      Type.Literal("not-applicable"),
    ]),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("sent"),
      Type.Literal("acknowledged"),
      Type.Literal("uncertain"),
    ]),
    createdAt: Type.String({ minLength: 1 }),
    sentAt: Type.Optional(Type.String({ minLength: 1 })),
    acknowledgedEntryId: Type.Optional(Type.String({ minLength: 1 })),
    /** Package-owned delivery diagnostic, never vendor prose. */
    deliveryError: Type.Optional(Type.String({ minLength: 1 })),
    /** Re-sent after an uncertain delivery; the label survives a failed re-send. */
    possibleDuplicate: Type.Optional(Type.Boolean()),
    /** How the outcome reached the assistant: the background notice entry or a foreground tool result. */
    channel: Type.Optional(Type.Union([Type.Literal("session-entry"), Type.Literal("tool-result")])),
  },
  { additionalProperties: false },
);
export type CompletionNotice = Static<typeof completionNoticeSchema>;

export const monitorRecordSchema = Type.Object(
  {
    kind: Type.Literal("exa-monitor-v1"),
    attemptId: Type.String({ minLength: 1 }),
    runId: Type.String({ minLength: 1 }),
    originSessionId: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal("registered"),
      Type.Literal("running"),
      Type.Literal("paused"),
      Type.Literal("stopped"),
    ]),
    reason: Type.Optional(
      Type.Union([
        Type.Literal("AUTH"),
        Type.Literal("NOT_FOUND"),
        Type.Literal("TRANSIENT_EXHAUSTED"),
        Type.Literal("MONITOR_LIFETIME"),
        Type.Literal("SHUTDOWN"),
        Type.Literal("RESTART"),
        Type.Literal("DETACHED"),
        Type.Literal("ARCHIVED"),
        Type.Literal("REGISTRATION_FAILED"),
        Type.Literal("STORAGE"),
      ]),
    ),
    gets: integer,
    consecutiveTransientErrors: integer,
    nextDelayMs: Type.Optional(integer),
    startedAt: Type.String({ minLength: 1 }),
    lastSuccessAt: Type.Optional(Type.String({ minLength: 1 })),
    lastErrorKind: Type.Optional(
      Type.Union([
        Type.Literal("transient"),
        Type.Literal("timeout"),
        Type.Literal("auth"),
        Type.Literal("not-found"),
        Type.Literal("observation"),
        Type.Literal("detached"),
      ]),
    ),
    notice: Type.Optional(completionNoticeSchema),
  },
  { additionalProperties: false },
);
export type MonitorRecord = Static<typeof monitorRecordSchema>;

export type ObservationFailure = {
  kind: NonNullable<MonitorRecord["lastErrorKind"]>;
  pause?: MonitorPauseReason;
};

/** Classify an observation failure without archiving vendor prose. */
export function classifyObservationError(error: unknown): ObservationFailure {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  if (statusCode === 401 || statusCode === 403) return { kind: "auth", pause: "AUTH" };
  if (statusCode === 404) return { kind: "not-found", pause: "NOT_FOUND" };
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AgentInspectionInterruptedError") return { kind: "timeout" };
  if (name === "AgentLifecycleObservationError") return { kind: "observation" };
  if (/detached|No active research cycle|ownership changed|RECOVERY_UNAVAILABLE/.test(message))
    return { kind: "detached", pause: "DETACHED" };
  return { kind: "transient" };
}

/**
 * Delay before the next check. The first check runs after `initialDelayMs`, so the
 * delay after it is already one backoff step longer (5 s, then 7.5 s, 11.25 s, …).
 * The cap never drops below the initial delay.
 */
export function nextMonitorDelay(previousMs: number | undefined, bounds: MonitorBounds): number {
  const base = (previousMs ?? bounds.initialDelayMs) * bounds.backoffFactor;
  const cap = Math.max(bounds.maxDelayMs, bounds.initialDelayMs);
  return Math.min(cap, Math.max(1, Math.round(base)));
}

export function jitteredDelay(delayMs: number, bounds: MonitorBounds, random: () => number = Math.random): number {
  if (!bounds.jitterRatio) return delayMs;
  return Math.max(1, Math.round(delayMs * (1 + (random() * 2 - 1) * bounds.jitterRatio)));
}

export function shouldPauseAfterTransient(
  monitor: Pick<MonitorRecord, "consecutiveTransientErrors" | "lastSuccessAt" | "startedAt">,
  nowMs: number,
  bounds: MonitorBounds,
): boolean {
  if (monitor.consecutiveTransientErrors >= bounds.maxConsecutiveTransientErrors) return true;
  const anchor = Date.parse(monitor.lastSuccessAt ?? monitor.startedAt);
  return Number.isFinite(anchor) && nowMs - anchor >= bounds.maxSilenceMs;
}

export function completionNoticeText(input: {
  cycleId: string;
  attemptId: string;
  runId: string;
  outcome: CompletionNotice["outcome"];
  processing: CompletionNotice["processing"];
}): string {
  const local =
    input.processing === "validated"
      ? "local output validated against the frozen task schema"
      : input.processing === "failed"
        ? "local output processing FAILED; recover the same run with researchMode=recover, never resubmit"
        : `local processing ${input.processing}`;
  return `Exa research attempt ${input.attemptId} (run ${input.runId}) for cycle ${input.cycleId} reached a terminal state: ${input.outcome}; ${local}. Report it now: call exa_research_status for the final report (recorded criteria, gaps, assumptions, classified usage) and exa_research_summary mode=brief or source_pack for evidence-backed findings. Generated claims do not satisfy criteria and API-reported usage is not verified billing. This reporting turn must not submit, retry or replace research.`;
}

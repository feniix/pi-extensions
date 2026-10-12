/**
 * Exa deep research — powered by the asynchronous Agent Runs API.
 */

import type { AgentRun, CreateAgentRunParams, DeepOutputSchema, DeepSearchOutput } from "exa-js";
import { DEFAULT_RESEARCH_OUTPUT_SCHEMA } from "./constants.js";
import { getExaClient } from "./exa-client.js";
import type { ToolPerformResult } from "./formatters.js";
import { formatResearchOutput } from "./formatters.js";

export const AGENT_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "auto", "max"] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export const DEFAULT_AGENT_EFFORT: AgentEffort = "medium";
export const DEFAULT_AGENT_POLL_INTERVAL_MS = 1_000;
/** Bounded wait for a create acknowledgement in the guided submit-only path (#171 settled). */
export const DEFAULT_AGENT_CREATE_WAIT_MS = 30_000;
export const MAX_EFFORT_BETA = "agent-max-effort-2026-07-27";
const DEFAULT_AGENT_TIMEOUT_MS = 180_000;
const AGENT_CANCEL_TIMEOUT_MS = 5_000;

export interface ResearchParams {
  query: string;
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  effort?: AgentEffort;
  input?: {
    data?: Record<string, unknown>[];
    exclusion?: Record<string, unknown>[];
  };
  previousRunId?: string;
  metadata?: Record<string, string>;
  dataSources?: Array<{ provider: string }>;
  budget?: { maxCostDollars?: number };
}

export interface ResearchExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Call-local host hooks; absent in standalone/MCP. Never an authorization boolean. */
  observer?: AgentLifecycleObserver;
}

export interface AgentLifecycleObserver {
  beforeCreate: () => Promise<() => void>;
  raw: (phase: "create" | "get" | "cancel", run: AgentRun) => Promise<void>;
}

export interface AgentInspectionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  observer?: {
    beforeGet: () => Promise<() => void>;
    raw: AgentLifecycleObserver["raw"];
  };
}

export interface AgentSubmissionOptions {
  /** Call-local host hooks; absent in standalone/MCP. Never an authorization boolean. */
  observer?: AgentLifecycleObserver;
  /** Bounded wait for the create acknowledgement; expiry leaves the outcome unknown. */
  createWaitMs?: number;
  signal?: AbortSignal;
}

/** The create wait expired before the request was sent; nothing reached Exa. */
export class AgentSubmissionNotDispatchedError extends Error {
  constructor(readonly waitMs: number) {
    super(
      `The ${waitMs}ms submission wait expired before the Agent run was sent; nothing was dispatched to Exa and no charge was incurred.`,
    );
    this.name = "AgentSubmissionNotDispatchedError";
  }
}

/**
 * The create request was dispatched but no acknowledgement arrived within the
 * bound (or the local wait was aborted). The remote outcome is unknown: nothing
 * was cancelled, invented or resubmitted, and a late reply still reaches the
 * attached observer.
 */
export class AgentSubmissionUnacknowledgedError extends Error {
  constructor(
    readonly waitMs: number,
    readonly reason: "timeout" | "aborted",
  ) {
    super(
      `Exa did not acknowledge the Agent run within ${waitMs}ms (${reason}). The submission outcome is unknown; no run ID was invented and no cancellation or resubmission was requested.`,
    );
    this.name = "AgentSubmissionUnacknowledgedError";
  }
}

export class AgentInspectionInterruptedError extends Error {
  constructor(
    readonly runId: string,
    readonly reason: "timeout" | "aborted",
  ) {
    super(
      `Inspection of Agent run ${runId} stopped locally (${reason}); no remote cancellation or new submission was requested. Inspect the same existing attempt.`,
    );
    this.name = "AgentInspectionInterruptedError";
  }
}

export class AgentResearchCancelledError extends Error {
  readonly runId?: string;
  readonly cancelError?: string;

  constructor(runId?: string, cancelError?: string) {
    super("Cancelled.");
    this.name = "AgentResearchCancelledError";
    this.runId = runId;
    this.cancelError = cancelError;
  }
}

export class AgentResearchTimeoutError extends Error {
  readonly runId?: string;
  readonly timeoutMs: number;
  readonly cancelError?: string;

  constructor(runId: string | undefined, timeoutMs: number, cancelError?: string) {
    super(
      runId
        ? `web_research_exa timed out after ${timeoutMs}ms; cancellation was attempted for Exa Agent run ${runId}.`
        : `web_research_exa timed out after ${timeoutMs}ms before Exa returned a run ID.`,
    );
    this.name = "AgentResearchTimeoutError";
    this.runId = runId;
    this.timeoutMs = timeoutMs;
    this.cancelError = cancelError;
  }
}

class AgentLifecycleAbortError extends Error {}
class AgentLifecycleDeadlineError extends Error {}
export class AgentLifecycleObservationError extends Error {
  constructor(readonly runId: string) {
    super(
      `Agent run ${runId} was observed, but its local durable observation failed. Recover the existing run; do not resubmit.`,
    );
    this.name = "AgentLifecycleObservationError";
  }
}

function parseOutputSchema(outputSchema: Record<string, unknown> | undefined): DeepOutputSchema {
  if (!outputSchema || !Object.hasOwn(outputSchema, "type")) {
    return DEFAULT_RESEARCH_OUTPUT_SCHEMA as unknown as DeepOutputSchema;
  }

  const schemaType = outputSchema.type;
  if (schemaType !== "object" && schemaType !== "text") {
    throw new Error('outputSchema.type must be either "object" or "text".');
  }

  return outputSchema as DeepOutputSchema;
}

function isPending(run: AgentRun): boolean {
  return run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled";
}

function elapsedMs(run: AgentRun): number | undefined {
  if (!run.createdAt || !run.completedAt) return undefined;
  const startedAt = Date.parse(run.createdAt);
  const completedAt = Date.parse(run.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return undefined;
  return completedAt - startedAt;
}

function isListenableSignal(signal: AbortSignal | undefined): signal is AbortSignal {
  return Boolean(
    signal && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function",
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const listenable = isListenableSignal(signal);
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      if (listenable) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    if (listenable) signal.addEventListener("abort", onAbort, { once: true });
  });
}

function withLifecycleBound<T>(promise: Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const listenable = isListenableSignal(signal);
    if (signal?.aborted) {
      reject(new AgentLifecycleAbortError());
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      reject(new AgentLifecycleDeadlineError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      if (listenable) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AgentLifecycleAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new AgentLifecycleDeadlineError());
    }, remainingMs);
    if (listenable) signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function formatCompletedRun(run: AgentRun, outputSchema: DeepOutputSchema): ToolPerformResult {
  const content = outputSchema.type === "object" ? run.output?.structured : run.output?.text;
  if (content === undefined || content === null || content === "") {
    throw new Error(`Exa Agent run ${run.id} completed without synthesized output.`);
  }

  const formatted = formatResearchOutput(
    {
      content,
      grounding: run.output?.grounding ?? [],
    } as DeepSearchOutput,
    outputSchema,
  );

  const searchTime = elapsedMs(run);
  const costDollars =
    typeof run.costDollars?.total === "number"
      ? (run.costDollars as unknown as NonNullable<ToolPerformResult["details"]["costDollars"]>)
      : undefined;
  return {
    text: formatted.text,
    details: {
      tool: "web_research_exa",
      runId: run.id,
      status: run.status,
      stopReason: run.stopReason ?? null,
      ...(costDollars ? { costDollars } : {}),
      ...(run.usage ? { usage: run.usage } : {}),
      ...(searchTime === undefined ? {} : { searchTime }),
      ...(run.createdAt ? { createdAt: run.createdAt } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(formatted.parsedOutput === undefined ? {} : { parsedOutput: formatted.parsedOutput }),
    },
  };
}

/**
 * One explicit existing-run GET. Not continuation/create or an automatic
 * poll/cancel lifecycle. The original-attempt observer owns result validation
 * and accounting; this helper exposes no raw response/output archive.
 */
export async function inspectResearchRun(
  apiKey: string,
  runId: string,
  options: AgentInspectionOptions = {},
): Promise<ToolPerformResult> {
  // The pinned SDK interpolates IDs without encoding; URL dot segments are
  // routing syntax, not an opaque run identifier.
  if (runId === "." || runId === ".." || !/^[A-Za-z0-9_.:-]{1,200}$/.test(runId))
    throw new Error("Invalid Agent run ID.");
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS);
  const assertWait = () => {
    if (options.signal?.aborted) throw new AgentInspectionInterruptedError(runId, "aborted");
    if (Date.now() >= deadline) throw new AgentInspectionInterruptedError(runId, "timeout");
  };
  assertWait();
  const exa = getExaClient(apiKey);
  const guard = await options.observer?.beforeGet();
  assertWait();
  // No await between the ownership/generation fence and the single SDK GET.
  guard?.();
  const observed = exa.agent.runs.get(runId).then(async (reply) => {
    if (reply.id !== runId) throw new Error("Agent inspection remote identity conflict.");
    if (!["queued", "running", "completed", "failed", "cancelled"].includes(reply.status))
      throw new Error("Invalid Agent inspection remote status.");
    const metadata = { runId, remoteStatus: reply.status, inspectionOnly: true };
    try {
      await options.observer?.raw("get", reply);
    } catch {
      throw new AgentLifecycleObservationError(runId);
    }
    return metadata;
  });
  let metadata: { runId: string; remoteStatus: AgentRun["status"]; inspectionOnly: boolean };
  try {
    metadata = await withLifecycleBound(observed, deadline, options.signal);
  } catch (error) {
    if (error instanceof AgentLifecycleAbortError) throw new AgentInspectionInterruptedError(runId, "aborted");
    if (error instanceof AgentLifecycleDeadlineError) throw new AgentInspectionInterruptedError(runId, "timeout");
    throw error;
  }
  return {
    text: `Existing Agent run ${runId}: ${metadata.remoteStatus}. This was one GET inspection, not replacement research or remote cancellation.`,
    details: metadata,
  };
}

/**
 * The one create request both lifecycles send. Guided submission and the blocking
 * standalone path must never drift: the hashed, approved request is exactly this.
 */
function buildCreateParams(params: ResearchParams): {
  createParams: CreateAgentRunParams;
  outputSchema: DeepOutputSchema;
} {
  const outputSchema = parseOutputSchema(params.outputSchema);
  const effort = params.effort ?? DEFAULT_AGENT_EFFORT;
  if (params.budget?.maxCostDollars !== undefined && effort !== "auto" && effort !== "max") {
    throw new Error("budget.maxCostDollars is only supported with auto or max effort.");
  }
  return {
    outputSchema,
    createParams: {
      query: params.query,
      effort,
      ...(params.systemPrompt === undefined ? {} : { systemPrompt: params.systemPrompt }),
      ...(outputSchema.type === "object" ? { outputSchema: outputSchema as Record<string, unknown> } : {}),
      ...(params.input === undefined ? {} : { input: params.input }),
      ...(params.previousRunId === undefined ? {} : { previousRunId: params.previousRunId }),
      ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
      ...(params.dataSources === undefined ? {} : { dataSources: params.dataSources }),
      ...(params.budget === undefined ? {} : { budget: params.budget }),
    },
  };
}

function dispatchCreate(exa: ReturnType<typeof getExaClient>, createParams: CreateAgentRunParams): Promise<AgentRun> {
  return createParams.effort === "max"
    ? exa.beta.agent.runs.create({ ...createParams, betas: [MAX_EFFORT_BETA] })
    : exa.agent.runs.create(createParams);
}

/**
 * Guided submit-only lifecycle: one bounded create, remote-ID publication through
 * the observer, immediate return. No polling, no cancellation, no result
 * retrieval; background observation is the host's job.
 */
export async function submitResearchRun(
  apiKey: string,
  params: ResearchParams,
  options: AgentSubmissionOptions = {},
): Promise<ToolPerformResult> {
  let { createParams } = buildCreateParams(params);
  const exa = getExaClient(apiKey);
  const waitMs = options.createWaitMs ?? DEFAULT_AGENT_CREATE_WAIT_MS;
  const deadline = Date.now() + waitMs;
  if (options.observer) {
    createParams = structuredClone(createParams);
    const guard = await options.observer.beforeCreate();
    // Nothing was dispatched yet: an abort here is an ordinary cancellation.
    if (options.signal?.aborted) throw new AgentResearchCancelledError();
    // The wait expired before the create was sent: nothing reached Exa, so this is not unknown.
    if (Date.now() >= deadline) throw new AgentSubmissionNotDispatchedError(waitMs);
    // No await between the final host fence and actual SDK invocation.
    guard();
  }
  const observer = options.observer;
  // The chain stays attached after the bounded wait ends so a late genuine
  // acknowledgement is still published to the original attempt.
  const createPromise = dispatchCreate(exa, createParams).then(async (reply) => {
    if (observer) {
      try {
        await observer.raw("create", reply);
      } catch {
        throw new AgentLifecycleObservationError(reply.id);
      }
    }
    return reply;
  });
  let run: AgentRun;
  try {
    run = await withLifecycleBound(createPromise, deadline, options.signal);
  } catch (error) {
    if (error instanceof AgentLifecycleAbortError) throw new AgentSubmissionUnacknowledgedError(waitMs, "aborted");
    if (error instanceof AgentLifecycleDeadlineError) throw new AgentSubmissionUnacknowledgedError(waitMs, "timeout");
    throw error;
  }
  return {
    text: `Exa Agent run ${run.id} acknowledged with status ${run.status}. Submission only: no polling, cancellation or result retrieval was performed.`,
    details: {
      runId: run.id,
      remoteStatus: run.status,
      submissionOnly: true,
      ...(run.createdAt ? { createdAt: run.createdAt } : {}),
    },
  };
}

export async function performResearch(
  apiKey: string,
  params: ResearchParams,
  execution: ResearchExecutionOptions = {},
): Promise<ToolPerformResult> {
  const built = buildCreateParams(params);
  const { outputSchema } = built;
  let { createParams } = built;
  const exa = getExaClient(apiKey);
  const timeoutMs = execution.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  if (execution.observer) {
    // Consent/intent must apply to the same nested request after host awaits.
    createParams = structuredClone(createParams);
    const guard = await execution.observer.beforeCreate();
    if (execution.signal?.aborted) throw new AgentResearchCancelledError();
    if (Date.now() >= deadline) throw new AgentResearchTimeoutError(undefined, timeoutMs);
    // No await between the final host fence and actual SDK invocation.
    guard();
  }
  let creationId: string | undefined;
  const observe = (phase: "create" | "get" | "cancel", promise: Promise<AgentRun>) =>
    execution.observer
      ? promise.then(async (reply) => {
          // This chain stays attached even when the local lifecycle wait ends.
          if (phase === "create" && typeof reply.id === "string" && reply.id) creationId = reply.id;
          try {
            await execution.observer?.raw(phase, reply);
          } catch {
            throw new AgentLifecycleObservationError(reply.id);
          }
          return reply;
        })
      : promise;
  const createPromise = observe("create", dispatchCreate(exa, createParams));
  let run: AgentRun;
  const cancelForInterruption = async (kind: "cancelled" | "timeout", runId: string = run.id): Promise<never> => {
    let cancelError: string | undefined;
    try {
      await withLifecycleBound(observe("cancel", exa.agent.runs.cancel(runId)), Date.now() + AGENT_CANCEL_TIMEOUT_MS);
    } catch (error) {
      cancelError = error instanceof Error ? error.message : String(error);
    }
    if (kind === "cancelled") {
      throw new AgentResearchCancelledError(runId, cancelError);
    }
    throw new AgentResearchTimeoutError(runId, timeoutMs, cancelError);
  };
  try {
    run = await withLifecycleBound(createPromise, deadline, execution.signal);
  } catch (error) {
    if (error instanceof AgentLifecycleAbortError) {
      if (creationId) await cancelForInterruption("cancelled", creationId);
      throw new AgentResearchCancelledError();
    }
    if (error instanceof AgentLifecycleDeadlineError) {
      if (creationId) await cancelForInterruption("timeout", creationId);
      throw new AgentResearchTimeoutError(undefined, timeoutMs);
    }
    throw error;
  }

  if (execution.signal?.aborted) {
    await cancelForInterruption("cancelled");
  }
  if (Date.now() >= deadline) {
    await cancelForInterruption("timeout");
  }

  while (isPending(run)) {
    if (execution.signal?.aborted) {
      await cancelForInterruption("cancelled");
    }
    if (Date.now() >= deadline) {
      await cancelForInterruption("timeout");
    }

    try {
      run = await withLifecycleBound(observe("get", exa.agent.runs.get(run.id)), deadline, execution.signal);
    } catch (error) {
      if (error instanceof AgentLifecycleObservationError) throw error;
      if (error instanceof AgentLifecycleAbortError) {
        await cancelForInterruption("cancelled");
      }
      if (error instanceof AgentLifecycleDeadlineError) {
        await cancelForInterruption("timeout");
      }
      const statusCode = errorStatusCode(error);
      if (statusCode === 404) {
        throw new Error(`Exa no longer recognizes Agent run ${run.id}.`);
      }
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(`Exa rejected the API key while polling Agent run ${run.id} (${statusCode}).`);
      }
      try {
        await sleep(Math.min(DEFAULT_AGENT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), execution.signal);
      } catch (sleepError) {
        if (execution.signal?.aborted) {
          await cancelForInterruption("cancelled");
        }
        throw sleepError;
      }
      continue;
    }
    if (execution.signal?.aborted) {
      await cancelForInterruption("cancelled");
    }
    if (Date.now() >= deadline) {
      await cancelForInterruption("timeout");
    }
    if (isPending(run)) {
      try {
        await sleep(Math.min(DEFAULT_AGENT_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), execution.signal);
      } catch (error) {
        if (execution.signal?.aborted) {
          await cancelForInterruption("cancelled");
        }
        throw error;
      }
    }
  }

  if (run.status === "failed" || run.status === "cancelled") {
    const message = run.error?.message ? `: ${run.error.message}` : "";
    throw new Error(`Exa Agent run ${run.id} ended with status ${run.status}${message}`);
  }

  return formatCompletedRun(run, outputSchema);
}

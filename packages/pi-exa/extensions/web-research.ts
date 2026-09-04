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

export async function performResearch(
  apiKey: string,
  params: ResearchParams,
  execution: ResearchExecutionOptions = {},
): Promise<ToolPerformResult> {
  const outputSchema = parseOutputSchema(params.outputSchema);
  const effort = params.effort ?? DEFAULT_AGENT_EFFORT;
  if (params.budget?.maxCostDollars !== undefined && effort !== "auto" && effort !== "max") {
    throw new Error("budget.maxCostDollars is only supported with auto or max effort.");
  }
  const exa = getExaClient(apiKey);
  const timeoutMs = execution.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const createParams: CreateAgentRunParams = {
    query: params.query,
    effort,
    ...(params.systemPrompt === undefined ? {} : { systemPrompt: params.systemPrompt }),
    ...(outputSchema.type === "object" ? { outputSchema: outputSchema as Record<string, unknown> } : {}),
    ...(params.input === undefined ? {} : { input: params.input }),
    ...(params.previousRunId === undefined ? {} : { previousRunId: params.previousRunId }),
    ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
    ...(params.dataSources === undefined ? {} : { dataSources: params.dataSources }),
    ...(params.budget === undefined ? {} : { budget: params.budget }),
  };

  const createPromise =
    createParams.effort === "max"
      ? exa.beta.agent.runs.create({ ...createParams, betas: [MAX_EFFORT_BETA] })
      : exa.agent.runs.create(createParams);
  let run: AgentRun;
  try {
    run = await withLifecycleBound(createPromise, deadline, execution.signal);
  } catch (error) {
    if (error instanceof AgentLifecycleAbortError) throw new AgentResearchCancelledError();
    if (error instanceof AgentLifecycleDeadlineError) throw new AgentResearchTimeoutError(undefined, timeoutMs);
    throw error;
  }

  const cancelForInterruption = async (kind: "cancelled" | "timeout"): Promise<never> => {
    let cancelError: string | undefined;
    try {
      await withLifecycleBound(exa.agent.runs.cancel(run.id), Date.now() + AGENT_CANCEL_TIMEOUT_MS);
    } catch (error) {
      cancelError = error instanceof Error ? error.message : String(error);
    }
    if (kind === "cancelled") {
      throw new AgentResearchCancelledError(run.id, cancelError);
    }
    throw new AgentResearchTimeoutError(run.id, timeoutMs, cancelError);
  };

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
      run = await withLifecycleBound(exa.agent.runs.get(run.id), deadline, execution.signal);
    } catch (error) {
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

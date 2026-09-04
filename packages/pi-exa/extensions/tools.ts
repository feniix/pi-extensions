/**
 * Host-neutral portable tool definitions for pi-exa.
 *
 * Tools defined here are consumed by both the Pi adapter (extensions/index.ts)
 * and the MCP stdio server (extensions/mcp-server.ts). Files in this module
 * must not import from `@earendil-works/pi-coding-agent` or the MCP SDK.
 */

import {
  definePortableTool,
  type PortableTool,
  type PortableToolHostExtras,
  type PortableToolResult,
} from "@feniix/bridgekit";
import type { Static, TObject } from "typebox";
import type { ToolPerformResult } from "./formatters.js";
import { createResearchPlanner, type ResearchPlanner } from "./research-planner.js";
import {
  exaResearchResetParams,
  exaResearchStatusParams,
  exaResearchStepParams,
  exaResearchSummaryParams,
  webAnswerParams,
  webFetchParams,
  webFindSimilarParams,
  webResearchParams,
  webSearchAdvancedParams,
  webSearchParams,
} from "./schemas.js";
import { PLANNER_GUIDELINES } from "./tool-guidance.js";
import { performAnswer } from "./web-answer.js";
import { performWebFetch } from "./web-fetch.js";
import { performFindSimilar } from "./web-find-similar.js";
import { AgentResearchCancelledError, AgentResearchTimeoutError, performResearch } from "./web-research.js";
import { DEFAULT_NUM_RESULTS, performWebSearch } from "./web-search.js";
import { performAdvancedSearch } from "./web-search-advanced.js";

export interface ExaToolsOptions {
  /** Resolve the Exa API key at execute time. Return undefined when unconfigured. */
  resolveApiKey?: () => string | undefined;
  /** Host-agnostic gating; tools whose names return false are omitted from the returned array. */
  isToolEnabled?: (name: string) => boolean;
  /** Planner instance for the four exa_research_* tools. Defaults to a fresh createResearchPlanner(). */
  planner?: ResearchPlanner;
  /**
   * Per-call timeout overrides in ms. Precedence: per-tool entry → `default` →
   * built-in per-tool default (60_000ms; 180_000ms for advanced search and research).
   * Resolved at execute time so config can change after construction.
   *
   * For ordinary SDK calls, the timeout bounds only the JS-side wait because
   * exa-js does not accept AbortSignal (exa-labs/exa-js#158).
   * `web_research_exa` owns its lifecycle and cancels its remote Agent run
   * when the host aborts or its timeout expires after a run ID is known.
   */
  timeouts?: ExaToolTimeouts;
}

/** Per-tool timeout overrides; all entries are optional positive integers (ms). */
export interface ExaToolTimeouts {
  default?: number;
  web_search_exa?: number;
  web_fetch_exa?: number;
  web_answer_exa?: number;
  web_find_similar_exa?: number;
  web_search_advanced_exa?: number;
  web_research_exa?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RESEARCH_TIMEOUT_MS = 180_000;

const EXA_JS_SIGNAL_ISSUE = "https://github.com/exa-labs/exa-js/issues/158";

/** Resolve the effective timeout for `toolName` given optional caller overrides. */
export function resolveExaToolTimeoutMs(toolName: string, timeouts?: ExaToolTimeouts): number {
  if (timeouts) {
    const perTool = timeouts[toolName as keyof ExaToolTimeouts];
    if (typeof perTool === "number" && perTool > 0) return perTool;
    if (typeof timeouts.default === "number" && timeouts.default > 0) return timeouts.default;
  }
  return toolName === "web_research_exa" || toolName === "web_search_advanced_exa"
    ? DEFAULT_RESEARCH_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

class ExaTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly toolName: string;
  constructor(timeoutMs: number, toolName: string) {
    super(
      `${toolName} timed out after ${timeoutMs}ms. The underlying Exa request continues to bill ` +
        `until exa-js supports AbortSignal (${EXA_JS_SIGNAL_ISSUE}).`,
    );
    this.name = "ExaTimeoutError";
    this.timeoutMs = timeoutMs;
    this.toolName = toolName;
  }
}

class ExaCancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "ExaCancelledError";
  }
}

/**
 * Race a promise against an AbortSignal and a per-call timeout.
 *
 * - perform resolves first  → resolves with the value
 * - signal aborts            → rejects with ExaCancelledError
 * - timeoutMs elapses        → rejects with ExaTimeoutError(timeoutMs, toolName)
 * - perform rejects          → rejects with the original error
 *
 * The underlying perform promise is not cancelled — exa-js does not accept
 * a signal. The helper bounds the JS-side wait only.
 */
function isListenableSignal(signal: AbortSignal | undefined): signal is AbortSignal {
  // Defensive: extension.test.ts and other call sites construct synthetic
  // signals like `{ aborted: false } as AbortSignal`. Treat those as
  // pre-flight-only — addEventListener wouldn't function on them anyway.
  return Boolean(
    signal && typeof signal.addEventListener === "function" && typeof signal.removeEventListener === "function",
  );
}

function withTimeoutAndAbort<T>(
  performPromise: Promise<T>,
  opts: { signal?: AbortSignal; timeoutMs: number; toolName: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const listenable = isListenableSignal(opts.signal);
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (listenable) {
        opts.signal?.removeEventListener("abort", onAbort);
      }
      action();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new ExaTimeoutError(opts.timeoutMs, opts.toolName)));
    }, opts.timeoutMs);

    const onAbort = (): void => {
      settle(() => reject(new ExaCancelledError()));
    };

    if (listenable) {
      opts.signal?.addEventListener("abort", onAbort, { once: true });
    }

    performPromise.then(
      (value) => settle(() => resolve(value)),
      (err) => settle(() => reject(err)),
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localToolResult(toolName: string, result: unknown): PortableToolResult {
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const base = { tool: toolName };
  // base-wins spread guarantees that planner result fields (current or future)
  // cannot override the canonical `tool` discriminator on structuredContent.
  return {
    text,
    structuredContent: isRecord(result) ? { ...result, ...base } : base,
  };
}

function localToolError(toolName: string, label: string, error: unknown): PortableToolResult {
  const message = toErrorMessage(error);
  return {
    text: `${label} error: ${message}`,
    isError: true,
    structuredContent: { kind: "domain", tool: toolName, error: message },
  };
}

const MISSING_KEY_TEXT = "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag.";

function missingApiKeyResult(toolName: string) {
  return {
    text: MISSING_KEY_TEXT,
    isError: true as const,
    structuredContent: { kind: "domain", tool: toolName, error: "missing_api_key" },
  };
}

function cancelledResult(toolName: string, details: Record<string, unknown> = {}) {
  return {
    text: "Cancelled.",
    structuredContent: { tool: toolName, cancelled: true, ...details },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  // Plain-object rejections (e.g., `{ message: "rate limited", code: 429 }`)
  // would otherwise stringify to "[object Object]" via the fallback below.
  // Prefer the object's own `.message` field when it's a non-empty string.
  if (typeof error === "object" && error !== null && "message" in error) {
    const candidate = (error as { message: unknown }).message;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return String(error);
}

interface ExaToolSpec<TParams extends TObject> {
  name: string;
  title: string;
  description: string;
  parameters: TParams;
  pendingMessage: string;
  errorPrefix: string;
  hostExtras?: PortableToolHostExtras;
  managesLifecycle?: boolean;
  perform: (
    apiKey: string,
    args: Static<TParams>,
    context: { signal?: AbortSignal; timeoutMs: number },
  ) => Promise<ToolPerformResult>;
}

function exaTool<TParams extends TObject>(
  spec: ExaToolSpec<TParams>,
  resolveApiKey: () => string | undefined,
  resolveTimeoutMs: () => number,
): PortableTool<TParams> {
  // Thread the spec's pendingMessage into hostExtras.pi.pendingMessage so
  // bridgekit's pi adapter fires it pre-validation via onUpdate. The previous
  // in-execute ctx.progress?.() emission has been removed: it fired AFTER the
  // missing-api-key / signal-aborted short-circuits and AFTER TypeBox
  // validation, so users with bad inputs never saw a pending signal. The
  // pre-validation hook is strictly better UX.
  const piExtras = { ...(spec.hostExtras?.pi ?? {}), pendingMessage: spec.pendingMessage };
  const hostExtras: PortableToolHostExtras = { ...spec.hostExtras, pi: piExtras };
  return definePortableTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    parameters: spec.parameters,
    hostExtras,
    async execute(args, ctx) {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        return missingApiKeyResult(spec.name);
      }
      if (ctx.signal?.aborted) {
        return cancelledResult(spec.name);
      }
      const timeoutMs = resolveTimeoutMs();
      try {
        const performPromise = spec.perform(apiKey, args, { signal: ctx.signal, timeoutMs });
        const result = spec.managesLifecycle
          ? await performPromise
          : await withTimeoutAndAbort(performPromise, {
              signal: ctx.signal,
              timeoutMs,
              toolName: spec.name,
            });
        return { text: result.text, structuredContent: result.details };
      } catch (error) {
        if (error instanceof AgentResearchCancelledError) {
          return cancelledResult(spec.name, {
            ...(error.runId === undefined ? {} : { runId: error.runId }),
            ...(error.cancelError === undefined ? {} : { cancelError: error.cancelError }),
          });
        }
        if (error instanceof AgentResearchTimeoutError) {
          return {
            text: error.message,
            isError: true,
            structuredContent: {
              kind: "domain",
              tool: spec.name,
              error: "timeout",
              timeoutMs: error.timeoutMs,
              ...(error.runId === undefined ? {} : { runId: error.runId }),
              ...(error.cancelError === undefined ? {} : { cancelError: error.cancelError }),
            },
          };
        }
        if (error instanceof ExaCancelledError) {
          return cancelledResult(spec.name);
        }
        if (error instanceof ExaTimeoutError) {
          return {
            text: error.message,
            isError: true,
            structuredContent: {
              kind: "domain",
              tool: spec.name,
              error: "timeout",
              timeoutMs: error.timeoutMs,
            },
          };
        }
        const message = toErrorMessage(error);
        return {
          text: `${spec.errorPrefix}: ${message}`,
          isError: true,
          structuredContent: { kind: "domain", tool: spec.name, error: message },
        };
      }
    },
  });
}

export function createExaTools(opts: ExaToolsOptions = {}): readonly PortableTool<TObject>[] {
  const resolveApiKey = opts.resolveApiKey ?? (() => undefined);
  const isEnabled = opts.isToolEnabled ?? (() => true);
  const planner = opts.planner ?? createResearchPlanner();
  const timeoutFor = (toolName: string) => () => resolveExaToolTimeoutMs(toolName, opts.timeouts);

  const tools: PortableTool<TObject>[] = [];

  if (isEnabled("exa_research_step")) {
    tools.push(
      definePortableTool({
        name: "exa_research_step",
        title: "Exa Research Step",
        description: "Record one step in a stateful, local Exa research planning session without calling Exa APIs.",
        parameters: exaResearchStepParams,
        // Local planner state — each step appends, not idempotent; openWorld=false
        // because no Exa calls are made.
        hostExtras: {
          pi: {
            promptSnippet: "Record iterative research-planning state before retrieval.",
            promptGuidelines: PLANNER_GUIDELINES,
          },
          mcp: { annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false } },
        },
        execute(args) {
          try {
            return localToolResult("exa_research_step", planner.recordStep(args));
          } catch (error) {
            return localToolError("exa_research_step", "Exa Research Step", error);
          }
        },
      }),
    );
  }

  if (isEnabled("exa_research_status")) {
    tools.push(
      definePortableTool({
        name: "exa_research_status",
        title: "Exa Research Status",
        description:
          "Report current local Exa research planning state, criteria coverage, sources, gaps, and next action.",
        parameters: exaResearchStatusParams,
        hostExtras: {
          pi: {
            promptSnippet: "Inspect current research-planning state.",
            promptGuidelines: PLANNER_GUIDELINES,
          },
          mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
        },
        execute() {
          try {
            return localToolResult("exa_research_status", planner.getStatus());
          } catch (error) {
            return localToolError("exa_research_status", "Exa Research Status", error);
          }
        },
      }),
    );
  }

  if (isEnabled("exa_research_summary")) {
    tools.push(
      definePortableTool({
        name: "exa_research_summary",
        title: "Exa Research Summary",
        description:
          "Generate a human-readable Exa research plan, Source Pack, or optional suggested web_research_exa payload.",
        parameters: exaResearchSummaryParams,
        // Idempotent because the summary is deterministic from the planner
        // state — no LLM call, no timestamping that varies across calls.
        hostExtras: {
          pi: {
            promptSnippet: "Summarize the accumulated Exa research plan.",
            promptGuidelines: PLANNER_GUIDELINES,
          },
          mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
        },
        execute(args) {
          try {
            return localToolResult("exa_research_summary", planner.getSummary(args));
          } catch (error) {
            return localToolError("exa_research_summary", "Exa Research Summary", error);
          }
        },
      }),
    );
  }

  if (isEnabled("exa_research_reset")) {
    tools.push(
      definePortableTool({
        name: "exa_research_reset",
        title: "Exa Research Reset",
        description: "Clear the current in-memory Exa research planning session.",
        parameters: exaResearchResetParams,
        // destructive=true (clears state); idempotent=true (resetting an empty
        // session is a no-op).
        hostExtras: {
          pi: {
            promptSnippet: "Reset local Exa research-planning state.",
            promptGuidelines: PLANNER_GUIDELINES,
          },
          mcp: { annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false } },
        },
        execute() {
          try {
            return localToolResult("exa_research_reset", planner.reset());
          } catch (error) {
            return localToolError("exa_research_reset", "Exa Research Reset", error);
          }
        },
      }),
    );
  }

  if (isEnabled("web_search_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_search_exa",
          title: "Exa Web Search",
          description:
            "Search the web for any topic and get clean, ready-to-use content. Best for lookup and current information queries.",
          parameters: webSearchParams,
          pendingMessage: "Searching the web via Exa...",
          errorPrefix: "Exa search error",
          hostExtras: {
            pi: {
              promptSnippet: "Quick web search for lookups, discovery, and current pages.",
              promptGuidelines: [
                "Use web_search_exa for quick lookups and finding pages; use web_answer_exa for direct factual questions with citations.",
                "Use web_search_exa for simple searches; use web_search_advanced_exa when you need category, domain, or date filters.",
                "Use web_search_exa to discover candidate URLs; use web_fetch_exa to read a known page in full.",
                "Use web_search_exa for retrieval; use web_search_advanced_exa for controlled one-shot synthesis or web_research_exa for autonomous multi-step research.",
              ],
            },
            // External network call; results may drift between calls
            // (page rankings, freshness). readOnly relative to Exa's side
            // since the search itself doesn't modify state.
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args) => performWebSearch(apiKey, args.query, args.numResults ?? DEFAULT_NUM_RESULTS),
        },
        resolveApiKey,
        timeoutFor("web_search_exa"),
      ),
    );
  }

  if (isEnabled("web_fetch_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_fetch_exa",
          title: "Exa Web Fetch",
          description:
            "Read a webpage's full content as clean markdown. Best for extracting full content from known URLs.",
          parameters: webFetchParams,
          pendingMessage: "Fetching content via Exa...",
          errorPrefix: "Exa fetch error",
          hostExtras: {
            pi: {
              promptSnippet: "Read known URLs as clean page text with optional summaries.",
              promptGuidelines: [
                "Use web_fetch_exa after web_search_exa or web_search_advanced_exa when snippets are not enough.",
                "Use web_fetch_exa to read a known URL in full; use web_answer_exa when the user only needs a concise cited answer.",
                "Use web_fetch_exa to inspect returned pages; use web_find_similar_exa when you want more pages like a source URL.",
              ],
            },
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args) =>
            performWebFetch(apiKey, args.urls, {
              maxCharacters: args.maxCharacters,
              highlights: args.highlights,
              summary: args.summary,
              maxAgeHours: args.maxAgeHours,
            }),
        },
        resolveApiKey,
        timeoutFor("web_fetch_exa"),
      ),
    );
  }

  if (isEnabled("web_answer_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_answer_exa",
          title: "Exa Answer",
          description:
            "Get a grounded answer with source citations. Returns the answer as a plain string by default; " +
            "pass `outputSchema` to receive structured output instead.",
          parameters: webAnswerParams,
          pendingMessage: "Fetching answer from Exa...",
          errorPrefix: "Exa answer error",
          hostExtras: {
            pi: {
              promptSnippet: "Grounded answers with citations for direct questions.",
              promptGuidelines: [
                "Use web_answer_exa for direct factual questions; use web_search_advanced_exa for controlled one-shot synthesis or web_research_exa for autonomous research.",
                "Use web_answer_exa when the user wants a concise answer; use web_search_exa when you first need to discover candidate pages.",
                "Use web_answer_exa for a cited response; use web_fetch_exa when you need the full source text.",
              ],
            },
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args) =>
            performAnswer(apiKey, {
              query: args.query,
              systemPrompt: args.systemPrompt,
              text: args.text,
              outputSchema: args.outputSchema,
            }),
        },
        resolveApiKey,
        timeoutFor("web_answer_exa"),
      ),
    );
  }

  if (isEnabled("web_find_similar_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_find_similar_exa",
          title: "Exa Similar Pages",
          description:
            "Deprecated Exa URL-similarity search. Use only when a known URL is the essential seed; prefer web_search_exa or web_search_advanced_exa for new discovery workflows.",
          parameters: webFindSimilarParams,
          pendingMessage: "Finding similar pages via Exa...",
          errorPrefix: "Exa similar search error",
          hostExtras: {
            pi: {
              promptSnippet: "Find pages similar to a known source URL.",
              promptGuidelines: [
                "Use deprecated web_find_similar_exa only when a known URL is an essential similarity seed; prefer web_search_exa for query-based discovery.",
                "Use web_find_similar_exa for legacy URL-seeded expansion; prefer web_search_advanced_exa when filters or Deep Search can express the goal.",
                "Use web_find_similar_exa to discover related pages; use web_fetch_exa to inspect the returned URLs in full.",
              ],
            },
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args) =>
            performFindSimilar(apiKey, {
              url: args.url,
              numResults: args.numResults,
              textMaxCharacters: args.textMaxCharacters,
              excludeSourceDomain: args.excludeSourceDomain,
              startPublishedDate: args.startPublishedDate,
              endPublishedDate: args.endPublishedDate,
              includeDomains: args.includeDomains,
              excludeDomains: args.excludeDomains,
            }),
        },
        resolveApiKey,
        timeoutFor("web_find_similar_exa"),
      ),
    );
  }

  if (isEnabled("web_research_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_research_exa",
          title: "Exa Agent Research",
          description:
            "Asynchronous autonomous Exa Agent research for complex multi-step work, row enrichment, continuation, or Connect data sources. Polls a cancellable run to completion. " +
            'Returns the synthesis as plain text by default; pass `outputSchema: { "type": "object", "properties": {...} }` ' +
            "to receive structured output. Prefer web_search_advanced_exa Deep Search for controlled one-shot synthesis.",
          parameters: webResearchParams,
          pendingMessage: "Performing deep research via Exa...",
          errorPrefix: "Exa research error",
          managesLifecycle: true,
          hostExtras: {
            pi: {
              promptSnippet: "Agent research; higher cost/latency. Choose effort and output schema deliberately.",
              promptGuidelines: [
                "Use web_research_exa for autonomous multi-step work; for controlled one-shot synthesis with explicit filters, prefer web_search_advanced_exa Deep Search.",
                "Use web_research_exa for open-ended synthesis; use web_answer_exa for direct questions needing a concise cited answer.",
                "web_research_exa defaults to medium effort; use minimal/low for narrow work and high/xhigh for difficult work, or use web_answer_exa for a cheaper concise answer.",
                "Choose web_research_exa when you need input rows, exclusions, continuation, Connect data sources, or an explicit Agent budget; use web_search_advanced_exa when those Agent-only capabilities are unnecessary.",
                "For metered auto/max effort in web_research_exa, set budget.maxCostDollars; prefer web_search_exa when simple retrieval can answer the question.",
              ],
            },
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args, context) =>
            performResearch(
              apiKey,
              {
                query: args.query,
                systemPrompt: args.systemPrompt,
                outputSchema: args.outputSchema,
                effort: args.effort,
                input: args.input as Parameters<typeof performResearch>[1]["input"],
                previousRunId: args.previousRunId,
                metadata: args.metadata as Parameters<typeof performResearch>[1]["metadata"],
                dataSources: args.dataSources,
                budget: args.budget,
              },
              context,
            ),
        },
        resolveApiKey,
        timeoutFor("web_research_exa"),
      ),
    );
  }

  if (isEnabled("web_search_advanced_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_search_advanced_exa",
          title: "Exa Advanced Search",
          description:
            "Synchronous Deep Search through one Exa /search call with filters and optional synthesis. Use instant/fast/auto for retrieval; deep-lite for lightweight synthesis, deep for comprehensive synthesis, and deep-reasoning only for difficult analysis. Supports text or structured output.",
          parameters: webSearchAdvancedParams,
          pendingMessage: "Performing advanced search via Exa...",
          errorPrefix: "Exa advanced search error",
          hostExtras: {
            pi: {
              promptSnippet:
                "Filtered search and synchronous Deep Search; higher deep modes cost more and take longer.",
              promptGuidelines: [
                "In web_search_advanced_exa, use instant for minimum latency, fast for speed, and auto for balanced retrieval; prefer web_search_exa when explicit mode or filters are unnecessary.",
                "In web_search_advanced_exa, use deep-lite for lightweight synthesis, deep for comprehensive synthesis, and deep-reasoning only for difficult analysis; use web_research_exa for autonomous asynchronous work.",
                "With web_search_advanced_exa, constrain authoritative sources with includeDomains, use outputSchema for extraction, and add additionalQueries only when deep-mode breadth justifies extra cost and latency; use web_fetch_exa to inspect decisive sources.",
              ],
            },
            mcp: { annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true } },
          },
          perform: (apiKey, args) =>
            performAdvancedSearch(apiKey, args.query, {
              numResults: args.numResults,
              category: args.category,
              type: args.type,
              systemPrompt: args.systemPrompt,
              outputSchema: args.outputSchema,
              startPublishedDate: args.startPublishedDate,
              endPublishedDate: args.endPublishedDate,
              includeDomains: args.includeDomains,
              excludeDomains: args.excludeDomains,
              includeText: args.includeText,
              excludeText: args.excludeText,
              userLocation: args.userLocation,
              moderation: args.moderation,
              additionalQueries: args.additionalQueries,
              textMaxCharacters: args.textMaxCharacters,
              contextMaxCharacters: args.contextMaxCharacters,
              enableHighlights: args.enableHighlights,
              highlightsNumSentences: args.highlightsNumSentences,
              highlightsMaxCharacters: args.highlightsMaxCharacters,
              highlightsQuery: args.highlightsQuery,
              enableSummary: args.enableSummary,
              summaryQuery: args.summaryQuery,
              maxAgeHours: args.maxAgeHours,
              livecrawlTimeout: args.livecrawlTimeout,
              subpages: args.subpages,
              subpageTarget: args.subpageTarget,
            }),
        },
        resolveApiKey,
        timeoutFor("web_search_advanced_exa"),
      ),
    );
  }

  return tools;
}

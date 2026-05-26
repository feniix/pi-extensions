/**
 * Host-neutral portable tool definitions for pi-exa.
 *
 * Tools defined here are consumed by both the Pi adapter (extensions/index.ts)
 * and the MCP stdio server (extensions/mcp-server.ts). Files in this module
 * must not import from `@earendil-works/pi-coding-agent` or the MCP SDK.
 */

import { definePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
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
import { performAnswer } from "./web-answer.js";
import { performWebFetch } from "./web-fetch.js";
import { performFindSimilar } from "./web-find-similar.js";
import { performResearch } from "./web-research.js";
import { DEFAULT_NUM_RESULTS, performWebSearch } from "./web-search.js";
import { performAdvancedSearch } from "./web-search-advanced.js";

export interface ExaToolsOptions {
  /** Resolve the Exa API key at execute time. Return undefined when unconfigured. */
  resolveApiKey?: () => string | undefined;
  /** Host-agnostic gating; tools whose names return false are omitted from the returned array. */
  isToolEnabled?: (name: string) => boolean;
  /** Planner instance for the four exa_research_* tools. Defaults to a fresh createResearchPlanner(). */
  planner?: ResearchPlanner;
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
    structuredContent: { tool: toolName, error: message },
  };
}

const MISSING_KEY_TEXT = "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag.";

function missingApiKeyResult(toolName: string) {
  return {
    text: MISSING_KEY_TEXT,
    isError: true as const,
    structuredContent: { tool: toolName, error: "missing_api_key" },
  };
}

function cancelledResult(toolName: string) {
  return {
    text: "Cancelled.",
    structuredContent: { tool: toolName, cancelled: true },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ExaToolSpec<TParams extends TObject> {
  name: string;
  title: string;
  description: string;
  parameters: TParams;
  pendingMessage: string;
  errorPrefix: string;
  perform: (apiKey: string, args: Static<TParams>) => Promise<ToolPerformResult>;
}

function exaTool<TParams extends TObject>(
  spec: ExaToolSpec<TParams>,
  resolveApiKey: () => string | undefined,
): PortableTool<TParams> {
  return definePortableTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    parameters: spec.parameters,
    async execute(args, ctx) {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        return missingApiKeyResult(spec.name);
      }
      if (ctx.signal?.aborted) {
        return cancelledResult(spec.name);
      }
      ctx.progress?.({
        text: spec.pendingMessage,
        structuredContent: { status: "pending" },
      });
      try {
        const result = await spec.perform(apiKey, args);
        return { text: result.text, structuredContent: result.details };
      } catch (error) {
        const message = toErrorMessage(error);
        return {
          text: `${spec.errorPrefix}: ${message}`,
          isError: true,
          structuredContent: { tool: spec.name, error: message },
        };
      }
    },
  });
}

export function createExaTools(opts: ExaToolsOptions = {}): readonly PortableTool<TObject>[] {
  const resolveApiKey = opts.resolveApiKey ?? (() => undefined);
  const isEnabled = opts.isToolEnabled ?? (() => true);
  const planner = opts.planner ?? createResearchPlanner();

  const tools: PortableTool<TObject>[] = [];

  if (isEnabled("exa_research_step")) {
    tools.push(
      definePortableTool({
        name: "exa_research_step",
        title: "Exa Research Step",
        description: "Record one step in a stateful, local Exa research planning session without calling Exa APIs.",
        parameters: exaResearchStepParams,
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
          perform: (apiKey, args) => performWebSearch(apiKey, args.query, args.numResults ?? DEFAULT_NUM_RESULTS),
        },
        resolveApiKey,
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
          perform: (apiKey, args) =>
            performWebFetch(apiKey, args.urls, {
              maxCharacters: args.maxCharacters,
              highlights: args.highlights,
              summary: args.summary,
              maxAgeHours: args.maxAgeHours,
            }),
        },
        resolveApiKey,
      ),
    );
  }

  if (isEnabled("web_answer_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_answer_exa",
          title: "Exa Answer",
          description: "Get a grounded answer with source citations and optional structured output.",
          parameters: webAnswerParams,
          pendingMessage: "Fetching answer from Exa...",
          errorPrefix: "Exa answer error",
          perform: (apiKey, args) =>
            performAnswer(apiKey, {
              query: args.query,
              systemPrompt: args.systemPrompt,
              text: args.text,
              outputSchema: args.outputSchema,
            }),
        },
        resolveApiKey,
      ),
    );
  }

  if (isEnabled("web_find_similar_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_find_similar_exa",
          title: "Exa Similar Pages",
          description: "Find web pages similar to a given URL.",
          parameters: webFindSimilarParams,
          pendingMessage: "Finding similar pages via Exa...",
          errorPrefix: "Exa similar search error",
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
      ),
    );
  }

  if (isEnabled("web_research_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_research_exa",
          title: "Exa Deep Research",
          description: "Deep-reasoning Exa search with synthesized, grounded output for complex research topics.",
          parameters: webResearchParams,
          pendingMessage: "Performing deep research via Exa...",
          errorPrefix: "Exa research error",
          perform: (apiKey, args) =>
            performResearch(apiKey, {
              query: args.query,
              type: args.type,
              systemPrompt: args.systemPrompt,
              textMaxCharacters: args.textMaxCharacters,
              outputSchema: args.outputSchema,
              additionalQueries: args.additionalQueries,
              numResults: args.numResults,
              includeDomains: args.includeDomains,
              excludeDomains: args.excludeDomains,
              startPublishedDate: args.startPublishedDate,
              endPublishedDate: args.endPublishedDate,
            }),
        },
        resolveApiKey,
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
            "Advanced web search with full Exa API control: category filters, domain restrictions, date ranges, text-content filters (includeText/excludeText), location targeting (userLocation), highlights, LLM summaries, freshness controls (maxAgeHours, livecrawlTimeout), and subpage crawling (subpages, subpageTarget).",
          parameters: webSearchAdvancedParams,
          pendingMessage: "Performing advanced search via Exa...",
          errorPrefix: "Exa advanced search error",
          perform: (apiKey, args) =>
            performAdvancedSearch(apiKey, args.query, {
              numResults: args.numResults,
              category: args.category,
              type: args.type,
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
      ),
    );
  }

  return tools;
}

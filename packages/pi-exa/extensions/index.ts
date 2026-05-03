/**
 * Exa AI extension for pi
 *
 * Provides Exa search tools via native TypeScript using the Exa API directly.
 */

import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import type { ToolPerformResult } from "./formatters.js";
import { getResearchStatus, getResearchSummary, recordResearchStep, resetResearchPlanner } from "./research-planner.js";
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

// Re-export public API for tests and consumers
export {
  getAuthStatusMessage,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
} from "./config.js";
export { formatCrawlResults, formatSearchResults } from "./formatters.js";
export { DEFAULT_MAX_CHARACTERS } from "./web-fetch.js";
export { DEFAULT_NUM_RESULTS } from "./web-search.js";

// =============================================================================
// Tool Registration Helpers
// =============================================================================

type ExaToolSpec<TParams extends TSchema> = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: TParams;
  pendingMessage: string;
  errorPrefix: string;
  perform: (apiKey: string, params: Static<TParams>) => Promise<ToolPerformResult>;
};

type LocalToolSpec<TParams extends TSchema> = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: TParams;
  perform: (params: Static<TParams>) => unknown;
};

function toolDetails(toolName: string): { tool: string } {
  return { tool: toolName };
}

function missingApiKeyResult(toolName: string) {
  return {
    content: [
      { type: "text" as const, text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." },
    ],
    isError: true,
    details: { ...toolDetails(toolName), error: "missing_api_key" },
  };
}

function cancelledResult(toolName: string) {
  return {
    content: [{ type: "text" as const, text: "Cancelled." }],
    details: { ...toolDetails(toolName), cancelled: true },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function registerLocalTool<TParams extends TSchema>(pi: ExtensionAPI, spec: LocalToolSpec<TParams>): void {
  pi.registerTool(
    defineTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      promptSnippet: spec.promptSnippet,
      promptGuidelines: spec.promptGuidelines,
      parameters: spec.parameters,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        if (signal?.aborted) {
          return cancelledResult(spec.name);
        }

        try {
          const result = spec.perform(params);
          return { content: [{ type: "text" as const, text: toText(result) }], details: toolDetails(spec.name) };
        } catch (error) {
          const message = toErrorMessage(error);
          return {
            content: [{ type: "text" as const, text: `${spec.label} error: ${message}` }],
            isError: true,
            details: { ...toolDetails(spec.name), error: message },
          };
        }
      },
    }),
  );
}

function registerExaTool<TParams extends TSchema>(pi: ExtensionAPI, spec: ExaToolSpec<TParams>): void {
  pi.registerTool(
    defineTool({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      promptSnippet: spec.promptSnippet,
      promptGuidelines: spec.promptGuidelines,
      parameters: spec.parameters,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = resolveAuth(pi).apiKey;
        if (!apiKey) {
          return missingApiKeyResult(spec.name);
        }

        if (signal?.aborted) {
          return cancelledResult(spec.name);
        }

        onUpdate?.({
          content: [{ type: "text", text: spec.pendingMessage }],
          details: { status: "pending" },
        });

        try {
          const result = await spec.perform(apiKey, params);
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = toErrorMessage(error);
          return {
            content: [{ type: "text", text: `${spec.errorPrefix}: ${message}` }],
            isError: true,
            details: { ...toolDetails(spec.name), error: message },
          };
        }
      },
    }),
  );
}

function registerResearchPlannerTools(pi: ExtensionAPI, isToolEnabled: (toolName: string) => boolean): void {
  const plannerGuidelines = [
    "Use exa_research_step to externalize non-trivial Exa research planning before expensive retrieval.",
    "Planning tools recommend Exa retrieval calls but never execute network or cost-incurring operations internally.",
    "Use exa_research_summary for human-readable plans before requesting payload mode.",
  ];

  if (isToolEnabled("exa_research_step")) {
    registerLocalTool(pi, {
      name: "exa_research_step",
      label: "Exa Research Step",
      description: "Record one step in a stateful, local Exa research planning session without calling Exa APIs.",
      promptSnippet: "Record iterative research-planning state before retrieval.",
      promptGuidelines: plannerGuidelines,
      parameters: exaResearchStepParams,
      perform: recordResearchStep,
    });
  }

  if (isToolEnabled("exa_research_status")) {
    registerLocalTool(pi, {
      name: "exa_research_status",
      label: "Exa Research Status",
      description:
        "Report current local Exa research planning state, criteria coverage, sources, gaps, and next action.",
      promptSnippet: "Inspect current research-planning state.",
      promptGuidelines: plannerGuidelines,
      parameters: exaResearchStatusParams,
      perform: () => getResearchStatus(),
    });
  }

  if (isToolEnabled("exa_research_summary")) {
    registerLocalTool(pi, {
      name: "exa_research_summary",
      label: "Exa Research Summary",
      description:
        "Generate a human-readable Exa research plan, Source Pack, or optional suggested web_research_exa payload.",
      promptSnippet: "Summarize the accumulated Exa research plan.",
      promptGuidelines: plannerGuidelines,
      parameters: exaResearchSummaryParams,
      perform: getResearchSummary,
    });
  }

  if (isToolEnabled("exa_research_reset")) {
    registerLocalTool(pi, {
      name: "exa_research_reset",
      label: "Exa Research Reset",
      description: "Clear the current in-memory Exa research planning session.",
      promptSnippet: "Reset local Exa research-planning state.",
      promptGuidelines: plannerGuidelines,
      parameters: exaResearchResetParams,
      perform: () => resetResearchPlanner(),
    });
  }
}

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag("--exa-api-key", {
    description: "Exa AI API key for search operations",
    type: "string",
  });
  pi.registerFlag("--exa-enable-advanced", {
    description: "Enable web_search_advanced_exa tool",
    type: "boolean",
  });
  pi.registerFlag("--exa-enable-research", {
    description: "Enable web_research_exa tool",
    type: "boolean",
  });
  pi.registerFlag("--exa-config-file", {
    description: "Path to custom JSON config file for private overrides such as API keys.",
    type: "string",
  });
  pi.registerFlag("--exa-config", {
    description: "Deprecated alias for --exa-config-file.",
    type: "string",
  });
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
  registerFlags(pi);

  const resolvedConfig = getResolvedConfig(pi);
  const isToolEnabled = (toolName: string): boolean => isToolEnabledForConfig(pi, resolvedConfig, toolName);
  registerResearchPlannerTools(pi, isToolEnabled);

  if (isToolEnabled("web_search_exa")) {
    registerExaTool(pi, {
      name: "web_search_exa",
      label: "Exa Web Search",
      description:
        "Search the web for any topic and get clean, ready-to-use content. Best for lookup and current information queries.",
      promptSnippet: "Quick web search for lookups, discovery, and current pages.",
      promptGuidelines: [
        "Use web_search_exa for quick lookups and finding pages; use web_answer_exa for direct factual questions with citations.",
        "Use web_search_exa for simple searches; use web_search_advanced_exa when you need category, domain, or date filters.",
        "Use web_search_exa to discover candidate URLs; use web_fetch_exa to read a known page in full.",
        "Use web_search_exa for retrieval; use web_research_exa for comparisons, synthesis, and recommendations.",
      ],
      parameters: webSearchParams,
      pendingMessage: "Searching the web via Exa...",
      errorPrefix: "Exa search error",
      perform: (apiKey, params) => performWebSearch(apiKey, params.query, params.numResults || DEFAULT_NUM_RESULTS),
    });
  }

  if (isToolEnabled("web_fetch_exa")) {
    registerExaTool(pi, {
      name: "web_fetch_exa",
      label: "Exa Web Fetch",
      description: "Read a webpage's full content as clean markdown. Best for extracting full content from known URLs.",
      promptSnippet: "Read known URLs as clean page text with optional summaries.",
      promptGuidelines: [
        "Use web_fetch_exa after web_search_exa or web_search_advanced_exa when snippets are not enough.",
        "Use web_fetch_exa to read a known URL in full; use web_answer_exa when the user only needs a concise cited answer.",
        "Use web_fetch_exa to inspect returned pages; use web_find_similar_exa when you want more pages like a source URL.",
      ],
      parameters: webFetchParams,
      pendingMessage: "Fetching content via Exa...",
      errorPrefix: "Exa fetch error",
      perform: (apiKey, params) =>
        performWebFetch(apiKey, params.urls, {
          maxCharacters: params.maxCharacters,
          highlights: params.highlights,
          summary: params.summary,
          maxAgeHours: params.maxAgeHours,
        }),
    });
  }

  if (isToolEnabled("web_search_advanced_exa")) {
    registerExaTool(pi, {
      name: "web_search_advanced_exa",
      label: "Exa Advanced Search",
      description:
        "Advanced web search with full Exa API control including category filters, domain restrictions, date ranges, highlights, and summaries.",
      promptSnippet: "Advanced search with category, domain, and date filters.",
      promptGuidelines: [
        "Use web_search_advanced_exa when you need category, domain, or date filters; use web_search_exa for simpler lookups.",
        "Use web_search_advanced_exa for retrieval with constraints; use web_research_exa for deep synthesis and comparisons.",
        "Use web_search_advanced_exa to find filtered result sets; use web_fetch_exa to read the selected URLs.",
      ],
      parameters: webSearchAdvancedParams,
      pendingMessage: "Performing advanced search via Exa...",
      errorPrefix: "Exa advanced search error",
      perform: (apiKey, params) =>
        performAdvancedSearch(apiKey, params.query, {
          numResults: params.numResults,
          category: params.category,
          type: params.type,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
          includeDomains: params.includeDomains,
          excludeDomains: params.excludeDomains,
          textMaxCharacters: params.textMaxCharacters,
          enableHighlights: params.enableHighlights,
          highlightsNumSentences: params.highlightsNumSentences,
        }),
    });
  }

  if (isToolEnabled("web_research_exa")) {
    registerExaTool(pi, {
      name: "web_research_exa",
      label: "Exa Deep Research",
      description: "Deep-reasoning Exa search with synthesized, grounded output for complex research topics.",
      promptSnippet: "Deep research with grounded synthesis; higher cost and latency.",
      promptGuidelines: [
        "Use web_research_exa for conclusions, comparisons, and recommendations; use web_search_exa for simple lookups.",
        "Use web_research_exa for open-ended synthesis; use web_answer_exa for direct questions needing a concise cited answer.",
        "Use web_research_exa when a systemPrompt or outputSchema is needed; use web_search_advanced_exa for filtered retrieval only.",
      ],
      parameters: webResearchParams,
      pendingMessage: "Performing deep research via Exa...",
      errorPrefix: "Exa research error",
      perform: (apiKey, params) =>
        performResearch(apiKey, {
          query: params.query,
          type: params.type,
          systemPrompt: params.systemPrompt,
          textMaxCharacters: params.textMaxCharacters,
          outputSchema: params.outputSchema,
          additionalQueries: params.additionalQueries,
          numResults: params.numResults,
          includeDomains: params.includeDomains,
          excludeDomains: params.excludeDomains,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
        }),
    });
  }

  if (isToolEnabled("web_answer_exa")) {
    registerExaTool(pi, {
      name: "web_answer_exa",
      label: "Exa Answer",
      description: "Get a grounded answer with source citations and optional structured output.",
      promptSnippet: "Grounded answers with citations for direct questions.",
      promptGuidelines: [
        "Use web_answer_exa for direct factual questions with sources; use web_research_exa for broader synthesis and comparisons.",
        "Use web_answer_exa when the user wants a concise answer; use web_search_exa when you first need to discover candidate pages.",
        "Use web_answer_exa for a cited response; use web_fetch_exa when you need the full source text.",
      ],
      parameters: webAnswerParams,
      pendingMessage: "Fetching answer from Exa...",
      errorPrefix: "Exa answer error",
      perform: (apiKey, params) =>
        performAnswer(apiKey, {
          query: params.query,
          systemPrompt: params.systemPrompt,
          text: params.text,
          outputSchema: params.outputSchema,
        }),
    });
  }

  if (isToolEnabled("web_find_similar_exa")) {
    registerExaTool(pi, {
      name: "web_find_similar_exa",
      label: "Exa Similar Pages",
      description: "Find web pages similar to a given URL.",
      promptSnippet: "Find pages similar to a known source URL.",
      promptGuidelines: [
        "Use web_find_similar_exa when you have a good page and want more like it; use web_search_exa for keyword-based discovery.",
        "Use web_find_similar_exa to expand from a source URL; use web_search_advanced_exa when you need explicit category, domain, or date filters.",
        "Use web_find_similar_exa to discover related pages; use web_fetch_exa to inspect the returned URLs in full.",
      ],
      parameters: webFindSimilarParams,
      pendingMessage: "Finding similar pages via Exa...",
      errorPrefix: "Exa similar search error",
      perform: (apiKey, params) =>
        performFindSimilar(apiKey, {
          url: params.url,
          numResults: params.numResults,
          textMaxCharacters: params.textMaxCharacters,
          excludeSourceDomain: params.excludeSourceDomain,
          startPublishedDate: params.startPublishedDate,
          endPublishedDate: params.endPublishedDate,
          includeDomains: params.includeDomains,
          excludeDomains: params.excludeDomains,
        }),
    });
  }
}

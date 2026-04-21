/**
 * Exa AI MCP Extension for pi
 *
 * Provides Exa search tools via native TypeScript (no external MCP server required).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAuthStatusMessage, getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import {
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
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
  // SessionStart: check auth and print status
  pi.on("session_start", async () => {
    console.log(getAuthStatusMessage(pi));
  });

  // Register CLI flags
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

  const getApiKey = (): string => resolveAuth(pi).apiKey;
  const isToolEnabled = (toolName: string): boolean => isToolEnabledForConfig(pi, getResolvedConfig(pi), toolName);

  function toolDetails(toolName: string): { tool: string } {
    return { tool: toolName };
  }

  // Register web_search_exa tool
  if (isToolEnabled("web_search_exa")) {
    pi.registerTool({
      name: "web_search_exa",
      label: "Exa Web Search",
      description:
        "Search the web for any topic and get clean, ready-to-use content. Best for lookup and current information queries.",
      promptSnippet: "Quick web search with highlights for lookups and discovery.",
      promptGuidelines: [
        "Use web_search_exa for quick lookups and finding pages; use web_answer_exa for direct factual questions with citations.",
        "Use web_search_exa for simple searches; use web_search_advanced_exa when you need category, domain, or date filters.",
        "Use web_search_exa to discover candidate URLs; use web_fetch_exa to read a known page in full.",
        "Use web_search_exa for retrieval; use web_research_exa for comparisons, synthesis, and recommendations.",
      ],
      parameters: webSearchParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_search_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Searching the web via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const { query, numResults } = params;
          const result = await performWebSearch(apiKey, query, numResults || DEFAULT_NUM_RESULTS);
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa search error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_search_exa"), error: message },
          };
        }
      },
    });
  }

  // Register web_fetch_exa tool
  if (isToolEnabled("web_fetch_exa")) {
    pi.registerTool({
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
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { ...toolDetails("web_fetch_exa"), error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_fetch_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching content via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const result = await performWebFetch(apiKey, params.urls, {
            maxCharacters: params.maxCharacters,
            highlights: params.highlights,
            summary: params.summary,
            maxAgeHours: params.maxAgeHours,
          });
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa fetch error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_fetch_exa"), error: message },
          };
        }
      },
    });
  }

  // Register web_search_advanced_exa tool (disabled by default)
  if (isToolEnabled("web_search_advanced_exa")) {
    pi.registerTool({
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
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { ...toolDetails("web_search_advanced_exa"), error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_search_advanced_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Performing advanced search via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const result = await performAdvancedSearch(apiKey, params.query, {
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
          });
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa advanced search error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_search_advanced_exa"), error: message },
          };
        }
      },
    });
  }

  // Register web_research_exa tool (disabled by default, opt-in)
  if (isToolEnabled("web_research_exa")) {
    pi.registerTool({
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
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { ...toolDetails("web_research_exa"), error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_research_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Performing deep research via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const result = await performResearch(apiKey, {
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
          });
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa research error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_research_exa"), error: message },
          };
        }
      },
    });
  }

  // Register web_answer_exa tool
  if (isToolEnabled("web_answer_exa")) {
    pi.registerTool({
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
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { ...toolDetails("web_answer_exa"), error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_answer_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching answer from Exa..." }],
          details: { status: "pending" },
        });

        try {
          const result = await performAnswer(apiKey, {
            query: params.query,
            systemPrompt: params.systemPrompt,
            text: params.text,
            outputSchema: params.outputSchema,
          });
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa answer error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_answer_exa"), error: message },
          };
        }
      },
    });
  }

  // Register web_find_similar_exa tool
  if (isToolEnabled("web_find_similar_exa")) {
    pi.registerTool({
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
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { ...toolDetails("web_find_similar_exa"), error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { ...toolDetails("web_find_similar_exa"), cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Finding similar pages via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const result = await performFindSimilar(apiKey, {
            url: params.url,
            numResults: params.numResults,
            textMaxCharacters: params.textMaxCharacters,
            excludeSourceDomain: params.excludeSourceDomain,
            startPublishedDate: params.startPublishedDate,
            endPublishedDate: params.endPublishedDate,
            includeDomains: params.includeDomains,
            excludeDomains: params.excludeDomains,
          });
          return { content: [{ type: "text", text: result.text }], details: result.details };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa similar search error: ${message}` }],
            isError: true,
            details: { ...toolDetails("web_find_similar_exa"), error: message },
          };
        }
      },
    });
  }
}

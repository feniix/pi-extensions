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
      promptSnippet: "Search web and return concise results using web_search_exa",
      promptGuidelines: [
        "Use web_search_exa for quick lookup and current facts.",
        "Use web_search_exa before web_search_advanced_exa unless you need category/date/filter control.",
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
      promptSnippet: "Fetch URLs with web_fetch_exa when you need full page text",
      promptGuidelines: [
        "Use web_fetch_exa for content extraction after discovering URLs.",
        "Enable highlights/summary only when extra context is needed.",
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
      promptSnippet: "Use web_search_advanced_exa for filters, categories, and deep tuning",
      promptGuidelines: [
        "Prefer web_search_advanced_exa for non-deep query constraints (category, domains, dates).",
        "Use web_search_exa for simpler lookups.",
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
      promptSnippet: "Run deep research questions with web_research_exa",
      promptGuidelines: [
        "Use web_research_exa for synthesis-oriented questions, comparisons, and recommendations.",
        "Provide a systemPrompt and use structured outputSchema when you need downstream automation.",
        "Prefer web_search_exa for quick fact lookup.",
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
      promptSnippet: "Answer direct questions with web_answer_exa",
      promptGuidelines: [
        "Use web_answer_exa for direct, answer-style prompts needing grounded citations.",
        "Use outputSchema for machine-consumable structured responses.",
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
      promptSnippet: "Find similar pages with web_find_similar_exa",
      promptGuidelines: [
        "Use web_find_similar_exa for recommendations once a source URL is known.",
        "Pair with web_fetch_exa for deeper inspection of any returned URLs.",
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

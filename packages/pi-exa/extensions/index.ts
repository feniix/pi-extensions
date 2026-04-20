/**
 * Exa AI MCP Extension for pi
 *
 * Provides Exa search tools via native TypeScript (no external MCP server required).
 * Tools: web_search_exa, web_fetch_exa, web_search_advanced_exa (disabled by default).
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-exa
 * 2. Get API key from: https://dashboard.exa.ai/api-keys
 * 3. Configure via:
 *    - Environment variable: EXA_API_KEY
 *    - Settings file for non-secret config: .pi/settings.json or ~/.pi/agent/settings.json under pi-exa
 *    - CLI flag: --exa-api-key
 *
 * Usage:
 *   "Search the web for recent AI news"
 *   "Read the content from https://example.com"
 *   "Find code examples for React hooks"
 *
 * Tools:
 *   - web_search_exa: Web search with highlights (enabled by default)
 *   - web_fetch_exa: Read URLs/crawl content (enabled by default)
 *   - web_search_advanced_exa: Full-featured search (disabled by default)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAuthStatusMessage, getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import { webFetchParams, webSearchAdvancedParams, webSearchParams } from "./schemas.js";
import { DEFAULT_MAX_CHARACTERS, performWebFetch } from "./web-fetch.js";
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

  // Register web_search_exa tool
  if (isToolEnabled("web_search_exa")) {
    pi.registerTool({
      name: "web_search_exa",
      label: "Exa Web Search",
      description:
        "Search the web for any topic and get clean, ready-to-use content. " +
        "Best for: Finding current information, news, facts, or answering questions. " +
        "Query tips: describe the ideal page, not keywords. 'blog post comparing React and Vue' not 'React Vue'.",
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
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Searching the web via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as { query: string; numResults?: number };
          const result = await performWebSearch(
            apiKey,
            typedParams.query,
            typedParams.numResults || DEFAULT_NUM_RESULTS,
          );
          return { content: [{ type: "text", text: result }], details: { tool: "web_search_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa search error: ${message}` }],
            isError: true,
            details: { tool: "web_search_exa", error: message },
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
      description:
        "Read a webpage's full content as clean markdown. " +
        "Use after web_search_exa when highlights are insufficient or to read any URL. " +
        "Best for: Extracting full content from known URLs. Batch multiple URLs in one call.",
      parameters: webFetchParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_fetch_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching content via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as { urls: string[]; maxCharacters?: number };
          const result = await performWebFetch(
            apiKey,
            typedParams.urls,
            typedParams.maxCharacters || DEFAULT_MAX_CHARACTERS,
          );
          return { content: [{ type: "text", text: result }], details: { tool: "web_fetch_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa fetch error: ${message}` }],
            isError: true,
            details: { tool: "web_fetch_exa", error: message },
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
        "Advanced web search with full Exa API control including category filters, domain restrictions, date ranges, " +
        "highlights, summaries, and subpage crawling. Requires --exa-enable-advanced flag or advancedEnabled in config.",
      parameters: webSearchAdvancedParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Performing advanced search via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as {
            query: string;
            numResults?: number;
            category?: string;
            type?: string;
            startPublishedDate?: string;
            endPublishedDate?: string;
            includeDomains?: string[];
            excludeDomains?: string[];
            textMaxCharacters?: number;
            enableHighlights?: boolean;
            highlightsNumSentences?: number;
          };

          const result = await performAdvancedSearch(apiKey, typedParams.query, {
            numResults: typedParams.numResults,
            category: typedParams.category,
            type: typedParams.type,
            startPublishedDate: typedParams.startPublishedDate,
            endPublishedDate: typedParams.endPublishedDate,
            includeDomains: typedParams.includeDomains,
            excludeDomains: typedParams.excludeDomains,
            textMaxCharacters: typedParams.textMaxCharacters,
            enableHighlights: typedParams.enableHighlights,
            highlightsNumSentences: typedParams.highlightsNumSentences,
          });

          return { content: [{ type: "text", text: result }], details: { tool: "web_search_advanced_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa advanced search error: ${message}` }],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: message },
          };
        }
      },
    });
  }
}

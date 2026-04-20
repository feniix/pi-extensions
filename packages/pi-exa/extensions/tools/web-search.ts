/**
 * Exa Web Search Tool
 */

import type { AgentToolUpdateCallback, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Exa } from "exa-js";

import { DEFAULT_NUM_RESULTS } from "../constants.js";
import { formatSearchResults } from "../formatters.js";
import type { ExaSearchResponse } from "../types.js";
import { webSearchParams } from "./definitions.js";

export type WebSearchInput = Static<typeof webSearchParams>;

export async function performWebSearch(apiKey: string, query: string, numResults: number): Promise<string> {
  const exa = new Exa(apiKey);

  const searchRequest = {
    query,
    type: "auto",
    numResults,
    contents: {
      highlights: { query },
      text: { maxCharacters: 300 },
    },
  };

  // Exa SDK already prefixes requests with its configured baseURL.
  // Pass a relative endpoint here, not a full URL, or the SDK will build
  // an invalid URL like "https://api.exa.aihttps://api.exa.ai/search".
  const response = await exa.request<ExaSearchResponse>("/search", "POST", searchRequest);

  if (!response?.results || response.results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return formatSearchResults(response.results);
}

export function createWebSearchTool() {
  return {
    name: "web_search_exa" as const,
    label: "Exa Web Search" as const,
    description:
      "Search the web for any topic and get clean, ready-to-use content. " +
      "Best for: Finding current information, news, facts, or answering questions. " +
      "Query tips: describe the ideal page, not keywords. 'blog post comparing React and Vue' not 'React Vue'.",
    parameters: webSearchParams,
    execute: async (
      _toolCallId: string,
      params: WebSearchInput,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<unknown> | undefined,
      _ctx: ExtensionContext,
      getApiKey: () => string,
    ) => {
      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          content: [
            { type: "text" as const, text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." },
          ],
          isError: true,
          details: { tool: "web_search_exa", error: "missing_api_key" },
        };
      }

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled." }],
          details: { cancelled: true },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: "Searching the web via Exa..." }],
        details: { status: "pending" },
      });

      try {
        const result = await performWebSearch(apiKey, params.query, params.numResults || DEFAULT_NUM_RESULTS);
        return { content: [{ type: "text" as const, text: result }], details: { tool: "web_search_exa" } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Exa search error: ${message}` }],
          isError: true,
          details: { tool: "web_search_exa", error: message },
        };
      }
    },
  };
}

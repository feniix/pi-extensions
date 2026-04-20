/**
 * Exa Advanced Web Search Tool
 */

import type { AgentToolUpdateCallback, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Exa } from "exa-js";

import { formatSearchResults } from "../formatters.js";
import type { ExaSearchResponse } from "../types.js";
import { webSearchAdvancedParams } from "./definitions.js";

export type WebSearchAdvancedInput = Static<typeof webSearchAdvancedParams>;

export interface AdvancedSearchOptions {
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
}

export async function performAdvancedSearch(
  apiKey: string,
  query: string,
  options: AdvancedSearchOptions,
): Promise<string> {
  const exa = new Exa(apiKey);

  const searchRequest: Record<string, unknown> = {
    query,
    numResults: options.numResults || 10,
    contents: {
      text: { maxCharacters: options.textMaxCharacters || 3000 },
    },
  };

  if (options.category) {
    searchRequest.category = options.category;
  }
  if (options.type) {
    searchRequest.type = options.type;
  }
  if (options.startPublishedDate) {
    searchRequest.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    searchRequest.endPublishedDate = options.endPublishedDate;
  }
  if (options.includeDomains && options.includeDomains.length > 0) {
    searchRequest.includeDomains = options.includeDomains;
  }
  if (options.excludeDomains && options.excludeDomains.length > 0) {
    searchRequest.excludeDomains = options.excludeDomains;
  }
  if (options.enableHighlights) {
    const existingContents = searchRequest.contents as Record<string, unknown>;
    searchRequest.contents = {
      ...existingContents,
      highlights: {
        highlightsPerUrl: options.highlightsNumSentences || 3,
      },
    };
  }

  const response = await exa.request<ExaSearchResponse>("/search", "POST", searchRequest);

  if (!response?.results || response.results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return formatSearchResults(response.results);
}

export function createWebSearchAdvancedTool() {
  return {
    name: "web_search_advanced_exa" as const,
    label: "Exa Advanced Search" as const,
    description:
      "Advanced web search with full Exa API control including category filters, domain restrictions, date ranges, " +
      "highlights, summaries, and subpage crawling. Requires --exa-enable-advanced flag or advancedEnabled in config.",
    parameters: webSearchAdvancedParams,
    execute: async (
      _toolCallId: string,
      params: WebSearchAdvancedInput,
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
          details: { tool: "web_search_advanced_exa", error: "missing_api_key" },
        };
      }

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled." }],
          details: { cancelled: true },
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

        return { content: [{ type: "text" as const, text: result }], details: { tool: "web_search_advanced_exa" } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Exa advanced search error: ${message}` }],
          isError: true,
          details: { tool: "web_search_advanced_exa", error: message },
        };
      }
    },
  };
}

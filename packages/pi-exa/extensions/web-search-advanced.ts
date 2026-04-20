/**
 * Exa advanced web search — full API control with category filters, domain restrictions, and date ranges.
 */

import { Exa } from "exa-js";
import type { ExaSearchResponse } from "./formatters.js";
import { formatSearchResults } from "./formatters.js";

export async function performAdvancedSearch(
  apiKey: string,
  query: string,
  options: {
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
  },
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

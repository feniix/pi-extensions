/**
 * Exa web search — performs a search and returns formatted results with highlights.
 */

import type { HighlightsContentsOptions, SearchResult, TextContentsOptions } from "exa-js";
import { Exa } from "exa-js";
import type { ToolPerformResult } from "./formatters.js";
import { formatSearchResults, toMetadata } from "./formatters.js";

export const DEFAULT_NUM_RESULTS = 5;

const DEFAULT_MAX_CHARACTERS = 500;

type SearchResultWithHighlight = SearchResult<{
  text: TextContentsOptions;
  highlights: HighlightsContentsOptions;
}>;

export async function performWebSearch(apiKey: string, query: string, numResults: number): Promise<ToolPerformResult> {
  const exa = new Exa(apiKey);

  const result = await exa.search(query, {
    type: "auto",
    numResults,
    contents: {
      text: { maxCharacters: DEFAULT_MAX_CHARACTERS },
      highlights: {
        query,
        numSentences: 3,
      },
    },
  });

  if (!result?.results || result.results.length === 0) {
    return {
      text: "No search results found. Please try a different query.",
      details: { tool: "web_search_exa" },
    };
  }

  return {
    text: formatSearchResults(result.results as SearchResultWithHighlight[]),
    details: {
      tool: "web_search_exa",
      ...toMetadata(result),
    },
  };
}

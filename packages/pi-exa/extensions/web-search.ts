/**
 * Exa web search — performs a search and returns formatted results with highlights.
 */

import { Exa } from "exa-js";
import type { ExaSearchResponse } from "./formatters.js";
import { formatSearchResults } from "./formatters.js";

export const DEFAULT_NUM_RESULTS = 5;

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

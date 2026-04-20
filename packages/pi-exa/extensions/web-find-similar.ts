/**
 * Exa findSimilar endpoint wrapper.
 */

import type { SearchResponse, SearchResult, TextContentsOptions } from "exa-js";
import { Exa } from "exa-js";
import type { ToolPerformResult } from "./formatters.js";
import { formatSearchResults, toMetadata } from "./formatters.js";

const DEFAULT_NUM_RESULTS = 5;

interface FindSimilarParams {
  url: string;
  numResults?: number;
  textMaxCharacters?: number;
  excludeSourceDomain?: boolean;
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
}

type SimilarResult = SearchResult<{
  text: TextContentsOptions;
}>;

export async function performFindSimilar(apiKey: string, params: FindSimilarParams): Promise<ToolPerformResult> {
  const exa = new Exa(apiKey);

  const result: SearchResponse<{ text: TextContentsOptions }> = await exa.findSimilar(params.url, {
    numResults: params.numResults || DEFAULT_NUM_RESULTS,
    excludeSourceDomain: params.excludeSourceDomain,
    startPublishedDate: params.startPublishedDate,
    endPublishedDate: params.endPublishedDate,
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    contents: {
      text: {
        maxCharacters: params.textMaxCharacters || 5000,
      },
    },
  });

  if (!result?.results || result.results.length === 0) {
    return {
      text: "No similar pages found.",
      details: { tool: "web_find_similar_exa" },
    };
  }

  return {
    text: formatSearchResults(result.results as SimilarResult[]),
    details: {
      tool: "web_find_similar_exa",
      ...toMetadata(result),
    },
  };
}

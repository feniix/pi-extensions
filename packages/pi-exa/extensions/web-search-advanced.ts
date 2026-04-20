/**
 * Exa advanced web search — full API control with category filters, domain restrictions, and date ranges.
 */

import type { HighlightsContentsOptions, SearchResponse, SearchResult, TextContentsOptions } from "exa-js";
import { DEEP_SEARCH_TYPES } from "./constants.js";
import { getExaClient } from "./exa-client.js";
import type { ToolPerformResult } from "./formatters.js";
import { formatSearchResults, toMetadata } from "./formatters.js";

const SEARCH_CATEGORIES = [
  "company",
  "research paper",
  "news",
  "pdf",
  "personal site",
  "financial report",
  "people",
] as const;

type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

type AdvancedResult = SearchResult<{
  text: TextContentsOptions;
  highlights?: HighlightsContentsOptions;
}>;

function validateCategory(category: string | undefined): SearchCategory | undefined {
  if (!category) {
    return undefined;
  }

  if (SEARCH_CATEGORIES.includes(category as SearchCategory)) {
    return category as SearchCategory;
  }

  throw new Error(`Invalid category "${category}". Supported categories: ${SEARCH_CATEGORIES.join(", ")}.`);
}

type AdvancedSearchOptions = {
  numResults?: number;
  category?: string;
  type?: "keyword" | "neural" | "auto" | "hybrid" | "fast" | "instant";
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  textMaxCharacters?: number;
  enableHighlights?: boolean;
  highlightsNumSentences?: number;
};

function validateAdvancedType(type: AdvancedSearchOptions["type"] | undefined): void {
  if (!type) {
    return;
  }

  if (DEEP_SEARCH_TYPES.includes(type as (typeof DEEP_SEARCH_TYPES)[number])) {
    throw new Error(
      "web_search_advanced_exa does not support deep types. Use web_research_exa for deep-reasoning / deep-lite / deep.",
    );
  }
}

export async function performAdvancedSearch(
  apiKey: string,
  query: string,
  options: AdvancedSearchOptions,
): Promise<ToolPerformResult> {
  validateAdvancedType(options.type);

  const exa = getExaClient(apiKey);

  const searchOptions: {
    numResults?: number;
    category?: SearchCategory;
    type?: "keyword" | "neural" | "auto" | "hybrid" | "fast" | "instant";
    startPublishedDate?: string;
    endPublishedDate?: string;
    includeDomains?: string[];
    excludeDomains?: string[];
    contents: {
      text: {
        maxCharacters: number;
      };
      highlights?: {
        numSentences?: number;
        query: string;
      };
    };
  } = {
    numResults: options.numResults || 10,
    category: validateCategory(options.category),
    type: options.type,
    startPublishedDate: options.startPublishedDate,
    endPublishedDate: options.endPublishedDate,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    contents: {
      text: {
        maxCharacters: options.textMaxCharacters || 3000,
      },
    },
  };

  if (options.enableHighlights) {
    searchOptions.contents = {
      ...searchOptions.contents,
      highlights: {
        numSentences: options.highlightsNumSentences || 3,
        query,
      },
    };
  }

  const result: SearchResponse<{
    text: TextContentsOptions;
    highlights?: HighlightsContentsOptions;
  }> = await exa.search(query, searchOptions);

  if (!result?.results || result.results.length === 0) {
    return {
      text: "No search results found. Please try a different query.",
      details: { tool: "web_search_advanced_exa" },
    };
  }

  return {
    text: formatSearchResults(result.results as AdvancedResult[]),
    details: {
      tool: "web_search_advanced_exa",
      ...toMetadata(result),
    },
  };
}

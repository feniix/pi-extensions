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

// Categories with restricted filter support per Exa API docs.
const RESTRICTED_CATEGORIES: readonly SearchCategory[] = ["company", "people"];
// The "people" category only accepts LinkedIn domains for includeDomains.
const LINKEDIN_DOMAINS = new Set(["linkedin.com", "www.linkedin.com"]);

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

function validateCategoryFilters(category: SearchCategory | undefined, options: AdvancedSearchOptions): void {
  if (!category || !RESTRICTED_CATEGORIES.includes(category)) {
    return;
  }

  const unsupported: string[] = [];
  if (options.startPublishedDate) unsupported.push("startPublishedDate");
  if (options.endPublishedDate) unsupported.push("endPublishedDate");
  if (options.excludeDomains && options.excludeDomains.length > 0) unsupported.push("excludeDomains");

  if (unsupported.length > 0) {
    throw new Error(
      `Category "${category}" does not support: ${unsupported.join(", ")}. These filters are not available for the "${category}" category.`,
    );
  }

  if (category === "people" && options.includeDomains && options.includeDomains.length > 0) {
    const nonLinkedIn = options.includeDomains.filter((d) => !LINKEDIN_DOMAINS.has(d));
    if (nonLinkedIn.length > 0) {
      throw new Error(
        `Category "people" only accepts LinkedIn domains for includeDomains. Invalid: ${nonLinkedIn.join(", ")}.`,
      );
    }
  }
}

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
  const category = validateCategory(options.category);
  validateCategoryFilters(category, options);

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
    category,
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

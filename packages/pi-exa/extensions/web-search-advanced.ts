/**
 * Exa advanced web search — full API control with category filters, domain restrictions, and date ranges.
 */

import type {
  ContextOptions,
  HighlightsContentsOptions,
  SearchResponse,
  SearchResult,
  SummaryContentsOptions,
  TextContentsOptions,
} from "exa-js";
import type { AdvancedSearchType } from "./constants.js";
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

type AdvancedResultContents = {
  text: TextContentsOptions;
  highlights?: HighlightsContentsOptions;
  summary?: SummaryContentsOptions;
  context?: ContextOptions;
};

type AdvancedResult = SearchResult<AdvancedResultContents>;

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
  type?: AdvancedSearchType;
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  userLocation?: string;
  moderation?: boolean;
  additionalQueries?: string[];
  textMaxCharacters?: number;
  contextMaxCharacters?: number;
  enableHighlights?: boolean;
  highlightsNumSentences?: number;
  highlightsMaxCharacters?: number;
  highlightsQuery?: string;
  enableSummary?: boolean;
  summaryQuery?: string;
  maxAgeHours?: number;
  livecrawlTimeout?: number;
  subpages?: number;
  subpageTarget?: string | string[];
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

type AdvancedHighlights = {
  query?: string;
  numSentences?: number;
  maxCharacters?: number;
};

type AdvancedSummary = {
  query?: string;
};

type AdvancedContext = {
  maxCharacters?: number;
};

type AdvancedContents = {
  text: { maxCharacters: number };
  highlights?: AdvancedHighlights;
  summary?: AdvancedSummary;
  context?: AdvancedContext;
  maxAgeHours?: number;
  livecrawlTimeout?: number;
  subpages?: number;
  subpageTarget?: string | string[];
};

// Local mirror of the SDK's RegularSearchOptions surface, kept narrow so we
// only forward fields pi-exa supports. The SDK's discriminated union marks
// `additionalQueries` as deep-search-only, but the live hosted MCP advertises
// it for advanced search and the Exa /search endpoint accepts it — so we
// describe the field here and skip the SDK's compile-time gate.
type AdvancedSearchPayload = {
  numResults: number;
  category?: SearchCategory;
  type?: AdvancedSearchType;
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  userLocation?: string;
  moderation?: boolean;
  additionalQueries?: string[];
  contents: AdvancedContents;
};

function buildHighlights(options: AdvancedSearchOptions, fallbackQuery: string): AdvancedHighlights | undefined {
  // Explicit `false` always denies, regardless of other highlights-* options.
  if (options.enableHighlights === false) {
    return undefined;
  }
  // Mirror summary's "query implies enable" semantics: highlightsQuery or
  // highlightsMaxCharacters implies enableHighlights.
  const wantsHighlights =
    options.enableHighlights === true ||
    options.highlightsQuery !== undefined ||
    options.highlightsMaxCharacters !== undefined;
  if (!wantsHighlights) {
    return undefined;
  }
  const highlights: AdvancedHighlights = {
    query: options.highlightsQuery ?? fallbackQuery,
  };
  // Exa prefers maxCharacters; fall back to legacy numSentences when neither is set.
  if (options.highlightsMaxCharacters !== undefined) {
    highlights.maxCharacters = options.highlightsMaxCharacters;
  } else {
    highlights.numSentences = options.highlightsNumSentences ?? 3;
  }
  return highlights;
}

function buildSummary(options: AdvancedSearchOptions): AdvancedSummary | undefined {
  // Explicit `false` always denies, even if summaryQuery is set.
  if (options.enableSummary === false) {
    return undefined;
  }
  // summaryQuery implies enableSummary so callers don't have to set both.
  if (!options.enableSummary && !options.summaryQuery) {
    return undefined;
  }
  return options.summaryQuery ? { query: options.summaryQuery } : {};
}

function buildContents(options: AdvancedSearchOptions, fallbackQuery: string): AdvancedContents {
  const contents: AdvancedContents = {
    text: { maxCharacters: options.textMaxCharacters ?? 3000 },
  };

  const highlights = buildHighlights(options, fallbackQuery);
  if (highlights) {
    contents.highlights = highlights;
  }

  const summary = buildSummary(options);
  if (summary) {
    contents.summary = summary;
  }

  if (options.contextMaxCharacters !== undefined) {
    contents.context = { maxCharacters: options.contextMaxCharacters };
  }

  if (options.maxAgeHours !== undefined) {
    contents.maxAgeHours = options.maxAgeHours;
  }
  if (options.livecrawlTimeout !== undefined) {
    contents.livecrawlTimeout = options.livecrawlTimeout;
  }
  if (options.subpages !== undefined) {
    contents.subpages = options.subpages;
  }
  if (options.subpageTarget !== undefined) {
    contents.subpageTarget = options.subpageTarget;
  }

  return contents;
}

export async function performAdvancedSearch(
  apiKey: string,
  query: string,
  options: AdvancedSearchOptions,
): Promise<ToolPerformResult> {
  const category = validateCategory(options.category);
  validateCategoryFilters(category, options);

  const exa = getExaClient(apiKey);

  const payload: AdvancedSearchPayload = {
    numResults: options.numResults ?? 10,
    contents: buildContents(options, query),
  };
  if (category) payload.category = category;
  if (options.type) payload.type = options.type;
  if (options.startPublishedDate) payload.startPublishedDate = options.startPublishedDate;
  if (options.endPublishedDate) payload.endPublishedDate = options.endPublishedDate;
  if (options.includeDomains && options.includeDomains.length > 0) payload.includeDomains = options.includeDomains;
  if (options.excludeDomains && options.excludeDomains.length > 0) payload.excludeDomains = options.excludeDomains;
  if (options.includeText && options.includeText.length > 0) payload.includeText = options.includeText;
  if (options.excludeText && options.excludeText.length > 0) payload.excludeText = options.excludeText;
  if (options.userLocation) payload.userLocation = options.userLocation;
  if (options.moderation !== undefined) payload.moderation = options.moderation;
  if (options.additionalQueries && options.additionalQueries.length > 0)
    payload.additionalQueries = options.additionalQueries;

  // See AdvancedSearchPayload comment for why we bypass the SDK type here.
  const result: SearchResponse<AdvancedResultContents> = await exa.search<AdvancedResultContents>(
    query,
    payload as unknown as { contents: AdvancedResultContents } & Record<string, unknown>,
  );

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

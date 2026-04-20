/**
 * Exa web fetch — reads webpage content as clean text.
 */

import type { ContentsOptions, SearchResponse, SearchResult } from "exa-js";
import { getExaClient } from "./exa-client.js";
import type { ToolPerformResult } from "./formatters.js";
import { formatCrawlResults, toMetadata } from "./formatters.js";

export const DEFAULT_MAX_CHARACTERS = 3000;

type FetchOptions = {
  maxCharacters?: number;
  highlights?: boolean;
  summary?: {
    query?: string;
  };
  maxAgeHours?: number;
};

type FetchedResult = SearchResult<{
  text: ContentsOptions["text"];
  highlights: ContentsOptions["highlights"];
  summary: ContentsOptions["summary"];
  subpages: number;
}>;

export async function performWebFetch(
  apiKey: string,
  urls: string[],
  options: FetchOptions = {},
): Promise<ToolPerformResult> {
  const exa = getExaClient(apiKey);

  const contents: ContentsOptions = {
    text: {
      maxCharacters: options.maxCharacters || DEFAULT_MAX_CHARACTERS,
    },
  };

  if (options.highlights) {
    contents.highlights = true;
  }

  if (options.summary?.query) {
    contents.summary = {
      query: options.summary.query,
    };
  }

  if (typeof options.maxAgeHours === "number") {
    contents.maxAgeHours = options.maxAgeHours;
  }

  const result: SearchResponse<{
    text: ContentsOptions["text"];
    highlights: ContentsOptions["highlights"];
    summary: ContentsOptions["summary"];
    subpages: number;
  }> = await exa.getContents(urls, contents);

  if (!result?.results || result.results.length === 0) {
    return {
      text: "No content found for the requested URLs.",
      details: { tool: "web_fetch_exa" },
    };
  }

  return {
    text: formatCrawlResults(result.results as FetchedResult[]),
    details: {
      tool: "web_fetch_exa",
      ...toMetadata(result),
    },
  };
}

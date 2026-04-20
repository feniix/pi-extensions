/**
 * Exa web fetch — reads webpage content as clean text.
 */

import { Exa } from "exa-js";
import type { CrawlResult } from "./formatters.js";
import { formatCrawlResults } from "./formatters.js";

export const DEFAULT_MAX_CHARACTERS = 3000;

export async function performWebFetch(apiKey: string, urls: string[], maxCharacters: number): Promise<string> {
  const exa = new Exa(apiKey);

  const crawlRequest = {
    ids: urls,
    contents: {
      text: {
        maxCharacters,
      },
    },
  };

  const response = await exa.request<{ results?: CrawlResult[] }>("/contents", "POST", crawlRequest);

  if (!response?.results || response.results.length === 0) {
    return "No content found for the requested URLs.";
  }

  return formatCrawlResults(response.results);
}

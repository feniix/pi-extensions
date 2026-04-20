/**
 * Exa Web Fetch Tool
 */

import type { AgentToolUpdateCallback, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Exa } from "exa-js";

import { DEFAULT_MAX_CHARACTERS } from "../constants.js";
import { formatCrawlResults } from "../formatters.js";
import type { CrawlResult } from "../types.js";
import { webFetchParams } from "./definitions.js";

export type WebFetchInput = Static<typeof webFetchParams>;

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

export function createWebFetchTool() {
  return {
    name: "web_fetch_exa" as const,
    label: "Exa Web Fetch" as const,
    description:
      "Read a webpage's full content as clean markdown. " +
      "Use after web_search_exa when highlights are insufficient or to read any URL. " +
      "Best for: Extracting full content from known URLs. Batch multiple URLs in one call.",
    parameters: webFetchParams,
    execute: async (
      _toolCallId: string,
      params: WebFetchInput,
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
          details: { tool: "web_fetch_exa", error: "missing_api_key" },
        };
      }

      if (signal?.aborted) {
        return {
          content: [{ type: "text" as const, text: "Cancelled." }],
          details: { cancelled: true },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: "Fetching content via Exa..." }],
        details: { status: "pending" },
      });

      try {
        const result = await performWebFetch(apiKey, params.urls, params.maxCharacters || DEFAULT_MAX_CHARACTERS);
        return { content: [{ type: "text" as const, text: result }], details: { tool: "web_fetch_exa" } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Exa fetch error: ${message}` }],
          isError: true,
          details: { tool: "web_fetch_exa", error: message },
        };
      }
    },
  };
}

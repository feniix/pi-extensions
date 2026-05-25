/**
 * Host-neutral portable tool definitions for pi-exa.
 *
 * Tools defined here are consumed by both the Pi adapter (extensions/index.ts)
 * and the MCP stdio server (extensions/mcp-server.ts). Files in this module
 * must not import from `@earendil-works/pi-coding-agent` or the MCP SDK.
 */

import { definePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { Static, TObject } from "typebox";
import type { ToolPerformResult } from "./formatters.js";
import { webFetchParams, webSearchParams } from "./schemas.js";
import { performWebFetch } from "./web-fetch.js";
import { DEFAULT_NUM_RESULTS, performWebSearch } from "./web-search.js";

export interface ExaToolsOptions {
  /** Resolve the Exa API key at execute time. Return undefined when unconfigured. */
  resolveApiKey?: () => string | undefined;
  /** Host-agnostic gating; tools whose names return false are omitted from the returned array. */
  isToolEnabled?: (name: string) => boolean;
}

const MISSING_KEY_TEXT = "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag.";

function missingApiKeyResult(toolName: string) {
  return {
    text: MISSING_KEY_TEXT,
    isError: true as const,
    structuredContent: { tool: toolName, error: "missing_api_key" },
  };
}

function cancelledResult(toolName: string) {
  return {
    text: "Cancelled.",
    structuredContent: { tool: toolName, cancelled: true },
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ExaToolSpec<TParams extends TObject> {
  name: string;
  title: string;
  description: string;
  parameters: TParams;
  pendingMessage: string;
  errorPrefix: string;
  perform: (apiKey: string, args: Static<TParams>) => Promise<ToolPerformResult>;
}

function exaTool<TParams extends TObject>(
  spec: ExaToolSpec<TParams>,
  resolveApiKey: () => string | undefined,
): PortableTool<TParams> {
  return definePortableTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    parameters: spec.parameters,
    async execute(args, ctx) {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        return missingApiKeyResult(spec.name);
      }
      if (ctx.signal?.aborted) {
        return cancelledResult(spec.name);
      }
      ctx.progress?.({
        text: spec.pendingMessage,
        structuredContent: { status: "pending" },
      });
      try {
        const result = await spec.perform(apiKey, args);
        return { text: result.text, structuredContent: result.details };
      } catch (error) {
        const message = toErrorMessage(error);
        return {
          text: `${spec.errorPrefix}: ${message}`,
          isError: true,
          structuredContent: { tool: spec.name, error: message },
        };
      }
    },
  });
}

export function createExaTools(opts: ExaToolsOptions = {}): readonly PortableTool<TObject>[] {
  const resolveApiKey = opts.resolveApiKey ?? (() => undefined);
  const isEnabled = opts.isToolEnabled ?? (() => true);

  const tools: PortableTool<TObject>[] = [];

  if (isEnabled("web_search_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_search_exa",
          title: "Exa Web Search",
          description:
            "Search the web for any topic and get clean, ready-to-use content. Best for lookup and current information queries.",
          parameters: webSearchParams,
          pendingMessage: "Searching the web via Exa...",
          errorPrefix: "Exa search error",
          perform: (apiKey, args) => performWebSearch(apiKey, args.query, args.numResults ?? DEFAULT_NUM_RESULTS),
        },
        resolveApiKey,
      ),
    );
  }

  if (isEnabled("web_fetch_exa")) {
    tools.push(
      exaTool(
        {
          name: "web_fetch_exa",
          title: "Exa Web Fetch",
          description:
            "Read a webpage's full content as clean markdown. Best for extracting full content from known URLs.",
          parameters: webFetchParams,
          pendingMessage: "Fetching content via Exa...",
          errorPrefix: "Exa fetch error",
          perform: (apiKey, args) =>
            performWebFetch(apiKey, args.urls, {
              maxCharacters: args.maxCharacters,
              highlights: args.highlights,
              summary: args.summary,
              maxAgeHours: args.maxAgeHours,
            }),
        },
        resolveApiKey,
      ),
    );
  }

  return tools;
}

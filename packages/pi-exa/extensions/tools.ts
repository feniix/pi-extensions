/**
 * Host-neutral portable tool definitions for pi-exa.
 *
 * Tools defined here are consumed by both the Pi adapter (extensions/index.ts)
 * and the MCP stdio server (extensions/mcp-server.ts). Files in this module
 * must not import from `@earendil-works/pi-coding-agent` or the MCP SDK.
 */

import { definePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { webSearchParams } from "./schemas.js";
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

export function createExaTools(opts: ExaToolsOptions = {}): readonly PortableTool<TObject>[] {
  const resolveApiKey = opts.resolveApiKey ?? (() => undefined);
  const isEnabled = opts.isToolEnabled ?? (() => true);

  const tools: PortableTool<TObject>[] = [];

  if (isEnabled("web_search_exa")) {
    tools.push(
      definePortableTool({
        name: "web_search_exa",
        title: "Exa Web Search",
        description:
          "Search the web for any topic and get clean, ready-to-use content. Best for lookup and current information queries.",
        parameters: webSearchParams,
        async execute(args, ctx) {
          const apiKey = resolveApiKey();
          if (!apiKey) {
            return missingApiKeyResult("web_search_exa");
          }
          if (ctx.signal?.aborted) {
            return cancelledResult("web_search_exa");
          }
          ctx.progress?.({
            text: "Searching the web via Exa...",
            structuredContent: { status: "pending" },
          });
          try {
            const result = await performWebSearch(apiKey, args.query, args.numResults ?? DEFAULT_NUM_RESULTS);
            return { text: result.text, structuredContent: result.details };
          } catch (error) {
            const message = toErrorMessage(error);
            return {
              text: `Exa search error: ${message}`,
              isError: true,
              structuredContent: { tool: "web_search_exa", error: message },
            };
          }
        },
      }),
    );
  }

  return tools;
}

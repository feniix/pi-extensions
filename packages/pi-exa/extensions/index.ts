/**
 * Exa AI MCP Extension for pi
 *
 * Provides Exa search tools via native TypeScript (no external MCP server required).
 * Tools: web_search_exa, web_fetch_exa, web_search_advanced_exa (disabled by default).
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-exa
 * 2. Get API key from: https://dashboard.exa.ai/api-keys
 * 3. Configure via:
 *    - Environment variable: EXA_API_KEY
 *    - Settings file for non-secret config: .pi/settings.json or ~/.pi/agent/settings.json under pi-exa
 *    - CLI flag: --exa-api-key
 *
 * Usage:
 *   "Search the web for recent AI news"
 *   "Read the content from https://example.com"
 *   "Find code examples for React hooks"
 *
 * Tools:
 *   - web_search_exa: Web search with highlights (enabled by default)
 *   - web_fetch_exa: Read URLs/crawl content (enabled by default)
 *   - web_search_advanced_exa: Full-featured search (disabled by default)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  getAuthStatusMessage,
  getResolvedConfig,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
} from "./config.js";
import { DEFAULT_MAX_CHARACTERS, DEFAULT_NUM_RESULTS } from "./constants.js";
import { formatCrawlResults, formatSearchResults } from "./formatters.js";
import { webFetchParams, webSearchAdvancedParams, webSearchParams } from "./tools/definitions.js";
import { createWebFetchTool } from "./tools/web-fetch.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { createWebSearchAdvancedTool } from "./tools/web-search-advanced.js";

// Re-export for backward compatibility with tests
export {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_NUM_RESULTS,
  formatCrawlResults,
  formatSearchResults,
  getAuthStatusMessage,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
};

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
  // SessionStart: check auth and print status
  pi.on("session_start", async () => {
    console.log(getAuthStatusMessage(pi));
  });

  // Register CLI flags
  pi.registerFlag("--exa-api-key", {
    description: "Exa AI API key for search operations",
    type: "string",
  });
  pi.registerFlag("--exa-enable-advanced", {
    description: "Enable web_search_advanced_exa tool",
    type: "boolean",
  });
  pi.registerFlag("--exa-config-file", {
    description: "Path to custom JSON config file for private overrides such as API keys.",
    type: "string",
  });
  pi.registerFlag("--exa-config", {
    description: "Deprecated alias for --exa-config-file.",
    type: "string",
  });

  const getApiKey = (): string => resolveAuth(pi).apiKey;

  const isToolEnabled = (toolName: string): boolean => isToolEnabledForConfig(pi, getResolvedConfig(pi), toolName);

  // Register web_search_exa tool
  if (isToolEnabled("web_search_exa")) {
    const webSearchTool = createWebSearchTool();
    pi.registerTool({
      name: webSearchTool.name,
      label: webSearchTool.label,
      description: webSearchTool.description,
      parameters: webSearchParams,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return webSearchTool.execute(toolCallId, params, signal, onUpdate, ctx, getApiKey);
      },
    });
  }

  // Register web_fetch_exa tool
  if (isToolEnabled("web_fetch_exa")) {
    const webFetchTool = createWebFetchTool();
    pi.registerTool({
      name: webFetchTool.name,
      label: webFetchTool.label,
      description: webFetchTool.description,
      parameters: webFetchParams,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return webFetchTool.execute(toolCallId, params, signal, onUpdate, ctx, getApiKey);
      },
    });
  }

  // Register web_search_advanced_exa tool (disabled by default)
  if (isToolEnabled("web_search_advanced_exa")) {
    const webSearchAdvancedTool = createWebSearchAdvancedTool();
    pi.registerTool({
      name: webSearchAdvancedTool.name,
      label: webSearchAdvancedTool.label,
      description: webSearchAdvancedTool.description,
      parameters: webSearchAdvancedParams,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        return webSearchAdvancedTool.execute(toolCallId, params, signal, onUpdate, ctx, getApiKey);
      },
    });
  }
}

/**
 * Exa AI extension for pi.
 *
 * Wires bridgekit's portable Exa tools (./tools.ts) into the pi host via
 * bridgekit 0.9.0's registerPiTools adapter. Per-tool pi metadata
 * (promptSnippet, promptGuidelines) lives on each portable tool's
 * `hostExtras.pi` field and is threaded through to pi's `registerTool`
 * call by the adapter; this module no longer maintains a custom
 * dispatch loop.
 *
 * Error semantics: registerPiTools defaults to `errorHandling: "return"`,
 * so portable `isError: true` results and TypeBox validation failures
 * surface as `{ content, details, isError: true }` rather than thrown
 * `PortableToolExecutionError`. This matches bridgekit's MCP adapter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/bridgekit/pi";
import { getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import { createExaTools, type ExaToolTimeouts } from "./tools.js";

export {
  getAuthStatusMessage,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
} from "./config.js";
export { formatCrawlResults, formatSearchResults } from "./formatters.js";
export { DEFAULT_MAX_CHARACTERS } from "./web-fetch.js";
export { DEFAULT_NUM_RESULTS } from "./web-search.js";

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag("--exa-api-key", {
    description: "Exa AI API key for search operations",
    type: "string",
  });
  pi.registerFlag("--exa-enable-advanced", {
    description: "Enable web_search_advanced_exa tool",
    type: "boolean",
  });
  pi.registerFlag("--exa-enable-research", {
    description: "Enable web_research_exa tool",
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
  pi.registerFlag("--exa-timeout-ms", {
    description: "Default per-call timeout in ms for Exa-backed tools. Overrides the built-in 60000 default.",
    type: "string",
  });
  pi.registerFlag("--exa-research-timeout-ms", {
    description:
      "Per-call timeout in ms for web_research_exa (deep-reasoning legitimately runs longer). Overrides the built-in 180000 default.",
    type: "string",
  });
}

function parsePositiveIntFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function resolvePiTimeouts(pi: ExtensionAPI): ExaToolTimeouts | undefined {
  const def = parsePositiveIntFlag(pi.getFlag("--exa-timeout-ms"));
  const research = parsePositiveIntFlag(pi.getFlag("--exa-research-timeout-ms"));
  if (def === undefined && research === undefined) return undefined;
  const out: ExaToolTimeouts = {};
  if (def !== undefined) out.default = def;
  if (research !== undefined) out.web_research_exa = research;
  return out;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
  registerFlags(pi);

  const resolvedConfig = getResolvedConfig(pi);
  const tools = createExaTools({
    resolveApiKey: () => resolveAuth(pi).apiKey || undefined,
    isToolEnabled: (toolName) => isToolEnabledForConfig(pi, resolvedConfig, toolName),
    timeouts: resolvePiTimeouts(pi),
  });
  registerPiTools(pi, tools);
}

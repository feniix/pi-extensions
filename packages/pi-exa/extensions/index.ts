/**
 * Exa AI extension for pi
 *
 * Wires bridgekit's portable Exa tools (./tools.ts) into the pi host.
 *
 * The Pi adapter is a thin wrapper rather than bridgekit's `registerPiTools`
 * directly: pi-exa carries per-tool `promptSnippet` and `promptGuidelines`
 * metadata that the Pi system prompt consumes, and bridgekit's adapter
 * intentionally exposes only the portable surface (name/title/description/
 * parameters). The wrapper still uses `executePortableTool` for execution and
 * throws `PortableToolExecutionError` for validation failures and portable
 * `isError: true` results, matching bridgekit's pi adapter contract.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
import { PortableToolExecutionError } from "@feniix/bridgekit/pi";
import type { TObject } from "typebox";
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

// =============================================================================
// Pi adapter
// =============================================================================

type PiContent = { type: "text"; text: string };
type PiToolResult = { content: PiContent[]; details: Record<string, unknown>; isError?: true };

function toPiResult(result: PortableToolResult): PiToolResult {
  const piResult: PiToolResult = {
    content: [{ type: "text", text: result.text }],
    details: result.structuredContent ?? {},
  };
  if (result.isError) {
    return { ...piResult, isError: true };
  }
  return piResult;
}

function registerExaPiTools(pi: ExtensionAPI, tools: readonly PortableTool<TObject>[]): void {
  for (const tool of tools) {
    // Pi progress callbacks never emit isError: true; portable error results
    // are only surfaced via the final execute() return and are converted to
    // PortableToolExecutionError below. Keeping this invariant means onUpdate
    // never delivers a Pi result with isError set.
    const piExtras = tool.hostExtras?.pi;
    pi.registerTool({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      parameters: tool.parameters,
      ...(piExtras?.promptSnippet ? { promptSnippet: piExtras.promptSnippet } : {}),
      // Bridgekit types promptGuidelines as readonly string[]; pi-coding-agent's
      // ToolDefinition expects a mutable string[]. Spread a fresh copy at the
      // boundary so we never hand pi a reference to PLANNER_GUIDELINES (or any
      // hostExtras-owned array) that pi could mutate.
      ...(piExtras?.promptGuidelines ? { promptGuidelines: [...piExtras.promptGuidelines] } : {}),
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const result = await executePortableTool(tool, params, {
          host: "pi",
          signal,
          progress(update) {
            onUpdate?.(toPiResult(update));
          },
        });
        if (result.isError) {
          throw new PortableToolExecutionError(result);
        }
        return toPiResult(result);
      },
    });
  }
}

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
  registerExaPiTools(pi, tools);
}

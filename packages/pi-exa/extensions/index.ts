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

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
import { PortableToolExecutionError } from "@feniix/bridgekit/pi";
import type { TSchema } from "typebox";
import { getResolvedConfig, isToolEnabledForConfig, resolveAuth } from "./config.js";
import { createExaTools } from "./tools.js";

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
// Pi-side tool metadata (system-prompt routing wisdom not carried by bridgekit)
// =============================================================================

interface PiToolMetadata {
  promptSnippet: string;
  promptGuidelines: string[];
}

const PLANNER_GUIDELINES: string[] = [
  "Use exa_research_step to externalize non-trivial Exa research planning before expensive retrieval.",
  "Planning tools recommend Exa retrieval calls but never execute network or cost-incurring operations internally.",
  "Use exa_research_summary for human-readable plans before requesting payload mode.",
];

const PI_TOOL_METADATA: Record<string, PiToolMetadata> = {
  web_search_exa: {
    promptSnippet: "Quick web search for lookups, discovery, and current pages.",
    promptGuidelines: [
      "Use web_search_exa for quick lookups and finding pages; use web_answer_exa for direct factual questions with citations.",
      "Use web_search_exa for simple searches; use web_search_advanced_exa when you need category, domain, or date filters.",
      "Use web_search_exa to discover candidate URLs; use web_fetch_exa to read a known page in full.",
      "Use web_search_exa for retrieval; use web_research_exa for comparisons, synthesis, and recommendations.",
    ],
  },
  web_fetch_exa: {
    promptSnippet: "Read known URLs as clean page text with optional summaries.",
    promptGuidelines: [
      "Use web_fetch_exa after web_search_exa or web_search_advanced_exa when snippets are not enough.",
      "Use web_fetch_exa to read a known URL in full; use web_answer_exa when the user only needs a concise cited answer.",
      "Use web_fetch_exa to inspect returned pages; use web_find_similar_exa when you want more pages like a source URL.",
    ],
  },
  web_search_advanced_exa: {
    promptSnippet: "Advanced search with category, domain, and date filters.",
    promptGuidelines: [
      "Use web_search_advanced_exa when you need category, domain, or date filters; use web_search_exa for simpler lookups.",
      "Use web_search_advanced_exa for retrieval with constraints; use web_research_exa for deep synthesis and comparisons.",
      "Use web_search_advanced_exa to find filtered result sets; use web_fetch_exa to read the selected URLs.",
    ],
  },
  web_research_exa: {
    promptSnippet: "Deep research with grounded synthesis; higher cost and latency.",
    promptGuidelines: [
      "Use web_research_exa for conclusions, comparisons, and recommendations; use web_search_exa for simple lookups.",
      "Use web_research_exa for open-ended synthesis; use web_answer_exa for direct questions needing a concise cited answer.",
      "Use web_research_exa when a systemPrompt or outputSchema is needed; use web_search_advanced_exa for filtered retrieval only.",
    ],
  },
  web_answer_exa: {
    promptSnippet: "Grounded answers with citations for direct questions.",
    promptGuidelines: [
      "Use web_answer_exa for direct factual questions with sources; use web_research_exa for broader synthesis and comparisons.",
      "Use web_answer_exa when the user wants a concise answer; use web_search_exa when you first need to discover candidate pages.",
      "Use web_answer_exa for a cited response; use web_fetch_exa when you need the full source text.",
    ],
  },
  web_find_similar_exa: {
    promptSnippet: "Find pages similar to a known source URL.",
    promptGuidelines: [
      "Use web_find_similar_exa when you have a good page and want more like it; use web_search_exa for keyword-based discovery.",
      "Use web_find_similar_exa to expand from a source URL; use web_search_advanced_exa when you need explicit category, domain, or date filters.",
      "Use web_find_similar_exa to discover related pages; use web_fetch_exa to inspect the returned URLs in full.",
    ],
  },
  exa_research_step: {
    promptSnippet: "Record iterative research-planning state before retrieval.",
    promptGuidelines: PLANNER_GUIDELINES,
  },
  exa_research_status: {
    promptSnippet: "Inspect current research-planning state.",
    promptGuidelines: PLANNER_GUIDELINES,
  },
  exa_research_summary: {
    promptSnippet: "Summarize the accumulated Exa research plan.",
    promptGuidelines: PLANNER_GUIDELINES,
  },
  exa_research_reset: {
    promptSnippet: "Reset local Exa research-planning state.",
    promptGuidelines: PLANNER_GUIDELINES,
  },
};

// =============================================================================
// Pi adapter
// =============================================================================

type PiContent = { type: "text"; text: string };
type PiToolResult = { content: PiContent[]; details: Record<string, unknown>; isError?: true };

function toPiResult(result: PortableToolResult): PiToolResult {
  const piResult: PiToolResult = {
    content: [{ type: "text", text: result.text }],
    details: result.structuredContent ?? result.details ?? {},
  };
  if (result.isError) {
    return { ...piResult, isError: true };
  }
  return piResult;
}

function registerExaPiTools(pi: ExtensionAPI, tools: readonly PortableTool<TSchema>[]): void {
  for (const tool of tools) {
    const metadata = PI_TOOL_METADATA[tool.name];
    pi.registerTool(
      defineTool({
        name: tool.name,
        label: tool.title,
        description: tool.description,
        parameters: tool.parameters,
        ...(metadata?.promptSnippet ? { promptSnippet: metadata.promptSnippet } : {}),
        ...(metadata?.promptGuidelines ? { promptGuidelines: metadata.promptGuidelines } : {}),
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
      }),
    );
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
  });
  registerExaPiTools(pi, tools);
}

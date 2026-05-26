/**
 * Host-neutral cross-tool routing guidelines for pi-exa.
 *
 * Single source of truth consumed by:
 *   - the Pi adapter (extensions/index.ts) — per-tool promptGuidelines
 *   - the MCP server (extensions/mcp-server.ts) — server-level instructions
 *
 * Keeping this in one module guarantees the decision tree exposed to the
 * Pi system prompt and to MCP clients stays in lockstep.
 */

export interface PiToolMetadata {
  promptSnippet: string;
  promptGuidelines: string[];
}

export type ExaToolName =
  | "web_search_exa"
  | "web_fetch_exa"
  | "web_answer_exa"
  | "web_find_similar_exa"
  | "web_search_advanced_exa"
  | "web_research_exa"
  | "exa_research_step"
  | "exa_research_status"
  | "exa_research_summary"
  | "exa_research_reset";

export const PLANNER_GUIDELINES: readonly string[] = [
  "Use exa_research_step to externalize non-trivial Exa research planning before expensive retrieval.",
  "Planning tools recommend Exa retrieval calls but never execute network or cost-incurring operations internally.",
  "Use exa_research_summary for human-readable plans before requesting payload mode.",
];

export const PI_TOOL_METADATA: Record<ExaToolName, PiToolMetadata> = {
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
    promptGuidelines: [...PLANNER_GUIDELINES],
  },
  exa_research_status: {
    promptSnippet: "Inspect current research-planning state.",
    promptGuidelines: [...PLANNER_GUIDELINES],
  },
  exa_research_summary: {
    promptSnippet: "Summarize the accumulated Exa research plan.",
    promptGuidelines: [...PLANNER_GUIDELINES],
  },
  exa_research_reset: {
    promptSnippet: "Reset local Exa research-planning state.",
    promptGuidelines: [...PLANNER_GUIDELINES],
  },
};

/**
 * Decision-tree text embedded in MCP `instructions`. Synthesized from the
 * per-tool guidelines so MCP clients receive equivalent routing guidance to
 * Pi's system prompt without duplicating individual sentences.
 */
export const CROSS_TOOL_GUIDELINES: string = [
  "Use these tools to search the web, fetch URLs, answer factual questions with grounded citations, and plan multi-step research using Exa AI.",
  "The four exa_research_* planner tools are local-only and never call Exa.",
  "Routing guidance:",
  "- web_search_exa: quick lookups and discovery of candidate URLs.",
  "- web_fetch_exa: read known URLs in full when search snippets are not enough.",
  "- web_search_advanced_exa: filtered retrieval with category, domain, date, text, location, and freshness controls.",
  "- web_answer_exa: direct factual questions that need a concise cited answer.",
  "- web_find_similar_exa: discover more pages like a known source URL.",
  "- web_research_exa: deep synthesis, comparisons, and recommendations (higher cost and latency).",
  "- exa_research_step / status / summary / reset: externalize research planning before expensive retrieval; these tools never call Exa.",
].join("\n");

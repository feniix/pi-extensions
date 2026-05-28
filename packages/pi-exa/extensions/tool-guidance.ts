/**
 * Host-neutral cross-tool routing guidelines for pi-exa.
 *
 * Two exports:
 *   - `PLANNER_GUIDELINES` is the shared per-tool guidance string for the four
 *     local `exa_research_*` planner tools; consumed by `tools.ts` and threaded
 *     onto each planner tool via `hostExtras.pi.promptGuidelines`.
 *   - `CROSS_TOOL_GUIDELINES` is the server-level decision tree consumed by
 *     the MCP server (`mcp-server.ts`) as `instructions`. It is intentionally
 *     duplicated as prose rather than synthesised from per-tool snippets so
 *     MCP clients see one self-contained routing block.
 *
 * Per-tool `promptSnippet` and `promptGuidelines` for the six Exa-API tools
 * live on the tool definitions themselves in `tools.ts` via
 * `hostExtras.pi.*` — bridgekit 0.9.0 threads them through to pi's
 * `registerTool` call without a sidecar map.
 */

export const PLANNER_GUIDELINES: readonly string[] = [
  "Use exa_research_step to externalize non-trivial Exa research planning before expensive retrieval.",
  "Planning tools recommend Exa retrieval calls but never execute network or cost-incurring operations internally.",
  "Use exa_research_summary for human-readable plans before requesting payload mode.",
];

/**
 * Decision-tree text embedded in MCP `instructions`. Mirrors the per-tool
 * `hostExtras.pi.promptGuidelines` at server granularity so MCP clients
 * receive equivalent routing guidance to Pi's system prompt without
 * duplicating individual sentences.
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

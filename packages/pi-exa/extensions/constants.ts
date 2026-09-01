/**
 * Shared Exa constants.
 */

// Canonical values per the live hosted MCP at mcp.exa.ai/mcp are `auto`,
// `fast`, and `instant`. The legacy `keyword`, `neural`, and `hybrid` values
// are still accepted by Exa's /search endpoint, so we keep them for
// backwards compatibility. Hard-removing them would be a breaking change.
export const ADVANCED_SEARCH_TYPES = ["auto", "fast", "instant", "keyword", "neural", "hybrid"] as const;
export type AdvancedSearchType = (typeof ADVANCED_SEARCH_TYPES)[number];

/**
 * Tool-level output mode for research. Agent Runs always produce
 * `output.text`, so this sentinel is not sent to Exa; object schemas are sent
 * and their values are read from `output.structured`.
 */
export const DEFAULT_RESEARCH_OUTPUT_SCHEMA = { type: "text" } as const;

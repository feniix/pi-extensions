/**
 * Shared Exa constants.
 */

export const DEEP_SEARCH_TYPES = ["deep-reasoning", "deep-lite", "deep"] as const;

// Canonical values per the live hosted MCP at mcp.exa.ai/mcp are `auto`,
// `fast`, and `instant`. The legacy `keyword`, `neural`, and `hybrid` values
// are still accepted by Exa's /search endpoint, so we keep them for
// backwards compatibility. Hard-removing them would be a breaking change.
export const ADVANCED_SEARCH_TYPES = ["auto", "fast", "instant", "keyword", "neural", "hybrid"] as const;
export type AdvancedSearchType = (typeof ADVANCED_SEARCH_TYPES)[number];

/**
 * Default `outputSchema` for deep search. Exa's `/search` endpoint only
 * returns an `output` field when an `outputSchema` is provided; text mode
 * is the lowest-friction default (no schema design required). Used by
 * `web_research_exa` to default omitted/missing-`type` schemas, and by
 * the research planner to keep copied payloads synthesis-ready.
 */
export const DEFAULT_RESEARCH_OUTPUT_SCHEMA = { type: "text" } as const;

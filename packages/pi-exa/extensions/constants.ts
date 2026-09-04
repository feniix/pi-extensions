/**
 * Shared Exa constants.
 */

// Canonical values from Exa's public OpenAPI specification. Deep Search stays
// on /search; asynchronous Agent research uses the separate /agent/runs API.
export const ADVANCED_SEARCH_TYPES = ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"] as const;
export type AdvancedSearchType = (typeof ADVANCED_SEARCH_TYPES)[number];

export const DEEP_SEARCH_TYPES = ["deep-lite", "deep", "deep-reasoning"] as const;
export type DeepSearchType = (typeof DEEP_SEARCH_TYPES)[number];

/** Default text synthesis mode shared by Deep Search and Agent research. */
export const DEFAULT_RESEARCH_OUTPUT_SCHEMA = { type: "text" } as const;

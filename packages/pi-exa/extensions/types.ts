/**
 * Exa Extension Types
 */

export interface ExaConfig {
  apiKey?: string;
  enabledTools?: string[];
  advancedEnabled?: boolean;
}

export interface AuthResolution {
  apiKey: string;
  source?: "CLI flag" | "EXA_API_KEY env var" | "config file";
}

export interface SearchResult {
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  text?: string;
}

export interface ExaSearchResponse {
  results?: SearchResult[];
  searchTime?: number;
}

export interface CrawlResult {
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
}

// =============================================================================
// Helpers
// =============================================================================

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getHomeDir(): string {
  return process.env.HOME || require("node:os").homedir();
}

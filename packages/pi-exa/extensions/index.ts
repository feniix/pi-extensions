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

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Exa } from "exa-js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_CHARACTERS = 3000;
const DEFAULT_NUM_RESULTS = 5;

// =============================================================================
// Types
// =============================================================================

interface ExaConfig {
  apiKey?: string;
  enabledTools?: string[];
  advancedEnabled?: boolean;
}

interface AuthResolution {
  apiKey: string;
  source?: "CLI flag" | "EXA_API_KEY env var" | "config file";
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface SearchResult {
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  text?: string;
}

interface ExaSearchResponse {
  results?: SearchResult[];
  searchTime?: number;
}

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

// =============================================================================
// Config Loading
// =============================================================================

function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed.startsWith("~/")) {
    return join(getHomeDir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("~")) {
    return join(getHomeDir(), trimmed.slice(1));
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(process.cwd(), trimmed);
}

function parseConfig(raw: unknown): ExaConfig {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  return {
    apiKey: normalizeString(obj.apiKey),
    enabledTools: Array.isArray(obj.enabledTools)
      ? obj.enabledTools
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    advancedEnabled: typeof obj.advancedEnabled === "boolean" ? obj.advancedEnabled : false,
  };
}

function loadConfigFile(path: string): ExaConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parseConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-exa] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function loadSettingsConfig(path: string): ExaConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed["pi-exa"];
    if (typeof config !== "object" || config === null) {
      return null;
    }
    const parsedConfig = parseConfig(config);
    return {
      enabledTools: parsedConfig.enabledTools,
      advancedEnabled: parsedConfig.advancedEnabled,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-exa] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function loadConfig(configPath?: string): ExaConfig | null {
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (process.env.EXA_CONFIG) {
    return loadConfigFile(resolveConfigPath(process.env.EXA_CONFIG));
  }

  const globalSettingsPath = join(getHomeDir(), ".pi", "agent", "settings.json");
  const projectSettingsPath = join(process.cwd(), ".pi", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath);
  const projectConfig = loadSettingsConfig(projectSettingsPath);

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return {
    apiKey: projectConfig?.apiKey ?? globalConfig?.apiKey,
    enabledTools: projectConfig?.enabledTools ?? globalConfig?.enabledTools,
    advancedEnabled: projectConfig?.advancedEnabled ?? globalConfig?.advancedEnabled,
  };
}

function getConfigOverrideFlag(pi: ExtensionAPI): string | undefined {
  return normalizeString(pi.getFlag("--exa-config"));
}

function getResolvedConfig(pi: ExtensionAPI): ExaConfig | null {
  return loadConfig(getConfigOverrideFlag(pi));
}

function resolveAuth(pi: ExtensionAPI): AuthResolution {
  const apiKeyFlag = normalizeString(pi.getFlag("--exa-api-key"));
  if (apiKeyFlag) {
    return { apiKey: apiKeyFlag, source: "CLI flag" };
  }

  const configApiKey = normalizeString(getResolvedConfig(pi)?.apiKey);
  if (configApiKey) {
    return { apiKey: configApiKey, source: "config file" };
  }

  const envApiKey = normalizeString(process.env.EXA_API_KEY);
  if (envApiKey) {
    return { apiKey: envApiKey, source: "EXA_API_KEY env var" };
  }

  return { apiKey: "" };
}

function getAuthStatusMessage(pi: ExtensionAPI): string {
  const auth = resolveAuth(pi);
  return auth.source
    ? `[exa] Authenticated via ${auth.source}`
    : "[exa] Not authenticated. Set EXA_API_KEY or use --exa-api-key flag.";
}

function isAdvancedToolEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const advancedFlag = pi.getFlag("--exa-enable-advanced");
  if (typeof advancedFlag === "boolean") {
    return advancedFlag;
  }
  return config?.advancedEnabled ?? false;
}

function isToolEnabledForConfig(pi: ExtensionAPI, config: ExaConfig | null, toolName: string): boolean {
  if (config?.enabledTools && Array.isArray(config.enabledTools)) {
    return config.enabledTools.includes(toolName);
  }

  if (toolName === "web_search_exa" || toolName === "web_fetch_exa") {
    return true;
  }

  if (toolName === "web_search_advanced_exa") {
    return isAdvancedToolEnabled(pi, config);
  }

  return false;
}

// =============================================================================
// Tool Parameters
// =============================================================================

const webSearchParams = Type.Object(
  {
    query: Type.String({
      description:
        "Natural language search query. Should be a semantically rich description of the ideal page, not just keywords.",
    }),
    numResults: Type.Optional(
      Type.Integer({ description: "Number of search results to return (1-20, default: 5)", minimum: 1, maximum: 20 }),
    ),
  },
  { additionalProperties: true },
);

const webFetchParams = Type.Object(
  {
    urls: Type.Array(Type.String({ description: "URLs to read. Batch multiple URLs in one call." }), {
      description: "URLs to read",
    }),
    maxCharacters: Type.Optional(
      Type.Integer({ description: "Maximum characters to extract per page (default: 3000)", minimum: 1 }),
    ),
  },
  { additionalProperties: true },
);

const webSearchAdvancedParams = Type.Object(
  {
    query: Type.String({ description: "Search query" }),
    numResults: Type.Optional(Type.Integer({ description: "Number of results (1-100)", minimum: 1, maximum: 100 })),
    category: Type.Optional(
      Type.String({
        description: "Category filter: company, research paper, financial report, people, news, etc.",
      }),
    ),
    type: Type.Optional(Type.String({ description: "Search type: auto, fast, deep, neural" })),
    startPublishedDate: Type.Optional(Type.String({ description: "ISO date filter (e.g., 2024-01-01)" })),
    endPublishedDate: Type.Optional(Type.String({ description: "ISO date filter (e.g., 2024-12-31)" })),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    textMaxCharacters: Type.Optional(Type.Integer()),
    enableHighlights: Type.Optional(Type.Boolean()),
    highlightsNumSentences: Type.Optional(Type.Integer()),
  },
  { additionalProperties: true },
);

// =============================================================================
// Tool Implementations
// =============================================================================

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return results
    .map((r) => {
      const lines: string[] = [
        `Title: ${r.title || "N/A"}`,
        `URL: ${r.url}`,
        `Published: ${r.publishedDate || "N/A"}`,
        `Author: ${r.author || "N/A"}`,
      ];
      if (Array.isArray(r.highlights) && r.highlights.length > 0) {
        lines.push(`Highlights:\n${r.highlights.join("\n")}`);
      } else if (r.text) {
        lines.push(`Text: ${r.text}`);
      }
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function formatCrawlResults(
  results: Array<{
    title?: string;
    url: string;
    publishedDate?: string;
    author?: string;
    text?: string;
  }>,
): string {
  if (results.length === 0) {
    return "No content found.";
  }

  return results
    .map((r) => {
      const lines: string[] = [`# ${r.title || "(no title)"}`, `URL: ${r.url}`];
      if (r.publishedDate) {
        lines.push(`Published: ${r.publishedDate.split("T")[0]}`);
      }
      if (r.author) {
        lines.push(`Author: ${r.author}`);
      }
      lines.push("");
      if (r.text) {
        lines.push(r.text);
      }
      lines.push("");
      return lines.join("\n");
    })
    .join("\n");
}

async function performWebSearch(apiKey: string, query: string, numResults: number): Promise<string> {
  const exa = new Exa(apiKey);

  const searchRequest = {
    query,
    type: "auto",
    numResults,
    contents: {
      highlights: { query },
      text: { maxCharacters: 300 },
    },
  };

  // Exa SDK already prefixes requests with its configured baseURL.
  // Pass a relative endpoint here, not a full URL, or the SDK will build
  // an invalid URL like "https://api.exa.aihttps://api.exa.ai/search".
  const response = await exa.request<ExaSearchResponse>("/search", "POST", searchRequest);

  if (!response?.results || response.results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return formatSearchResults(response.results);
}

async function performWebFetch(apiKey: string, urls: string[], maxCharacters: number): Promise<string> {
  const exa = new Exa(apiKey);

  const crawlRequest = {
    ids: urls,
    contents: {
      text: {
        maxCharacters,
      },
    },
  };

  const response = await exa.request<{
    results?: Array<{
      title?: string;
      url: string;
      publishedDate?: string;
      author?: string;
      text?: string;
    }>;
  }>("/contents", "POST", crawlRequest);

  if (!response?.results || response.results.length === 0) {
    return "No content found for the requested URLs.";
  }

  return formatCrawlResults(response.results);
}

async function performAdvancedSearch(
  apiKey: string,
  query: string,
  options: {
    numResults?: number;
    category?: string;
    type?: string;
    startPublishedDate?: string;
    endPublishedDate?: string;
    includeDomains?: string[];
    excludeDomains?: string[];
    textMaxCharacters?: number;
    enableHighlights?: boolean;
    highlightsNumSentences?: number;
  },
): Promise<string> {
  const exa = new Exa(apiKey);

  const searchRequest: Record<string, unknown> = {
    query,
    numResults: options.numResults || 10,
    contents: {
      text: { maxCharacters: options.textMaxCharacters || 3000 },
    },
  };

  if (options.category) {
    searchRequest.category = options.category;
  }
  if (options.type) {
    searchRequest.type = options.type;
  }
  if (options.startPublishedDate) {
    searchRequest.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    searchRequest.endPublishedDate = options.endPublishedDate;
  }
  if (options.includeDomains && options.includeDomains.length > 0) {
    searchRequest.includeDomains = options.includeDomains;
  }
  if (options.excludeDomains && options.excludeDomains.length > 0) {
    searchRequest.excludeDomains = options.excludeDomains;
  }
  if (options.enableHighlights) {
    const existingContents = searchRequest.contents as Record<string, unknown>;
    searchRequest.contents = {
      ...existingContents,
      highlights: {
        highlightsPerUrl: options.highlightsNumSentences || 3,
      },
    };
  }

  const response = await exa.request<ExaSearchResponse>("/search", "POST", searchRequest);

  if (!response?.results || response.results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return formatSearchResults(response.results);
}

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
  pi.registerFlag("--exa-config", {
    description: "Path to custom JSON config file for private overrides such as API keys.",
    type: "string",
  });

  const getApiKey = (): string => resolveAuth(pi).apiKey;

  const isToolEnabled = (toolName: string): boolean => isToolEnabledForConfig(pi, getResolvedConfig(pi), toolName);

  // Register web_search_exa tool
  if (isToolEnabled("web_search_exa")) {
    pi.registerTool({
      name: "web_search_exa",
      label: "Exa Web Search",
      description:
        "Search the web for any topic and get clean, ready-to-use content. " +
        "Best for: Finding current information, news, facts, or answering questions. " +
        "Query tips: describe the ideal page, not keywords. 'blog post comparing React and Vue' not 'React Vue'.",
      parameters: webSearchParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Searching the web via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as { query: string; numResults?: number };
          const result = await performWebSearch(
            apiKey,
            typedParams.query,
            typedParams.numResults || DEFAULT_NUM_RESULTS,
          );
          return { content: [{ type: "text", text: result }], details: { tool: "web_search_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa search error: ${message}` }],
            isError: true,
            details: { tool: "web_search_exa", error: message },
          };
        }
      },
    });
  }

  // Register web_fetch_exa tool
  if (isToolEnabled("web_fetch_exa")) {
    pi.registerTool({
      name: "web_fetch_exa",
      label: "Exa Web Fetch",
      description:
        "Read a webpage's full content as clean markdown. " +
        "Use after web_search_exa when highlights are insufficient or to read any URL. " +
        "Best for: Extracting full content from known URLs. Batch multiple URLs in one call.",
      parameters: webFetchParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_fetch_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching content via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as { urls: string[]; maxCharacters?: number };
          const result = await performWebFetch(
            apiKey,
            typedParams.urls,
            typedParams.maxCharacters || DEFAULT_MAX_CHARACTERS,
          );
          return { content: [{ type: "text", text: result }], details: { tool: "web_fetch_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa fetch error: ${message}` }],
            isError: true,
            details: { tool: "web_fetch_exa", error: message },
          };
        }
      },
    });
  }

  // Register web_search_advanced_exa tool (disabled by default)
  if (isToolEnabled("web_search_advanced_exa")) {
    pi.registerTool({
      name: "web_search_advanced_exa",
      label: "Exa Advanced Search",
      description:
        "Advanced web search with full Exa API control including category filters, domain restrictions, date ranges, " +
        "highlights, summaries, and subpage crawling. Requires --exa-enable-advanced flag or advancedEnabled in config.",
      parameters: webSearchAdvancedParams,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Cancelled." }],
            details: { cancelled: true },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Performing advanced search via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as {
            query: string;
            numResults?: number;
            category?: string;
            type?: string;
            startPublishedDate?: string;
            endPublishedDate?: string;
            includeDomains?: string[];
            excludeDomains?: string[];
            textMaxCharacters?: number;
            enableHighlights?: boolean;
            highlightsNumSentences?: number;
          };

          const result = await performAdvancedSearch(apiKey, typedParams.query, {
            numResults: typedParams.numResults,
            category: typedParams.category,
            type: typedParams.type,
            startPublishedDate: typedParams.startPublishedDate,
            endPublishedDate: typedParams.endPublishedDate,
            includeDomains: typedParams.includeDomains,
            excludeDomains: typedParams.excludeDomains,
            textMaxCharacters: typedParams.textMaxCharacters,
            enableHighlights: typedParams.enableHighlights,
            highlightsNumSentences: typedParams.highlightsNumSentences,
          });

          return { content: [{ type: "text", text: result }], details: { tool: "web_search_advanced_exa" } };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa advanced search error: ${message}` }],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: message },
          };
        }
      },
    });
  }
}

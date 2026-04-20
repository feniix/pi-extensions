/**
 * Exa AI MCP Extension for pi
 *
 * Provides Exa search tools via native TypeScript (no external MCP server required).
 * Tools: web_search_exa, web_fetch_exa, web_search_advanced_exa (disabled by default),
 *        web_research_exa (disabled by default), web_answer_exa, web_find_similar_exa.
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
 *   "Deep research on the latest LLM architectures"
 *
 * Tools:
 *   - web_search_exa: Web search with highlights (enabled by default)
 *   - web_fetch_exa: Read URLs/crawl content with highlights, summary, maxAgeHours (enabled by default)
 *   - web_search_advanced_exa: Full-featured search with category filters (disabled by default)
 *   - web_research_exa: Deep research with synthesized output + grounding citations (disabled by default)
 *   - web_answer_exa: Grounded LLM answer with citations (enabled by default)
 *   - web_find_similar_exa: Find pages similar to a URL (enabled by default)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { SearchResponse, SearchResult } from "exa-js";
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
  researchEnabled?: boolean;
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
    researchEnabled: typeof obj.researchEnabled === "boolean" ? obj.researchEnabled : false,
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
      researchEnabled: parsedConfig.researchEnabled,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-exa] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "exa.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "exa.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-exa] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-exa". Keep secrets in EXA_API_KEY or an explicit custom config via --exa-config-file / EXA_CONFIG_FILE.`,
      );
    }
  }
}

function loadConfig(configPath?: string): ExaConfig | null {
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (process.env.EXA_CONFIG_FILE) {
    return loadConfigFile(resolveConfigPath(process.env.EXA_CONFIG_FILE));
  }
  if (process.env.EXA_CONFIG) {
    console.warn("[pi-exa] EXA_CONFIG is deprecated; use EXA_CONFIG_FILE.");
    return loadConfigFile(resolveConfigPath(process.env.EXA_CONFIG));
  }

  warnIgnoredLegacyConfigFiles();

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
    researchEnabled: projectConfig?.researchEnabled ?? globalConfig?.researchEnabled,
  };
}

function getConfigOverrideFlag(pi: ExtensionAPI): string | undefined {
  const configFileFlag = normalizeString(pi.getFlag("--exa-config-file"));
  if (configFileFlag) {
    return configFileFlag;
  }

  const legacyConfigFlag = normalizeString(pi.getFlag("--exa-config"));
  if (legacyConfigFlag) {
    console.warn("[pi-exa] --exa-config is deprecated; use --exa-config-file.");
    return legacyConfigFlag;
  }

  return undefined;
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

function isResearchToolEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const researchFlag = pi.getFlag("--exa-enable-research");
  // Flag takes priority over config (allows CLI override even when config restricts)
  if (researchFlag !== undefined) {
    return Boolean(researchFlag);
  }
  return config?.researchEnabled ?? false;
}

function isToolEnabledForConfig(pi: ExtensionAPI, config: ExaConfig | null, toolName: string): boolean {
  if (config?.enabledTools && Array.isArray(config.enabledTools) && config.enabledTools.length > 0) {
    return config.enabledTools.includes(toolName);
  }

  // Default-enabled tools
  if (
    toolName === "web_search_exa" ||
    toolName === "web_fetch_exa" ||
    toolName === "web_answer_exa" ||
    toolName === "web_find_similar_exa"
  ) {
    return true;
  }

  if (toolName === "web_search_advanced_exa") {
    return isAdvancedToolEnabled(pi, config);
  }

  if (toolName === "web_research_exa") {
    return isResearchToolEnabled(pi, config);
  }

  return false;
}

// =============================================================================
// Observability Helpers
// =============================================================================

type CostDollars = { search?: { total?: number }; contents?: { total?: number } };

function extractCost(costDollars?: CostDollars): Record<string, unknown> | undefined {
  if (!costDollars) return undefined;
  return { costDollars };
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
    highlights: Type.Optional(Type.Boolean({ description: "Include highlighted passages relevant to the query." })),
    summary: Type.Optional(
      Type.Object(
        { query: Type.String({ description: "Query to guide the summary extraction." }) },
        { description: "Request a summary of the page content." },
      ),
    ),
    maxAgeHours: Type.Optional(
      Type.Integer({ description: "Max age of cached content in hours (0 = always fresh, -1 = never fresh)." }),
    ),
  },
  { additionalProperties: true },
);

const VALID_ADVANCED_TYPES = ["auto", "fast", "neural", "keyword", "hybrid", "instant"] as const;
type ValidAdvancedType = (typeof VALID_ADVANCED_TYPES)[number];

const webSearchAdvancedParams = Type.Object(
  {
    query: Type.String({ description: "Search query" }),
    numResults: Type.Optional(Type.Integer({ description: "Number of results (1-100)", minimum: 1, maximum: 100 })),
    category: Type.Optional(
      Type.String({
        description: "Category filter: company, research paper, financial report, people, news, etc.",
      }),
    ),
    type: Type.Optional(
      Type.Union(
        [
          Type.Literal("auto"),
          Type.Literal("fast"),
          Type.Literal("neural"),
          Type.Literal("keyword"),
          Type.Literal("hybrid"),
          Type.Literal("instant"),
        ],
        {
          description:
            "Search type: auto, fast, neural, keyword, hybrid, instant (not deep types — use web_research_exa)",
        },
      ),
    ),
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

const webResearchParams = Type.Object(
  {
    query: Type.String({ description: "Research question or topic to investigate deeply." }),
    type: Type.Optional(
      Type.Union([Type.Literal("deep-reasoning"), Type.Literal("deep-lite"), Type.Literal("deep")], {
        description: "Deep search variant (default: deep-reasoning)",
      }),
    ),
    systemPrompt: Type.Optional(Type.String({ description: "Additional instructions for the research agent." })),
    outputSchema: Type.Optional(
      Type.Object({}, { additionalProperties: true }, { description: "JSON Schema for structured output." }),
    ),
    additionalQueries: Type.Optional(
      Type.Array(Type.String({ maxLength: 5 }), {
        description: "Alternative query formulations (max 5).",
      }),
    ),
    numResults: Type.Optional(Type.Integer({ description: "Number of source results to include." })),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    startPublishedDate: Type.Optional(Type.String()),
    endPublishedDate: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const webAnswerParams = Type.Object(
  {
    query: Type.String({ description: "Question to answer." }),
    systemPrompt: Type.Optional(Type.String({ description: "Instructions to guide the answer style." })),
    text: Type.Optional(Type.Boolean({ description: "Include source text in citations (default: false)." })),
    outputSchema: Type.Optional(
      Type.Object({}, { additionalProperties: true }, { description: "JSON Schema for structured output." }),
    ),
  },
  { additionalProperties: true },
);

const webFindSimilarParams = Type.Object(
  {
    url: Type.String({ description: "URL to find similar pages for." }),
    numResults: Type.Optional(
      Type.Integer({ description: "Number of similar results (default: 5)", minimum: 1, maximum: 100 }),
    ),
    excludeSourceDomain: Type.Optional(
      Type.Boolean({ description: "Exclude links from the base domain of the input URL." }),
    ),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    startPublishedDate: Type.Optional(Type.String()),
    endPublishedDate: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// =============================================================================
// Prompt Guidance
// =============================================================================

const PROMPT_SNIPPETS: Record<string, string> = {
  web_search_exa: "Web search — real-time information, news, facts. Semantically rich queries perform best.",
  web_fetch_exa: "Read webpage content — use after search when full article is needed.",
  web_search_advanced_exa:
    "Advanced search with category filters, date ranges, domain restrictions. Best for targeted discovery.",
  web_research_exa: "Deep research — synthesizes findings with grounded citations. ~20s, higher cost.",
  web_answer_exa: "Grounded answer with citations — best for direct factual questions.",
  web_find_similar_exa: "Find similar pages — best for expanding coverage from a known URL.",
};

const PROMPT_GUIDELINES: Record<string, string[]> = {
  web_search_exa: [
    "Use semantically rich, descriptive queries — 'blog post comparing React and Vue' not 'React Vue'",
    "Include language/framework/version when relevant",
    "Include exact identifiers (function names, error messages) when available",
  ],
  web_fetch_exa: [
    "Use after web_search_exa or web_search_advanced_exa to read full content",
    "For multiple URLs, batch in one call",
    "Use maxCharacters to limit output size per page",
  ],
  web_search_advanced_exa: [
    "Use category filters for entity-focused searches (company, people, research paper, financial report)",
    "Domain and date filters work with most categories; check category restrictions",
    "Use enableHighlights for relevant passage extraction",
  ],
  web_research_exa: [
    "Higher latency (~20s) — use for complex research questions, not quick lookups",
    "Works best with clear research questions and outputSchema for structured results",
    "Ground citations come from real sources — cite them in responses",
  ],
  web_answer_exa: [
    "Best for factual questions with verifiable sources",
    "Use systemPrompt to guide answer style (e.g., 'be concise', 'for experts')",
    "Set text: true to include full source snippets alongside citations",
  ],
  web_find_similar_exa: [
    "Provide a single representative URL — the more specific the better",
    "Use excludeSourceDomain to find content from different sources",
    "Combine with category filters for better relevance",
  ],
};

// =============================================================================
// Tool Implementations
// =============================================================================

function formatSearchResults(results: SearchResult<unknown>[]): string {
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
      } else if (typeof r.text === "string" && r.text) {
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
    highlights?: string[];
    summary?: string;
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
      if (Array.isArray(r.highlights) && r.highlights.length > 0) {
        lines.push(`\nHighlights:\n${r.highlights.join("\n")}`);
      }
      if (typeof r.summary === "string" && r.summary) {
        lines.push(`\nSummary:\n${r.summary}`);
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

function formatResearchOutput(response: {
  output?: {
    content: string | Record<string, unknown>;
    grounding?: Array<{
      field: string;
      citations: Array<{ url: string; title: string }>;
      confidence: "low" | "medium" | "high";
    }>;
  };
  results?: Array<{ url: string; title?: string }>;
}): string {
  const parts: string[] = [];

  if (response.output) {
    const { content, grounding } = response.output;

    // Primary output
    if (typeof content === "string") {
      parts.push(content);
    } else {
      parts.push("```json");
      parts.push(JSON.stringify(content, null, 2));
      parts.push("```");
    }

    // Grounding / citations
    if (grounding && grounding.length > 0) {
      parts.push("");
      parts.push("## Grounding Citations\n");
      for (const entry of grounding) {
        const citationList = entry.citations.map((c) => `- [${c.title}](${c.url}) [${entry.confidence}]`).join("\n");
        parts.push(`**${entry.field}** (${entry.confidence}):\n${citationList}`);
      }
    }
  }

  // Source links (tertiary)
  if (response.results && response.results.length > 0) {
    parts.push("");
    parts.push("## Sources\n");
    for (const result of response.results.slice(0, 20)) {
      const title = result.title || result.url;
      parts.push(`- [${title}](${result.url})`);
    }
    if (response.results.length > 20) {
      parts.push(`_...and ${response.results.length - 20} more_`);
    }
  }

  return parts.join("\n\n");
}

function formatAnswerResult(response: {
  answer: string | Record<string, unknown>;
  citations: Array<{ id: string; url: string; title?: string; text?: string }>;
  requestId?: string;
}): string {
  const parts: string[] = [];

  // Primary answer
  if (typeof response.answer === "string") {
    parts.push(response.answer);
  } else {
    parts.push("```json");
    parts.push(JSON.stringify(response.answer, null, 2));
    parts.push("```");
  }

  // Citations
  if (response.citations.length > 0) {
    parts.push("");
    parts.push("## Sources\n");
    for (const citation of response.citations) {
      const title = citation.title || citation.url;
      const lines = [`- [${title}](${citation.url})`];
      if (citation.text) {
        lines.push(`  > ${citation.text}`);
      }
      parts.push(lines.join("\n"));
    }
  }

  return parts.join("\n\n");
}

// =============================================================================
// SDK Operations
// =============================================================================

async function performWebSearch(apiKey: string, query: string, numResults: number) {
  const exa = new Exa(apiKey);

  const response = await exa.search(query, {
    numResults,
    type: "auto",
    contents: {
      highlights: { query, maxCharacters: 500 },
      text: { maxCharacters: 500 },
    },
  });

  return response;
}

async function performWebFetch(
  apiKey: string,
  urls: string[],
  options: {
    maxCharacters: number;
    highlights?: boolean;
    summary?: { query: string };
    maxAgeHours?: number;
  },
) {
  const exa = new Exa(apiKey);

  const contentsOptions: Record<string, unknown> = {
    text: { maxCharacters: options.maxCharacters },
  };

  if (options.highlights) {
    contentsOptions.highlights = true;
  }
  if (options.summary) {
    contentsOptions.summary = { query: options.summary.query };
  }
  if (options.maxAgeHours !== undefined) {
    contentsOptions.maxAgeHours = options.maxAgeHours;
  }

  const response = await exa.getContents(urls, contentsOptions as Parameters<typeof exa.getContents>[1]);
  return response;
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
) {
  const exa = new Exa(apiKey);

  const searchOptions: Record<string, unknown> = {
    query,
    numResults: options.numResults || 10,
    contents: {
      text: { maxCharacters: options.textMaxCharacters || 3000 },
    },
  };

  if (options.category) {
    searchOptions.category = options.category;
  }
  if (options.type) {
    searchOptions.type = options.type;
  }
  if (options.startPublishedDate) {
    searchOptions.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    searchOptions.endPublishedDate = options.endPublishedDate;
  }
  if (options.includeDomains && options.includeDomains.length > 0) {
    searchOptions.includeDomains = options.includeDomains;
  }
  if (options.excludeDomains && options.excludeDomains.length > 0) {
    searchOptions.excludeDomains = options.excludeDomains;
  }
  if (options.enableHighlights) {
    const existingContents = searchOptions.contents as Record<string, unknown>;
    searchOptions.contents = {
      ...existingContents,
      highlights: {
        highlightsPerUrl: options.highlightsNumSentences || 3,
      },
    };
  }

  const response = await exa.search(query, searchOptions as Parameters<typeof exa.search>[1]);
  return response;
}

async function performResearch(
  apiKey: string,
  query: string,
  options: {
    type?: "deep-reasoning" | "deep-lite" | "deep";
    systemPrompt?: string;
    outputSchema?: Record<string, unknown>;
    additionalQueries?: string[];
    numResults?: number;
    includeDomains?: string[];
    excludeDomains?: string[];
    startPublishedDate?: string;
    endPublishedDate?: string;
  },
) {
  const exa = new Exa(apiKey);

  const researchParams: Record<string, unknown> = {
    query,
    type: options.type || "deep-reasoning",
  };

  if (options.systemPrompt) {
    researchParams.systemPrompt = options.systemPrompt;
  }
  if (options.outputSchema) {
    researchParams.outputSchema = options.outputSchema;
  }
  if (options.additionalQueries && options.additionalQueries.length > 0) {
    researchParams.additionalQueries = options.additionalQueries.slice(0, 5);
  }
  if (options.numResults) {
    researchParams.numResults = options.numResults;
  }
  if (options.includeDomains && options.includeDomains.length > 0) {
    researchParams.includeDomains = options.includeDomains;
  }
  if (options.excludeDomains && options.excludeDomains.length > 0) {
    researchParams.excludeDomains = options.excludeDomains;
  }
  if (options.startPublishedDate) {
    researchParams.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    researchParams.endPublishedDate = options.endPublishedDate;
  }

  // Use the research client to create and poll
  const createResponse = await exa.research.create(researchParams as Parameters<typeof exa.research.create>[0]);
  const researchId = createResponse.researchId;

  // Poll until finished
  const result = await exa.research.pollUntilFinished(researchId, {
    pollInterval: 2000,
    timeoutMs: 120_000,
  });

  return result;
}

async function performAnswer(
  apiKey: string,
  query: string,
  options: {
    systemPrompt?: string;
    text?: boolean;
    outputSchema?: Record<string, unknown>;
  },
) {
  const exa = new Exa(apiKey);

  const answerOptions: Record<string, unknown> = {};
  if (options.systemPrompt) {
    answerOptions.systemPrompt = options.systemPrompt;
  }
  if (options.text !== undefined) {
    answerOptions.text = options.text;
  }
  if (options.outputSchema) {
    answerOptions.outputSchema = options.outputSchema;
  }

  const response = await exa.answer(query, answerOptions as Parameters<typeof exa.answer>[1]);
  return response;
}

async function performFindSimilar(
  apiKey: string,
  url: string,
  options: {
    numResults?: number;
    excludeSourceDomain?: boolean;
    includeDomains?: string[];
    excludeDomains?: string[];
    startPublishedDate?: string;
    endPublishedDate?: string;
  },
) {
  const exa = new Exa(apiKey);

  const searchOptions: Record<string, unknown> = {};
  if (options.numResults) searchOptions.numResults = options.numResults;
  if (options.excludeSourceDomain !== undefined) {
    searchOptions.excludeSourceDomain = options.excludeSourceDomain;
  }
  if (options.includeDomains && options.includeDomains.length > 0) {
    searchOptions.includeDomains = options.includeDomains;
  }
  if (options.excludeDomains && options.excludeDomains.length > 0) {
    searchOptions.excludeDomains = options.excludeDomains;
  }
  if (options.startPublishedDate) {
    searchOptions.startPublishedDate = options.startPublishedDate;
  }
  if (options.endPublishedDate) {
    searchOptions.endPublishedDate = options.endPublishedDate;
  }

  const response = await exa.findSimilar(url, searchOptions as Parameters<typeof exa.findSimilar>[1]);
  return response;
}

// =============================================================================
// Exports (for testing)
// =============================================================================

export {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_NUM_RESULTS,
  extractCost,
  formatAnswerResult,
  formatCrawlResults,
  formatResearchOutput,
  formatSearchResults,
  getAuthStatusMessage,
  isResearchToolEnabled,
  isToolEnabledForConfig,
  loadConfig,
  performWebSearch,
  PROMPT_GUIDELINES,
  PROMPT_SNIPPETS,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
  VALID_ADVANCED_TYPES,
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
  pi.registerFlag("--exa-enable-research", {
    description: "Enable web_research_exa tool (deep research)",
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

  const getApiKey = (): string => resolveAuth(pi).apiKey;

  const isToolEnabled = (toolName: string): boolean => isToolEnabledForConfig(pi, getResolvedConfig(pi), toolName);

  // ---------------------------------------------------------------------------
  // web_search_exa
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_search_exa")) {
    pi.registerTool({
      name: "web_search_exa",
      label: "Exa Web Search",
      description:
        "Search the web for any topic and get clean, ready-to-use content. " +
        "Best for: Finding current information, news, facts, or answering questions. " +
        "Query tips: describe the ideal page, not keywords. 'blog post comparing React and Vue' not 'React Vue'.",
      parameters: webSearchParams,
      promptSnippet: PROMPT_SNIPPETS.web_search_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_search_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Searching the web via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as { query: string; numResults?: number };
          const response = await performWebSearch(
            apiKey,
            typedParams.query,
            typedParams.numResults || DEFAULT_NUM_RESULTS,
          );

          const result =
            response.results.length > 0
              ? formatSearchResults(response.results)
              : "No search results found. Please try a different query.";

          return {
            content: [{ type: "text", text: result }],
            details: {
              tool: "web_search_exa",
              ...extractCost(response.costDollars),
              searchTime: response.searchTime,
              resolvedSearchType: response.resolvedSearchType,
            },
          };
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

  // ---------------------------------------------------------------------------
  // web_fetch_exa
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_fetch_exa")) {
    pi.registerTool({
      name: "web_fetch_exa",
      label: "Exa Web Fetch",
      description:
        "Read a webpage's full content as clean markdown. " +
        "Use after web_search_exa when highlights are insufficient or to read any URL. " +
        "Best for: Extracting full content from known URLs. Batch multiple URLs in one call. " +
        "Supports highlights, summary, and maxAgeHours for content freshness control.",
      parameters: webFetchParams,
      promptSnippet: PROMPT_SNIPPETS.web_fetch_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_fetch_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_fetch_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching content via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as {
            urls: string[];
            maxCharacters?: number;
            highlights?: boolean;
            summary?: { query: string };
            maxAgeHours?: number;
          };

          const response = await performWebFetch(apiKey, typedParams.urls, {
            maxCharacters: typedParams.maxCharacters || DEFAULT_MAX_CHARACTERS,
            highlights: typedParams.highlights,
            summary: typedParams.summary,
            maxAgeHours: typedParams.maxAgeHours,
          });

          const result =
            response.results.length > 0
              ? formatCrawlResults(response.results as Parameters<typeof formatCrawlResults>[0])
              : "No content found for the requested URLs.";

          return {
            content: [{ type: "text", text: result }],
            details: {
              tool: "web_fetch_exa",
              ...extractCost(response.costDollars),
            },
          };
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

  // ---------------------------------------------------------------------------
  // web_search_advanced_exa (disabled by default)
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_search_advanced_exa")) {
    pi.registerTool({
      name: "web_search_advanced_exa",
      label: "Exa Advanced Search",
      description:
        "Advanced web search with full Exa API control including category filters, domain restrictions, date ranges, " +
        "highlights, summaries, and subpage crawling. Requires --exa-enable-advanced flag or advancedEnabled in config. " +
        "Note: deep types (deep, deep-lite, deep-reasoning) are not supported here — use web_research_exa instead.",
      parameters: webSearchAdvancedParams,
      promptSnippet: PROMPT_SNIPPETS.web_search_advanced_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_search_advanced_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

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

        // FR-6: Reject deep search types — direct to web_research_exa
        if (typedParams.type && !VALID_ADVANCED_TYPES.includes(typedParams.type as ValidAdvancedType)) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Type "${typedParams.type}" is not supported in web_search_advanced_exa. ` +
                  `Use web_research_exa for deep research types (deep-reasoning, deep-lite, deep), ` +
                  `or use web_search_exa for standard searches.`,
              },
            ],
            isError: true,
            details: { tool: "web_search_advanced_exa", error: "unsupported_type" },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Performing advanced search via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const response = await performAdvancedSearch(apiKey, typedParams.query, {
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

          const result =
            response.results.length > 0
              ? formatSearchResults(response.results)
              : "No search results found. Please try a different query.";

          return {
            content: [{ type: "text", text: result }],
            details: {
              tool: "web_search_advanced_exa",
              ...extractCost(response.costDollars),
              searchTime: response.searchTime,
              resolvedSearchType: response.resolvedSearchType,
            },
          };
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

  // ---------------------------------------------------------------------------
  // web_research_exa (disabled by default)
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_research_exa")) {
    pi.registerTool({
      name: "web_research_exa",
      label: "Exa Deep Research",
      description:
        "Deep research with synthesized output and grounded citations. " +
        "Performs multi-step web research, synthesizes findings, and provides citations. " +
        "Use for complex research questions. ~20s latency. Requires --exa-enable-research flag or researchEnabled in config.",
      parameters: webResearchParams,
      promptSnippet: PROMPT_SNIPPETS.web_research_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_research_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_research_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        const typedParams = params as {
          query: string;
          type?: "deep-reasoning" | "deep-lite" | "deep";
          systemPrompt?: string;
          outputSchema?: Record<string, unknown>;
          additionalQueries?: string[];
          numResults?: number;
          includeDomains?: string[];
          excludeDomains?: string[];
          startPublishedDate?: string;
          endPublishedDate?: string;
        };

        // Reject non-deep types with helpful guidance
        if (typedParams.type && !["deep-reasoning", "deep-lite", "deep"].includes(typedParams.type)) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Type "${typedParams.type}" is not a valid deep search type for web_research_exa. ` +
                  `Valid types are: deep-reasoning, deep-lite, deep. ` +
                  `For standard search, use web_search_exa or web_search_advanced_exa.`,
              },
            ],
            isError: true,
            details: { tool: "web_research_exa", error: "unsupported_type" },
          };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Running deep research via Exa... (this may take ~20 seconds)" }],
          details: { status: "pending" },
        });

        try {
          const researchResponse = await performResearch(apiKey, typedParams.query, {
            type: typedParams.type || "deep-reasoning",
            systemPrompt: typedParams.systemPrompt,
            outputSchema: typedParams.outputSchema,
            additionalQueries: typedParams.additionalQueries,
            numResults: typedParams.numResults,
            includeDomains: typedParams.includeDomains,
            excludeDomains: typedParams.excludeDomains,
            startPublishedDate: typedParams.startPublishedDate,
            endPublishedDate: typedParams.endPublishedDate,
          });

          if (researchResponse.status === "canceled") {
            return { content: [{ type: "text", text: "Research cancelled." }], details: { cancelled: true } };
          }

          if (researchResponse.status === "failed") {
            return {
              content: [
                {
                  type: "text",
                  text: `Research failed: ${(researchResponse as unknown as { error?: string }).error || "Unknown error"}`,
                },
              ],
              isError: true,
              details: { tool: "web_research_exa", error: "research_failed" },
            };
          }

          const formatted = formatResearchOutput(researchResponse as Parameters<typeof formatResearchOutput>[0]);

          return {
            content: [{ type: "text", text: formatted }],
            details: {
              tool: "web_research_exa",
              costDollars: researchResponse.costDollars,
              resolvedSearchType: researchResponse.status,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa research error: ${message}` }],
            isError: true,
            details: { tool: "web_research_exa", error: message },
          };
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // web_answer_exa
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_answer_exa")) {
    pi.registerTool({
      name: "web_answer_exa",
      label: "Exa Answer",
      description:
        "Generate a grounded answer to a question with citations from the web. " +
        "Best for: Direct factual questions that benefit from source attribution.",
      parameters: webAnswerParams,
      promptSnippet: PROMPT_SNIPPETS.web_answer_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_answer_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_answer_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Fetching answer from Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as {
            query: string;
            systemPrompt?: string;
            text?: boolean;
            outputSchema?: Record<string, unknown>;
          };

          const response = await performAnswer(apiKey, typedParams.query, {
            systemPrompt: typedParams.systemPrompt,
            text: typedParams.text,
            outputSchema: typedParams.outputSchema,
          });

          const formatted = formatAnswerResult(response as Parameters<typeof formatAnswerResult>[0]);

          return {
            content: [{ type: "text", text: formatted }],
            details: {
              tool: "web_answer_exa",
              ...extractCost(response.costDollars),
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa answer error: ${message}` }],
            isError: true,
            details: { tool: "web_answer_exa", error: message },
          };
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // web_find_similar_exa
  // ---------------------------------------------------------------------------
  if (isToolEnabled("web_find_similar_exa")) {
    pi.registerTool({
      name: "web_find_similar_exa",
      label: "Exa Find Similar",
      description:
        "Find pages similar to a given URL using Exa's semantic similarity. " +
        "Best for: Expanding coverage from a known source, finding related content.",
      parameters: webFindSimilarParams,
      promptSnippet: PROMPT_SNIPPETS.web_find_similar_exa,
      promptGuidelines: PROMPT_GUIDELINES.web_find_similar_exa,
      async execute(_toolCallId, params, signal, onUpdate) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag." }],
            isError: true,
            details: { tool: "web_find_similar_exa", error: "missing_api_key" },
          };
        }

        if (signal?.aborted) {
          return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
        }

        onUpdate?.({
          content: [{ type: "text", text: "Finding similar pages via Exa..." }],
          details: { status: "pending" },
        });

        try {
          const typedParams = params as {
            url: string;
            numResults?: number;
            excludeSourceDomain?: boolean;
            includeDomains?: string[];
            excludeDomains?: string[];
            startPublishedDate?: string;
            endPublishedDate?: string;
          };

          const response = await performFindSimilar(apiKey, typedParams.url, {
            numResults: typedParams.numResults,
            excludeSourceDomain: typedParams.excludeSourceDomain,
            includeDomains: typedParams.includeDomains,
            excludeDomains: typedParams.excludeDomains,
            startPublishedDate: typedParams.startPublishedDate,
            endPublishedDate: typedParams.endPublishedDate,
          });

          const result =
            response.results.length > 0 ? formatSearchResults(response.results) : "No similar pages found.";

          return {
            content: [{ type: "text", text: result }],
            details: {
              tool: "web_find_similar_exa",
              ...extractCost(response.costDollars),
              searchTime: response.searchTime,
              resolvedSearchType: response.resolvedSearchType,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Exa find similar error: ${message}` }],
            isError: true,
            details: { tool: "web_find_similar_exa", error: message },
          };
        }
      },
    });
  }
}

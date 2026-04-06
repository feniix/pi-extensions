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
 *    - JSON config: ~/.pi/agent/extensions/exa.json
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
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

// =============================================================================
// Config Loading
// =============================================================================

function resolveConfigPath(configPath: string): string {
	const trimmed = configPath.trim();
	if (trimmed.startsWith("~/")) {
		return join(homedir(), trimmed.slice(2));
	}
	if (trimmed.startsWith("~")) {
		return join(homedir(), trimmed.slice(1));
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
		apiKey: typeof obj.apiKey === "string" ? obj.apiKey : undefined,
		enabledTools: Array.isArray(obj.enabledTools) ? obj.enabledTools.filter((t) => typeof t === "string") : undefined,
		advancedEnabled: typeof obj.advancedEnabled === "boolean" ? obj.advancedEnabled : false,
	};
}

function loadConfig(configPath?: string): ExaConfig | null {
	const candidates: string[] = [];

	if (configPath) {
		candidates.push(resolveConfigPath(configPath));
	} else if (process.env.EXA_CONFIG) {
		candidates.push(resolveConfigPath(process.env.EXA_CONFIG));
	} else {
		const projectConfigPath = join(process.cwd(), ".pi", "extensions", "exa.json");
		const globalConfigPath = join(homedir(), ".pi", "agent", "extensions", "exa.json");
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		candidates.push(projectConfigPath, globalConfigPath);
	}

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		const raw = readFileSync(candidate, "utf-8");
		const parsed = JSON.parse(raw);
		return parseConfig(parsed);
	}

	return null;
}

function ensureDefaultConfigFile(projectConfigPath: string, globalConfigPath: string): void {
	if (existsSync(projectConfigPath) || existsSync(globalConfigPath)) {
		return;
	}

	const defaultConfig = {
		apiKey: null,
		enabledTools: ["web_search_exa", "web_fetch_exa"],
		advancedEnabled: false,
	};

	try {
		mkdirSync(dirname(globalConfigPath), { recursive: true });
		writeFileSync(globalConfigPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-exa] Failed to write ${globalConfigPath}: ${message}`);
	}
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

	const response = await exa.request<ExaSearchResponse>("https://api.exa.ai/search", "POST", searchRequest);

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
	}>("https://api.exa.ai/contents", "POST", crawlRequest);

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

	const response = await exa.request<ExaSearchResponse>("https://api.exa.ai/search", "POST", searchRequest);

	if (!response?.results || response.results.length === 0) {
		return "No search results found. Please try a different query.";
	}

	return formatSearchResults(response.results);
}

export {
	DEFAULT_MAX_CHARACTERS,
	DEFAULT_NUM_RESULTS,
	ensureDefaultConfigFile,
	formatCrawlResults,
	formatSearchResults,
	loadConfig,
	parseConfig,
	resolveConfigPath,
};

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function exaExtension(pi: ExtensionAPI) {
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
		description: "Path to JSON config file (defaults to ~/.pi/agent/extensions/exa.json)",
		type: "string",
	});

	const getApiKey = (): string => {
		// Priority: CLI flag > config file > environment variable
		const apiKeyFlag = pi.getFlag("--exa-api-key");
		if (typeof apiKeyFlag === "string" && apiKeyFlag.trim().length > 0) {
			return apiKeyFlag.trim();
		}

		const configFlag = pi.getFlag("--exa-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
		if (config?.apiKey) {
			return config.apiKey;
		}

		const envApiKey = process.env.EXA_API_KEY;
		if (envApiKey && envApiKey.trim().length > 0) {
			return envApiKey.trim();
		}

		return "";
	};

	const isToolEnabled = (toolName: string): boolean => {
		const configFlag = pi.getFlag("--exa-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

		// Check if tool is in enabledTools list
		if (config?.enabledTools && Array.isArray(config.enabledTools)) {
			return config.enabledTools.includes(toolName);
		}

		// Default enabled tools
		if (toolName === "web_search_exa" || toolName === "web_fetch_exa") {
			return true;
		}

		// web_search_advanced_exa requires explicit enable
		if (toolName === "web_search_advanced_exa") {
			const advancedFlag = pi.getFlag("--exa-enable-advanced");
			if (typeof advancedFlag === "boolean") {
				return advancedFlag;
			}
			return config?.advancedEnabled ?? false;
		}

		return false;
	};

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

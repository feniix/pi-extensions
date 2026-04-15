/**
 * Ref.tools MCP CLI Extension
 *
 * Provides Ref MCP tools via HTTP: ref_search_documentation and ref_read_url.
 * Token-efficient documentation search and URL reading via Ref's Model Context Protocol.
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-ref-tools
 * 2. Optional config:
 *    - JSON config: ~/.pi/agent/extensions/ref-tools.json or .pi/extensions/ref-tools.json
 *      (or set REF_MCP_CONFIG / --ref-mcp-config for a custom path)
 *      Keys: url, apiKey, timeoutMs, protocolVersion, maxBytes, maxLines
 *    - REF_MCP_URL (default: https://api.ref.tools/mcp)
 *    - REF_API_KEY (API key, sent as x-ref-api-key header)
 *    - REF_MCP_TIMEOUT_MS (default: 30000)
 *    - REF_MCP_PROTOCOL_VERSION (default: 2025-06-18)
 *    - REF_MCP_MAX_BYTES (default: 51200)
 *    - REF_MCP_MAX_LINES (default: 2000)
 * 3. Or pass flags:
 *    --ref-mcp-url, --ref-mcp-api-key, --ref-mcp-timeout-ms,
 *    --ref-mcp-protocol, --ref-mcp-config, --ref-mcp-max-bytes, --ref-mcp-max-lines
 *
 * Usage:
 *   "Search the docs for React Server Components"
 *   "Read the Tailwind CSS docs page on flex utilities"
 *
 * Tools:
 *   - ref_search_documentation: Search indexed technical documentation
 *   - ref_read_url: Fetch and read a documentation URL as optimized markdown
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ENDPOINT = "https://api.ref.tools/mcp";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
	url: DEFAULT_ENDPOINT,
	apiKey: null,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	protocolVersion: DEFAULT_PROTOCOL_VERSION,
	maxBytes: DEFAULT_MAX_BYTES,
	maxLines: DEFAULT_MAX_LINES,
};

const CLIENT_INFO = {
	name: "pi-ref-tools-extension",
	version: "1.0.0",
} as const;

// =============================================================================
// Types
// =============================================================================

type JsonRpcId = string;

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: JsonRpcId | number | null;
	result?: unknown;
	error?: JsonRpcError;
}

interface McpToolResult {
	content?: Array<Record<string, unknown>>;
	isError?: boolean;
}

interface McpToolDetails {
	tool: string;
	endpoint: string;
	truncated: boolean;
	truncation?: {
		truncatedBy: "lines" | "bytes" | null;
		totalLines: number;
		totalBytes: number;
		outputLines: number;
		outputBytes: number;
		maxLines: number;
		maxBytes: number;
	};
	tempFile?: string;
}

interface McpErrorDetails {
	tool: string;
	endpoint: string;
	error: string;
}

interface RefMcpConfig {
	url?: string;
	apiKey?: string;
	timeoutMs?: number;
	protocolVersion?: string;
	maxBytes?: number;
	maxLines?: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	return isRecord(value) && value.jsonrpc === "2.0";
}

function toJsonString(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatToolOutput(
	toolName: string,
	endpoint: string,
	result: McpToolResult,
	limits?: { maxBytes?: number; maxLines?: number },
): { text: string; details: McpToolDetails } {
	const contentBlocks = Array.isArray(result.content) ? result.content : [];
	const renderedBlocks =
		contentBlocks.length > 0
			? contentBlocks.map((block) => {
					if (block.type === "text" && typeof block.text === "string") {
						return block.text;
					}
					return toJsonString(block);
				})
			: [toJsonString(result)];

	const rawText = renderedBlocks.join("\n");
	const truncation = truncateHead(rawText, {
		maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
		maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
	});

	let text = truncation.content;
	let tempFile: string | undefined;

	if (truncation.truncated) {
		tempFile = writeTempFile(toolName, rawText);
		text +=
			`\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
			`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
			`Full output saved to: ${tempFile}]`;
	}

	if (truncation.firstLineExceedsLimit && rawText.length > 0) {
		text =
			`[First line exceeded ${formatSize(truncation.maxBytes)} limit. Full output saved to: ${tempFile ?? "N/A"}]\n` +
			text;
	}

	return {
		text,
		details: {
			tool: toolName,
			endpoint,
			truncated: truncation.truncated,
			truncation: {
				truncatedBy: truncation.truncatedBy,
				totalLines: truncation.totalLines,
				totalBytes: truncation.totalBytes,
				outputLines: truncation.outputLines,
				outputBytes: truncation.outputBytes,
				maxLines: truncation.maxLines,
				maxBytes: truncation.maxBytes,
			},
			tempFile,
		},
	};
}

function writeTempFile(toolName: string, content: string): string {
	const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
	const filename = `pi-ref-tools-${safeName}-${Date.now()}.txt`;
	const filePath = join(tmpdir(), filename);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function parseTimeoutMs(value: string | number | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function splitParams(params: Record<string, unknown>): {
	mcpArgs: Record<string, unknown>;
	requestedLimits: { maxBytes?: number; maxLines?: number };
} {
	const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
		piMaxBytes?: unknown;
		piMaxLines?: unknown;
	};
	return {
		mcpArgs: rest,
		requestedLimits: {
			maxBytes: normalizeNumber(piMaxBytes),
			maxLines: normalizeNumber(piMaxLines),
		},
	};
}

function resolveEffectiveLimits(
	requested: { maxBytes?: number; maxLines?: number },
	maxAllowed: { maxBytes: number; maxLines: number },
): { maxBytes: number; maxLines: number } {
	const requestedBytes = requested.maxBytes ?? maxAllowed.maxBytes;
	const requestedLines = requested.maxLines ?? maxAllowed.maxLines;
	return {
		maxBytes: Math.min(requestedBytes, maxAllowed.maxBytes),
		maxLines: Math.min(requestedLines, maxAllowed.maxLines),
	};
}

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

function parseConfig(raw: unknown, pathHint: string): RefMcpConfig {
	if (!isRecord(raw)) {
		throw new Error(`Invalid Ref MCP config at ${pathHint}: expected an object.`);
	}
	return {
		url: normalizeString(raw.url),
		apiKey: normalizeString(raw.apiKey),
		timeoutMs: normalizeNumber(raw.timeoutMs),
		protocolVersion: normalizeString(raw.protocolVersion),
		maxBytes: normalizeNumber(raw.maxBytes),
		maxLines: normalizeNumber(raw.maxLines),
	};
}

function loadConfig(configPath: string | undefined): RefMcpConfig | null {
	const candidates: string[] = [];
	const envConfig = process.env.REF_MCP_CONFIG;
	if (configPath) {
		candidates.push(resolveConfigPath(configPath));
	} else if (envConfig) {
		candidates.push(resolveConfigPath(envConfig));
	} else {
		const projectConfigPath = join(process.cwd(), ".pi", "extensions", "ref-tools.json");
		const globalConfigPath = join(homedir(), ".pi", "agent", "extensions", "ref-tools.json");
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		candidates.push(projectConfigPath, globalConfigPath);
	}

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		try {
			const raw = readFileSync(candidate, "utf-8");
			const parsed = JSON.parse(raw);
			return parseConfig(parsed, candidate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[pi-ref-tools] Failed to parse config ${candidate}: ${message}`);
		}
	}

	return null;
}

function ensureDefaultConfigFile(projectConfigPath: string, globalConfigPath: string): void {
	if (existsSync(projectConfigPath) || existsSync(globalConfigPath)) {
		return;
	}
	try {
		mkdirSync(dirname(globalConfigPath), { recursive: true });
		writeFileSync(globalConfigPath, `${JSON.stringify(DEFAULT_CONFIG_FILE, null, 2)}\n`, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[pi-ref-tools] Failed to write ${globalConfigPath}: ${message}`);
	}
}

function redactApiKey(apiKey: string | undefined): string {
	if (!apiKey) {
		return "(none)";
	}
	if (apiKey.length <= 8) {
		return "***";
	}
	return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

// =============================================================================
// MCP Client
// =============================================================================

class RefMcpClient {
	private requestCounter = 0;
	private initialized = false;
	private initializing: Promise<void> | null = null;
	private lastEndpoint: string | null = null;
	private lastApiKey: string | null = null;
	private sessionId: string | null = null;

	constructor(
		private readonly resolveEndpoint: () => string,
		private readonly resolveApiKey: () => string | undefined,
		private readonly getTimeoutMs: () => number,
		private readonly getProtocolVersion: () => string,
	) {}

	currentEndpoint(): string {
		return this.resolveEndpoint();
	}

	async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
		await this.ensureInitialized(signal);
		const result = await this.sendRequest("tools/call", { name: toolName, arguments: args }, signal);
		if (isRecord(result)) {
			return result as McpToolResult;
		}
		return { content: [{ type: "text", text: toJsonString(result) }] };
	}

	private async ensureInitialized(signal?: AbortSignal): Promise<void> {
		const endpoint = this.resolveEndpoint();
		const apiKey = this.resolveApiKey();
		if (this.lastEndpoint !== endpoint || this.lastApiKey !== apiKey) {
			this.initialized = false;
			this.initializing = null;
			this.sessionId = null;
			this.lastEndpoint = endpoint;
			this.lastApiKey = apiKey ?? null;
		}

		if (this.initialized) {
			return;
		}

		if (!this.initializing) {
			this.initializing = (async () => {
				await this.initialize(signal);
				this.initialized = true;
			})()
				.catch((error) => {
					this.initialized = false;
					throw error;
				})
				.finally(() => {
					this.initializing = null;
				});
		}

		await this.initializing;
	}

	private async initialize(signal?: AbortSignal): Promise<void> {
		await this.sendRequest(
			"initialize",
			{
				protocolVersion: this.getProtocolVersion(),
				capabilities: {},
				clientInfo: CLIENT_INFO,
			},
			signal,
		);
		await this.sendNotification("notifications/initialized", {}, signal);
	}

	private async sendRequest(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const id = this.nextId();
		const response = await this.sendJsonRpc(
			{
				jsonrpc: "2.0",
				id,
				method,
				params,
			},
			signal,
		);

		const json = extractJsonRpcResponse(response, id);
		if (json.error) {
			throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
		}
		return json.result;
	}

	private async sendNotification(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
		await this.sendJsonRpc(
			{
				jsonrpc: "2.0",
				method,
				params,
			},
			signal,
			true,
		);
	}

	private async sendJsonRpc(
		payload: Record<string, unknown>,
		signal?: AbortSignal,
		isNotification = false,
	): Promise<unknown> {
		const endpoint = this.resolveEndpoint();
		const apiKey = this.resolveApiKey();
		const { signal: mergedSignal, cleanup } = createMergedSignal(signal, this.getTimeoutMs());

		const headers: Record<string, string> = {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		};
		if (apiKey) {
			headers["x-ref-api-key"] = apiKey;
		}
		if (this.sessionId) {
			headers["mcp-session-id"] = this.sessionId;
		}

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: mergedSignal,
			});

			// Capture session ID from server (set during initialize, persisted for all subsequent requests)
			const returnedSessionId = response.headers.get("mcp-session-id");
			if (returnedSessionId) {
				this.sessionId = returnedSessionId;
			}

			if (response.status === 204 || response.status === 202) {
				return undefined;
			}

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`MCP HTTP ${response.status}: ${text || response.statusText}`);
			}

			if (isNotification) {
				return undefined;
			}

			const contentType = response.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				const json: unknown = await response.json();
				return json;
			}
			if (contentType.includes("text/event-stream")) {
				return parseSseResponse(response, payload.id);
			}

			const text = await response.text();
			throw new Error(`Unexpected MCP response content-type: ${contentType || "unknown"} (${text.slice(0, 200)})`);
		} finally {
			cleanup();
		}
	}

	private nextId(): JsonRpcId {
		this.requestCounter += 1;
		return `ref-mcp-${this.requestCounter}`;
	}
}

function extractJsonRpcResponse(response: unknown, requestId: unknown): JsonRpcResponse {
	if (Array.isArray(response)) {
		const match = response.find((item) => isJsonRpcResponse(item) && item.id === requestId);
		if (match) {
			return match;
		}
		throw new Error("MCP response did not include matching request id.");
	}

	if (isJsonRpcResponse(response)) {
		return response;
	}

	throw new Error("Invalid MCP response payload.");
}

async function parseSseResponse(response: Response, requestId: unknown): Promise<unknown> {
	if (!response.body) {
		throw new Error("MCP response stream missing body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let matched: unknown;

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });

		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = buffer.slice(0, newlineIndex).trimEnd();
			buffer = buffer.slice(newlineIndex + 1);
			newlineIndex = buffer.indexOf("\n");

			if (!line.startsWith("data:")) {
				continue;
			}

			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") {
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(data);
				if (isRecord(parsed) && parsed.id === requestId) {
					matched = parsed;
					await reader.cancel();
					return matched;
				}
			} catch {
				// Ignore malformed SSE chunk.
			}
		}
	}

	if (matched) {
		return matched;
	}

	throw new Error("MCP SSE response ended without a matching result.");
}

function createMergedSignal(
	parentSignal: AbortSignal | undefined,
	timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	let timeoutId: NodeJS.Timeout | undefined;

	const handleAbort = () => {
		controller.abort();
	};

	if (parentSignal) {
		if (parentSignal.aborted) {
			controller.abort();
		} else {
			parentSignal.addEventListener("abort", handleAbort, { once: true });
		}
	}

	if (timeoutMs > 0) {
		timeoutId = setTimeout(() => {
			controller.abort();
		}, timeoutMs);
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			if (parentSignal) {
				parentSignal.removeEventListener("abort", handleAbort);
			}
		},
	};
}

// =============================================================================
// Tool Parameters
// =============================================================================

const searchDocumentationParams = Type.Object(
	{
		query: Type.String({
			description: "Your search query. Include programming language, framework, or library names for best results.",
		}),
		piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
		piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
	},
	{ additionalProperties: true },
);

const readUrlParams = Type.Object(
	{
		url: Type.String({ description: "The exact URL of the documentation page to read." }),
		piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
		piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
	},
	{ additionalProperties: true },
);

// =============================================================================
// Extension Entry Point
// =============================================================================

export {
	DEFAULT_CONFIG_FILE,
	ensureDefaultConfigFile,
	formatToolOutput,
	isJsonRpcResponse,
	isRecord,
	normalizeNumber,
	normalizeString,
	parseConfig,
	parseTimeoutMs,
	redactApiKey,
	resolveConfigPath,
	resolveEffectiveLimits,
	splitParams,
	toJsonString,
	writeTempFile,
};

export default function refTools(pi: ExtensionAPI) {
	// SessionStart: check config and print status
	pi.on("session_start", async () => {
		const urlFlag = pi.getFlag("--ref-mcp-url");
		const hasUrlFlag = typeof urlFlag === "string" && urlFlag.trim().length > 0;
		const hasEnvUrl = typeof process.env.REF_MCP_URL === "string" && process.env.REF_MCP_URL.trim().length > 0;
		const configFlag = pi.getFlag("--ref-mcp-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
		const hasConfigUrl = config?.url && config.url.trim().length > 0;

		const endpoint = hasUrlFlag
			? String(urlFlag)
			: hasEnvUrl
				? (process.env.REF_MCP_URL ?? "https://api.ref.tools/mcp")
				: hasConfigUrl
					? (config?.url ?? "https://api.ref.tools/mcp")
					: "https://api.ref.tools/mcp";

		const apiKeyFlag = pi.getFlag("--ref-mcp-api-key");
		const hasApiKey = typeof apiKeyFlag === "string" && apiKeyFlag.trim().length > 0;
		const hasEnvKey = typeof process.env.REF_API_KEY === "string" && process.env.REF_API_KEY.trim().length > 0;
		const hasConfigKey = config?.apiKey != null && config.apiKey.trim().length > 0;

		if (hasApiKey || hasEnvKey || hasConfigKey) {
			const source = hasApiKey ? "CLI flag" : hasEnvKey ? "REF_API_KEY env var" : "config file";
			console.log(`[ref-tools] Connected to ${endpoint} (API key: ${source})`);
		} else {
			console.log(`[ref-tools] No API key configured for ${endpoint}. Set REF_API_KEY or use --ref-mcp-api-key.`);
		}
	});

	// Register CLI flags
	pi.registerFlag("--ref-mcp-url", {
		description: "Override the Ref MCP endpoint.",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-api-key", {
		description: "Ref API key (sent as x-ref-api-key header).",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-timeout-ms", {
		description: "HTTP timeout for MCP requests (milliseconds).",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-protocol", {
		description: "MCP protocol version for initialize() (default: 2025-06-18).",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-config", {
		description: "Path to JSON config file (defaults to ~/.pi/agent/extensions/ref-tools.json).",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-max-bytes", {
		description: "Max bytes to keep from tool output (default: 51200).",
		type: "string",
	});
	pi.registerFlag("--ref-mcp-max-lines", {
		description: "Max lines to keep from tool output (default: 2000).",
		type: "string",
	});

	const getBaseUrl = (): string => {
		const configFlag = pi.getFlag("--ref-mcp-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

		const urlFlag = pi.getFlag("--ref-mcp-url");
		const fromFlag = typeof urlFlag === "string" ? normalizeString(urlFlag) : undefined;
		const fromEnv = normalizeString(process.env.REF_MCP_URL);
		const fromConfig = normalizeString(config?.url);
		return fromFlag ?? fromEnv ?? fromConfig ?? DEFAULT_ENDPOINT;
	};

	const getApiKey = (): string | undefined => {
		const apiKeyFlag = pi.getFlag("--ref-mcp-api-key");
		const fromFlag = typeof apiKeyFlag === "string" ? normalizeString(apiKeyFlag) : undefined;
		if (fromFlag) {
			return fromFlag;
		}
		const configFlag = pi.getFlag("--ref-mcp-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
		return normalizeString(process.env.REF_API_KEY) ?? normalizeString(config?.apiKey);
	};

	const getMaxLimits = (): { maxBytes: number; maxLines: number } => {
		const maxBytesFlag = pi.getFlag("--ref-mcp-max-bytes");
		const maxLinesFlag = pi.getFlag("--ref-mcp-max-lines");
		const configFlag = pi.getFlag("--ref-mcp-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

		const maxBytes =
			typeof maxBytesFlag === "string"
				? normalizeNumber(maxBytesFlag)
				: normalizeNumber(process.env.REF_MCP_MAX_BYTES ?? config?.maxBytes);
		const maxLines =
			typeof maxLinesFlag === "string"
				? normalizeNumber(maxLinesFlag)
				: normalizeNumber(process.env.REF_MCP_MAX_LINES ?? config?.maxLines);

		return {
			maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
			maxLines: maxLines ?? DEFAULT_MAX_LINES,
		};
	};

	const client = new RefMcpClient(
		() => getBaseUrl(),
		() => getApiKey(),
		() => {
			const configFlag = pi.getFlag("--ref-mcp-config");
			const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
			const timeoutFlag = pi.getFlag("--ref-mcp-timeout-ms");
			const timeoutValue =
				typeof timeoutFlag === "string" ? timeoutFlag : (process.env.REF_MCP_TIMEOUT_MS ?? config?.timeoutMs);
			return parseTimeoutMs(timeoutValue, DEFAULT_TIMEOUT_MS);
		},
		() => {
			const configFlag = pi.getFlag("--ref-mcp-config");
			const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
			const protocolFlag = pi.getFlag("--ref-mcp-protocol");
			if (typeof protocolFlag === "string" && protocolFlag.trim().length > 0) {
				return protocolFlag.trim();
			}
			const envVersion = process.env.REF_MCP_PROTOCOL_VERSION;
			if (envVersion && envVersion.trim().length > 0) {
				return envVersion.trim();
			}
			if (config?.protocolVersion) {
				return config.protocolVersion;
			}
			return DEFAULT_PROTOCOL_VERSION;
		},
	);

	// Register ref_search_documentation tool
	pi.registerTool({
		name: "ref_search_documentation",
		label: "Ref Doc Search",
		description:
			"Search technical documentation via Ref.tools; best for API docs, library references, and framework guides. " +
			"Include language/framework names in your query for best results. " +
			"Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		parameters: searchDocumentationParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
			}
			onUpdate?.({
				content: [{ type: "text", text: "Searching Ref documentation..." }],
				details: { status: "pending" },
			});

			try {
				const endpoint = client.currentEndpoint();
				const { mcpArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
				const maxLimits = getMaxLimits();
				const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);
				const result = await client.callTool("ref_search_documentation", mcpArgs, signal);
				const { text, details } = formatToolOutput("ref_search_documentation", endpoint, result, effectiveLimits);
				return { content: [{ type: "text", text }], details, isError: result.isError === true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Ref MCP error: ${message}` }],
					isError: true,
					details: {
						tool: "ref_search_documentation",
						endpoint: client.currentEndpoint(),
						error: message,
					} satisfies McpErrorDetails,
				};
			}
		},
	});

	// Register ref_read_url tool
	pi.registerTool({
		name: "ref_read_url",
		label: "Ref Read URL",
		description:
			"Read a documentation URL via Ref.tools and return optimized markdown. " +
			"Pass the exact URL from a ref_search_documentation result or any documentation page. " +
			"Client-side truncation; override with piMaxBytes/piMaxLines (clamped by config).",
		parameters: readUrlParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Cancelled." }], details: { cancelled: true } };
			}
			onUpdate?.({ content: [{ type: "text", text: "Reading URL via Ref..." }], details: { status: "pending" } });

			try {
				const endpoint = client.currentEndpoint();
				const { mcpArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
				const maxLimits = getMaxLimits();
				const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);
				const result = await client.callTool("ref_read_url", mcpArgs, signal);
				const { text, details } = formatToolOutput("ref_read_url", endpoint, result, effectiveLimits);
				return { content: [{ type: "text", text }], details, isError: result.isError === true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Ref MCP error: ${message}` }],
					isError: true,
					details: {
						tool: "ref_read_url",
						endpoint: client.currentEndpoint(),
						error: message,
					} satisfies McpErrorDetails,
				};
			}
		},
	});
}

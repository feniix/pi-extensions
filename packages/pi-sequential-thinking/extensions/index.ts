/**
 * Sequential Thinking MCP CLI Extension
 *
 * Provides Sequential Thinking MCP tools via stdio: process_thought, generate_summary,
 * clear_history, export_session, and import_session.
 * Structured progressive thinking through defined cognitive stages.
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-sequential-thinking
 * 2. Requires: uvx (from uv package manager) with mcp-sequential-thinking available
 * 3. Optional config:
 *    - JSON config: ~/.pi/agent/extensions/sequential-thinking.json or .pi/extensions/sequential-thinking.json
 *      (or set SEQ_THINK_CONFIG / --seq-think-config for a custom path)
 *      Keys: command, args, storageDir, maxBytes, maxLines
 *    - SEQ_THINK_COMMAND (default: uvx)
 *    - SEQ_THINK_ARGS (default: --from,git+https://github.com/arben-adm/mcp-sequential-thinking,--with,portalocker,mcp-sequential-thinking)
 *    - MCP_STORAGE_DIR (storage directory for thought sessions)
 *    - SEQ_THINK_MAX_BYTES (default: 51200)
 *    - SEQ_THINK_MAX_LINES (default: 2000)
 * 4. Or pass flags:
 *    --seq-think-command, --seq-think-args, --seq-think-storage-dir,
 *    --seq-think-config, --seq-think-max-bytes, --seq-think-max-lines
 *
 * Usage:
 *   "Think through this architecture decision step by step"
 *   "Process a thought about the database schema design"
 *   "Generate a summary of the thinking process"
 *
 * Tools:
 *   - process_thought: Record and analyze a sequential thought with stage metadata
 *   - generate_summary: Generate a summary of the entire thinking process
 *   - clear_history: Reset the thinking process
 *   - export_session: Export the current thinking session to a JSON file
 *   - import_session: Import a previously exported thinking session
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COMMAND = "uvx";
const DEFAULT_ARGS = [
	"--from",
	"git+https://github.com/arben-adm/mcp-sequential-thinking",
	"--with",
	"portalocker",
	"mcp-sequential-thinking",
];
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
	command: DEFAULT_COMMAND,
	args: DEFAULT_ARGS,
	storageDir: null,
	maxBytes: DEFAULT_MAX_BYTES,
	maxLines: DEFAULT_MAX_LINES,
};

const CLIENT_INFO = {
	name: "pi-sequential-thinking-extension",
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

interface SeqThinkConfig {
	command?: string;
	args?: string[];
	storageDir?: string;
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
	const filename = `pi-seq-think-${safeName}-${Date.now()}.txt`;
	const filePath = join(tmpdir(), filename);
	writeFileSync(filePath, content, "utf-8");
	return filePath;
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

function parseConfig(raw: unknown, pathHint: string): SeqThinkConfig {
	if (!isRecord(raw)) {
		throw new Error(`Invalid Sequential Thinking config at ${pathHint}: expected an object.`);
	}
	return {
		command: normalizeString(raw.command),
		args: Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === "string") : undefined,
		storageDir: normalizeString(raw.storageDir),
		maxBytes: normalizeNumber(raw.maxBytes),
		maxLines: normalizeNumber(raw.maxLines),
	};
}

function loadConfig(configPath: string | undefined): SeqThinkConfig | null {
	const candidates: string[] = [];
	const envConfig = process.env.SEQ_THINK_CONFIG;
	if (configPath) {
		candidates.push(resolveConfigPath(configPath));
	} else if (envConfig) {
		candidates.push(resolveConfigPath(envConfig));
	} else {
		const projectConfigPath = join(process.cwd(), ".pi", "extensions", "sequential-thinking.json");
		const globalConfigPath = join(homedir(), ".pi", "agent", "extensions", "sequential-thinking.json");
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		candidates.push(projectConfigPath, globalConfigPath);
	}

	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		const raw = readFileSync(candidate, "utf-8");
		const parsed = JSON.parse(raw);
		return parseConfig(parsed, candidate);
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
		console.warn(`[pi-sequential-thinking] Failed to write ${globalConfigPath}: ${message}`);
	}
}

// =============================================================================
// Stdio MCP Client
// =============================================================================

class StdioMcpClient {
	private requestCounter = 0;
	private childProcess: ChildProcess | null = null;
	private initialized = false;
	private initializing: Promise<void> | null = null;
	private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private buffer = "";

	constructor(
		private readonly getCommand: () => string,
		private readonly getArgs: () => string[],
		private readonly getEnv: () => Record<string, string | undefined>,
	) {}

	async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
		await this.ensureInitialized(signal);
		const result = await this.sendRequest("tools/call", { name: toolName, arguments: args }, signal);
		if (isRecord(result)) {
			return result as McpToolResult;
		}
		return { content: [{ type: "text", text: toJsonString(result) }] };
	}

	shutdown(): void {
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
		this.initialized = false;
		this.initializing = null;
		for (const [, pending] of this.pendingRequests) {
			pending.reject(new Error("Client shutting down"));
		}
		this.pendingRequests.clear();
		this.buffer = "";
	}

	private async ensureInitialized(signal?: AbortSignal): Promise<void> {
		if (this.initialized && this.childProcess && !this.childProcess.killed) {
			return;
		}

		// Process died or was never started — reset state
		if (this.childProcess?.killed || (this.childProcess && this.childProcess.exitCode !== null)) {
			this.initialized = false;
			this.initializing = null;
			this.childProcess = null;
		}

		if (!this.initializing) {
			this.initializing = (async () => {
				this.spawnProcess();
				await this.initialize(signal);
				this.initialized = true;
			})()
				.catch((error) => {
					this.initialized = false;
					this.shutdown();
					throw error;
				})
				.finally(() => {
					this.initializing = null;
				});
		}

		await this.initializing;
	}

	private spawnProcess(): void {
		const command = this.getCommand();
		const args = this.getArgs();
		const env = { ...process.env, ...this.getEnv() };

		this.childProcess = spawn(command, args, {
			stdio: ["pipe", "pipe", "ignore"],
			env,
		});

		this.childProcess.stdout?.setEncoding("utf-8");
		this.childProcess.stdout?.on("data", (chunk: string) => {
			this.buffer += chunk;
			this.processBuffer();
		});

		this.childProcess.on("error", (err) => {
			for (const [, pending] of this.pendingRequests) {
				pending.reject(new Error(`MCP process error: ${err.message}`));
			}
			this.pendingRequests.clear();
			this.initialized = false;
		});

		this.childProcess.on("exit", (code) => {
			for (const [, pending] of this.pendingRequests) {
				pending.reject(new Error(`MCP process exited with code ${code}`));
			}
			this.pendingRequests.clear();
			this.initialized = false;
		});
	}

	private processBuffer(): void {
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			newlineIndex = this.buffer.indexOf("\n");

			if (!line) {
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(line);
				if (isJsonRpcResponse(parsed) && parsed.id != null) {
					const id = String(parsed.id);
					const pending = this.pendingRequests.get(id);
					if (pending) {
						this.pendingRequests.delete(id);
						if (parsed.error) {
							pending.reject(new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`));
						} else {
							pending.resolve(parsed.result);
						}
					}
				}
			} catch {
				// Ignore non-JSON lines (e.g. stderr leaking to stdout)
			}
		}
	}

	private async initialize(signal?: AbortSignal): Promise<void> {
		await this.sendRequest(
			"initialize",
			{
				protocolVersion: DEFAULT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: CLIENT_INFO,
			},
			signal,
		);
		this.sendNotification("notifications/initialized", {});
	}

	private sendRequest(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
		const id = this.nextId();

		return new Promise<unknown>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`MCP request timed out: ${method}`));
			}, 60000);

			const cleanup = () => {
				clearTimeout(timeoutId);
			};

			if (signal?.aborted) {
				cleanup();
				reject(new Error("Request aborted"));
				return;
			}

			signal?.addEventListener(
				"abort",
				() => {
					cleanup();
					this.pendingRequests.delete(id);
					reject(new Error("Request aborted"));
				},
				{ once: true },
			);

			this.pendingRequests.set(id, {
				resolve: (value) => {
					cleanup();
					resolve(value);
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
			});

			this.writeMessage({ jsonrpc: "2.0", id, method, params });
		});
	}

	private sendNotification(method: string, params: Record<string, unknown>): void {
		this.writeMessage({ jsonrpc: "2.0", method, params });
	}

	private writeMessage(message: Record<string, unknown>): void {
		if (!this.childProcess?.stdin?.writable) {
			throw new Error("MCP process stdin is not writable");
		}
		this.childProcess.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private nextId(): JsonRpcId {
		this.requestCounter += 1;
		return `seq-think-${this.requestCounter}`;
	}
}

// =============================================================================
// Tool Parameters
// =============================================================================

const processThoughtParams = Type.Object(
	{
		thought: Type.String({ description: "The content of your thought." }),
		thought_number: Type.Integer({ minimum: 1, description: "Position in your sequence (e.g., 1 for first thought)." }),
		total_thoughts: Type.Integer({ minimum: 1, description: "Expected total thoughts in the sequence." }),
		next_thought_needed: Type.Boolean({ description: "Whether more thoughts are needed after this one." }),
		stage: Type.Union(
			[
				Type.Literal("Problem Definition"),
				Type.Literal("Research"),
				Type.Literal("Analysis"),
				Type.Literal("Synthesis"),
				Type.Literal("Conclusion"),
			],
			{ description: "The thinking stage." },
		),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Keywords or categories for your thought." })),
		axioms_used: Type.Optional(
			Type.Array(Type.String(), { description: "Principles or axioms applied in your thought." }),
		),
		assumptions_challenged: Type.Optional(
			Type.Array(Type.String(), { description: "Assumptions your thought questions or challenges." }),
		),
		piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
		piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
	},
	{ additionalProperties: true },
);

const generateSummaryParams = Type.Object(
	{
		piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
		piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
	},
	{ additionalProperties: true },
);

const clearHistoryParams = Type.Object({}, { additionalProperties: true });

const exportSessionParams = Type.Object(
	{
		file_path: Type.String({ description: "Path to save the exported session JSON file." }),
	},
	{ additionalProperties: true },
);

const importSessionParams = Type.Object(
	{
		file_path: Type.String({ description: "Path to the JSON file to import." }),
	},
	{ additionalProperties: true },
);

// =============================================================================
// Extension Entry Point
// =============================================================================

export { DEFAULT_CONFIG_FILE, ensureDefaultConfigFile, normalizeNumber, resolveEffectiveLimits, splitParams };

export default function sequentialThinking(pi: ExtensionAPI) {
	// Register CLI flags
	pi.registerFlag("--seq-think-command", {
		description: "Command to launch the Sequential Thinking MCP server (default: uvx).",
		type: "string",
	});
	pi.registerFlag("--seq-think-args", {
		description: "Comma-separated arguments for the MCP server command.",
		type: "string",
	});
	pi.registerFlag("--seq-think-storage-dir", {
		description: "Storage directory for thought sessions.",
		type: "string",
	});
	pi.registerFlag("--seq-think-config", {
		description: "Path to JSON config file (defaults to ~/.pi/agent/extensions/sequential-thinking.json).",
		type: "string",
	});
	pi.registerFlag("--seq-think-max-bytes", {
		description: "Max bytes to keep from tool output (default: 51200).",
		type: "string",
	});
	pi.registerFlag("--seq-think-max-lines", {
		description: "Max lines to keep from tool output (default: 2000).",
		type: "string",
	});

	const getMaxLimits = (): { maxBytes: number; maxLines: number } => {
		const maxBytesFlag = pi.getFlag("--seq-think-max-bytes");
		const maxLinesFlag = pi.getFlag("--seq-think-max-lines");
		const configFlag = pi.getFlag("--seq-think-config");
		const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);

		const maxBytes =
			typeof maxBytesFlag === "string"
				? normalizeNumber(maxBytesFlag)
				: normalizeNumber(process.env.SEQ_THINK_MAX_BYTES ?? config?.maxBytes);
		const maxLines =
			typeof maxLinesFlag === "string"
				? normalizeNumber(maxLinesFlag)
				: normalizeNumber(process.env.SEQ_THINK_MAX_LINES ?? config?.maxLines);

		return {
			maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
			maxLines: maxLines ?? DEFAULT_MAX_LINES,
		};
	};

	const client = new StdioMcpClient(
		() => {
			const cmdFlag = pi.getFlag("--seq-think-command");
			if (typeof cmdFlag === "string" && cmdFlag.trim().length > 0) {
				return cmdFlag.trim();
			}
			const configFlag = pi.getFlag("--seq-think-config");
			const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
			return process.env.SEQ_THINK_COMMAND ?? config?.command ?? DEFAULT_COMMAND;
		},
		() => {
			const argsFlag = pi.getFlag("--seq-think-args");
			if (typeof argsFlag === "string" && argsFlag.trim().length > 0) {
				return argsFlag.split(",").map((a) => a.trim());
			}
			const envArgs = process.env.SEQ_THINK_ARGS;
			if (envArgs) {
				return envArgs.split(",").map((a) => a.trim());
			}
			const configFlag = pi.getFlag("--seq-think-config");
			const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
			return config?.args ?? DEFAULT_ARGS;
		},
		() => {
			const storageDirFlag = pi.getFlag("--seq-think-storage-dir");
			const configFlag = pi.getFlag("--seq-think-config");
			const config = loadConfig(typeof configFlag === "string" ? configFlag : undefined);
			const storageDir =
				typeof storageDirFlag === "string"
					? storageDirFlag
					: (process.env.MCP_STORAGE_DIR ?? config?.storageDir ?? undefined);

			const env: Record<string, string | undefined> = {};
			if (storageDir) {
				env.MCP_STORAGE_DIR = storageDir;
			}
			return env;
		},
	);

	// Shut down the child process when the session ends
	pi.on("session_shutdown", () => {
		client.shutdown();
	});

	// Helper to execute an MCP tool call
	const executeMcpTool = async (
		toolName: string,
		pendingMessage: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		// biome-ignore lint/suspicious/noExplicitAny: pi's AgentToolUpdateCallback type varies by tool
		onUpdate: ((partialResult: any) => void) | undefined,
	) => {
		if (signal?.aborted) {
			return { content: [{ type: "text" as const, text: "Cancelled." }], details: { cancelled: true } };
		}
		onUpdate?.({
			content: [{ type: "text" as const, text: pendingMessage }],
			details: { status: "pending" },
		});

		try {
			const { mcpArgs, requestedLimits } = splitParams(params);
			const maxLimits = getMaxLimits();
			const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);
			const result = await client.callTool(toolName, mcpArgs, signal);
			const { text, details } = formatToolOutput(toolName, result, effectiveLimits);
			return { content: [{ type: "text" as const, text }], details, isError: result.isError === true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text" as const, text: `Sequential Thinking MCP error: ${message}` }],
				isError: true,
				details: { tool: toolName, error: message },
			};
		}
	};

	// Register tools
	pi.registerTool({
		name: "process_thought",
		label: "Process Thought",
		description:
			"Record and analyze a sequential thought with metadata. Use this to break down complex problems " +
			"into structured steps through stages: Problem Definition, Research, Analysis, Synthesis, Conclusion. " +
			"Each thought is tracked with its position in the sequence, stage, tags, and related analysis.",
		parameters: processThoughtParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			return executeMcpTool(
				"process_thought",
				"Processing thought...",
				params as Record<string, unknown>,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: "generate_summary",
		label: "Generate Thinking Summary",
		description:
			"Generate a summary of the entire sequential thinking process. Returns stage counts, " +
			"timeline, top tags, and completion status. Use after processing multiple thoughts.",
		parameters: generateSummaryParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			return executeMcpTool(
				"generate_summary",
				"Generating summary...",
				params as Record<string, unknown>,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: "clear_history",
		label: "Clear Thought History",
		description: "Reset the sequential thinking process by clearing all recorded thoughts.",
		parameters: clearHistoryParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			return executeMcpTool(
				"clear_history",
				"Clearing history...",
				params as Record<string, unknown>,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: "export_session",
		label: "Export Thinking Session",
		description:
			"Export the current thinking session to a JSON file for sharing or backup. " +
			"Parent directories are created automatically.",
		parameters: exportSessionParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			return executeMcpTool(
				"export_session",
				"Exporting session...",
				params as Record<string, unknown>,
				signal,
				onUpdate,
			);
		},
	});

	pi.registerTool({
		name: "import_session",
		label: "Import Thinking Session",
		description: "Import a previously exported thinking session from a JSON file.",
		parameters: importSessionParams,
		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			return executeMcpTool(
				"import_session",
				"Importing session...",
				params as Record<string, unknown>,
				signal,
				onUpdate,
			);
		},
	});
}

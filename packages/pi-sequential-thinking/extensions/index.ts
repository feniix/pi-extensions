/**
 * Sequential Thinking Extension for pi
 *
 * Provides structured progressive thinking through defined cognitive stages.
 * This is a native TypeScript implementation with no external dependencies.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ThoughtAnalyzer } from "./analyzer.js";
import {
  type EffectiveConfigStatus,
  type ExportSessionResult,
  type ImportSessionResult,
  type SessionOperationResult,
  ThoughtStorage,
} from "./storage.js";
import {
  DEFAULT_HISTORY_LIMIT,
  generateUuid,
  isRecord,
  MAX_HISTORY_LIMIT,
  normalizeSessionId,
  normalizeThoughtInput,
  pickAliasedArg,
  type ThoughtData,
  ThoughtStage,
  ThoughtValidationError,
  type ValidationError,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

type ConfigSource = "flag" | "env" | "project_settings" | "global_settings" | "config_file" | "default";

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

// =============================================================================
// Types
// =============================================================================

interface SeqThinkConfig {
  storageDir?: string;
  maxBytes?: number;
  maxLines?: number;
}

interface SeqThinkConfigWithSources {
  config: SeqThinkConfig;
  sources: Partial<Record<keyof SeqThinkConfig, ConfigSource>>;
}

interface ResolveEffectiveConfigInput {
  flags?: {
    storageDir?: unknown;
    maxBytes?: unknown;
    maxLines?: unknown;
  };
  env?: Record<string, string | undefined>;
  config?: SeqThinkConfigWithSources | null;
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
  error?: string;
  validationErrors?: ValidationError[];
}

// =============================================================================
// Utility Functions
// =============================================================================

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
  result: unknown,
  limits: { maxBytes?: number; maxLines?: number },
): { text: string; details: McpToolDetails } {
  const rawText = toJsonString(result);
  const truncation = truncateHead(rawText, {
    maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let tempFile: string | undefined;

  if (truncation.truncated) {
    tempFile = writeTempFile(toolName, rawText);
    const tempSuffix = tempFile
      ? `Full output saved to: ${tempFile}`
      : "Full output unavailable (could not write overflow file)";
    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${tempSuffix}]`;
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

function writeTempFile(toolName: string, content: string): string | undefined {
  const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
  const filename = `pi-seq-think-${safeName}-${Date.now()}.txt`;
  const filePath = join(tmpdir(), filename);
  try {
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  } catch (error) {
    // If /tmp is full or unwritable, the truncated tool result is still
    // useful — don't convert a successful tool call into an error.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Could not write truncation overflow file: ${message}`);
    return undefined;
  }
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
  toolArgs: Record<string, unknown>;
  requestedLimits: { maxBytes?: number; maxLines?: number };
} {
  const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
    piMaxBytes?: unknown;
    piMaxLines?: unknown;
  };
  return {
    toolArgs: rest,
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

function parseConfig(raw: unknown, pathHint: string): SeqThinkConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Sequential Thinking config at ${pathHint}: expected an object.`);
  }
  return {
    storageDir: normalizeString(raw.storageDir),
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function sourceForConfig(config: SeqThinkConfig, source: ConfigSource): SeqThinkConfigWithSources {
  const sources: SeqThinkConfigWithSources["sources"] = {};
  if (config.storageDir !== undefined) sources.storageDir = source;
  if (config.maxBytes !== undefined) sources.maxBytes = source;
  if (config.maxLines !== undefined) sources.maxLines = source;
  return { config, sources };
}

function loadSettingsConfig(
  path: string,
  source: "project_settings" | "global_settings",
): SeqThinkConfigWithSources | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const config = parsed["pi-sequential-thinking"];
    if (!isRecord(config)) {
      return null;
    }
    return sourceForConfig(parseConfig(config, path), source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "sequential-thinking.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "sequential-thinking.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-sequential-thinking] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-sequential-thinking", or pass --seq-think-config-file / SEQ_THINK_CONFIG_FILE explicitly.`,
      );
    }
  }
}

function loadConfigWithSources(configPath: string | undefined): SeqThinkConfigWithSources | null {
  const envConfigFile = process.env.SEQ_THINK_CONFIG_FILE;
  const legacyEnvConfig = process.env.SEQ_THINK_CONFIG;
  if (configPath) {
    return loadConfigFileWithSources(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFileWithSources(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-sequential-thinking] SEQ_THINK_CONFIG is deprecated; use SEQ_THINK_CONFIG_FILE.");
    return loadConfigFileWithSources(resolveConfigPath(legacyEnvConfig));
  }

  warnIgnoredLegacyConfigFiles();

  const projectSettingsPath = join(process.cwd(), ".pi", "settings.json");
  const globalSettingsPath = join(getHomeDir(), ".pi", "agent", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath, "global_settings");
  const projectConfig = loadSettingsConfig(projectSettingsPath, "project_settings");

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return mergeConfigWithSources(globalConfig, projectConfig);
}

function loadConfigFileWithSources(path: string): SeqThinkConfigWithSources | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return sourceForConfig(parseConfig(parsed, path), "config_file");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function mergeConfigWithSources(
  globalConfig: SeqThinkConfigWithSources | null,
  projectConfig: SeqThinkConfigWithSources | null,
): SeqThinkConfigWithSources {
  const config: SeqThinkConfig = {
    storageDir: projectConfig?.config.storageDir ?? globalConfig?.config.storageDir,
    maxBytes: projectConfig?.config.maxBytes ?? globalConfig?.config.maxBytes,
    maxLines: projectConfig?.config.maxLines ?? globalConfig?.config.maxLines,
  };
  return {
    config,
    sources: {
      storageDir: projectConfig?.sources.storageDir ?? globalConfig?.sources.storageDir,
      maxBytes: projectConfig?.sources.maxBytes ?? globalConfig?.sources.maxBytes,
      maxLines: projectConfig?.sources.maxLines ?? globalConfig?.sources.maxLines,
    },
  };
}

function resolveEffectiveConfig(input: ResolveEffectiveConfigInput = {}): EffectiveConfigStatus {
  const flags = input.flags ?? {};
  const env = input.env ?? process.env;
  const config = input.config;

  const flagStorageDir = normalizeString(flags.storageDir);
  const envStorageDir = normalizeString(env.MCP_STORAGE_DIR);
  const configStorageDir = config?.config.storageDir;

  const flagMaxBytes = normalizeNumber(flags.maxBytes);
  const envMaxBytes = normalizeNumber(env.SEQ_THINK_MAX_BYTES);
  const configMaxBytes = config?.config.maxBytes;

  const flagMaxLines = normalizeNumber(flags.maxLines);
  const envMaxLines = normalizeNumber(env.SEQ_THINK_MAX_LINES);
  const configMaxLines = config?.config.maxLines;

  const storageDir = flagStorageDir ?? envStorageDir ?? configStorageDir;

  return {
    storageDir: storageDir ? resolveConfigPath(storageDir) : undefined,
    maxBytes: flagMaxBytes ?? envMaxBytes ?? configMaxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: flagMaxLines ?? envMaxLines ?? configMaxLines ?? DEFAULT_MAX_LINES,
    sources: {
      storageDir: flagStorageDir
        ? "flag"
        : envStorageDir
          ? "env"
          : configStorageDir
            ? (config?.sources.storageDir ?? "config_file")
            : "default",
      maxBytes: flagMaxBytes
        ? "flag"
        : envMaxBytes
          ? "env"
          : configMaxBytes
            ? (config?.sources.maxBytes ?? "config_file")
            : "default",
      maxLines: flagMaxLines
        ? "flag"
        : envMaxLines
          ? "env"
          : configMaxLines
            ? (config?.sources.maxLines ?? "config_file")
            : "default",
    },
  };
}

function sessionIdFromArgs(args: Record<string, unknown>): string | null {
  const resolved = pickAliasedArg(args, "session_id", "sessionId", (value) => normalizeSessionId(value).sessionId);
  return resolved ?? null;
}

function includeFullThoughtsFromArgs(args: Record<string, unknown>): boolean {
  const resolved = pickAliasedArg(args, "include_full_thoughts", "includeFullThoughts", (value) => {
    if (typeof value !== "boolean") {
      throw new ThoughtValidationError([
        { field: "include_full_thoughts", message: "include_full_thoughts must be a boolean" },
      ]);
    }
    return value;
  });
  return resolved ?? true;
}

function toReceipt(
  operation: string,
  result: SessionOperationResult | ExportSessionResult | ImportSessionResult,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const receipt: Record<string, unknown> = {
    operation,
    sessionId: result.sessionId,
    sessionLabel: result.sessionLabel,
    preCount: result.preCount,
    postCount: result.postCount,
    changed: result.changed,
    savedAt: result.savedAt,
    stateFingerprint: result.stateFingerprint,
    ...extra,
  };

  if ("exportedAt" in result) receipt.exportedAt = result.exportedAt;
  if ("importedAt" in result) receipt.importedAt = result.importedAt;
  if ("overwroteExistingFile" in result) receipt.overwroteExistingFile = result.overwroteExistingFile;
  if ("filePath" in result) receipt.filePath = result.filePath;
  if (result.warnings && result.warnings.length > 0) receipt.warnings = result.warnings;

  return receipt;
}

// =============================================================================
// Tool Parameters
// =============================================================================

const sessionParams = {
  session_id: Type.Optional(Type.String({ description: "Session to use. Omit for the default session." })),
  sessionId: Type.Optional(Type.String({ description: "camelCase alias for session_id." })),
};

const outputLimitParams = {
  piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
  piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
};

const processThoughtParams = Type.Object(
  {
    thought: Type.String({ description: "The content of your thought." }),
    thought_number: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Position in your sequence. Required at runtime — supply this field or its camelCase alias thoughtNumber.",
      }),
    ),
    thoughtNumber: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "camelCase alias for thought_number. Required at runtime — supply either form.",
      }),
    ),
    total_thoughts: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Expected total thoughts in the sequence. Required at runtime — supply this field or its camelCase alias totalThoughts.",
      }),
    ),
    totalThoughts: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "camelCase alias for total_thoughts. Required at runtime — supply either form.",
      }),
    ),
    next_thought_needed: Type.Optional(
      Type.Boolean({
        description:
          "Whether more thoughts are needed after this one. Required at runtime — supply this field or its camelCase alias nextThoughtNeeded.",
      }),
    ),
    nextThoughtNeeded: Type.Optional(
      Type.Boolean({
        description: "camelCase alias for next_thought_needed. Required at runtime — supply either form.",
      }),
    ),
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
    axiomsUsed: Type.Optional(Type.Array(Type.String(), { description: "camelCase alias for axioms_used." })),
    assumptions_challenged: Type.Optional(
      Type.Array(Type.String(), { description: "Assumptions your thought questions or challenges." }),
    ),
    assumptionsChallenged: Type.Optional(
      Type.Array(Type.String(), { description: "camelCase alias for assumptions_challenged." }),
    ),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

const sessionScopedParams = Type.Object({ ...sessionParams, ...outputLimitParams }, { additionalProperties: true });

const clearHistoryParams = sessionScopedParams;

const exportSessionParams = Type.Object(
  {
    file_path: Type.String({ description: "Path to save the exported session JSON file." }),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

const importSessionParams = Type.Object(
  {
    file_path: Type.String({ description: "Path to the JSON file to import." }),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

const getThinkingHistoryParams = Type.Object(
  {
    ...sessionParams,
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: MAX_HISTORY_LIMIT, description: "Maximum thoughts to return." }),
    ),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Number of thoughts to skip from the start." })),
    include_full_thoughts: Type.Optional(
      Type.Boolean({
        description: "Whether to include full thought text. Default true; pass false to receive 120-char snippets.",
      }),
    ),
    includeFullThoughts: Type.Optional(
      Type.Boolean({ description: "camelCase alias for include_full_thoughts. Default true." }),
    ),
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

const getThinkingStatusParams = Type.Object({ ...outputLimitParams }, { additionalProperties: true });

const sequentialThinkParams = Type.Object(
  {
    topic: Type.String({ description: "The topic or question to think through." }),
    num_thoughts: Type.Optional(
      Type.Integer({ minimum: 3, maximum: 10, description: "Number of thoughts to generate (default: 5)." }),
    ),
    ...sessionParams,
    ...outputLimitParams,
  },
  { additionalProperties: true },
);

// =============================================================================
// Extension Entry Point
// =============================================================================

export { ThoughtStorage } from "./storage.js";

export default function sequentialThinking(pi: ExtensionAPI) {
  // Register CLI flags
  pi.registerFlag("--seq-think-storage-dir", {
    description: "Storage directory for thought sessions.",
    type: "string",
  });
  pi.registerFlag("--seq-think-config-file", {
    description: "Path to custom JSON config file (overrides settings.json lookup).",
    type: "string",
  });
  pi.registerFlag("--seq-think-config", {
    description: "Deprecated alias for --seq-think-config-file.",
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

  const getConfiguredFile = (): string | undefined => {
    const configFileFlag = pi.getFlag("--seq-think-config-file");
    const legacyConfigFlag = pi.getFlag("--seq-think-config");
    if (typeof configFileFlag !== "string" && typeof legacyConfigFlag === "string") {
      console.warn("[pi-sequential-thinking] --seq-think-config is deprecated; use --seq-think-config-file.");
    }
    return typeof configFileFlag === "string"
      ? configFileFlag
      : typeof legacyConfigFlag === "string"
        ? legacyConfigFlag
        : undefined;
  };

  const getEffectiveConfig = (): EffectiveConfigStatus => {
    const config = loadConfigWithSources(getConfiguredFile());
    return resolveEffectiveConfig({
      flags: {
        storageDir: pi.getFlag("--seq-think-storage-dir"),
        maxBytes: pi.getFlag("--seq-think-max-bytes"),
        maxLines: pi.getFlag("--seq-think-max-lines"),
      },
      env: process.env,
      config,
    });
  };

  const initialConfig = getEffectiveConfig();
  const storage = new ThoughtStorage(initialConfig.storageDir);
  const analyzer = new ThoughtAnalyzer();

  const getMaxLimits = (): { maxBytes: number; maxLines: number } => {
    const config = getEffectiveConfig();
    return { maxBytes: config.maxBytes, maxLines: config.maxLines };
  };

  const effectiveConfigForStatus = (): EffectiveConfigStatus => {
    const config = getEffectiveConfig();
    return {
      ...config,
      storageDir: config.storageDir ?? join(getHomeDir(), ".mcp_sequential_thinking"),
    };
  };

  // Helper to execute a tool
  const executeTool = (
    toolName: string,
    pendingMessage: string,
    executeFn: () => unknown,
    onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    params: Record<string, unknown>,
  ) => {
    onUpdate?.({
      content: [{ type: "text" as const, text: pendingMessage }],
      details: { status: "pending" },
    });

    try {
      const { requestedLimits } = splitParams(params);
      const maxLimits = getMaxLimits();
      const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);
      const result = executeFn();
      const { text, details } = formatToolOutput(toolName, result, effectiveLimits);
      return { content: [{ type: "text" as const, text }], details, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const validationErrors = error instanceof ThoughtValidationError ? error.errors : undefined;
      return {
        content: [{ type: "text" as const, text: `Sequential Thinking error: ${message}` }],
        isError: true,
        details: { tool: toolName, truncated: false, error: message, validationErrors },
      };
    }
  };

  // =============================================================================
  // Tool Implementations
  // =============================================================================

  function processThought(args: Record<string, unknown>): {
    thoughtAnalysis: unknown;
    receipt: Record<string, unknown>;
  } {
    const normalized = normalizeThoughtInput(args);
    const storageResult = storage.addThought(normalized.thought, normalized.session.sessionId);
    const allThoughts = storage.getAllThoughts(normalized.session.sessionId);
    const analysis = analyzer.analyzeThought(normalized.thought, allThoughts);

    return {
      ...analysis,
      receipt: toReceipt("process_thought", storageResult, { ...normalized.adjustments }),
    };
  }

  function generateSummary(args: Record<string, unknown>): {
    sessionId: string | null;
    sessionLabel: string;
    summary: unknown;
  } {
    const sessionId = sessionIdFromArgs(args);
    const session = normalizeSessionId(sessionId);
    const thoughts = storage.getAllThoughts(session.sessionId);
    return { sessionId: session.sessionId, sessionLabel: session.sessionLabel, ...analyzer.generateSummary(thoughts) };
  }

  function clearHistory(args: Record<string, unknown>): {
    status: string;
    message: string;
    receipt: Record<string, unknown>;
  } {
    const sessionId = sessionIdFromArgs(args);
    const result = storage.clearHistory(sessionId);
    return { status: "success", message: "Thought history cleared", receipt: toReceipt("clear_history", result) };
  }

  function exportSession(args: Record<string, unknown>): {
    status: string;
    message: string;
    receipt: Record<string, unknown>;
  } {
    const filePath = normalizeString(args.file_path);
    if (!filePath) {
      throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
    }
    const sessionId = sessionIdFromArgs(args);
    const result = storage.exportSession(filePath, sessionId);
    return {
      status: "success",
      message: `Session exported to ${result.filePath}`,
      receipt: toReceipt("export_session", result),
    };
  }

  function importSession(args: Record<string, unknown>): {
    status: string;
    message: string;
    receipt: Record<string, unknown>;
  } {
    const filePath = normalizeString(args.file_path);
    if (!filePath) {
      throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
    }
    const sessionId = sessionIdFromArgs(args);
    const result = storage.importSession(filePath, sessionId);
    return {
      status: "success",
      message: `Session imported from ${filePath}`,
      receipt: toReceipt("import_session", result),
    };
  }

  function getThinkingHistory(args: Record<string, unknown>) {
    const sessionId = sessionIdFromArgs(args);
    const includeFullThoughts = includeFullThoughtsFromArgs(args);
    return storage.getHistory({
      sessionId,
      limit: normalizeNumber(args.limit) ?? DEFAULT_HISTORY_LIMIT,
      offset: normalizeNumber(args.offset) ?? 0,
      includeFullThoughts,
    });
  }

  function getThinkingStatus() {
    return storage.getStatus({ effectiveConfig: effectiveConfigForStatus() });
  }

  function sequentialThink(args: Record<string, unknown>): {
    sessionId: string | null;
    sessionLabel: string;
    summary: unknown;
    receipt: Record<string, unknown>;
  } {
    const topic = normalizeString(args.topic);
    if (!topic) {
      throw new ThoughtValidationError([{ field: "topic", message: "topic cannot be empty" }]);
    }
    const requestedThoughts = normalizeNumber(args.num_thoughts) ?? 5;
    const numThoughts = Math.min(Math.max(requestedThoughts, 3), 10);
    const sessionId = sessionIdFromArgs(args);
    const session = normalizeSessionId(sessionId);
    const preCount = storage.getAllThoughts(session.sessionId).length;

    const stages: ThoughtStage[] = [
      ThoughtStage.PROBLEM_DEFINITION,
      ThoughtStage.RESEARCH,
      ThoughtStage.ANALYSIS,
      ThoughtStage.SYNTHESIS,
      ThoughtStage.CONCLUSION,
    ];

    const stagePrompts: Record<ThoughtStage, string> = {
      [ThoughtStage.PROBLEM_DEFINITION]: `Define the problem: What exactly needs to be decided or solved regarding "${topic}"? What are the constraints and success criteria?`,
      [ThoughtStage.RESEARCH]: `Research options for "${topic}": What are the available choices? What are their tradeoffs? What does the evidence say?`,
      [ThoughtStage.ANALYSIS]: `Analyze "${topic}": Examine each option in detail. What are the pros and cons? What are the risks?`,
      [ThoughtStage.SYNTHESIS]: `Synthesize insights about "${topic}": How do the pieces fit together? What is the overall assessment?`,
      [ThoughtStage.CONCLUSION]: `Draw a conclusion about "${topic}": What is the recommendation? What is the final verdict?`,
    };

    let lastResult: SessionOperationResult | undefined;
    const thoughtCount = Math.min(numThoughts, stages.length);
    for (let i = 0; i < thoughtCount; i++) {
      const stage = stages[i];
      const thoughtData: ThoughtData = {
        thought: stagePrompts[stage],
        thought_number: i + 1,
        total_thoughts: thoughtCount,
        next_thought_needed: i < thoughtCount - 1,
        stage,
        tags: [topic.toLowerCase().split(/\s+/)[0]],
        axioms_used: [],
        assumptions_challenged: [],
        timestamp: new Date().toISOString(),
        id: generateUuid(),
      };
      lastResult = storage.addThought(thoughtData, session.sessionId);
    }

    const thoughts = storage.getAllThoughts(session.sessionId);
    const summary = analyzer.generateSummary(thoughts);
    const fallbackResult: SessionOperationResult = {
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      preCount,
      postCount: thoughts.length,
      changed: thoughts.length !== preCount,
      savedAt: new Date().toISOString(),
      stateFingerprint: lastResult?.stateFingerprint ?? "",
    };

    return {
      sessionId: session.sessionId,
      sessionLabel: session.sessionLabel,
      ...summary,
      receipt: toReceipt("sequential_think", lastResult ? { ...lastResult, preCount } : fallbackResult),
    };
  }

  // =============================================================================
  // Register Tools
  // =============================================================================

  pi.registerTool({
    name: "process_thought",
    label: "Process Thought",
    description:
      "Record and analyze a sequential thought with metadata. Use this to break down complex problems " +
      "into structured steps through stages: Problem Definition, Research, Analysis, Synthesis, Conclusion. " +
      "Accepts snake_case fields and MCP-style camelCase aliases. Content-bearing: stores thought text in local plaintext JSON.",
    parameters: processThoughtParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "process_thought",
        "Processing thought...",
        () => processThought(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "generate_summary",
    label: "Generate Thinking Summary",
    description:
      "Generate a summary of one thinking session. Content-bearing: summaries derive from stored thought content.",
    parameters: sessionScopedParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "generate_summary",
        "Generating summary...",
        () => generateSummary(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "clear_history",
    label: "Clear Thought History",
    description: "Reset one thinking session by clearing recorded thoughts.",
    parameters: clearHistoryParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "clear_history",
        "Clearing history...",
        () => clearHistory(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "export_session",
    label: "Export Thinking Session",
    description:
      "Export one thinking session to a JSON file. Content-bearing: exported files include thought text. Parent directories are created automatically.",
    parameters: exportSessionParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "export_session",
        "Exporting session...",
        () => exportSession(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "import_session",
    label: "Import Thinking Session",
    description:
      "Import a previously exported thinking session from a JSON file. Treats imported thought text as inert content.",
    parameters: importSessionParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "import_session",
        "Importing session...",
        () => importSession(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "get_thinking_history",
    label: "Get Thinking History",
    description:
      "Read recorded thoughts for one session with bounded pagination. Content-bearing: may return full thought text unless include_full_thoughts=false.",
    parameters: getThinkingHistoryParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "get_thinking_history",
        "Getting thinking history...",
        () => getThinkingHistory(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "get_thinking_status",
    label: "Get Thinking Status",
    description:
      "Read content-free storage and configuration diagnostics for sequential thinking sessions. " +
      "Returns storage writability, per-session thought counts and state fingerprints, corrupt-session flags with error strings, " +
      "backup file names, effectiveConfig.sources labels (flag/env/project_settings/global_settings/config_file/default), " +
      "and a statusCompleteness block indicating whether the listing was truncated or contained corrupt entries. " +
      "Use writable=false or sessions[].corrupt=true to diagnose write and parse failures.",
    parameters: getThinkingStatusParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      return executeTool(
        "get_thinking_status",
        "Getting thinking status...",
        getThinkingStatus,
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "sequential_think",
    label: "Sequential Thinking",
    description:
      "Scaffold a complete staged thinking sequence for a topic in one call. " +
      "Generates one thought per cognitive stage (Problem Definition through Conclusion) and writes them to the selected session. " +
      "Use process_thought instead when you want to record your own thoughts step-by-step.",
    parameters: sequentialThinkParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "sequential_think",
        "Starting structured thinking process...",
        () => sequentialThink(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });
}

// Export utilities for testing
export {
  formatToolOutput,
  isRecord,
  loadConfigWithSources,
  normalizeNumber,
  normalizeString,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveConfig,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
};

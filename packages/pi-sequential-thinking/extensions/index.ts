/**
 * Sequential Thinking Extension for pi
 *
 * Provides structured progressive thinking through defined cognitive stages.
 * This is a native TypeScript implementation with no external dependencies.
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-sequential-thinking
 * 2. Optional config:
 *    - Settings file: ~/.pi/agent/settings.json or .pi/settings.json under the pi-sequential-thinking key
 *      (or set SEQ_THINK_CONFIG_FILE / --seq-think-config-file for a custom path)
 *      Keys: storageDir, maxBytes, maxLines
 *    - MCP_STORAGE_DIR (storage directory for thought sessions)
 *    - SEQ_THINK_MAX_BYTES (default: 51200)
 *    - SEQ_THINK_MAX_LINES (default: 2000)
 * 3. Or pass flags:
 *    --seq-think-storage-dir, --seq-think-config-file, --seq-think-max-bytes, --seq-think-max-lines
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { ThoughtAnalyzer } from "./analyzer.js";
import { ThoughtStorage } from "./storage.js";
import { generateUuid, parseThoughtStage, type ThoughtData, ThoughtStage } from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
  storageDir: null,
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
};

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

// =============================================================================
// Utility Functions
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    storageDir: normalizeString(raw.storageDir),
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function loadSettingsConfig(path: string): SeqThinkConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const config = parsed["pi-sequential-thinking"];
    if (!isRecord(config)) {
      return null;
    }
    return parseConfig(config, path);
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

function loadConfig(configPath: string | undefined): SeqThinkConfig | null {
  const envConfigFile = process.env.SEQ_THINK_CONFIG_FILE;
  const legacyEnvConfig = process.env.SEQ_THINK_CONFIG;
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFile(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-sequential-thinking] SEQ_THINK_CONFIG is deprecated; use SEQ_THINK_CONFIG_FILE.");
    return loadConfigFile(resolveConfigPath(legacyEnvConfig));
  }

  warnIgnoredLegacyConfigFiles();

  const projectSettingsPath = join(process.cwd(), ".pi", "settings.json");
  const globalSettingsPath = join(getHomeDir(), ".pi", "agent", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath);
  const projectConfig = loadSettingsConfig(projectSettingsPath);

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return {
    storageDir: projectConfig?.storageDir ?? globalConfig?.storageDir,
    maxBytes: projectConfig?.maxBytes ?? globalConfig?.maxBytes,
    maxLines: projectConfig?.maxLines ?? globalConfig?.maxLines,
  };
}

function loadConfigFile(path: string): SeqThinkConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parseConfig(parsed, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse config ${path}: ${message}`);
    return null;
  }
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

// =============================================================================
// Tool Parameters
// =============================================================================

const processThoughtParams = Type.Object(
  {
    thought: Type.String({ description: "The content of your thought." }),
    thought_number: Type.Integer({
      minimum: 1,
      description: "Position in your sequence (e.g., 1 for first thought).",
    }),
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
      Type.Array(Type.String(), {
        description: "Assumptions your thought questions or challenges.",
      }),
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

const sequentialThinkParams = Type.Object(
  {
    topic: Type.String({ description: "The topic or question to think through." }),
    num_thoughts: Type.Optional(
      Type.Integer({ minimum: 3, maximum: 10, description: "Number of thoughts to generate (default: 5)." }),
    ),
    piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
    piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
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

  const getStorageDir = (): string | undefined => {
    const storageDirFlag = pi.getFlag("--seq-think-storage-dir");
    if (typeof storageDirFlag === "string" && storageDirFlag.trim().length > 0) {
      return resolveConfigPath(storageDirFlag);
    }

    const configFileFlag = pi.getFlag("--seq-think-config-file");
    const legacyConfigFlag = pi.getFlag("--seq-think-config");
    const configFlag =
      typeof configFileFlag === "string"
        ? configFileFlag
        : typeof legacyConfigFlag === "string"
          ? legacyConfigFlag
          : undefined;
    if (typeof configFileFlag !== "string" && typeof legacyConfigFlag === "string") {
      console.warn("[pi-sequential-thinking] --seq-think-config is deprecated; use --seq-think-config-file.");
    }
    const config = loadConfig(configFlag);
    const envStorageDir = normalizeString(process.env.MCP_STORAGE_DIR);
    if (envStorageDir) {
      return resolveConfigPath(envStorageDir);
    }
    if (config?.storageDir) {
      return resolveConfigPath(config.storageDir);
    }
    return undefined;
  };

  // Create singleton storage and analyzer
  const storage = new ThoughtStorage(getStorageDir());
  const analyzer = new ThoughtAnalyzer();

  const getMaxLimits = (): { maxBytes: number; maxLines: number } => {
    const maxBytesFlag = pi.getFlag("--seq-think-max-bytes");
    const maxLinesFlag = pi.getFlag("--seq-think-max-lines");
    const configFileFlag = pi.getFlag("--seq-think-config-file");
    const legacyConfigFlag = pi.getFlag("--seq-think-config");
    const configFlag =
      typeof configFileFlag === "string"
        ? configFileFlag
        : typeof legacyConfigFlag === "string"
          ? legacyConfigFlag
          : undefined;
    if (typeof configFileFlag !== "string" && typeof legacyConfigFlag === "string") {
      console.warn("[pi-sequential-thinking] --seq-think-config is deprecated; use --seq-think-config-file.");
    }
    const config = loadConfig(configFlag);

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
      return {
        content: [{ type: "text" as const, text: `Sequential Thinking error: ${message}` }],
        isError: true,
        details: { tool: toolName, error: message },
      };
    }
  };

  // =============================================================================
  // Tool Implementations
  // =============================================================================

  function processThought(args: Record<string, unknown>): { thoughtAnalysis: unknown } {
    const thought = args.thought as string;
    const thoughtNumber = args.thought_number as number;
    const totalThoughts = args.total_thoughts as number;
    const nextThoughtNeeded = args.next_thought_needed as boolean;
    const stageStr = args.stage as string;
    const tags = (args.tags as string[]) ?? [];
    const axiomsUsed = (args.axioms_used as string[]) ?? [];
    const assumptionsChallenged = (args.assumptions_challenged as string[]) ?? [];

    // Parse stage
    const stage: ThoughtStage = parseThoughtStage(stageStr);

    // Create thought data
    const thoughtData: ThoughtData = {
      thought,
      thought_number: thoughtNumber,
      total_thoughts: totalThoughts,
      next_thought_needed: nextThoughtNeeded,
      stage,
      tags,
      axioms_used: axiomsUsed,
      assumptions_challenged: assumptionsChallenged,
      timestamp: new Date().toISOString(),
      id: generateUuid(),
    };

    // Validate
    if (!thought.trim()) {
      throw new Error("Thought content cannot be empty");
    }
    if (thoughtNumber < 1) {
      throw new Error("Thought number must be a positive integer");
    }
    if (totalThoughts < thoughtNumber) {
      throw new Error("Total thoughts must be greater or equal to current thought number");
    }

    // Store and analyze
    storage.addThought(thoughtData);
    const allThoughts = storage.getAllThoughts();
    const analysis = analyzer.analyzeThought(thoughtData, allThoughts);

    return analysis;
  }

  function generateSummary(): { summary: unknown } {
    const thoughts = storage.getAllThoughts();
    return analyzer.generateSummary(thoughts);
  }

  function clearHistory(): { status: string; message: string } {
    storage.clearHistory();
    return { status: "success", message: "Thought history cleared" };
  }

  function exportSession(args: Record<string, unknown>): { status: string; message: string } {
    const filePath = args.file_path as string;
    if (!filePath) {
      throw new Error("file_path is required");
    }
    storage.exportSession(filePath);
    return { status: "success", message: `Session exported to ${filePath}` };
  }

  function importSession(args: Record<string, unknown>): { status: string; message: string } {
    const filePath = args.file_path as string;
    if (!filePath) {
      throw new Error("file_path is required");
    }
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    storage.importSession(filePath);
    return { status: "success", message: `Session imported from ${filePath}` };
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
      "Each thought is tracked with its position in the sequence, stage, tags, and related analysis.",
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
      "Generate a summary of the entire sequential thinking process. Returns stage counts, " +
      "timeline, top tags, and completion status. Use after processing multiple thoughts.",
    parameters: generateSummaryParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      return executeTool(
        "generate_summary",
        "Generating summary...",
        generateSummary,
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  pi.registerTool({
    name: "clear_history",
    label: "Clear Thought History",
    description: "Reset the sequential thinking process by clearing all recorded thoughts.",
    parameters: clearHistoryParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      return executeTool(
        "clear_history",
        "Clearing history...",
        clearHistory,
        onUpdate,
        params as Record<string, unknown>,
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
    description: "Import a previously exported thinking session from a JSON file.",
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
    name: "sequential_think",
    label: "Sequential Thinking",
    description:
      "Think through a topic systematically using structured cognitive stages. " +
      "Call this when user asks to 'think through', 'analyze', or 'decide' something. " +
      "Processes through Problem Definition → Research → Analysis → Synthesis → Conclusion. " +
      "Returns a structured summary with recommendations.",
    parameters: sequentialThinkParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
      const maxLimits = getMaxLimits();
      const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);

      onUpdate?.({
        content: [{ type: "text" as const, text: "Starting structured thinking process..." }],
        details: { status: "pending" },
      });

      try {
        const topic = toolArgs.topic as string;
        const numThoughts = (toolArgs.num_thoughts as number) || 5;

        // Generate thoughts for each stage
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

        // Process thoughts for each stage
        for (let i = 0; i < Math.min(numThoughts, stages.length); i++) {
          const stage = stages[i];
          const thoughtData: ThoughtData = {
            thought: stagePrompts[stage],
            thought_number: i + 1,
            total_thoughts: Math.min(numThoughts, stages.length),
            next_thought_needed: i < Math.min(numThoughts, stages.length) - 1,
            stage,
            tags: [topic.toLowerCase().split(/\s+/)[0]], // First word of topic as tag
            axioms_used: [],
            assumptions_challenged: [],
            timestamp: new Date().toISOString(),
            id: generateUuid(),
          };

          storage.addThought(thoughtData);
        }

        // Generate summary
        const summary = analyzer.generateSummary(storage.getAllThoughts());
        const { text, details } = formatToolOutput("sequential_think", summary, effectiveLimits);

        return {
          content: [{ type: "text" as const, text }],
          details,
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Sequential Thinking error: ${message}` }],
          isError: true,
          details: { tool: "sequential_think", error: message },
        };
      }
    },
  });
}

// Export utilities for testing
export {
  DEFAULT_CONFIG_FILE,
  formatToolOutput,
  isRecord,
  loadConfig,
  normalizeNumber,
  normalizeString,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
};

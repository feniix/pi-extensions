/**
 * Code Reasoning Extension for pi
 *
 * Provides a tool for reflective problem-solving through sequential thinking.
 * Supports branching (exploring alternatives) and revision (correcting earlier thoughts).
 *
 * Setup:
 * 1. Install: pi install npm:@feniix/pi-code-reasoning
 * 2. Or pass flags:
 *    --code-reasoning-config-file, --code-reasoning-max-bytes, --code-reasoning-max-lines
 *
 * Usage:
 *   "Use code reasoning to think through this architecture decision"
 *   "Process a thought about the database schema design"
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import {
  enforceCrossFieldRules,
  MAX_THOUGHT_COUNT,
  MAX_THOUGHT_LENGTH,
  type ThoughtData,
  type ValidatedThoughtData,
  validateThoughtData,
} from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
};

// Reserved for future use
// const DEFAULT_CONFIG_DIR = join(homedir(), ".pi-code-reasoning");

// =============================================================================
// Types
// =============================================================================

interface CodeReasoningConfig {
  maxBytes?: number;
  maxLines?: number;
}

interface ThoughtTracker {
  add: (thought: ValidatedThoughtData) => void;
  reset: () => void;
  ensureBranchIsValid: (branchFromThought?: number) => void;
  ensureRevisionIsValid: (revisesThought?: number) => void;
  branches: () => string[];
  count: () => number;
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
// Utility Functions
// =============================================================================

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

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
  const filename = `pi-code-reasoning-${safeName}-${Date.now()}.txt`;
  const filePath = join(tmpdir(), filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
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

function parseConfig(raw: unknown, pathHint: string): CodeReasoningConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Code Reasoning config at ${pathHint}: expected an object.`);
  }
  return {
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function loadConfigFile(path: string): CodeReasoningConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parseConfig(parsed, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-code-reasoning] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function loadSettingsConfig(path: string): CodeReasoningConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed["pi-code-reasoning"];
    if (!isRecord(config)) {
      return null;
    }
    return parseConfig(config, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-code-reasoning] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "code-reasoning.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "code-reasoning.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-code-reasoning] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-code-reasoning", or pass --code-reasoning-config-file / CODE_REASONING_CONFIG_FILE explicitly.`,
      );
    }
  }
}

function loadConfig(configPath: string | undefined): CodeReasoningConfig | null {
  const envConfigFile = process.env.CODE_REASONING_CONFIG_FILE;
  const legacyEnvConfig = process.env.CODE_REASONING_CONFIG;
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFile(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-code-reasoning] CODE_REASONING_CONFIG is deprecated; use CODE_REASONING_CONFIG_FILE.");
    return loadConfigFile(resolveConfigPath(legacyEnvConfig));
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
    maxBytes: projectConfig?.maxBytes ?? globalConfig?.maxBytes,
    maxLines: projectConfig?.maxLines ?? globalConfig?.maxLines,
  };
}

// =============================================================================
// Thought Tracker
// =============================================================================

function createThoughtTracker(): ThoughtTracker {
  const thoughtHistory: ValidatedThoughtData[] = [];
  const branches = new Map<string, ValidatedThoughtData[]>();

  return {
    add: (thought) => {
      thoughtHistory.push(thought);
      if (thought.branch_id) {
        const branchThoughts = branches.get(thought.branch_id) ?? [];
        branchThoughts.push(thought);
        branches.set(thought.branch_id, branchThoughts);
      }
    },
    ensureBranchIsValid: (branchFromThought) => {
      if (branchFromThought && branchFromThought > thoughtHistory.length) {
        throw new Error(`Invalid branch_from_thought ${branchFromThought}.`);
      }
    },
    ensureRevisionIsValid: (revisesThought) => {
      if (revisesThought && revisesThought > thoughtHistory.length) {
        throw new Error(`Invalid revises_thought ${revisesThought}.`);
      }
    },
    branches: () => Array.from(branches.keys()),
    count: () => thoughtHistory.length,
    reset: () => {
      thoughtHistory.length = 0;
      branches.clear();
    },
  };
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function _formatThought(t: ValidatedThoughtData): string {
  const { thought_number, total_thoughts, thought, is_revision, revises_thought, branch_id, branch_from_thought } = t;

  const header = is_revision
    ? `🔄 Revision ${thought_number}/${total_thoughts} (of ${revises_thought})`
    : branch_id
      ? `🌿 Branch ${thought_number}/${total_thoughts} (from ${branch_from_thought}, id:${branch_id})`
      : `💭 Thought ${thought_number}/${total_thoughts}`;

  const body = thought
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

  return `\n${header}\n---\n${body}\n---`;
}

function getExampleThought(errorMsg: string): Partial<ThoughtData> {
  if (errorMsg.includes("branch")) {
    return {
      thought: "Exploring alternative: Consider algorithm X.",
      thought_number: 3,
      total_thoughts: 7,
      next_thought_needed: true,
      branch_from_thought: 2,
      branch_id: "alternative-algo-x",
    };
  }
  if (errorMsg.includes("revis")) {
    return {
      thought: "Revisiting earlier point: Assumption Y was flawed.",
      thought_number: 4,
      total_thoughts: 6,
      next_thought_needed: true,
      is_revision: true,
      revises_thought: 2,
    };
  }
  if (errorMsg.includes("length") || errorMsg.includes("empty")) {
    return {
      thought: "Breaking down the thought into smaller parts...",
      thought_number: 2,
      total_thoughts: 5,
      next_thought_needed: true,
    };
  }
  return {
    thought: "Initial exploration of the problem.",
    thought_number: 1,
    total_thoughts: 5,
    next_thought_needed: true,
  };
}

function buildSuccess(t: ValidatedThoughtData, tracker: ThoughtTracker): Record<string, unknown> {
  return {
    status: "processed",
    thought_number: t.thought_number,
    total_thoughts: t.total_thoughts,
    next_thought_needed: t.next_thought_needed,
    branches: tracker.branches(),
    thought_history_length: tracker.count(),
  };
}

function buildError(error: Error): Record<string, unknown> {
  const errorMessage = error.message;
  let guidance = "Check the tool description and schema for correct usage.";
  const example = getExampleThought(errorMessage);

  if (errorMessage.includes("branch")) {
    guidance =
      "When branching, provide both branch_from_thought (number) and branch_id (string), and do not combine with revision.";
  } else if (errorMessage.includes("revision")) {
    guidance =
      "When revising, set is_revision=true and provide revises_thought (positive number). Do not combine with branching.";
  } else if (errorMessage.includes("length")) {
    guidance = `The thought is too long. Keep it under ${MAX_THOUGHT_LENGTH} characters.`;
  } else if (errorMessage.includes("Max thought")) {
    guidance = `The maximum thought limit (${MAX_THOUGHT_COUNT}) was reached.`;
  }

  return {
    status: "failed",
    error: errorMessage,
    guidance,
    example,
  };
}

// =============================================================================
// Tool Parameters
// =============================================================================

const codeReasoningParams = Type.Object(
  {
    thought: Type.String({ description: "The content of your reasoning/thought." }),
    thought_number: Type.Integer({
      minimum: 1,
      description: "Current number in the thinking sequence.",
    }),
    total_thoughts: Type.Integer({
      minimum: 1,
      description: "Estimated total number of thoughts.",
    }),
    next_thought_needed: Type.Boolean({
      description: "Set to FALSE only when completely done.",
    }),
    is_revision: Type.Optional(Type.Boolean({ description: "When correcting earlier thinking (🔄)." })),
    revises_thought: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Which thought number you're revising.",
      }),
    ),
    branch_from_thought: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "When exploring alternative approaches (🌿).",
      }),
    ),
    branch_id: Type.Optional(Type.String({ description: "Identifier for this branch." })),
    needs_more_thoughts: Type.Optional(Type.Boolean({ description: "If more thoughts are needed." })),
    piMaxBytes: Type.Optional(Type.Integer({ description: "Client-side max bytes override (clamped by config)." })),
    piMaxLines: Type.Optional(Type.Integer({ description: "Client-side max lines override (clamped by config)." })),
  },
  { additionalProperties: true },
);

// =============================================================================
// Extension Entry Point
// =============================================================================

export {
  buildError,
  buildSuccess,
  createThoughtTracker,
  DEFAULT_CONFIG_FILE,
  formatToolOutput,
  getExampleThought,
  isRecord,
  normalizeNumber,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
};

export default function codeReasoning(pi: ExtensionAPI) {
  // Register CLI flags
  pi.registerFlag("--code-reasoning-config-file", {
    description:
      "Path to JSON config file (overrides .pi/settings.json or ~/.pi/agent/settings.json under pi-code-reasoning).",
    type: "string",
  });
  pi.registerFlag("--code-reasoning-config", {
    description: "Deprecated alias for --code-reasoning-config-file.",
    type: "string",
  });
  pi.registerFlag("--code-reasoning-max-bytes", {
    description: "Max bytes to keep from tool output (default: 51200).",
    type: "string",
  });
  pi.registerFlag("--code-reasoning-max-lines", {
    description: "Max lines to keep from tool output (default: 2000).",
    type: "string",
  });

  const tracker = createThoughtTracker();

  const getMaxLimits = (): { maxBytes: number; maxLines: number } => {
    const maxBytesFlag = pi.getFlag("--code-reasoning-max-bytes");
    const maxLinesFlag = pi.getFlag("--code-reasoning-max-lines");
    const configFileFlag = pi.getFlag("--code-reasoning-config-file");
    const legacyConfigFlag = pi.getFlag("--code-reasoning-config");
    const configFlag =
      typeof configFileFlag === "string"
        ? configFileFlag
        : typeof legacyConfigFlag === "string"
          ? legacyConfigFlag
          : undefined;
    if (typeof configFileFlag !== "string" && typeof legacyConfigFlag === "string") {
      console.warn("[pi-code-reasoning] --code-reasoning-config is deprecated; use --code-reasoning-config-file.");
    }
    const config = loadConfig(configFlag);

    const maxBytes =
      typeof maxBytesFlag === "string"
        ? normalizeNumber(maxBytesFlag)
        : normalizeNumber(process.env.CODE_REASONING_MAX_BYTES ?? config?.maxBytes);
    const maxLines =
      typeof maxLinesFlag === "string"
        ? normalizeNumber(maxLinesFlag)
        : normalizeNumber(process.env.CODE_REASONING_MAX_LINES ?? config?.maxLines);

    return {
      maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
      maxLines: maxLines ?? DEFAULT_MAX_LINES,
    };
  };

  // Process a single thought
  const processThought = (args: Record<string, unknown>): Record<string, unknown> => {
    const thought = args.thought as string;
    const thought_number = args.thought_number as number;
    const total_thoughts = args.total_thoughts as number;
    const next_thought_needed = args.next_thought_needed as boolean;
    const is_revision = args.is_revision as boolean | undefined;
    const revises_thought = args.revises_thought as number | undefined;
    const branch_from_thought = args.branch_from_thought as number | undefined;
    const branch_id = args.branch_id as string | undefined;
    const needs_more_thoughts = args.needs_more_thoughts as boolean | undefined;

    const data: ThoughtData = {
      thought,
      thought_number,
      total_thoughts,
      next_thought_needed,
      is_revision,
      revises_thought,
      branch_from_thought,
      branch_id,
      needs_more_thoughts,
    };

    const fieldErrors = validateThoughtData(data);
    if (fieldErrors.length > 0) {
      throw new Error(fieldErrors[0].message);
    }

    // Validate thought limits and ordering
    if (data.thought_number > MAX_THOUGHT_COUNT || data.total_thoughts > MAX_THOUGHT_COUNT) {
      throw new Error(`Max thought_number exceeded (${MAX_THOUGHT_COUNT}).`);
    }
    if (data.thought_number > data.total_thoughts) {
      throw new Error("thought_number cannot exceed total_thoughts.");
    }

    // Cross-field validation
    const crossErrors = enforceCrossFieldRules(data);
    if (crossErrors.length > 0) {
      throw new Error(crossErrors[0].message);
    }

    // Validate branch/revision references
    tracker.ensureBranchIsValid(data.branch_from_thought);
    tracker.ensureRevisionIsValid(data.revises_thought);

    // Add defaults
    const validated: ValidatedThoughtData = {
      thought: data.thought,
      thought_number: data.thought_number,
      total_thoughts: data.total_thoughts,
      next_thought_needed: data.next_thought_needed,
      is_revision: data.is_revision ?? false,
      branch_from_thought: data.branch_from_thought,
      branch_id: data.branch_id,
      needs_more_thoughts: data.needs_more_thoughts ?? data.next_thought_needed,
    };

    tracker.add(validated);

    return buildSuccess(validated, tracker);
  };

  // Helper to execute a tool
  const executeTool = (
    toolName: string,
    pendingMessage: string,
    executeFn: () => Record<string, unknown>,
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
      const err = error instanceof Error ? error : new Error(String(error));
      const result = buildError(err);
      const { text, details } = formatToolOutput(toolName, result, {});
      return { content: [{ type: "text" as const, text }], details, isError: true };
    }
  };

  // =============================================================================
  // Register Tool
  // =============================================================================

  pi.registerTool({
    name: "code_reasoning",
    label: "Code Reasoning",
    description: `🧠 Reflective problem-solving through sequential thinking with branching and revision support.

KEY PARAMETERS:
- thought: Your current reasoning step (required)
- thought_number: Current position in sequence (required)
- total_thoughts: Estimated total (can adjust as you go) (required)
- next_thought_needed: Set to FALSE ONLY when done (required)
- branch_from_thought + branch_id: When exploring alternatives (🌿)
- is_revision + revises_thought: When correcting earlier thinking (🔄)

✅ CHECKLIST (review every 3 thoughts):
1. Need to explore alternatives? → Use BRANCH (🌿)
2. Need to correct earlier thinking? → Use REVISION (🔄)
3. Scope changed? → Adjust total_thoughts
4. Done? → Set next_thought_needed = false

💡 TIPS:
- Don't hesitate to revise when you learn something new
- Use branching to explore multiple approaches
- Express uncertainty when present
- End with a validated conclusion`,
    parameters: codeReasoningParams,
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { toolArgs } = splitParams(params as Record<string, unknown>);
      return executeTool(
        "code_reasoning",
        "Processing thought...",
        () => processThought(toolArgs),
        onUpdate,
        params as Record<string, unknown>,
      );
    },
  });

  // =============================================================================
  // Register Helper Tools
  // =============================================================================

  pi.registerTool({
    name: "code_reasoning_status",
    label: "Code Reasoning Status",
    description: "Get current status of the code reasoning session: branches, thought count.",
    parameters: Type.Object({}, { additionalProperties: true }),
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { requestedLimits } = splitParams(params as Record<string, unknown>);
      const maxLimits = getMaxLimits();
      const effectiveLimits = resolveEffectiveLimits(requestedLimits, maxLimits);

      onUpdate?.({
        content: [{ type: "text" as const, text: "Getting status..." }],
        details: { status: "pending" },
      });

      const status = {
        branches: tracker.branches(),
        thought_count: tracker.count(),
      };

      const { text, details } = formatToolOutput("code_reasoning_status", status, effectiveLimits);
      return { content: [{ type: "text" as const, text }], details, isError: false };
    },
  });

  pi.registerTool({
    name: "code_reasoning_reset",
    label: "Reset Code Reasoning",
    description: "Reset the code reasoning session, clearing all thoughts and branches.",
    parameters: Type.Object({}, { additionalProperties: true }),
    async execute(_toolCallId, _params, _signal, onUpdate, _ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: "Resetting..." }],
        details: { status: "pending" },
      });

      tracker.reset();
      return {
        content: [{ type: "text" as const, text: "Code reasoning session reset." }],
        isError: false,
        details: { tool: "code_reasoning_reset" },
      };
    },
  });
}

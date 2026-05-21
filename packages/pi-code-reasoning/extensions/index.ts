/**
 * Code Reasoning Extension for pi
 *
 * Provides a tool for reflective problem-solving through sequential thinking.
 * Supports branching (exploring alternatives) and revision (correcting earlier thoughts).
 */

import {
  type AgentToolUpdateCallback,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, normalizeNumber, type OutputLimitRequest, resolveEffectiveLimits, splitParams } from "./config.js";
import { CODE_REASONING_FLAGS, CODE_REASONING_TOOLS } from "./constants.js";
import { formatToolOutput } from "./output.js";
import { processThought } from "./processor.js";
import { buildError } from "./responses.js";
import { createThoughtTracker } from "./tracker.js";

export {
  DEFAULT_CONFIG_FILE,
  isRecord,
  normalizeNumber,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveLimits,
  splitParams,
} from "./config.js";
export { formatToolOutput, toJsonString, writeTempFile } from "./output.js";
export { buildError, buildSuccess, getExampleThought } from "./responses.js";
export { createThoughtTracker } from "./tracker.js";

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

function registerFlags(pi: ExtensionAPI): void {
  pi.registerFlag(CODE_REASONING_FLAGS.configFile, {
    description:
      "Path to JSON config file (overrides .pi/settings.json or ~/.pi/agent/settings.json under pi-code-reasoning).",
    type: "string",
  });
  pi.registerFlag(CODE_REASONING_FLAGS.legacyConfigFile, {
    description: "Deprecated alias for --code-reasoning-config-file.",
    type: "string",
  });
  pi.registerFlag(CODE_REASONING_FLAGS.maxBytes, {
    description: "Max bytes to keep from tool output (default: 51200).",
    type: "string",
  });
  pi.registerFlag(CODE_REASONING_FLAGS.maxLines, {
    description: "Max lines to keep from tool output (default: 2000).",
    type: "string",
  });
}

function resolveConfigFlag(pi: ExtensionAPI): string | undefined {
  const configFileFlag = pi.getFlag(CODE_REASONING_FLAGS.configFile);
  const legacyConfigFlag = pi.getFlag(CODE_REASONING_FLAGS.legacyConfigFile);

  if (typeof configFileFlag === "string") {
    return configFileFlag;
  }
  if (typeof legacyConfigFlag === "string") {
    console.warn("[pi-code-reasoning] --code-reasoning-config is deprecated; use --code-reasoning-config-file.");
    return legacyConfigFlag;
  }
  return undefined;
}

function createMaxLimitsResolver(pi: ExtensionAPI): () => { maxBytes: number; maxLines: number } {
  let cachedLimits: { maxBytes: number; maxLines: number } | undefined;

  return () => {
    if (cachedLimits) {
      return cachedLimits;
    }

    const maxBytesFlag = pi.getFlag(CODE_REASONING_FLAGS.maxBytes);
    const maxLinesFlag = pi.getFlag(CODE_REASONING_FLAGS.maxLines);
    const config = loadConfig(resolveConfigFlag(pi));

    const maxBytes =
      typeof maxBytesFlag === "string"
        ? normalizeNumber(maxBytesFlag)
        : normalizeNumber(process.env.CODE_REASONING_MAX_BYTES ?? config?.maxBytes);
    const maxLines =
      typeof maxLinesFlag === "string"
        ? normalizeNumber(maxLinesFlag)
        : normalizeNumber(process.env.CODE_REASONING_MAX_LINES ?? config?.maxLines);

    cachedLimits = {
      maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
      maxLines: maxLines ?? DEFAULT_MAX_LINES,
    };
    return cachedLimits;
  };
}

function resolveToolLimits(
  requestedLimits: OutputLimitRequest,
  getMaxLimits: () => { maxBytes: number; maxLines: number },
): { maxBytes: number; maxLines: number } {
  return resolveEffectiveLimits(requestedLimits, getMaxLimits());
}

function executeTool(
  toolName: string,
  pendingMessage: string,
  executeFn: () => Record<string, unknown>,
  onUpdate: AgentToolUpdateCallback<unknown> | undefined,
  requestedLimits: OutputLimitRequest,
  getMaxLimits: () => { maxBytes: number; maxLines: number },
) {
  onUpdate?.({
    content: [{ type: "text" as const, text: pendingMessage }],
    details: { status: "pending" },
  });

  try {
    const effectiveLimits = resolveToolLimits(requestedLimits, getMaxLimits);
    const result = executeFn();
    const { text, details } = formatToolOutput(toolName, result, effectiveLimits);
    return { content: [{ type: "text" as const, text }], details, isError: false };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const result = buildError(err);
    const { text, details } = formatToolOutput(toolName, result, {});
    return { content: [{ type: "text" as const, text }], details, isError: true };
  }
}

export default function codeReasoning(pi: ExtensionAPI) {
  registerFlags(pi);

  const tracker = createThoughtTracker();
  const getMaxLimits = createMaxLimitsResolver(pi);

  pi.registerTool({
    name: CODE_REASONING_TOOLS.reasoning,
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
      const { toolArgs, requestedLimits } = splitParams(params as Record<string, unknown>);
      return executeTool(
        CODE_REASONING_TOOLS.reasoning,
        "Processing thought...",
        () => processThought(toolArgs, tracker),
        onUpdate,
        requestedLimits,
        getMaxLimits,
      );
    },
  });

  pi.registerTool({
    name: CODE_REASONING_TOOLS.status,
    label: "Code Reasoning Status",
    description: "Get current status of the code reasoning session: branches, thought count.",
    parameters: Type.Object({}, { additionalProperties: true }),
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const { requestedLimits } = splitParams(params as Record<string, unknown>);
      return executeTool(
        CODE_REASONING_TOOLS.status,
        "Getting status...",
        () => ({
          branches: tracker.branches(),
          thought_count: tracker.count(),
        }),
        onUpdate,
        requestedLimits,
        getMaxLimits,
      );
    },
  });

  pi.registerTool({
    name: CODE_REASONING_TOOLS.reset,
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
        details: { tool: CODE_REASONING_TOOLS.reset },
      };
    },
  });
}

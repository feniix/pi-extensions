import { definePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
import { Type } from "typebox";
import {
  isRecord,
  loadConfig,
  normalizeNumber,
  type OutputLimitRequest,
  resolveEffectiveLimits,
  splitParams,
} from "./config.js";
import { CODE_REASONING_TOOLS, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.js";
import { formatToolOutput, type McpToolDetails } from "./output.js";
import { processThought } from "./processor.js";
import { buildError } from "./responses.js";
import { createThoughtTracker, type ThoughtTracker } from "./tracker.js";

export type MaxLimits = { maxBytes: number; maxLines: number };
export type MaxLimitsResolver = () => MaxLimits;

export interface CodeReasoningToolsOptions {
  tracker?: ThoughtTracker;
  getMaxLimits?: MaxLimitsResolver;
}

export const codeReasoningParams = Type.Object(
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
    piMaxBytes: Type.Optional(
      Type.Integer({ minimum: 1, description: "Client-side max bytes override (clamped by config)." }),
    ),
    piMaxLines: Type.Optional(
      Type.Integer({ minimum: 1, description: "Client-side max lines override (clamped by config)." }),
    ),
  },
  { additionalProperties: true },
);

const outputLimitParams = {
  piMaxBytes: Type.Optional(
    Type.Integer({ minimum: 1, description: "Client-side max bytes override (clamped by config)." }),
  ),
  piMaxLines: Type.Optional(
    Type.Integer({ minimum: 1, description: "Client-side max lines override (clamped by config)." }),
  ),
};

export const statusParams = Type.Object(outputLimitParams, { additionalProperties: true });
export const resetParams = Type.Object({}, { additionalProperties: true });

export type CodeReasoningTools = readonly [
  PortableTool<typeof codeReasoningParams>,
  PortableTool<typeof statusParams>,
  PortableTool<typeof resetParams>,
];

export function createEnvironmentMaxLimitsResolver(): MaxLimitsResolver {
  let cachedLimits: MaxLimits | undefined;

  return () => {
    if (cachedLimits) return cachedLimits;

    const config = loadConfig(undefined);
    const maxBytes = normalizeNumber(process.env.CODE_REASONING_MAX_BYTES ?? config?.maxBytes);
    const maxLines = normalizeNumber(process.env.CODE_REASONING_MAX_LINES ?? config?.maxLines);

    cachedLimits = {
      maxBytes: maxBytes ?? DEFAULT_MAX_BYTES,
      maxLines: maxLines ?? DEFAULT_MAX_LINES,
    };
    return cachedLimits;
  };
}

function resolveToolLimits(requestedLimits: OutputLimitRequest, getMaxLimits: MaxLimitsResolver): MaxLimits {
  return resolveEffectiveLimits(requestedLimits, getMaxLimits());
}

function structuredContentFor(result: unknown, details: McpToolDetails): Record<string, unknown> {
  if (!isRecord(result) || details.truncated) {
    return { ...details };
  }
  return { ...details, ...result };
}

function formatPortableResult(
  toolName: string,
  result: unknown,
  requestedLimits: OutputLimitRequest,
  getMaxLimits: MaxLimitsResolver,
): PortableToolResult {
  const effectiveLimits = resolveToolLimits(requestedLimits, getMaxLimits);
  return formatPortableResultWithLimits(toolName, result, effectiveLimits);
}

function formatPortableResultWithLimits(
  toolName: string,
  result: unknown,
  limits: { maxBytes?: number; maxLines?: number },
  isError = false,
): PortableToolResult {
  const { text, details } = formatToolOutput(toolName, result, limits);
  const structuredContent = structuredContentFor(result, details);
  // Add the bridgekit discriminator so consumers can narrow with
  // isDomainFailure(result). kind comes first so the spread in
  // structuredContentFor (which may include user data) can't override it.
  return {
    text,
    structuredContent: isError ? { kind: "domain", ...structuredContent } : structuredContent,
    isError,
  };
}

function runFormattedTool(
  toolName: string,
  args: object,
  executeFn: (toolArgs: Record<string, unknown>) => Record<string, unknown>,
  getMaxLimits: MaxLimitsResolver,
): PortableToolResult {
  const { toolArgs, requestedLimits } = splitParams(args as Record<string, unknown>);

  try {
    return formatPortableResult(toolName, executeFn(toolArgs), requestedLimits, getMaxLimits);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return formatPortableResultWithLimits(toolName, buildError(err), {}, true);
  }
}

export function createCodeReasoningTools(options: CodeReasoningToolsOptions = {}): CodeReasoningTools {
  const tracker = options.tracker ?? createThoughtTracker();
  const getMaxLimits = options.getMaxLimits ?? createEnvironmentMaxLimitsResolver();

  return [
    definePortableTool({
      name: CODE_REASONING_TOOLS.reasoning,
      title: "Code Reasoning",
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
      // pendingMessage now fires pre-validation via bridgekit's pi adapter.
      // openWorldHint=false: writes to a local in-memory tracker; idempotentHint=false:
      // each call appends a thought (timestamps and ordering differ between calls).
      hostExtras: {
        pi: { pendingMessage: "Processing thought..." },
        mcp: { annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      },
      execute(args) {
        return runFormattedTool(
          CODE_REASONING_TOOLS.reasoning,
          args,
          (toolArgs) => processThought(toolArgs, tracker),
          getMaxLimits,
        );
      },
    }),
    definePortableTool({
      name: CODE_REASONING_TOOLS.status,
      title: "Code Reasoning Status",
      description: "Get current status of the code reasoning session: branches, thought count.",
      parameters: statusParams,
      hostExtras: {
        pi: { pendingMessage: "Getting status..." },
        mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
      },
      execute(args) {
        return runFormattedTool(
          CODE_REASONING_TOOLS.status,
          args,
          () => ({ branches: tracker.branches(), thought_count: tracker.count() }),
          getMaxLimits,
        );
      },
    }),
    definePortableTool({
      name: CODE_REASONING_TOOLS.reset,
      title: "Reset Code Reasoning",
      description: "Reset the code reasoning session, clearing all thoughts and branches.",
      parameters: resetParams,
      // destructiveHint=true: clears the tracker. idempotentHint=true: calling
      // reset on an already-reset session is a no-op (no observable change).
      hostExtras: {
        mcp: { annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false } },
      },
      execute() {
        tracker.reset();
        return {
          text: "Code reasoning session reset.",
          structuredContent: { tool: CODE_REASONING_TOOLS.reset },
        };
      },
    }),
  ];
}

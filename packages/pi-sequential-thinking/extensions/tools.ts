/**
 * Host-neutral tool definitions for pi-sequential-thinking.
 *
 * Tools defined here run unchanged under pi (via @feniix/bridgekit/pi) and
 * MCP (via @feniix/bridgekit/mcp). Host-specific concerns — pi-side output
 * truncation, MCP stdio transport — live in their own adapter modules.
 */

import { definePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
import { type TObject, Type } from "typebox";
import type { ThoughtAnalyzer } from "./analyzer.js";
import type { EffectiveConfigStatus } from "./config.js";
import { normalizeNumber, normalizeString } from "./config.js";
import type { ExportSessionResult, ImportSessionResult, SessionOperationResult, ThoughtStorage } from "./storage.js";
import {
  DEFAULT_HISTORY_LIMIT,
  generateUuid,
  MAX_HISTORY_LIMIT,
  normalizeSessionId,
  normalizeThoughtInput,
  pickAliasedArg,
  type ThoughtData,
  ThoughtStage,
  ThoughtValidationError,
} from "./types.js";

// =============================================================================
// Dependencies
// =============================================================================

export interface SequentialThinkingDeps {
  storage: ThoughtStorage;
  analyzer: ThoughtAnalyzer;
  effectiveConfigForStatus: EffectiveConfigStatus;
}

// =============================================================================
// Argument helpers (mirrored from extensions/index.ts, kept here so portable
// tools have no upstream dependency on the pi adapter)
// =============================================================================

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
// Parameter schemas (identical to extensions/index.ts so pi-side observable
// behavior is preserved exactly)
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
// Portable handlers
// =============================================================================

function toErrorResult(toolName: string, error: unknown): PortableToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const validationErrors = error instanceof ThoughtValidationError ? error.errors : undefined;
  const structuredContent: Record<string, unknown> = {
    tool: toolName,
    error: message,
  };
  if (validationErrors) {
    structuredContent.validationErrors = validationErrors;
  }
  return {
    text: `Sequential Thinking error: ${message}`,
    structuredContent,
    isError: true,
  };
}

function toOkResult(value: unknown): PortableToolResult {
  const structuredContent: Record<string, unknown> = isPlainObject(value)
    ? (value as Record<string, unknown>)
    : { value };
  return {
    text: JSON.stringify(structuredContent, null, 2),
    structuredContent,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function processThoughtHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const normalized = normalizeThoughtInput(args);
  const storageResult = deps.storage.addThought(normalized.thought, normalized.session.sessionId);
  const allThoughts = deps.storage.getAllThoughts(normalized.session.sessionId);
  const analysis = deps.analyzer.analyzeThought(normalized.thought, allThoughts);
  return {
    ...analysis,
    receipt: toReceipt("process_thought", storageResult, { ...normalized.adjustments }),
  };
}

function generateSummaryHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const sessionId = sessionIdFromArgs(args);
  const session = normalizeSessionId(sessionId);
  const thoughts = deps.storage.getAllThoughts(session.sessionId);
  return {
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    ...deps.analyzer.generateSummary(thoughts),
  };
}

function clearHistoryHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const sessionId = sessionIdFromArgs(args);
  const result = deps.storage.clearHistory(sessionId);
  return { status: "success", message: "Thought history cleared", receipt: toReceipt("clear_history", result) };
}

function exportSessionHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const filePath = normalizeString(args.file_path);
  if (!filePath) {
    throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
  }
  const sessionId = sessionIdFromArgs(args);
  const result = deps.storage.exportSession(filePath, sessionId);
  return {
    status: "success",
    message: `Session exported to ${result.filePath}`,
    receipt: toReceipt("export_session", result),
  };
}

function importSessionHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const filePath = normalizeString(args.file_path);
  if (!filePath) {
    throw new ThoughtValidationError([{ field: "file_path", message: "file_path is required" }]);
  }
  const sessionId = sessionIdFromArgs(args);
  const result = deps.storage.importSession(filePath, sessionId);
  return {
    status: "success",
    message: `Session imported from ${filePath}`,
    receipt: toReceipt("import_session", result),
  };
}

function getThinkingHistoryHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const sessionId = sessionIdFromArgs(args);
  const includeFullThoughts = includeFullThoughtsFromArgs(args);
  return deps.storage.getHistory({
    sessionId,
    limit: normalizeNumber(args.limit) ?? DEFAULT_HISTORY_LIMIT,
    offset: normalizeNumber(args.offset) ?? 0,
    includeFullThoughts,
  });
}

function getThinkingStatusHandler(deps: SequentialThinkingDeps): object {
  return deps.storage.getStatus({ effectiveConfig: deps.effectiveConfigForStatus });
}

function sequentialThinkHandler(deps: SequentialThinkingDeps, args: Record<string, unknown>): object {
  const topic = normalizeString(args.topic);
  if (!topic) {
    throw new ThoughtValidationError([{ field: "topic", message: "topic cannot be empty" }]);
  }
  const requestedThoughts = normalizeNumber(args.num_thoughts) ?? 5;
  const numThoughts = Math.min(Math.max(requestedThoughts, 3), 10);
  const sessionId = sessionIdFromArgs(args);
  const session = normalizeSessionId(sessionId);
  const preCount = deps.storage.getAllThoughts(session.sessionId).length;

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
    lastResult = deps.storage.addThought(thoughtData, session.sessionId);
  }

  const thoughts = deps.storage.getAllThoughts(session.sessionId);
  const summary = deps.analyzer.generateSummary(thoughts);
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
// Tool factory
// =============================================================================

function defineTool<TParams extends TObject>(
  tool: Omit<PortableTool<TParams>, "execute"> & {
    execute: (args: Record<string, unknown>) => object;
  },
): PortableTool<TParams> {
  return definePortableTool<TParams>({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    parameters: tool.parameters,
    execute(args) {
      try {
        return toOkResult(tool.execute(args as Record<string, unknown>));
      } catch (error) {
        return toErrorResult(tool.name, error);
      }
    },
  });
}

export function createTools(deps: SequentialThinkingDeps): PortableTool<TObject>[] {
  return [
    defineTool({
      name: "process_thought",
      title: "Process Thought",
      description:
        "Record and analyze a sequential thought with metadata. Use this to break down complex problems " +
        "into structured steps through stages: Problem Definition, Research, Analysis, Synthesis, Conclusion. " +
        "Accepts snake_case fields and MCP-style camelCase aliases. Content-bearing: stores thought text in local plaintext JSON.",
      parameters: processThoughtParams,
      execute: (args) => processThoughtHandler(deps, args),
    }),
    defineTool({
      name: "generate_summary",
      title: "Generate Thinking Summary",
      description:
        "Generate a summary of one thinking session. Content-bearing: summaries derive from stored thought content.",
      parameters: sessionScopedParams,
      execute: (args) => generateSummaryHandler(deps, args),
    }),
    defineTool({
      name: "clear_history",
      title: "Clear Thought History",
      description: "Reset one thinking session by clearing recorded thoughts.",
      parameters: clearHistoryParams,
      execute: (args) => clearHistoryHandler(deps, args),
    }),
    defineTool({
      name: "export_session",
      title: "Export Thinking Session",
      description:
        "Export one thinking session to a JSON file. Content-bearing: exported files include thought text. Parent directories are created automatically.",
      parameters: exportSessionParams,
      execute: (args) => exportSessionHandler(deps, args),
    }),
    defineTool({
      name: "import_session",
      title: "Import Thinking Session",
      description:
        "Import a previously exported thinking session from a JSON file. Treats imported thought text as inert content.",
      parameters: importSessionParams,
      execute: (args) => importSessionHandler(deps, args),
    }),
    defineTool({
      name: "get_thinking_history",
      title: "Get Thinking History",
      description:
        "Read recorded thoughts for one session with bounded pagination. Content-bearing: may return full thought text unless include_full_thoughts=false.",
      parameters: getThinkingHistoryParams,
      execute: (args) => getThinkingHistoryHandler(deps, args),
    }),
    defineTool({
      name: "get_thinking_status",
      title: "Get Thinking Status",
      description:
        "Read content-free storage and configuration diagnostics for sequential thinking sessions. " +
        "Returns storage writability, per-session thought counts and state fingerprints, corrupt-session flags with error strings, " +
        "backup file names, effectiveConfig.sources labels (flag/env/project_settings/global_settings/config_file/default), " +
        "and a statusCompleteness block indicating whether the listing was truncated or contained corrupt entries. " +
        "Use writable=false or sessions[].corrupt=true to diagnose write and parse failures.",
      parameters: getThinkingStatusParams,
      execute: () => getThinkingStatusHandler(deps),
    }),
    defineTool({
      name: "sequential_think",
      title: "Sequential Thinking",
      description:
        "Scaffold a complete staged thinking sequence for a topic in one call. " +
        "Generates one thought per cognitive stage (Problem Definition through Conclusion) and writes them to the selected session. " +
        "Use process_thought instead when you want to record your own thoughts step-by-step.",
      parameters: sequentialThinkParams,
      execute: (args) => sequentialThinkHandler(deps, args),
    }),
  ];
}

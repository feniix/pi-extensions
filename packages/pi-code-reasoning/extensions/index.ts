/**
 * Code Reasoning Extension for pi
 *
 * Provides tools for reflective problem-solving through sequential thinking.
 * Supports branching (exploring alternatives) and revision (correcting earlier thoughts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executePortableTool, type PortableTool, type PortableToolResult } from "@feniix/bridgekit";
import type { TSchema } from "typebox";
import { loadConfig, normalizeNumber } from "./config.js";
import { CODE_REASONING_FLAGS, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.js";
import { createCodeReasoningTools, type MaxLimits } from "./tools.js";

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
export { createCodeReasoningTools } from "./tools.js";
export { createThoughtTracker } from "./tracker.js";

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

type PiContent = { type: "text"; text: string };

type PiToolResult = {
  content: PiContent[];
  details: Record<string, unknown>;
  isError?: true;
};

function toPiDetails(result: PortableToolResult): Record<string, unknown> {
  return result.structuredContent ?? result.details ?? {};
}

function toPiResult(result: PortableToolResult): PiToolResult {
  const piResult = {
    content: [{ type: "text" as const, text: result.text }],
    details: toPiDetails(result),
  };

  if (result.isError) {
    return { ...piResult, isError: true };
  }
  return piResult;
}

function registerCodeReasoningPiTools(pi: ExtensionAPI, tools: readonly PortableTool<TSchema>[]): void {
  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.title,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        const result = await executePortableTool(tool, params, {
          host: "pi",
          signal,
          progress(update) {
            onUpdate?.(toPiResult(update));
          },
        });
        return toPiResult(result);
      },
    });
  }
}

function createPiMaxLimitsResolver(pi: ExtensionAPI): () => MaxLimits {
  let cachedLimits: MaxLimits | undefined;

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

export default function codeReasoning(pi: ExtensionAPI) {
  registerFlags(pi);
  registerCodeReasoningPiTools(pi, createCodeReasoningTools({ getMaxLimits: createPiMaxLimitsResolver(pi) }));
}

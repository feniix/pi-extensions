/**
 * Code Reasoning Extension for pi
 *
 * Provides tools for reflective problem-solving through sequential thinking.
 * Supports branching (exploring alternatives) and revision (correcting earlier thoughts).
 *
 * Pi-side wiring uses bridgekit 0.9.0's registerPiTools adapter directly.
 * Error semantics default to `errorHandling: "return"`, so portable
 * `isError: true` results and TypeBox validation failures surface as
 * `{ content, details, isError: true }` rather than thrown exceptions.
 * This matches bridgekit's MCP adapter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/bridgekit/pi";
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
  const tools = createCodeReasoningTools({ getMaxLimits: createPiMaxLimitsResolver(pi) });
  registerPiTools(pi, tools);
}

/**
 * Sequential Thinking Extension for pi.
 *
 * Provides structured progressive thinking through defined cognitive stages.
 * Tool definitions and handlers live in `./tools.ts` as host-neutral
 * bridgekit PortableTools; this module owns the pi-specific concerns
 * (flag registration, config resolution, output truncation) and wires
 * the portable tools into pi via the pi-output adapter.
 */

import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTools } from "@feniix/bridgekit/pi";
import { ThoughtAnalyzer } from "./analyzer.js";
import { type EffectiveConfigStatus, getHomeDir, loadConfigWithSources, resolveEffectiveConfig } from "./config.js";
import { withPiOutput } from "./pi-output.js";
import { ThoughtStorage } from "./storage.js";
import { createTools } from "./tools.js";

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

  // Resolve config once at extension init. CLI flags, env vars, and settings
  // files are all session-constant for this extension, so re-reading them on
  // every tool invocation is wasted I/O.
  const effectiveConfig = resolveEffectiveConfig({
    flags: {
      storageDir: pi.getFlag("--seq-think-storage-dir"),
      maxBytes: pi.getFlag("--seq-think-max-bytes"),
      maxLines: pi.getFlag("--seq-think-max-lines"),
    },
    env: process.env,
    config: loadConfigWithSources(getConfiguredFile()),
  });

  const storage = new ThoughtStorage(effectiveConfig.storageDir);
  const analyzer = new ThoughtAnalyzer();

  const maxLimits = { maxBytes: effectiveConfig.maxBytes, maxLines: effectiveConfig.maxLines };
  const effectiveConfigForStatus: EffectiveConfigStatus = {
    ...effectiveConfig,
    storageDir: effectiveConfig.storageDir ?? join(getHomeDir(), ".mcp_sequential_thinking"),
  };

  const portableTools = createTools({ storage, analyzer, effectiveConfigForStatus });
  const piTools = portableTools.map((tool) => withPiOutput(tool, { maxLimits }));
  registerPiTools(pi, piTools);
}

export {
  loadConfigWithSources,
  normalizeNumber,
  normalizeString,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveConfig,
  resolveEffectiveLimits,
  splitParams,
} from "./config.js";
export { formatToolOutput, toJsonString, writeTempFile } from "./output.js";
export { isRecord } from "./types.js";

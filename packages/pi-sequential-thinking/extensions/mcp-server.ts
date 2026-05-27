/**
 * MCP stdio server module for pi-sequential-thinking.
 *
 * Reuses the host-neutral createTools() factory from ./tools.ts. The same
 * eight sequential-thinking tools exposed through the pi extension are
 * served here over stdio MCP via @feniix/bridgekit/mcp.
 *
 * Configuration on the MCP side comes from environment variables and pi
 * settings files (.pi/settings.json, ~/.pi/agent/settings.json). CLI
 * flags are pi-only and have no effect here. Output truncation
 * (formatToolOutput) is also pi-only — MCP returns full structured
 * tool output to the client and lets the consuming model decide.
 *
 * This module is strictly import-passive: it exports
 * createMcpServerOptions and runServer for callers. Stdio is started
 * exclusively by bin/pi-sequential-thinking-mcp.js (which uses
 * @feniix/bridgekit/bin-wrapper to import this module and invoke
 * runServer). Tests import the exports directly without side effects.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CreateMcpServerOptions, runMcpStdioServer } from "@feniix/bridgekit/mcp";
import { ThoughtAnalyzer } from "./analyzer.js";
import { type EffectiveConfigStatus, getHomeDir, loadConfigWithSources, resolveEffectiveConfig } from "./config.js";
import { ThoughtStorage } from "./storage.js";
import { createTools, type SequentialThinkingDeps } from "./tools.js";

const SERVER_NAME = "pi-sequential-thinking";
const INSTRUCTIONS =
  "Structured progressive thinking through defined cognitive stages (Problem Definition, " +
  "Research, Analysis, Synthesis, Conclusion). Use process_thought to record individual " +
  "thoughts step by step, sequential_think to scaffold a full staged sequence for a topic, " +
  "and the session helpers (generate_summary, clear_history, export_session, import_session, " +
  "get_thinking_history, get_thinking_status) to inspect and manage stored sessions.";

export interface CreateMcpServerOptionsArgs {
  /** Inject pre-built deps. Useful for tests; omit to derive from env + settings. */
  deps?: SequentialThinkingDeps;
  /** Override the advertised server version. Defaults to the package version. */
  version?: string;
}

function readPackageVersion(): string {
  // Production: this file is dist/extensions/mcp-server.js, so the package
  // root is two directories up. The pi-side never calls this function (the
  // pi entrypoint is extensions/index.ts and bypasses createMcpServerOptions),
  // so we only need the dist-relative layout to work.
  try {
    const fileDir = dirname(fileURLToPath(import.meta.url));
    const packagePath = resolve(fileDir, "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // ignore — fall through to the default below
  }
  return "0.0.0";
}

function buildDefaultDeps(): SequentialThinkingDeps {
  const effectiveConfig = resolveEffectiveConfig({
    flags: {},
    env: process.env,
    config: loadConfigWithSources(undefined),
  });
  const storage = new ThoughtStorage(effectiveConfig.storageDir);
  const analyzer = new ThoughtAnalyzer();
  const effectiveConfigForStatus: EffectiveConfigStatus = {
    ...effectiveConfig,
    storageDir: effectiveConfig.storageDir ?? join(getHomeDir(), ".mcp_sequential_thinking"),
  };
  return { storage, analyzer, effectiveConfigForStatus };
}

export function createMcpServerOptions(args: CreateMcpServerOptionsArgs = {}): CreateMcpServerOptions {
  const deps = args.deps ?? buildDefaultDeps();
  const version = args.version ?? readPackageVersion();
  return {
    name: SERVER_NAME,
    version,
    tools: createTools(deps),
    instructions: INSTRUCTIONS,
  };
}

export async function runServer(): Promise<void> {
  await runMcpStdioServer(createMcpServerOptions());
}

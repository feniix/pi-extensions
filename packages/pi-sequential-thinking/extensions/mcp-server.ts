#!/usr/bin/env node
/**
 * MCP stdio server entrypoint for pi-sequential-thinking.
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
 */

import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
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
  try {
    const packagePath = resolve(fileURLToPath(import.meta.url), "..", "..", "package.json");
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

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  return realpathIfPossible(resolve(entrypoint)) === realpathIfPossible(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  await runServer();
}

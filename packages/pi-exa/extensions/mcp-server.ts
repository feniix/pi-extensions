#!/usr/bin/env node
/**
 * MCP stdio server for pi-exa.
 *
 * Exposes the same portable Exa tools that extensions/index.ts registers
 * with Pi. Tool enablement and API key resolution come from environment
 * variables (and the shared EXA_CONFIG_FILE shape from config.ts) rather
 * than Pi CLI flags. Precedence mirrors the Pi-side `isToolEnabledForConfig`:
 *
 *   1. EXA_ENABLED_TOOLS env (comma-separated allowlist) — overrides
 *      everything else when set.
 *   2. config file's `enabledTools` array — same allowlist semantics.
 *   3. Per-tool env toggles (EXA_ENABLE_ADVANCED, EXA_ENABLE_RESEARCH) and
 *      config file's advancedEnabled / researchEnabled.
 *   4. Default: 8 tools on (4 cheap Exa + 4 planner), 2 hidden
 *      (web_search_advanced_exa, web_research_exa).
 *
 * The module stays import-passive: it only starts stdio when invoked as the
 * main module. Tests import createMcpServerOptions and runServer directly.
 */

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CreateMcpServerOptions, runMcpStdioServer as defaultRunMcpStdioServer } from "@feniix/bridgekit/mcp";
import { type ExaConfig, loadConfig, normalizeString } from "./config.js";
import { createExaTools } from "./tools.js";

const ALWAYS_ON_TOOLS = new Set([
  "web_search_exa",
  "web_fetch_exa",
  "web_answer_exa",
  "web_find_similar_exa",
  "exa_research_step",
  "exa_research_status",
  "exa_research_summary",
  "exa_research_reset",
]);

function readPackageVersion(packageJsonUrl: URL): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, "utf-8"));
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as Record<string, unknown>).version;
      return typeof version === "string" ? version : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function packageVersion(): string {
  return (
    readPackageVersion(new URL("../package.json", import.meta.url)) ??
    readPackageVersion(new URL("../../package.json", import.meta.url)) ??
    "0.0.0"
  );
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function createMcpToolGater(config: ExaConfig | null = null): (name: string) => boolean {
  const envAllowlist = normalizeString(process.env.EXA_ENABLED_TOOLS);
  if (envAllowlist) {
    const allow = parseAllowlist(envAllowlist);
    return (name) => allow.has(name);
  }
  if (config?.enabledTools && config.enabledTools.length > 0) {
    const allow = new Set(config.enabledTools);
    return (name) => allow.has(name);
  }

  const advanced = isTruthyEnv(process.env.EXA_ENABLE_ADVANCED) || config?.advancedEnabled === true;
  const research = isTruthyEnv(process.env.EXA_ENABLE_RESEARCH) || config?.researchEnabled === true;

  return (name) => {
    if (ALWAYS_ON_TOOLS.has(name)) return true;
    if (name === "web_search_advanced_exa") return advanced;
    if (name === "web_research_exa") return research;
    return false;
  };
}

export function createMcpApiKeyResolver(config: ExaConfig | null): () => string | undefined {
  return () => {
    const envKey = normalizeString(process.env.EXA_API_KEY);
    if (envKey) return envKey;
    return normalizeString(config?.apiKey);
  };
}

export function createMcpServerOptions(): CreateMcpServerOptions {
  const config = loadConfig();
  return {
    name: "pi-exa",
    version: packageVersion(),
    tools: createExaTools({
      resolveApiKey: createMcpApiKeyResolver(config),
      isToolEnabled: createMcpToolGater(config),
    }),
    instructions:
      "Use these tools to search the web, fetch URLs, answer factual questions with grounded citations, and plan multi-step research using Exa AI. The four exa_research_* planner tools are local-only and never call Exa.",
  };
}

type RunMcpStdioServer = (options: CreateMcpServerOptions) => Promise<void>;

export async function runServer(runMcpStdioServer: RunMcpStdioServer = defaultRunMcpStdioServer): Promise<void> {
  await runMcpStdioServer(createMcpServerOptions());
}

function realpathIfPossible(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

if (process.argv[1]) {
  const invokedPath = realpathIfPossible(resolve(process.argv[1]));
  const modulePath = realpathIfPossible(fileURLToPath(import.meta.url));
  if (invokedPath === modulePath) {
    await runServer();
  }
}

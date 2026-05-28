/**
 * MCP stdio server for pi-exa.
 *
 * Exposes the same portable Exa tools that extensions/index.ts registers
 * with Pi. Tool enablement and API key resolution come from environment
 * variables (and the shared EXA_CONFIG_FILE shape from config.ts) rather
 * than Pi CLI flags. Precedence mirrors the Pi-side `isToolEnabledForConfig`:
 *
 *   1. EXA_ENABLED_TOOLS env (comma-separated allowlist) — overrides
 *      everything else when set. An EXA_ENABLED_TOOLS string that parses
 *      to an empty allowlist (e.g. ",,,") emits a warning and falls
 *      through to the per-tool toggle defaults.
 *   2. config file's `enabledTools` array — same allowlist semantics. An
 *      empty array means "no tools enabled" — matching the Pi adapter.
 *   3. Per-tool env toggles (EXA_ENABLE_ADVANCED, EXA_ENABLE_RESEARCH) and
 *      config file's advancedEnabled / researchEnabled.
 *   4. Default: 8 tools on (4 cheap Exa + 4 planner), 2 hidden
 *      (web_search_advanced_exa, web_research_exa).
 *
 * EXA_CONFIG is accepted as a deprecated alias for EXA_CONFIG_FILE.
 *
 * The module is strictly import-passive: it exports createMcpServerOptions
 * and runServer for callers. Stdio is started exclusively by bin/pi-exa.js,
 * which imports runServer() and invokes it explicitly. Tests import the
 * exports directly without any side effects.
 */

import { readFileSync } from "node:fs";
import { type CreateMcpServerOptions, runMcpStdioServer as defaultRunMcpStdioServer } from "@feniix/bridgekit/mcp";
import { type ExaConfig, loadConfig, normalizeString } from "./config.js";
import { CROSS_TOOL_GUIDELINES } from "./tool-guidance.js";
import { createExaTools, type ExaToolTimeouts } from "./tools.js";

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
  const version =
    readPackageVersion(new URL("../package.json", import.meta.url)) ??
    readPackageVersion(new URL("../../package.json", import.meta.url));
  if (!version) {
    console.warn(
      "[pi-exa] Unable to resolve package version from neighboring package.json; falling back to 0.0.0. Verify the installed package layout.",
    );
    return "0.0.0";
  }
  return version;
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
    if (allow.size > 0) {
      return (name) => allow.has(name);
    }
    console.warn(
      `[pi-exa] EXA_ENABLED_TOOLS=${JSON.stringify(envAllowlist)} parsed to an empty allowlist; falling back to per-tool toggle defaults.`,
    );
  }
  if (config?.enabledTools) {
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

function parsePositiveIntEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/**
 * Build an ExaToolTimeouts object from EXA_TIMEOUT_MS (generic default) and
 * EXA_RESEARCH_TIMEOUT_MS (web_research_exa override). Returns undefined when
 * neither var is set or both fail to parse — letting createExaTools fall
 * through to its built-in per-tool defaults (60s / 180s).
 */
export function createMcpTimeoutsFromEnv(): ExaToolTimeouts | undefined {
  const def = parsePositiveIntEnv(process.env.EXA_TIMEOUT_MS);
  const research = parsePositiveIntEnv(process.env.EXA_RESEARCH_TIMEOUT_MS);
  if (def === undefined && research === undefined) return undefined;
  const out: ExaToolTimeouts = {};
  if (def !== undefined) out.default = def;
  if (research !== undefined) out.web_research_exa = research;
  return out;
}

export function createMcpServerOptions(): CreateMcpServerOptions {
  // Note: env-driven gating (EXA_API_KEY, EXA_ENABLED_TOOLS, etc.) is captured
  // at construction time. Hosts that need to react to runtime env changes
  // must call createMcpServerOptions() again.
  const config = loadConfig();
  return {
    name: "pi-exa",
    version: packageVersion(),
    tools: createExaTools({
      resolveApiKey: createMcpApiKeyResolver(config),
      isToolEnabled: createMcpToolGater(config),
      timeouts: createMcpTimeoutsFromEnv(),
    }),
    instructions: CROSS_TOOL_GUIDELINES,
  };
}

type RunMcpStdioServer = (options: CreateMcpServerOptions) => Promise<void>;

export async function runServer(runMcpStdioServer: RunMcpStdioServer = defaultRunMcpStdioServer): Promise<void> {
  await runMcpStdioServer(createMcpServerOptions());
}

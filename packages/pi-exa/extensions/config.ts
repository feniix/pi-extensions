/**
 * Configuration loading, authentication resolution, and tool enablement for pi-exa.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExaToolTimeouts } from "./tools.js";

// =============================================================================
// Types
// =============================================================================

export interface ExaConfig {
  apiKey?: string;
  enabledTools?: string[];
  advancedEnabled?: boolean;
  researchEnabled?: boolean;
  cyclesEnabled?: boolean;
  timeoutMs?: number;
  researchTimeoutMs?: number;
  submitTimeoutMs?: number;
  monitorIntervalMs?: number;
}

export interface AuthResolution {
  apiKey: string;
  source?: "CLI flag" | "EXA_API_KEY env var" | "config file";
}

// =============================================================================
// Utilities
// =============================================================================

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

/** Node timers overflow to 1ms above this bound; never accept those values. */
function durationMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : undefined;
}

function durationString(value: unknown): number | undefined {
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? durationMs(Number(value)) : undefined;
}

// =============================================================================
// Config Path Resolution
// =============================================================================

export function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed.startsWith("~/")) {
    return join(getHomeDir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("~")) {
    return join(getHomeDir(), trimmed.slice(1));
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(process.cwd(), trimmed);
}

// =============================================================================
// Config Parsing & Loading
// =============================================================================

export function parseConfig(raw: unknown): ExaConfig {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  return {
    apiKey: normalizeString(obj.apiKey),
    enabledTools: Array.isArray(obj.enabledTools)
      ? obj.enabledTools
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    advancedEnabled: typeof obj.advancedEnabled === "boolean" ? obj.advancedEnabled : false,
    researchEnabled: typeof obj.researchEnabled === "boolean" ? obj.researchEnabled : false,
    cyclesEnabled: typeof obj.cyclesEnabled === "boolean" ? obj.cyclesEnabled : undefined,
    timeoutMs: durationMs(obj.timeoutMs),
    researchTimeoutMs: durationMs(obj.researchTimeoutMs),
    submitTimeoutMs: durationMs(obj.submitTimeoutMs),
    monitorIntervalMs: durationMs(obj.monitorIntervalMs),
  };
}

function loadConfigFile(path: string): ExaConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parseConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-exa] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function loadSettingsConfig(path: string): ExaConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed["pi-exa"];
    if (typeof config !== "object" || config === null) {
      return null;
    }
    const parsedConfig = parseConfig(config);
    if (parsedConfig.apiKey) {
      console.warn(
        `[pi-exa] Loaded apiKey from settings file ${path}. Prefer EXA_API_KEY or --exa-config-file for secrets.`,
      );
    }
    return {
      enabledTools: parsedConfig.enabledTools,
      apiKey: parsedConfig.apiKey,
      advancedEnabled: parsedConfig.advancedEnabled,
      researchEnabled: parsedConfig.researchEnabled,
      cyclesEnabled: parsedConfig.cyclesEnabled,
      timeoutMs: parsedConfig.timeoutMs,
      researchTimeoutMs: parsedConfig.researchTimeoutMs,
      submitTimeoutMs: parsedConfig.submitTimeoutMs,
      monitorIntervalMs: parsedConfig.monitorIntervalMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-exa] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "exa.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "exa.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-exa] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-exa". Keep secrets in EXA_API_KEY or an explicit custom config via --exa-config-file / EXA_CONFIG_FILE.`,
      );
    }
  }
}

export function loadConfig(configPath?: string): ExaConfig | null {
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (process.env.EXA_CONFIG_FILE) {
    return loadConfigFile(resolveConfigPath(process.env.EXA_CONFIG_FILE));
  }
  if (process.env.EXA_CONFIG) {
    console.warn("[pi-exa] EXA_CONFIG is deprecated; use EXA_CONFIG_FILE.");
    return loadConfigFile(resolveConfigPath(process.env.EXA_CONFIG));
  }

  warnIgnoredLegacyConfigFiles();

  const globalSettingsPath = join(getHomeDir(), ".pi", "agent", "settings.json");
  const projectSettingsPath = join(process.cwd(), ".pi", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath);
  const projectConfig = loadSettingsConfig(projectSettingsPath);

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return {
    apiKey: projectConfig?.apiKey ?? globalConfig?.apiKey,
    enabledTools: projectConfig?.enabledTools ?? globalConfig?.enabledTools,
    advancedEnabled: projectConfig?.advancedEnabled ?? globalConfig?.advancedEnabled,
    researchEnabled: projectConfig?.researchEnabled ?? globalConfig?.researchEnabled,
    cyclesEnabled: projectConfig?.cyclesEnabled ?? globalConfig?.cyclesEnabled,
    timeoutMs: projectConfig?.timeoutMs ?? globalConfig?.timeoutMs,
    researchTimeoutMs: projectConfig?.researchTimeoutMs ?? globalConfig?.researchTimeoutMs,
    submitTimeoutMs: projectConfig?.submitTimeoutMs ?? globalConfig?.submitTimeoutMs,
    monitorIntervalMs: projectConfig?.monitorIntervalMs ?? globalConfig?.monitorIntervalMs,
  };
}

// =============================================================================
// Config Flag Helpers
// =============================================================================

let warnedLegacyConfigFlag = false;

function getConfigOverrideFlag(pi: ExtensionAPI): string | undefined {
  const configFileFlag = normalizeString(pi.getFlag("exa-config-file"));
  if (configFileFlag) {
    return configFileFlag;
  }

  const legacyConfigFlag = normalizeString(pi.getFlag("exa-config"));
  if (legacyConfigFlag) {
    // Config is resolved on every tool call; warn once per process, not over the TUI each time.
    if (!warnedLegacyConfigFlag) {
      warnedLegacyConfigFlag = true;
      console.warn("[pi-exa] --exa-config is deprecated; use --exa-config-file.");
    }
    return legacyConfigFlag;
  }

  return undefined;
}

export function getResolvedConfig(pi: ExtensionAPI): ExaConfig | null {
  return loadConfig(getConfigOverrideFlag(pi));
}

export function areCyclesEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const flag = pi.getFlag("exa-enable-cycles");
  return typeof flag === "boolean" ? flag : (config?.cyclesEnabled ?? false);
}

export function resolveRuntimeSettings(
  pi: Pick<ExtensionAPI, "getFlag">,
  config: ExaConfig | null,
): { timeouts?: ExaToolTimeouts; submitTimeoutMs?: number; monitorIntervalMs?: number } {
  const def =
    durationString(pi.getFlag("exa-timeout-ms")) ?? durationString(process.env.EXA_TIMEOUT_MS) ?? config?.timeoutMs;
  const research =
    durationString(pi.getFlag("exa-research-timeout-ms")) ??
    durationString(process.env.EXA_RESEARCH_TIMEOUT_MS) ??
    config?.researchTimeoutMs;
  const timeouts: ExaToolTimeouts = {};
  if (def !== undefined) timeouts.default = def;
  if (research !== undefined) timeouts.web_research_exa = research;
  return {
    timeouts: def === undefined && research === undefined ? undefined : timeouts,
    submitTimeoutMs: durationString(pi.getFlag("exa-submit-timeout-ms")) ?? config?.submitTimeoutMs,
    monitorIntervalMs: durationString(pi.getFlag("exa-monitor-interval-ms")) ?? config?.monitorIntervalMs,
  };
}

// =============================================================================
// Auth Resolution
// =============================================================================

export function resolveAuth(pi: ExtensionAPI): AuthResolution {
  const apiKeyFlag = normalizeString(pi.getFlag("exa-api-key"));
  if (apiKeyFlag) {
    return { apiKey: apiKeyFlag, source: "CLI flag" };
  }

  const configApiKey = normalizeString(getResolvedConfig(pi)?.apiKey);
  if (configApiKey) {
    return { apiKey: configApiKey, source: "config file" };
  }

  const envApiKey = normalizeString(process.env.EXA_API_KEY);
  if (envApiKey) {
    return { apiKey: envApiKey, source: "EXA_API_KEY env var" };
  }

  return { apiKey: "" };
}

export function getAuthStatusMessage(pi: ExtensionAPI): string {
  const auth = resolveAuth(pi);
  return auth.source
    ? `[exa] Authenticated via ${auth.source}`
    : "[exa] Not authenticated. Set EXA_API_KEY or use --exa-api-key flag.";
}

// =============================================================================
// Tool Enablement
// =============================================================================

function isAdvancedToolEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const advancedFlag = pi.getFlag("exa-enable-advanced");
  if (typeof advancedFlag === "boolean") {
    return advancedFlag;
  }
  return config?.advancedEnabled ?? false;
}

function isResearchToolEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const researchFlag = pi.getFlag("exa-enable-research");
  if (typeof researchFlag === "boolean") {
    return researchFlag;
  }
  return config?.researchEnabled ?? false;
}

export function isToolEnabledForConfig(pi: ExtensionAPI, config: ExaConfig | null, toolName: string): boolean {
  if (config?.enabledTools && Array.isArray(config.enabledTools)) {
    return config.enabledTools.includes(toolName);
  }

  if (
    toolName === "web_search_exa" ||
    toolName === "web_fetch_exa" ||
    toolName === "web_answer_exa" ||
    toolName === "web_find_similar_exa" ||
    toolName === "exa_research_step" ||
    toolName === "exa_research_status" ||
    toolName === "exa_research_summary" ||
    toolName === "exa_research_reset"
  ) {
    return true;
  }

  if (toolName === "web_search_advanced_exa") {
    return isAdvancedToolEnabled(pi, config);
  }

  if (toolName === "web_research_exa") {
    return isResearchToolEnabled(pi, config);
  }

  return false;
}

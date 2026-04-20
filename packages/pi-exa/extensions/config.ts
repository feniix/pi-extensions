/**
 * Configuration loading, authentication resolution, and tool enablement for pi-exa.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Types
// =============================================================================

export interface ExaConfig {
  apiKey?: string;
  enabledTools?: string[];
  advancedEnabled?: boolean;
  researchEnabled?: boolean;
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
    return {
      enabledTools: parsedConfig.enabledTools,
      apiKey: parsedConfig.apiKey,
      advancedEnabled: parsedConfig.advancedEnabled,
      researchEnabled: parsedConfig.researchEnabled,
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
  };
}

// =============================================================================
// Config Flag Helpers
// =============================================================================

function getConfigOverrideFlag(pi: ExtensionAPI): string | undefined {
  const configFileFlag = normalizeString(pi.getFlag("--exa-config-file"));
  if (configFileFlag) {
    return configFileFlag;
  }

  const legacyConfigFlag = normalizeString(pi.getFlag("--exa-config"));
  if (legacyConfigFlag) {
    console.warn("[pi-exa] --exa-config is deprecated; use --exa-config-file.");
    return legacyConfigFlag;
  }

  return undefined;
}

export function getResolvedConfig(pi: ExtensionAPI): ExaConfig | null {
  return loadConfig(getConfigOverrideFlag(pi));
}

// =============================================================================
// Auth Resolution
// =============================================================================

export function resolveAuth(pi: ExtensionAPI): AuthResolution {
  const apiKeyFlag = normalizeString(pi.getFlag("--exa-api-key"));
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
  const advancedFlag = pi.getFlag("--exa-enable-advanced");
  if (typeof advancedFlag === "boolean") {
    return advancedFlag;
  }
  return config?.advancedEnabled ?? false;
}

function isResearchToolEnabled(pi: ExtensionAPI, config: ExaConfig | null): boolean {
  const researchFlag = pi.getFlag("--exa-enable-research");
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
    toolName === "web_find_similar_exa"
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

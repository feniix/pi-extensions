import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { DEFAULT_CONFIG_FILE, SETTINGS_KEY } from "./constants.js";

export interface CodeReasoningConfig {
  maxBytes?: number;
  maxLines?: number;
}

export interface OutputLimitRequest {
  maxBytes?: number;
  maxLines?: number;
}

interface JsonReadResult {
  found: boolean;
  value?: unknown;
}

export { DEFAULT_CONFIG_FILE };

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeNumber(value: unknown): number | undefined {
  let parsed: number | undefined;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = Number(value);
  }

  if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function splitParams(params: Record<string, unknown>): {
  toolArgs: Record<string, unknown>;
  requestedLimits: OutputLimitRequest;
} {
  const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
    piMaxBytes?: unknown;
    piMaxLines?: unknown;
  };
  return {
    toolArgs: rest,
    requestedLimits: {
      maxBytes: normalizeNumber(piMaxBytes),
      maxLines: normalizeNumber(piMaxLines),
    },
  };
}

export function resolveEffectiveLimits(
  requested: OutputLimitRequest,
  maxAllowed: { maxBytes: number; maxLines: number },
): { maxBytes: number; maxLines: number } {
  const requestedBytes = requested.maxBytes ?? maxAllowed.maxBytes;
  const requestedLines = requested.maxLines ?? maxAllowed.maxLines;
  return {
    maxBytes: Math.min(requestedBytes, maxAllowed.maxBytes),
    maxLines: Math.min(requestedLines, maxAllowed.maxLines),
  };
}

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

export function parseConfig(raw: unknown, pathHint: string): CodeReasoningConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Code Reasoning config at ${pathHint}: expected an object.`);
  }
  return {
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJsonFile(path: string, label: "config" | "settings"): JsonReadResult {
  try {
    return { found: true, value: JSON.parse(readFileSync(path, "utf-8")) };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { found: false };
    }
    console.warn(`[pi-code-reasoning] Failed to parse ${label} ${path}: ${errorMessage(error)}`);
    return { found: false };
  }
}

function warnInvalidConfig(error: unknown, path: string, label: "config" | "settings"): void {
  console.warn(`[pi-code-reasoning] Failed to parse ${label} ${path}: ${errorMessage(error)}`);
}

function loadConfigFile(path: string): CodeReasoningConfig | null {
  const raw = readJsonFile(path, "config");
  if (!raw.found) {
    return null;
  }

  try {
    return parseConfig(raw.value, path);
  } catch (error) {
    warnInvalidConfig(error, path, "config");
    return null;
  }
}

function loadSettingsConfig(path: string): CodeReasoningConfig | null {
  const raw = readJsonFile(path, "settings");
  if (!raw.found || !isRecord(raw.value)) {
    return null;
  }

  const config = raw.value[SETTINGS_KEY];
  if (!isRecord(config)) {
    return null;
  }

  try {
    return parseConfig(config, path);
  } catch (error) {
    warnInvalidConfig(error, path, "settings");
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "code-reasoning.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "code-reasoning.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-code-reasoning] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "${SETTINGS_KEY}", or pass --code-reasoning-config-file / CODE_REASONING_CONFIG_FILE explicitly.`,
      );
    }
  }
}

export function loadConfig(configPath: string | undefined): CodeReasoningConfig | null {
  const envConfigFile = process.env.CODE_REASONING_CONFIG_FILE;
  const legacyEnvConfig = process.env.CODE_REASONING_CONFIG;
  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFile(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-code-reasoning] CODE_REASONING_CONFIG is deprecated; use CODE_REASONING_CONFIG_FILE.");
    return loadConfigFile(resolveConfigPath(legacyEnvConfig));
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
    maxBytes: projectConfig?.maxBytes ?? globalConfig?.maxBytes,
    maxLines: projectConfig?.maxLines ?? globalConfig?.maxLines,
  };
}

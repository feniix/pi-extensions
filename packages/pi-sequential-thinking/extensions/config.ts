/**
 * Configuration discovery, parsing, and precedence resolution for
 * Sequential Thinking.
 *
 * Per-field precedence is:
 *   1. CLI flags
 *   2. Environment variables
 *   3. Project settings (.pi/settings.json)
 *   4. Global settings (~/.pi/agent/settings.json)
 *   5. Built-in defaults
 *
 * Custom config-file discovery uses --seq-think-config-file then the
 * deprecated --seq-think-config flag, then SEQ_THINK_CONFIG_FILE, then
 * the deprecated SEQ_THINK_CONFIG env var.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isRecord } from "./types.js";

// Inlined so the MCP stdio entrypoint does not transitively load
// @earendil-works/pi-coding-agent — that dependency is an optional peer
// supplied by pi at runtime and is not present in a standalone npm
// install of the MCP bin. The values mirror pi-coding-agent's
// historical defaults (50 KiB / 2000 lines).
const DEFAULT_MAX_BYTES = 51200;
const DEFAULT_MAX_LINES = 2000;

export type ConfigSource = "flag" | "env" | "project_settings" | "global_settings" | "config_file" | "default";

export interface SeqThinkConfig {
  storageDir?: string;
  maxBytes?: number;
  maxLines?: number;
}

export interface EffectiveConfigStatus {
  storageDir?: string;
  maxBytes: number;
  maxLines: number;
  sources: {
    storageDir: ConfigSource;
    maxBytes: ConfigSource;
    maxLines: ConfigSource;
  };
}

export interface SeqThinkConfigWithSources {
  config: SeqThinkConfig;
  sources: Partial<Record<keyof SeqThinkConfig, ConfigSource>>;
}

export interface ResolveEffectiveConfigInput {
  flags?: {
    storageDir?: unknown;
    maxBytes?: unknown;
    maxLines?: unknown;
  };
  env?: Record<string, string | undefined>;
  config?: SeqThinkConfigWithSources | null;
}

export function getHomeDir(): string {
  return process.env.HOME || homedir();
}

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function splitParams(params: Record<string, unknown>): {
  toolArgs: Record<string, unknown>;
  requestedLimits: { maxBytes?: number; maxLines?: number };
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
  requested: { maxBytes?: number; maxLines?: number },
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

export function parseConfig(raw: unknown, pathHint: string): SeqThinkConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Sequential Thinking config at ${pathHint}: expected an object.`);
  }
  return {
    storageDir: normalizeString(raw.storageDir),
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function sourceForConfig(config: SeqThinkConfig, source: ConfigSource): SeqThinkConfigWithSources {
  const sources: SeqThinkConfigWithSources["sources"] = {};
  if (config.storageDir !== undefined) sources.storageDir = source;
  if (config.maxBytes !== undefined) sources.maxBytes = source;
  if (config.maxLines !== undefined) sources.maxLines = source;
  return { config, sources };
}

function loadSettingsConfig(
  path: string,
  source: "project_settings" | "global_settings",
): SeqThinkConfigWithSources | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed)) {
      return null;
    }
    const config = parsed["pi-sequential-thinking"];
    if (!isRecord(config)) {
      return null;
    }
    return sourceForConfig(parseConfig(config, path), source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "sequential-thinking.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "sequential-thinking.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-sequential-thinking] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-sequential-thinking", or pass --seq-think-config-file / SEQ_THINK_CONFIG_FILE explicitly.`,
      );
    }
  }
}

function loadConfigFileWithSources(path: string): SeqThinkConfigWithSources | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return sourceForConfig(parseConfig(parsed, path), "config_file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function mergeConfigWithSources(
  globalConfig: SeqThinkConfigWithSources | null,
  projectConfig: SeqThinkConfigWithSources | null,
): SeqThinkConfigWithSources {
  const config: SeqThinkConfig = {
    storageDir: projectConfig?.config.storageDir ?? globalConfig?.config.storageDir,
    maxBytes: projectConfig?.config.maxBytes ?? globalConfig?.config.maxBytes,
    maxLines: projectConfig?.config.maxLines ?? globalConfig?.config.maxLines,
  };
  return {
    config,
    sources: {
      storageDir: projectConfig?.sources.storageDir ?? globalConfig?.sources.storageDir,
      maxBytes: projectConfig?.sources.maxBytes ?? globalConfig?.sources.maxBytes,
      maxLines: projectConfig?.sources.maxLines ?? globalConfig?.sources.maxLines,
    },
  };
}

export function loadConfigWithSources(configPath: string | undefined): SeqThinkConfigWithSources | null {
  const envConfigFile = process.env.SEQ_THINK_CONFIG_FILE;
  const legacyEnvConfig = process.env.SEQ_THINK_CONFIG;
  if (configPath) {
    return loadConfigFileWithSources(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFileWithSources(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-sequential-thinking] SEQ_THINK_CONFIG is deprecated; use SEQ_THINK_CONFIG_FILE.");
    return loadConfigFileWithSources(resolveConfigPath(legacyEnvConfig));
  }

  warnIgnoredLegacyConfigFiles();

  const projectSettingsPath = join(process.cwd(), ".pi", "settings.json");
  const globalSettingsPath = join(getHomeDir(), ".pi", "agent", "settings.json");

  const globalConfig = loadSettingsConfig(globalSettingsPath, "global_settings");
  const projectConfig = loadSettingsConfig(projectSettingsPath, "project_settings");

  if (!globalConfig && !projectConfig) {
    return null;
  }

  return mergeConfigWithSources(globalConfig, projectConfig);
}

function resolveSource(
  flagValue: unknown,
  envValue: unknown,
  configValue: unknown,
  configSource: ConfigSource | undefined,
): ConfigSource {
  if (flagValue !== undefined) return "flag";
  if (envValue !== undefined) return "env";
  if (configValue !== undefined) return configSource ?? "config_file";
  return "default";
}

export function resolveEffectiveConfig(input: ResolveEffectiveConfigInput = {}): EffectiveConfigStatus {
  const flags = input.flags ?? {};
  const env = input.env ?? process.env;
  const config = input.config;

  const flagStorageDir = normalizeString(flags.storageDir);
  const envStorageDir = normalizeString(env.MCP_STORAGE_DIR);
  const configStorageDir = config?.config.storageDir;

  const flagMaxBytes = normalizeNumber(flags.maxBytes);
  const envMaxBytes = normalizeNumber(env.SEQ_THINK_MAX_BYTES);
  const configMaxBytes = config?.config.maxBytes;

  const flagMaxLines = normalizeNumber(flags.maxLines);
  const envMaxLines = normalizeNumber(env.SEQ_THINK_MAX_LINES);
  const configMaxLines = config?.config.maxLines;

  const storageDir = flagStorageDir ?? envStorageDir ?? configStorageDir;

  return {
    storageDir: storageDir ? resolveConfigPath(storageDir) : undefined,
    maxBytes: flagMaxBytes ?? envMaxBytes ?? configMaxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: flagMaxLines ?? envMaxLines ?? configMaxLines ?? DEFAULT_MAX_LINES,
    sources: {
      storageDir: resolveSource(flagStorageDir, envStorageDir, configStorageDir, config?.sources.storageDir),
      maxBytes: resolveSource(flagMaxBytes, envMaxBytes, configMaxBytes, config?.sources.maxBytes),
      maxLines: resolveSource(flagMaxLines, envMaxLines, configMaxLines, config?.sources.maxLines),
    },
  };
}

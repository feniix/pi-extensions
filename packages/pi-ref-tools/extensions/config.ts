import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { DEFAULT_ENDPOINT, DEFAULT_PROTOCOL_VERSION, DEFAULT_TIMEOUT_MS } from "./constants.js";
import { isRecord, normalizeNumber, normalizeString, parseTimeoutMs } from "./helpers.js";

export interface RefMcpConfig {
  url?: string;
  apiKey?: string;
  timeoutMs?: number;
  protocolVersion?: string;
  maxBytes?: number;
  maxLines?: number;
}

export type ApiKeySource = "CLI flag" | "REF_API_KEY env var" | "config file";

export interface RefRuntimeSettings {
  config: RefMcpConfig | null;
  endpoint: string;
  apiKey?: string;
  apiKeySource?: ApiKeySource;
  maxBytes: number;
  maxLines: number;
  timeoutMs: number;
  protocolVersion: string;
}

function getHomeDir(): string {
  return process.env.HOME || homedir();
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

export function parseConfig(raw: unknown, pathHint: string): RefMcpConfig {
  if (!isRecord(raw)) {
    throw new Error(`Invalid Ref MCP config at ${pathHint}: expected an object.`);
  }

  return {
    url: normalizeString(raw.url),
    apiKey: normalizeString(raw.apiKey),
    timeoutMs: normalizeNumber(raw.timeoutMs),
    protocolVersion: normalizeString(raw.protocolVersion),
    maxBytes: normalizeNumber(raw.maxBytes),
    maxLines: normalizeNumber(raw.maxLines),
  };
}

function loadConfigFile(path: string): RefMcpConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parseConfig(parsed, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-ref-tools] Failed to parse config ${path}: ${message}`);
    return null;
  }
}

function loadSettingsConfig(path: string): RefMcpConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed["pi-ref-tools"];
    if (!isRecord(config)) {
      return null;
    }

    const parsedConfig = parseConfig(config, path);
    return {
      url: parsedConfig.url,
      timeoutMs: parsedConfig.timeoutMs,
      protocolVersion: parsedConfig.protocolVersion,
      maxBytes: parsedConfig.maxBytes,
      maxLines: parsedConfig.maxLines,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-ref-tools] Failed to parse settings ${path}: ${message}`);
    return null;
  }
}

function warnIgnoredLegacyConfigFiles(): void {
  const legacyPaths = [
    join(process.cwd(), ".pi", "extensions", "ref-tools.json"),
    join(getHomeDir(), ".pi", "agent", "extensions", "ref-tools.json"),
  ];

  for (const legacyPath of legacyPaths) {
    if (existsSync(legacyPath)) {
      console.warn(
        `[pi-ref-tools] Ignoring legacy config file ${legacyPath}. Migrate non-secret settings to .pi/settings.json or ~/.pi/agent/settings.json under "pi-ref-tools". Keep secrets in REF_API_KEY or an explicit custom config via --ref-mcp-config-file / REF_MCP_CONFIG_FILE.`,
      );
    }
  }
}

function loadConfig(configPath: string | undefined): RefMcpConfig | null {
  const envConfigFile = process.env.REF_MCP_CONFIG_FILE;
  const legacyEnvConfig = process.env.REF_MCP_CONFIG;

  if (configPath) {
    return loadConfigFile(resolveConfigPath(configPath));
  }
  if (envConfigFile) {
    return loadConfigFile(resolveConfigPath(envConfigFile));
  }
  if (legacyEnvConfig) {
    console.warn("[pi-ref-tools] REF_MCP_CONFIG is deprecated; use REF_MCP_CONFIG_FILE.");
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
    url: projectConfig?.url ?? globalConfig?.url,
    apiKey: projectConfig?.apiKey ?? globalConfig?.apiKey,
    timeoutMs: projectConfig?.timeoutMs ?? globalConfig?.timeoutMs,
    protocolVersion: projectConfig?.protocolVersion ?? globalConfig?.protocolVersion,
    maxBytes: projectConfig?.maxBytes ?? globalConfig?.maxBytes,
    maxLines: projectConfig?.maxLines ?? globalConfig?.maxLines,
  };
}

function getConfigOverride(pi: ExtensionAPI): string | undefined {
  const configFileFlag = pi.getFlag("--ref-mcp-config-file");
  if (typeof configFileFlag === "string") {
    return configFileFlag;
  }

  const legacyConfigFlag = pi.getFlag("--ref-mcp-config");
  if (typeof legacyConfigFlag === "string") {
    console.warn("[pi-ref-tools] --ref-mcp-config is deprecated; use --ref-mcp-config-file.");
    return legacyConfigFlag;
  }

  return undefined;
}

export function loadRuntimeConfig(pi: ExtensionAPI): RefMcpConfig | null {
  return loadConfig(getConfigOverride(pi));
}

export function resolveRuntimeSettings(pi: ExtensionAPI): RefRuntimeSettings {
  const config = loadRuntimeConfig(pi);
  const urlFlag = normalizeString(pi.getFlag("--ref-mcp-url"));
  const envUrl = normalizeString(process.env.REF_MCP_URL);
  const configUrl = normalizeString(config?.url);
  const endpoint = urlFlag ?? envUrl ?? configUrl ?? DEFAULT_ENDPOINT;

  const apiKeyFlag = normalizeString(pi.getFlag("--ref-mcp-api-key"));
  const envApiKey = normalizeString(process.env.REF_API_KEY);
  const configApiKey = normalizeString(config?.apiKey);
  const apiKey = apiKeyFlag ?? envApiKey ?? configApiKey;
  const apiKeySource = apiKeyFlag
    ? "CLI flag"
    : envApiKey
      ? "REF_API_KEY env var"
      : configApiKey
        ? "config file"
        : undefined;

  const maxBytesFlag = normalizeNumber(pi.getFlag("--ref-mcp-max-bytes"));
  const maxLinesFlag = normalizeNumber(pi.getFlag("--ref-mcp-max-lines"));
  const maxBytes =
    maxBytesFlag ?? normalizeNumber(process.env.REF_MCP_MAX_BYTES ?? config?.maxBytes) ?? DEFAULT_MAX_BYTES;
  const maxLines =
    maxLinesFlag ?? normalizeNumber(process.env.REF_MCP_MAX_LINES ?? config?.maxLines) ?? DEFAULT_MAX_LINES;

  const timeoutFlag = pi.getFlag("--ref-mcp-timeout-ms");
  const timeoutValue =
    typeof timeoutFlag === "string" ? timeoutFlag : (process.env.REF_MCP_TIMEOUT_MS ?? config?.timeoutMs);
  const timeoutMs = parseTimeoutMs(timeoutValue, DEFAULT_TIMEOUT_MS);

  const protocolFlag = normalizeString(pi.getFlag("--ref-mcp-protocol"));
  const envProtocol = normalizeString(process.env.REF_MCP_PROTOCOL_VERSION);
  const protocolVersion = protocolFlag ?? envProtocol ?? config?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;

  return {
    config,
    endpoint,
    apiKey,
    apiKeySource,
    maxBytes,
    maxLines,
    timeoutMs,
    protocolVersion,
  };
}

export function formatSessionStartMessage(settings: RefRuntimeSettings): string {
  if (settings.apiKeySource) {
    return `[ref-tools] Connected to ${settings.endpoint} (API key: ${settings.apiKeySource})`;
  }

  return `[ref-tools] No API key configured for ${settings.endpoint}. Set REF_API_KEY or use --ref-mcp-api-key.`;
}

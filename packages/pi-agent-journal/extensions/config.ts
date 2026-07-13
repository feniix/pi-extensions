import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface AgentJournalConfig {
  storageDir: string;
  maxBytes: number;
  maxLines: number;
  maxEntryBytes: number;
  maxCheckpointBytes: number;
}

export const DEFAULT_CONFIG: AgentJournalConfig = {
  storageDir: join(homedir(), ".pi_agent_journal"),
  maxBytes: 51200,
  maxLines: 2000,
  maxEntryBytes: 20000,
  maxCheckpointBytes: 16000,
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string, fallback: number): number | undefined {
  return Object.hasOwn(record, key) ? positiveInteger(record[key], fallback) : undefined;
}

export function parseConfig(value: unknown): Partial<AgentJournalConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const parsed: Partial<AgentJournalConfig> = {};
  if (typeof record.storageDir === "string" && record.storageDir.trim()) parsed.storageDir = record.storageDir.trim();
  const numericSettings = [
    ["maxBytes", DEFAULT_CONFIG.maxBytes],
    ["maxLines", DEFAULT_CONFIG.maxLines],
    ["maxEntryBytes", DEFAULT_CONFIG.maxEntryBytes],
    ["maxCheckpointBytes", DEFAULT_CONFIG.maxCheckpointBytes],
  ] as const;
  for (const [key, fallback] of numericSettings) {
    const setting = optionalPositiveInteger(record, key, fallback);
    if (setting !== undefined) parsed[key] = setting;
  }
  return parsed;
}

export function resolveConfig(input: Partial<AgentJournalConfig> = {}, storageFlag?: string): AgentJournalConfig {
  const storageDir =
    storageFlag ?? process.env.AGENT_JOURNAL_STORAGE_DIR ?? input.storageDir ?? DEFAULT_CONFIG.storageDir;
  return {
    ...DEFAULT_CONFIG,
    ...input,
    storageDir: isAbsolute(storageDir) ? resolve(storageDir) : resolve(process.cwd(), storageDir),
  };
}

export function loadSettings(path: string): Partial<AgentJournalConfig> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return parseConfig(parsed["pi-agent-journal"]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function canonicalPath(path: string): string {
  let candidate = resolve(path);
  const missing: string[] = [];
  while (!existsSync(candidate)) {
    missing.unshift(candidate.slice(dirname(candidate).length + 1));
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  if (existsSync(candidate)) candidate = realpathSync(candidate);
  return resolve(candidate, ...missing);
}

export function assertDistinctStores(piStore: string, mcpStore: string): void {
  if (canonicalPath(piStore) === canonicalPath(mcpStore)) {
    throw new Error("MCP and Pi Agent Journal stores must be distinct");
  }
}

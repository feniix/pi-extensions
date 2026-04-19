/**
 * Notion Extension for pi
 *
 * Features:
 * - SessionStart: checks Notion authentication and prints status
 * - Tool call guardrails: advisory warnings for common Notion mistakes
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Config Paths
// =============================================================================

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

function getConfigDir(): string {
  return join(getHomeDir(), ".pi", "agent", "extensions");
}

function getMcpConfigFile(): string {
  return join(getConfigDir(), "notion-mcp.json");
}

function getTokenFile(): string {
  return join(getConfigDir(), "notion-tokens.json");
}

// =============================================================================
// Token Types
// =============================================================================

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
}

interface NotionUserInfo {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon?: string;
  botId: string;
  ownerEmail?: string;
  ownerName?: string;
}

interface AuthStatus {
  authenticated: boolean;
  workspaceName?: string;
  message: string;
}

// =============================================================================
// Authentication Check
// =============================================================================

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function getMcpConfigAuthStatus(): AuthStatus | null {
  const config = readJsonIfExists<{ accessToken?: string; mcpUrl?: string }>(getMcpConfigFile());
  if (typeof config?.accessToken !== "string" || config.accessToken.trim().length === 0) return null;

  return {
    authenticated: true,
    message: `[notion] MCP config found (${config.mcpUrl ?? "https://mcp.notion.com/mcp"})`,
  };
}

function getOAuthTokenAuthStatus(): AuthStatus | null {
  const tokenFile = getTokenFile();
  const tokens = readJsonIfExists<OAuthTokens>(tokenFile);
  if (!tokens?.accessToken || tokens.expiresAt <= Date.now()) return null;

  const userInfoPath = tokenFile.replace("-tokens.json", "-user.json");
  const userInfo = readJsonIfExists<NotionUserInfo>(userInfoPath);
  if (!userInfo) {
    return {
      authenticated: true,
      message: "[notion] Authenticated (OAuth tokens valid)",
    };
  }

  return {
    authenticated: true,
    workspaceName: userInfo.workspaceName,
    message: `[notion] Authenticated as ${userInfo.workspaceName || "Unknown workspace"}`,
  };
}

function getLegacyEnvAuthStatus(): AuthStatus | null {
  const apiKey = process.env.NOTION_API_KEY ?? process.env.NOTION_TOKEN;
  if (!apiKey) return null;

  return {
    authenticated: false,
    message: process.env.NOTION_API_KEY
      ? "[notion] NOTION_API_KEY detected (legacy direct API token). MCP OAuth is still required: run /notion."
      : "[notion] NOTION_TOKEN detected (legacy). MCP OAuth is still required: run /notion.",
  };
}

function checkNotionAuth(): AuthStatus {
  return (
    getMcpConfigAuthStatus() ??
    getOAuthTokenAuthStatus() ??
    getLegacyEnvAuthStatus() ?? {
      authenticated: false,
      message: "[notion] Not authenticated. Use /notion to connect your Notion workspace.",
    }
  );
}

// =============================================================================
// Tool Call Guardrails
// =============================================================================

type CheckFn = (input: Record<string, unknown>) => string[];

function checkNotionSearch(input: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  if (input.content_search_mode !== "workspace_search") {
    warnings.push(
      "⚠ notion-search: content_search_mode is not 'workspace_search'. Default 'ai_search' returns calendar events. Use 'workspace_search' for workspace content.",
    );
  }

  if (!("filters" in input)) {
    warnings.push("⚠ notion-search: 'filters' key is missing. Add at minimum 'filters': {}.");
  }

  return warnings;
}

function checkNotionFetch(input: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const id = String(input.id ?? "");

  if (!id) return warnings;

  if (id.startsWith("view://")) {
    warnings.push("⚠ notion-fetch: 'view://' URLs can't be fetched — use notion-query-database-view instead.");
  } else if (!id.startsWith("https://") && !id.startsWith("collection://")) {
    warnings.push("⚠ notion-fetch: Using raw ID. Prefer the 'url' field from search results for reliability.");
  }

  return warnings;
}

function checkMeetingNotes(input: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  if (!("filter" in input)) {
    warnings.push(
      '⚠ notion-query-meeting-notes: \'filter\' is required. Use {"filter": {"operator": "and", "filters": []}} at minimum.',
    );
  } else {
    const filter = input.filter as Record<string, unknown> | null;
    if (filter && typeof filter === "object" && !("operator" in filter)) {
      warnings.push(
        '⚠ notion-query-meeting-notes: Empty filter {} will fail. Use {"filter": {"operator": "and", "filters": []}}.',
      );
    }
  }

  return warnings;
}

const toolChecks: Record<string, CheckFn> = {
  "notion-search": checkNotionSearch,
  "notion-fetch": checkNotionFetch,
  "notion-query-meeting-notes": checkMeetingNotes,
};

function extractShortName(toolName: string): string {
  const parts = toolName.split("__");
  return parts.at(-1) ?? toolName;
}

async function handleToolGuardrails(
  event: { toolName: string; input?: Record<string, unknown> },
  ctx: ExtensionContext,
) {
  // Only check Notion MCP tools
  if (!event.toolName.includes("notion")) return;

  const shortName = extractShortName(event.toolName);
  const checkFn = toolChecks[shortName];
  if (!checkFn) return;

  const warnings = checkFn(event.input ?? {});
  if (warnings.length > 0) {
    ctx.ui.notify(`[notion]\n${warnings.join("\n")}`, "warning");
  }
}

// =============================================================================
// Exports
// =============================================================================

export { checkNotionAuth, extractShortName, toolChecks };

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function notion(pi: ExtensionAPI) {
  // SessionStart: check auth and print status
  pi.on("session_start", async () => {
    const auth = checkNotionAuth();
    console.log(auth.message);
  });

  // Tool call: advisory guardrails for Notion tools
  pi.on("tool_call", async (event, ctx) => {
    await handleToolGuardrails(event, ctx);
  });
}

// =============================================================================
// Utility Functions (kept for other extensions/tests)
// =============================================================================

interface NotionConfig {
  token?: string;
}

function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed.startsWith("~/")) return join(getHomeDir(), trimmed.slice(2));
  if (trimmed.startsWith("~")) return join(getHomeDir(), trimmed.slice(1));
  return resolve(process.cwd(), trimmed);
}

function loadConfigFile(path: string): NotionConfig | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as NotionConfig;
  } catch {
    return null;
  }
}

function loadConfig(configPath?: string): NotionConfig | null {
  if (configPath) return loadConfigFile(resolveConfigPath(configPath));
  if (process.env.NOTION_CONFIG) return loadConfigFile(resolveConfigPath(process.env.NOTION_CONFIG));
  return null;
}

interface TitleProp {
  type?: string;
  title?: Array<{ plain_text: string }>;
}

function getTitleFromProperties(properties: Record<string, unknown>): string {
  const titleProp = Object.values(properties).find((p: unknown) => (p as TitleProp)?.type === "title") as
    | TitleProp
    | undefined;
  if (titleProp?.title) {
    return titleProp.title.map((t) => t.plain_text).join("") || "Untitled";
  }
  return "Untitled";
}

function formatPage(page: { id: string; url: string; properties: Record<string, unknown> }) {
  const title = getTitleFromProperties(page.properties);
  return `# Page: ${page.id}\nURL: ${page.url}\nTitle: ${title}\n\n## Properties\n${JSON.stringify(page.properties, null, 2)}`;
}

function formatDatabase(database: {
  id: string;
  title?: Array<{ plain_text: string }>;
  properties: Record<string, unknown>;
}) {
  const title = database.title?.map((t) => t.plain_text).join("") || "Untitled";
  return `# Database: ${database.id}\nTitle: ${title}\n\n## Properties\n${JSON.stringify(database.properties, null, 2)}`;
}

function formatBlocks(result: { results: Array<{ type: string; [key: string]: unknown }> }) {
  if (!result.results?.length) return "No blocks found.";
  return result.results
    .map((block) => {
      const type = block.type || "unknown";
      const content = (block[type] as Record<string, unknown>) || {};
      const text = (content.text as Array<{ plain_text: string }>)?.map((t) => t.plain_text).join("") || "";
      return `[${type}] ${text}`;
    })
    .join("\n");
}

function formatSearch(result: { results: unknown[] }) {
  if (!result.results?.length) return "No results found.";
  return result.results
    .map((item: unknown) => {
      const obj = item as { object: string; id: string; properties?: Record<string, unknown> };
      const type = obj.object;
      const title = obj.properties ? getTitleFromProperties(obj.properties) : "Untitled";
      return `- [${type}] ${title} (${obj.id})`;
    })
    .join("\n");
}

// Re-export utilities
export {
  formatBlocks,
  formatDatabase,
  formatPage,
  formatSearch,
  getTitleFromProperties,
  loadConfig,
  resolveConfigPath,
};

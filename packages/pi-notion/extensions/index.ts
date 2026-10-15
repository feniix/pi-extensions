/**
 * Notion Extension for pi
 *
 * Features:
 * - Registers Notion's hosted MCP server with pi's built-in MCP support, which handles OAuth,
 *   token refresh, reconnects, and tool exposure
 * - Tool call guardrails: advisory warnings for common Notion mistakes
 * - Numeric property coercion: numeric strings in page properties are sent as numbers
 */

import type { ExtensionAPI, ExtensionContext, McpServerConfig } from "@earendil-works/pi-coding-agent";

const NOTION_MCP_SERVER = "notion";
const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

const NOTION_MCP_CONFIG: McpServerConfig = {
  url: NOTION_MCP_URL,
  // 57 tools: declared to the model only after tool_search finds them
  exposure: "deferred",
  description:
    "Notion workspace: search and fetch pages and databases, create and update pages, comments, and meeting notes",
};

// =============================================================================
// Tool names
// =============================================================================

/**
 * Notion's own name for a built-in MCP tool name, or undefined for other tools. Built-in MCP names
 * tools `mcp__<server>__<tool>` with `-` replaced by `_`; any server name matches, since a user may
 * configure Notion under another name in mcp.json.
 */
function notionToolName(toolName: string): string | undefined {
  const match = /^mcp__.+__(notion_[a-z0-9_]+)$/.exec(toolName);
  return match?.[1]?.replaceAll("_", "-");
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

// =============================================================================
// Numeric Property Coercion
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value));
}

function coercePropertyMap(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([propName, propValue]) => [
      propName,
      isNumericString(propValue) ? Number(propValue) : coerceNumericProperties(propValue),
    ]),
  );
}

/** Models often send number properties as strings, which Notion rejects. */
function coerceNumericProperties(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(coerceNumericProperties);
  if (!isRecord(obj)) return obj;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      key === "properties" && isRecord(value) ? coercePropertyMap(value) : coerceNumericProperties(value),
    ]),
  );
}

// =============================================================================
// Tool Call Handler
// =============================================================================

function handleToolCall(event: { toolName: string; input?: Record<string, unknown> }, ctx: ExtensionContext) {
  const name = notionToolName(event.toolName);
  if (!name || !event.input) return;

  // pi runs the call with event.input, so it has to be changed in place
  Object.assign(event.input, coerceNumericProperties(event.input));

  const warnings = toolChecks[name]?.(event.input) ?? [];
  if (warnings.length > 0) {
    ctx.ui.notify(`[notion]\n${warnings.join("\n")}`, "warning");
  }
}

// =============================================================================
// Exports
// =============================================================================

export { coerceNumericProperties, NOTION_MCP_SERVER, NOTION_MCP_URL, notionToolName, toolChecks };

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function notion(pi: ExtensionAPI) {
  if (typeof pi.registerMcpServer !== "function") {
    console.warn("[pi-notion] Notion MCP needs pi 1.1.0 or later, which has built-in MCP support.");
  } else {
    try {
      pi.registerMcpServer(NOTION_MCP_SERVER, NOTION_MCP_CONFIG);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[pi-notion] Could not register the Notion MCP server: ${message}`);
    }
  }

  pi.registerCommand("notion", {
    description: "How to sign in to Notion (handled by pi's built-in MCP support)",
    async handler(_args, ctx) {
      ctx.ui.notify(
        "Notion is served by pi's built-in MCP support. Sign in with /mcp login notion (or `pi mcp login notion` in a shell); /mcp shows its status.",
        "info",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    handleToolCall(event, ctx);
  });
}

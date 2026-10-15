/**
 * Notion Extension for pi
 *
 * Features:
 * - Registers Notion's hosted MCP server with pi's built-in MCP support, which handles OAuth,
 *   token refresh, reconnects, and tool exposure
 * - Tool call guardrails: advisory warnings for common Notion mistakes
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
  "notion-query-meeting-notes": checkMeetingNotes,
};

// =============================================================================
// Tool Call Handler
// =============================================================================

function handleToolCall(event: { toolName: string; input?: Record<string, unknown> }, ctx: ExtensionContext) {
  const name = notionToolName(event.toolName);
  if (!name || !event.input) return;

  const warnings = toolChecks[name]?.(event.input) ?? [];
  if (warnings.length > 0) {
    ctx.ui.notify(`[notion]\n${warnings.join("\n")}`, "warning");
  }
}

// =============================================================================
// Exports
// =============================================================================

export { NOTION_MCP_SERVER, NOTION_MCP_URL, notionToolName, toolChecks };

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

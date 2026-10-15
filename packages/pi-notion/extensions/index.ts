/**
 * Notion Extension for pi
 *
 * Registers Notion's hosted MCP server with pi's built-in MCP support, which handles OAuth,
 * token refresh, reconnects, and tool exposure. The workspace-explorer skill ships alongside.
 */

import type { ExtensionAPI, McpServerConfig } from "@earendil-works/pi-coding-agent";

const NOTION_MCP_SERVER = "notion";
const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

const NOTION_MCP_CONFIG: McpServerConfig = {
  url: NOTION_MCP_URL,
  // 57 tools: declared to the model only after tool_search finds them
  exposure: "deferred",
  description:
    "Notion workspace: search and fetch pages and databases, create and update pages, comments, and meeting notes",
};

export { NOTION_MCP_SERVER, NOTION_MCP_URL };

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
}

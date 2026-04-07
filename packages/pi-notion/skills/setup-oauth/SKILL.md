---
name: setup-oauth
description: Guide the user through setting up Notion MCP with OAuth authentication
---

# Setup Notion MCP

Connect pi to Notion using the official MCP (Model Context Protocol) server with OAuth.

## When to Use

Use this skill when the user:
- Wants to connect pi to Notion
- Says "setup notion", "connect notion", "notion oauth", or similar
- Gets errors about Notion not being configured
- Asks to search or access their Notion workspace

## OAuth Flow

The `/notion` command handles the full OAuth flow automatically:

1. Starts a local callback server on an available port
2. Opens Notion's authorization page in your browser
3. You approve access in the browser
4. Receives the authorization code via callback
5. Exchanges the code for access token
6. Discovers and registers available MCP tools

## Quick Start

### Step 1: Check Current Status

```
Use notion_mcp_status to check if already connected.
```

### Step 2: Connect

```
Run the /notion command to start the OAuth flow.
```

### Step 3: Verify

```
Use notion_mcp_status to verify the connection.
```

## After Connecting

Once connected, use the **workspace-explorer** skill to learn how to:
- Search for pages and databases
- Read page content
- Query databases
- Create and update pages

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection failed | Try again - OAuth may have timed out |
| Token expired | Run `/notion` to re-authenticate |
| Need to switch workspace | Disconnect first, then reconnect |

## Available Tools

### Local tools (always available)
- `notion_mcp_connect` — Connect to Notion via OAuth
- `notion_mcp_disconnect` — Disconnect and clear saved credentials
- `notion_mcp_status` — Check connection status

### MCP tools (auto-discovered after connecting)
These are registered dynamically from Notion's MCP server. Run `notion_mcp_status` to see available tools after connecting.

## Disconnect

```
Use notion_mcp_disconnect to disconnect from Notion MCP.
```

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

1. Starts a local callback server on port 3000
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
| "Port 3000 in use" | Stop the other process using that port, then try again |
| Connection failed | Try again - OAuth may have timed out |
| Token expired | Run `/notion` to re-authenticate |
| Need to switch workspace | Disconnect first, then reconnect |

## Available Tools

### MCP Tools (via `/notion`)
These are discovered automatically after connecting via `/notion`:
- `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`
- `notion-get-database`, `notion-query-database-view`, `notion-query-meeting-notes`
- `notion-get-block-children`, `notion-append-blocks`
- `notion-get-teams`, `notion-get-users`
- `notion-mcp-connect`, `notion-mcp-disconnect`, `notion-mcp-status`

### Direct API Tools (via `notion_oauth_setup`)
These are available when using direct OAuth instead of MCP:
- `notion_oauth_setup`, `notion_oauth_status`, `notion_oauth_logout`
- `notion_search`, `notion_get_page`, `notion_create_page`, `notion_update_page`, `notion_archive_page`
- `notion_get_database`, `notion_query_database`, `notion_create_database`
- `notion_get_block_children`, `notion_append_blocks`
- `notion_get_user`, `notion_get_me`

## Disconnect

```
Use notion_mcp_disconnect to disconnect from Notion MCP.
```

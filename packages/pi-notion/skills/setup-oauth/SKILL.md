---
description: Guide the user through setting up Notion MCP with OAuth authentication
---

# Setup Notion MCP

Connect pi to Notion using the official MCP (Model Context Protocol) server.

## When to Use

Use this skill when the user:
- Wants to connect pi to Notion
- Says "setup notion", "connect notion", "notion oauth", or similar
- Gets errors about Notion not being configured
- Asks to search or access their Notion workspace

## Quick Start

### Step 1: Check Current Status

```
Use notion_mcp_status to check if already connected.
```

### Step 2: Connect (if not connected)

```
Run the /notion command to start the OAuth flow.
```

This will:
1. Register an OAuth client with Notion's MCP server
2. Open Notion's authorization page in your browser
3. Wait for you to approve access and select a workspace
4. Exchange the authorization code for an access token (PKCE)
5. Connect to Notion MCP and discover available tools

### Step 3: Verify

```
Use notion_mcp_status to verify the connection.
```

## Available Tools

### MCP connection tools

| Tool | Description |
|------|-------------|
| `notion_mcp_connect` | Connect to Notion via OAuth |
| `notion_mcp_disconnect` | Disconnect and clear saved credentials |
| `notion_mcp_status` | Check connection status |

### Direct Notion API tools

These use the direct Notion API via OAuth (configured separately with `notion_oauth_setup`):

| Category | Tools |
|----------|-------|
| **Auth** | `notion_oauth_setup`, `notion_oauth_status`, `notion_oauth_logout` |
| **Pages** | `notion_get_page`, `notion_create_page`, `notion_update_page`, `notion_archive_page` |
| **Databases** | `notion_get_database`, `notion_query_database`, `notion_create_database` |
| **Blocks** | `notion_get_block_children`, `notion_append_blocks` |
| **Search** | `notion_search` |
| **Users** | `notion_get_user`, `notion_get_me` |

### MCP tools (auto-discovered after connecting)

These are dynamically registered from the MCP server. Common ones include:

| Category | Tools |
|----------|-------|
| **Search** | `notion-search` |
| **Pages** | `notion-fetch`, `notion-create-pages`, `notion-update-page`, `notion-move-pages`, `notion-duplicate-page` |
| **Databases** | `notion-query-database-view`, `notion-create-database`, `notion-query-meeting-notes` |
| **Views** | `notion-create-view`, `notion-update-view` |
| **Comments** | `notion-create-comment`, `notion-get-comments` |
| **Users** | `notion-get-users`, `notion-get-teams` |
| **Data Sources** | `notion-update-data-source` |

## Example Usage

```
# Search for meeting notes
notion-search: { "query": "meeting notes" }

# Get a page by URL or ID
notion-fetch: { "id": "https://notion.so/Page-Title-abc123" }

# Create a new page
notion-create-pages: { "pages": [{ "properties": { "title": "New Page" } }] }

# Query a database view
notion-query-database-view: { "databaseId": "abc123..." }
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Not connected" | Run `/notion` command |
| Connection failed | Try again — OAuth callback may have timed out (5 min limit) |
| Token expired | Run `/notion` to re-authenticate |
| Port 3000 in use | Free up port 3000 — the OAuth callback server needs it |
| Need to switch workspace | Use `notion_mcp_disconnect` first, then reconnect |

## Disconnect

```
Use notion_mcp_disconnect to disconnect from Notion MCP.
```

## Notes

- Notion MCP uses official Notion OAuth with PKCE (no API key needed)
- Credentials are stored in `~/.pi/agent/extensions/notion-mcp.json`
- The connection persists across sessions via saved credentials
- Available MCP tools depend on what the server exposes at connect time

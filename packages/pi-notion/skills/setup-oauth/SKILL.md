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
1. Open Notion's authorization page in your browser
2. Wait for you to approve access
3. Automatically complete the OAuth flow
4. Connect to Notion MCP

### Step 3: Verify

```
Use notion_mcp_status to verify the connection.
```

## Available Notion Tools

After connecting, you can use:

| Category | Tools |
|----------|-------|
| **Search** | `notion-search` - Search Notion pages |
| **Pages** | `notion-fetch`, `notion-create-pages`, `notion-update-page`, `notion-move-pages`, `notion-duplicate-page` |
| **Databases** | `notion-get-database`, `notion-query-database`, `notion-create-database`, `notion-query-meeting-notes` |
| **Content** | `notion-get-block-children`, `notion-append-blocks` |
| **Users** | `notion-get-users`, `notion-get-teams` |
| **Connectivity** | `notion-mcp-connect`, `notion-mcp-disconnect`, `notion-mcp-status`, `notion-mcp-oauth-setup` |

## Example Usage

```
# Search for meeting notes
notion-search: { "query": "meeting notes" }

# Get a page by URL or ID
notion-fetch: { "id": "https://notion.so/Page-Title-abc123" }

# Create a new page
notion-create-pages: { "pages": [{ "properties": { "title": "New Page" } }] }

# Query a database
notion-query-database: { "databaseId": "abc123..." }
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Not connected" | Run `/notion` command |
| Connection failed | Try again - OAuth may have timed out |
| Token expired | Run `/notion` to re-authenticate |
| Need to switch workspace | Disconnect first, then reconnect |

## Disconnect

```
Use notion_mcp_disconnect to disconnect from Notion MCP.
```

## Notes

- Notion MCP uses official Notion OAuth (no API key needed)
- Tokens are stored securely and auto-refreshed
- The connection persists across sessions
- 16 tools available via MCP

---
name: workspace-explorer
description: Explore and navigate Notion workspaces. Use when searching for pages, understanding database structure, or finding content in Notion.
context: fork
---

# Notion Workspace Explorer

Explore and navigate Notion workspaces after connecting with the setup-oauth skill.

## Prerequisites

Ensure Notion MCP is connected:
```
notion_mcp_status
```
If not connected, use the **setup-oauth** skill first.

## Common Workflows

### 1. Find and Read a Page

```
notion-search: { "query": "quarterly report" }
# Note the page URL or ID from results

notion-fetch: { "id": "https://notion.so/Page-Title-abc123" }
```

### 2. Query a Database

```
notion-get-database: { "databaseId": "xyz789..." }
notion-query-database-view: { "view_url": "https://www.notion.so/workspace/xyz789?v=viewId" }
```

### 3. Get Meeting Notes

```
notion-query-meeting-notes: {}
```

### 4. List Teamspaces and Users

```
notion-get-teams: {}
notion-get-users: {}
```

## Tips

- Pass page URLs directly to `notion-fetch` - no need to extract IDs
- Use `notion-search` for quick discovery across all content
- Add date filters to narrow meeting notes by timeframe
- For database views, use the full view URL from the database page

## Alternative: Direct API Tools

If connected via direct API instead of MCP, use underscore-named tools:
- `notion_search`, `notion_get_page`, `notion_get_database`, `notion_query_database`
- Same workflows apply, just different tool names

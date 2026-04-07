---
name: workspace-explorer
description: Explore and navigate Notion workspaces. Use when searching for pages, understanding database structure, or finding content in Notion.
context: fork
---

# Notion Workspace Explorer

Explore and navigate Notion workspaces using Notion MCP tools.

## Prerequisites

Ensure Notion MCP is connected:
```
notion_mcp_status
```
If not connected, run `/notion` to start the OAuth flow.

## Tool Usage

### 1. Search for Content

Use `notion-search` to find pages/databases:
- `notion-search { "query": "project planning" }` - Search by keyword
- `notion-search { "query": "tasks", "type": "page" }` - Search only pages

### 2. Get Page Content

Use `notion-fetch` to retrieve page details:
```
notion-fetch { "id": "https://notion.so/Page-Title-abc123" }
```

### 3. Explore Database

Use `notion-get-database` to get schema:
```
notion-get-database { "databaseId": "abc123..." }
```

Use `notion-query-database` to query rows:
```
notion-query-database { "databaseId": "abc123...", "pageSize": 10 }
```

### 4. Get Page Blocks

Use `notion-get-block-children`:
```
notion-get-block-children { "blockId": "abc123..." }
```

### 5. Get Current User

Use `notion-get-users` or `notion-get-teams`:
```
notion-get-users
notion-get-teams
```

## Examples

### Find and read a page
```
notion-search { "query": "quarterly report" }
notion-fetch { "id": "abc123..." }
notion-get-block-children { "blockId": "abc123..." }
```

### Explore a database
```
notion-search { "query": "tasks", "data_source_url": "collection://xyz789" }
notion-get-database { "databaseId": "xyz789" }
notion-query-database { "databaseId": "xyz789" }
```

### Get meeting notes
```
notion-query-meeting-notes {}
```

## Tips

- Use `notion-search` for quick search across all content
- Pass page URLs directly to `notion-fetch`
- Add filters to `notion-query-database` for specific results
- Use `notion-get-teams` to find available teamspaces

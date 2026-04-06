---
name: workspace-explorer
description: Explore and navigate Notion workspaces. Use when searching for pages, understanding database structure, or finding content in Notion.
context: fork
---

# Notion Workspace Explorer

Explore and navigate Notion workspaces using native tools.

## Tool Restrictions (Critical)

Use ONLY these tools:
- `notion_search` - Search pages and databases
- `notion_get_page` - Retrieve page details
- `notion_get_database` - Get database schema
- `notion_query_database` - Query database contents
- `notion_get_block_children` - Get page content
- `notion_get_me` - Get current user info

## Workflow

### 1. Identify User and Workspace

Call `notion_get_me` first to confirm authentication.

### 2. Search for Content

Use `notion_search` with a query to find pages/databases:
- `notion_search { query: "project planning" }` - Search by keyword
- `notion_search { query: "meetings", type: "database" }` - Search only databases

### 3. Explore Page Structure

For a found page:
1. `notion_get_page { pageId: "xxx" }` - Get page metadata
2. `notion_get_block_children { blockId: "xxx" }` - Get page content

### 4. Explore Database

For a database:
1. `notion_get_database { databaseId: "xxx" }` - Get schema
2. `notion_query_database { databaseId: "xxx" }` - Query rows

## Examples

### Find a page and read it
```
notion_get_me
notion_search { query: "quarterly report" }
notion_get_page { pageId: "abc123" }
notion_get_block_children { blockId: "abc123" }
```

### Explore a database
```
notion_search { query: "tasks", type: "database" }
notion_get_database { databaseId: "xyz789" }
notion_query_database { databaseId: "xyz789", pageSize: 10 }
```

## Tips

- Use `notion_search` without type filter to search everything
- Add `pageSize` to `query_database` for pagination control
- Block children include paragraphs, headings, lists, etc.

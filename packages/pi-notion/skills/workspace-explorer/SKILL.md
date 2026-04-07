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

## Finding Content

### 1. Search for Pages

```
notion-search: { "query": "quarterly report" }
```

Search returns pages and calendar events. Note page URLs from results.

### 2. Explore a Page

```
notion-fetch: { "id": "https://notion.so/Page-Title-abc123" }
```

Pages often contain:
- Child pages (sub-pages)
- **Databases** (with `collection://` data source URLs)
- Content blocks (text, headings, callouts, etc.)

## Working with Databases

Databases are discovered inside pages, not searchable directly.

### 1. Get Database Schema

```
notion-fetch: { "id": "https://www.notion.so/database-page-url" }
```

The response includes:
- `data-source-url="collection://..."` for the data source ID
- `view url="view://..."` for available views
- SQLite table definition showing schema

### 2. Query a Database View

```
notion-query-database-view: { "view_url": "view://abc123..." }
```

Use the `view://` URL from the database fetch response.

### 3. Get Meeting Notes

```
notion-query-meeting-notes: {}
```

## Finding Teamspaces

### List Teams

```
notion-get-teams: {}
```

Returns teams you're a member of and other workspace teams.

### Get Users

```
notion-get-users: {}
```

## Workflow Examples

### Find PRDs in a Project

```
# Search for the project page
notion-search: { "query": "project name" }

# Fetch the page to discover the PRD database
notion-fetch: { "id": "https://notion.so/project-page-url" }

# Note the view:// URL from the database section
# Then query it
notion-query-database-view: { "view_url": "view://..." }
```

### Browse a Teamspace

```
# Get team ID from notion-get-teams
notion-get-teams: {}

# Search within a teamspace
notion-search: { "query": "topic", "teamspace_id": "team-id" }

# Explore team pages to find databases
notion-fetch: { "id": "https://notion.so/team-homepage-url" }
```

## Tips

- Pass page URLs directly to `notion-fetch` - no need to extract IDs
- Databases are inside pages, not standalone searchable items
- Use `view://` URLs (not page URLs) for `notion-query-database-view`
- Add date filters to `notion-query-meeting-notes` for timeframe filtering

---
name: workspace-explorer
description: "Explore and navigate Notion workspaces via MCP. Use when searching for pages, understanding database structure, finding content, creating or updating pages/databases, or managing Notion workspace content. Triggers when user asks about Notion, mentions Notion pages/databases, wants to find something in their wiki, update a page, add rows to a tracker, query a database, check meeting notes, or when the Notion MCP server is connected. Even if the user doesn't say 'Notion' explicitly — if they mention a wiki, knowledge base, or workspace page, this skill likely applies."
context: fork
---

# Notion Workspace Explorer

Explore and navigate Notion workspaces after connecting with the setup-oauth skill.

For detailed reference on specific operations, see:
- `references/databases.md` — Database schemas, DDL types, views, queries, property formats
- `references/write-operations.md` — Create/update pages, comments, move, duplicate, trash
- `references/failure-modes.md` — Error table and tips (read when something fails)

## Prerequisites

Ensure Notion MCP is connected:
```
notion_mcp_status
```
If not connected, use the **setup-oauth** skill first.

## Search (Critical: Get This Right)

`notion-search` has two modes. **Always specify `content_search_mode` explicitly.**

| Mode | What it returns | Use for |
|------|----------------|---------|
| `workspace_search` | Pages and databases in your workspace | Finding content, discovering databases |
| `ai_search` | Calendar events and connected sources (Slack, Google Drive) | Semantic queries across all integrations |

**Default is `ai_search`**, which mostly returns calendar events — almost never what you want. Always use `workspace_search` unless explicitly looking for calendar/integration data.

### Search the workspace
```
notion-search: {
  "query": "topic",
  "query_type": "internal",
  "content_search_mode": "workspace_search",
  "filters": {},
  "page_size": 25,
  "max_highlight_length": 0
}
```

**Required:** `"filters": {}` must always be present, even when empty. Query must be at least 1 character.

### Narrow search scope

- **By teamspace:** Add `"teamspace_id": "<team-uuid>"` (get IDs from `notion-get-teams`)
- **Within a page:** Add `"page_url": "https://www.notion.so/<page-id>"` to search under that page and its children
- **Within a database:** Use `"data_source_url": "collection://<id>"` to search rows (note: this uses `ai_search` regardless of `content_search_mode`)
- **By date:** Add `"created_date_range": {"start_date": "2026-04-01", "end_date": "2026-04-07"}` inside `filters`
- **By creator:** Add `"created_by_user_ids": ["<user-uuid>"]` inside `filters` (get IDs from `notion-get-users`)

### Search for users
```
notion-search: {
  "query": "Sebastian",
  "query_type": "user",
  "filters": {}
}
```

Results are capped at `page_size` (max 25) with no pagination cursor.

## Fetching Content

**Always use the `url` field from search results** — raw `id` values often fail.

```
notion-fetch: { "id": "https://www.notion.so/<page-url-from-search>" }
```

Pages return Notion-flavored markdown with `<ancestor-path>` (parent hierarchy), `<content>` (page body), and child `<page>` elements.

**Options:**
- `"include_discussions": true` — include inline comment threads
- `"include_transcript": true` — for meeting pages with audio/video

**Cannot fetch:** Team/teamspace IDs (use `notion-get-teams` + search instead) or `view://` URLs (use `notion-query-database-view` instead).

## Working with Databases

### Disambiguating similar database names

Workspaces often have databases with similar or identical names across different projects (e.g., "Tasks" under Project A and "Tasks" under Project B). When search returns multiple databases with similar names:

1. **Check the `ancestor-path`** — after fetching each database, look at the `<ancestor-path>` in the response to see which parent page it belongs to
2. **Confirm with the user** before writing — say which database you found and its parent (e.g., "I found 'Tasks' under 'Evie Platform' — is that the right one?")
3. **Never assume** — if two results look similar, always ask rather than picking one

### The standard workflow

```
# 1. Find the database
notion-search: {
  "query": "project name",
  "query_type": "internal",
  "content_search_mode": "workspace_search",
  "filters": {},
  "page_size": 25,
  "max_highlight_length": 0
}

# 2. Fetch schema — get data source and view URLs
notion-fetch: { "id": "<database-url-from-search>" }

# 3. Query the database view
notion-query-database-view: { "view_url": "view://<view-id-from-fetch>" }
```

**Key things to know:**
- `notion-query-database-view` does NOT accept filter/sort params — it uses the view's saved config
- To filter/sort: create a new view with `notion-create-view` first, then query it
- `view://` URLs come from fetching a database, not from search results
- Database schemas are in SQLite DDL format

For creating databases, modifying schemas, creating views, and property value formats, read `references/databases.md`.

## Creating and Updating Pages

### Quick page creation
```
notion-create-pages: {
  "pages": [{
    "properties": {"title": "Page Title"},
    "content": "## Heading\nParagraph text.\n\n- item 1\n- item 2"
  }],
  "parent": {"type": "page_id", "page_id": "<parent-page-uuid>"}
}
```

Use H2+ in content — H1 is stripped (the page title serves as H1). `content` is optional. The `parent` is top-level (not inside each page) and supports `page_id`, `database_id`, or `data_source_id`.

### Quick page update (search-and-replace)
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_content",
  "properties": {},
  "content_updates": [{"old_str": "original text", "new_str": "replacement text"}]
}
```

Other commands: `update_properties`, `replace_content`, `apply_template`, `update_verification`. For full details, read `references/write-operations.md`.

## Other Tools

### Teams and users
- `notion-get-teams: {}` — list teamspaces (filter with `"query": "name"`)
- `notion-get-users: {}` — list workspace users (filter with `"query": "name"`)
- `notion-get-users: { "user_id": "self" }` — get current authenticated user

### Meeting notes
`notion-query-meeting-notes` requires a filter with an `operator` — empty `{}` will fail:
```
notion-query-meeting-notes: {
  "filter": { "operator": "and", "filters": [] }
}
```

### Comments, move, duplicate, trash
See `references/write-operations.md` for the full API.

## When Something Goes Wrong

Read `references/failure-modes.md` for a comprehensive error table. The most common mistakes:

1. **Forgetting `content_search_mode: "workspace_search"`** — you'll only get calendar events
2. **Using `id` instead of `url` from search results** — `object_not_found`
3. **SELECT values not in schema** — fetch schema first, add options with `notion-update-data-source`
4. **Empty filter `{}` on meeting notes** — must have `operator` and `filters` keys
5. **Trying to fetch `view://` URLs** — use `notion-query-database-view` instead
6. **Token expired (401)** — run `/notion` to re-authenticate

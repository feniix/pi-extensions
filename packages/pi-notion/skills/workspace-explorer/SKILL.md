---
name: workspace-explorer
description: "Explore and navigate Notion workspaces via MCP. Use when searching for pages, understanding database structure, finding content, creating or updating pages/databases, or managing Notion workspace content. Triggers when user asks about Notion, mentions Notion pages/databases, wants to find something in their wiki, update a page, add rows to a tracker, query a database, check meeting notes, or when the Notion MCP server is connected. Even if the user doesn't say 'Notion' explicitly — if they mention a wiki, knowledge base, or workspace page, this skill likely applies."
context: fork
---

# Notion Workspace Explorer

Explore and navigate Notion workspaces through Notion's MCP server, which pi connects with its built-in MCP support.

For detailed reference on specific operations, see:
- `references/databases.md` — Database schemas, DDL types, views, queries, property formats
- `references/write-operations.md` — Create/update pages, comments, move, duplicate, trash
- `references/failure-modes.md` — Error table and tips (read when something fails)

## Prerequisites

Notion's tools are named `mcp__notion__<tool>`, with `-` replaced by `_`: `notion-search` is `mcp__notion__notion_search`. This skill uses Notion's own names. They are deferred: load the ones you need with `tool_search` before calling them, or call them from a `codemode` script.

`tool_search` ranks by matching words, not exact names, so a tool's own name often loads a similar tool instead (`notion-query-data-sources` loads `notion-query-multiple-data-sources`). These queries load the right tool, also with a `mcp__notion` prefix. Before the first Notion call, load every tool the task needs at once: send these `tool_search` calls in parallel, each with `"limit": 1`:

| Tool | `tool_search` query |
|---|---|
| `notion-search` | `search connected sources` |
| `notion-fetch` | `notion fetch` |
| `notion-query-data-sources` | `faithful structured rows` |
| `notion-query-meeting-notes` | `query meeting notes` |

If no Notion tools are found, or calls fail because Notion needs sign-in, ask the user to run `/mcp login notion`. Do not try to sign in yourself.

A user with several Notion workspaces has one server per workspace, such as `mcp__notion__*` and `mcp__notion_work__*`. Use the server whose name or description matches the workspace the user means; if that is unclear, ask which workspace before calling. Pages and IDs from one workspace do not exist in another.

## Search

Start with just a query; add other parameters only to narrow the search:

```
notion-search: { "query": "Estimation Platform Proposal" }
```

Without filters, `notion-search` ranks Notion pages by meaning and also returns connected sources such as Google Drive and Slack; each result's `type` says where it came from (for example `page` or `google-drive`). Any filter, or a sort other than relevance, returns Notion results only, matched on keywords.

### Narrow search scope

- **Within a page:** `"page_url": "<page-url-or-id>"` searches that page and its children
- **Within a database:** `"data_source_url": "collection://<id>"` searches its rows
- **By teamspace:** `"teamspace_id": "<team-uuid>"` (get IDs from `notion-get-teams`)
- **By date:** `"filters": {"created_date_range": {"start_date": "2026-04-01", "end_date": "2026-04-07"}}`
- **By creator:** `"filters": {"created_by_user_ids": ["<user-uuid>"]}` (`"me"` for the signed-in user)
- `"max_highlight_length": 0` keeps responses small; `page_size` goes up to 50

### Search for users
```
notion-search: { "query": "Sebastian", "query_type": "user" }
```

## Fetching Content

Pass the `url` field from search results, or the page's ID (with or without dashes). Both work.

```
notion-fetch: { "id": "https://www.notion.so/<page-url-from-search>" }
```

Pages return Notion-flavored markdown with `<ancestor-path>` (parent hierarchy), `<content>` (page body), and child `<page>` elements.

**Options:**
- `"include_discussions": true` — include inline comment threads
- `"include_transcript": true` — for meeting pages with audio/video

**Cannot fetch:** Team/teamspace IDs (use `notion-get-teams` + search instead).

**`view://` URLs:** fetching one returns the view's definition (its `collection://` data source, displayed properties, and type), not its rows. Use `notion-query-data-sources` for the rows.

## Working with Databases

### Disambiguating similar database names

Workspaces often have databases with similar or identical names across different projects (e.g., "Tasks" under Project A and "Tasks" under Project B). When search returns multiple databases with similar names:

1. **Check the `ancestor-path`** — after fetching each database, look at the `<ancestor-path>` in the response to see which parent page it belongs to
2. **Confirm with the user** before writing — say which database you found and its parent (e.g., "I found 'Tasks' under 'Evie Platform' — is that the right one?")
3. **Never assume** — if two results look similar, always ask rather than picking one

### The standard workflow

```
# 1. Find the database
notion-search: { "query": "PRDs" }

# 2. Fetch it: the schema (<sqlite-table>), its collection:// data source URL, and its views
notion-fetch: { "id": "<database-url-from-search>" }

# 3a. Filter and sort with SQL, using the column names from <sqlite-table>
notion-query-data-sources: { "data": {
  "data_source_urls": ["collection://<id>"],
  "query": "SELECT * FROM \"collection://<id>\" WHERE \"Status\" != ? ORDER BY \"date:Date:start\" DESC LIMIT 20",
  "params": ["Done"]
} }

# 3b. Or read a saved view's rows, with its own filters and sorts
notion-query-data-sources: { "data": { "mode": "view", "view_url": "<view-url-from-fetch>" } }
```

**Key things to know:**
- All arguments go inside `data`; leaving it out fails with `data: must have required properties data`
- SQL is the default mode and is read-only. Use only the table and column names the fetch shows; date columns expand to `date:<Name>:start` and `date:<Name>:end`
- `"mode": "rows"` with `data_source_url`, `filter`, and `sort` returns rows with rich text, links, and mentions intact; use it before rewriting a rich-text property
- Do not create a view just to filter rows; SQL or rows mode filters without changing the workspace
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
For meeting notes, use `notion-query-meeting-notes`, not search: it queries Notion's AI meeting notes directly and is much faster. Filter by date, title, or attendees; with no `filter` it returns recent meeting notes.
```
notion-query-meeting-notes: {
  "filter": { "operator": "and", "filters": [
    { "property": "created_time", "filter": { "operator": "date_is_within", "value": { "type": "relative", "value": "the_past_month" } } }
  ] }
}
```
It covers only Notion's AI meeting notes. If it returns nothing and the user keeps meeting notes as ordinary pages, say so and offer to search for them.

### Comments, move, duplicate, trash
See `references/write-operations.md` for the full API.

## When Something Goes Wrong

Read `references/failure-modes.md` for a comprehensive error table. The most common mistakes:

1. **Leaving out `data` in `notion-query-data-sources`** — every argument goes inside `"data": { ... }`
2. **Guessing SQL column names** — fetch the database first and use the names in `<sqlite-table>`
3. **SELECT values not in schema** — fetch schema first, add options with `notion-update-data-source`
4. **Searching for meeting notes** — use `notion-query-meeting-notes`
5. **Fetching a `view://` URL to read rows** — it returns the view's definition only; use `notion-query-data-sources` for the rows
6. **Sign-in expired (401 after pi's automatic refresh)** — ask the user to run `/mcp login notion`

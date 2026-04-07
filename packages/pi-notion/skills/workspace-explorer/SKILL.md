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

## Search Modes (Critical)

`notion-search` has two modes. **Always specify `content_search_mode` explicitly.**

| Mode | What it returns | Use for |
|------|----------------|---------|
| `workspace_search` | Pages and databases in your workspace | Finding content, discovering databases |
| `ai_search` | Calendar events and connected sources (Slack, Google Drive) | Semantic queries across all integrations |

**Default is `ai_search`**, which mostly returns calendar events — not what you usually want.

## Finding Pages and Databases

### Search a Teamspace

```
# 1. Get teamspace IDs
notion-get-teams: {}

# 2. Search within a teamspace
notion-search: {
  "query": "project name",
  "query_type": "internal",
  "teamspace_id": "<team-uuid>",
  "content_search_mode": "workspace_search",
  "filters": {},
  "page_size": 25,
  "max_highlight_length": 0
}
```

Results include both pages (`"type": "page"`) and databases (`"type": "database"`).

### Search the Whole Workspace

Omit `teamspace_id`:
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

### Search Within a Page

Scoped search under a specific page and its children:
```
notion-search: {
  "query": "architecture",
  "query_type": "internal",
  "page_url": "https://www.notion.so/<page-id>",
  "content_search_mode": "workspace_search",
  "filters": {},
  "page_size": 10,
  "max_highlight_length": 0
}
```

### Search Within a Database (Data Source)

Search rows inside a specific database using its `collection://` URL:
```
notion-search: {
  "query": "Chicago",
  "data_source_url": "collection://3372e80c-997d-80bd-abee-000bc4bf4cd1",
  "filters": {},
  "page_size": 10,
  "max_highlight_length": 0
}
```

Note: `data_source_url` searches use `ai_search` mode regardless of `content_search_mode`.

### Search with Date Filters

```
notion-search: {
  "query": "Evie",
  "query_type": "internal",
  "content_search_mode": "workspace_search",
  "filters": {
    "created_date_range": {
      "start_date": "2026-04-01",
      "end_date": "2026-04-07"
    }
  },
  "page_size": 10,
  "max_highlight_length": 0
}
```

### Search by Creator

```
notion-search: {
  "query": "Evie",
  "query_type": "internal",
  "content_search_mode": "workspace_search",
  "filters": {
    "created_by_user_ids": ["<user-uuid>"]
  },
  "page_size": 10,
  "max_highlight_length": 0
}
```

Get user UUIDs from `notion-get-users` or `notion-search` with `query_type: "user"`.

### Search for Users

```
notion-search: {
  "query": "Sebastian",
  "query_type": "user",
  "filters": {}
}
```

Returns user IDs, names, and emails in `user://` format.

## Fetching Content

### Fetch a Page

Use the `url` field from search results (not the `id` field — raw IDs often fail):
```
notion-fetch: { "id": "https://www.notion.so/<page-url-from-search>" }
```

Pages return Notion-flavored markdown with:
- `<ancestor-path>` — parent page hierarchy
- `<content>` — page body (headings, text, links, child pages)
- Child `<page>` elements for sub-pages

### Fetch with Discussions

Include inline comment threads in the response:
```
notion-fetch: { "id": "https://www.notion.so/<page-id>", "include_discussions": true }
```

Adds `<page-discussions>` tag with discussion threads and comment counts.

### Fetch with Transcript

For meeting pages with audio/video content:
```
notion-fetch: { "id": "https://www.notion.so/<meeting-page-id>", "include_transcript": true }
```

### Fetch a Data Source Schema

Use the `collection://` URL from a database fetch:
```
notion-fetch: { "id": "collection://3372e80c-997d-80bd-abee-000bc4bf4cd1" }
```

Returns the data source schema, property definitions, and SQLite DDL — same schema info as fetching the parent database but without view information.

### What notion-fetch CANNOT fetch
- **Team/teamspace IDs** — these are not pages. Use `notion-get-teams` and `notion-search` with `teamspace_id` instead.
- **`view://` URLs** — returns "URL type webpage not currently supported". Use `notion-query-database-view` to query views instead.

## Working with Databases

### 1. Discover Databases

Use `workspace_search` — databases appear with `"type": "database"` in results.

### 2. Fetch Database Schema

```
notion-fetch: { "id": "<database-url-from-search>" }
```

Returns:
- `<data-source url="collection://...">` — the data source ID for queries
- `<sqlite-table>` — CREATE TABLE DDL showing column names and types
- `<view url="view://...">` — available view IDs with display properties
- `<data-source-state>` — property definitions with types and options

### 3. Query a Database View

Use the `view://` URL from the database fetch response:
```
notion-query-database-view: {
  "view_url": "view://3372e80c-997d-8090-8144-000c95adf05a"
}
```

**Failure mode:** If the `view://` URL alone doesn't work, try the full database URL with `?v=` query param.

Returns rows as JSON objects with column values.

**Note:** `notion-query-database-view` does NOT accept filter or sort parameters — it returns all rows using the view's saved configuration. To filter/sort, create a new view with `notion-create-view` with the desired configuration.

## Meeting Notes

`notion-query-meeting-notes` requires a `filter` with an `operator`. **Empty `{}` will fail.**

### Get all meeting notes (with required filter structure)
```
notion-query-meeting-notes: {
  "filter": { "operator": "and", "filters": [] }
}
```

### Filter meeting notes by date
```
notion-query-meeting-notes: {
  "filter": {
    "operator": "and",
    "filters": [{
      "property": "Created time",
      "date": { "after": "2026-03-20" }
    }]
  }
}
```

Returns meeting entries with Title, Created time, Attendees (as `user://` refs), and URLs.

## Comments

### Get comments on a page
```
notion-get-comments: {
  "page_id": "<page-uuid>"
}
```

**Optional params:**
- `include_resolved: true` — include resolved discussions (hidden by default)
- `include_all_blocks: true` — include comments on all blocks, not just page-level
- `discussion_id: "discussion://..."` — fetch a specific discussion thread

Returns `{}` when no comments exist. Returns XML-like `<discussions>` with threads when present.

### Create a comment
```
notion-create-comment: {
  "page_url": "https://www.notion.so/<page-id>",
  "comment_text": "Your comment here"
}
```

### Reply to an existing discussion

Get the `discussion://` ID from `notion-get-comments`, then pass it:
```
notion-create-comment: {
  "page_url": "https://www.notion.so/<page-id>",
  "discussion_id": "discussion://<page-id>/<page-id>/<discussion-id>",
  "comment_text": "Reply text"
}
```

## Other Read Tools

### List Teamspaces
```
notion-get-teams: {}
```
Returns `yourTeams` (member/owner) and `otherTeams` (visible but not joined). Each has `id`, `name`, `role`, `in_trash`.

Filter by name:
```
notion-get-teams: { "query": "Evie" }
```

### List Users
```
notion-get-users: {}
```
Returns all workspace users (people and bots) with `id`, `name`, `email`, `type`.

Filter by name/email:
```
notion-get-users: { "query": "Sebastian" }
```

Get current authenticated user:
```
notion-get-users: { "user_id": "self" }
```

Supports pagination via `start_cursor` and `page_size` (max 100).

## Write Tools

### Create Pages

```
notion-create-pages: {
  "pages": [{
    "url": "https://www.notion.so/<parent-page-id>",
    "title": "Page Title",
    "content_markdown": "# Heading\nParagraph text.\n\n- item 1\n- item 2"
  }]
}
```

Returns created page `id`, `url`, and `properties`. Can create multiple pages in one call. `content_markdown` is optional — omit it to create a blank page.

**Supported markdown elements:**
- Headings: H2, H3 (H1 is stripped — Notion uses it as the page title)
- **Bold**, *italic*, ~~strikethrough~~, `inline code`
- Horizontal rules (`---`)
- Blockquotes (`>`)
- Numbered lists (with nesting)
- Bullet lists (with nesting)
- Todo checkboxes (`- [ ]` and `- [x]`)
- Code blocks with language (` ```python `)
- Tables (markdown pipe format)
- Links (`[text](url)`)
- Images (`![alt](url)`)

**Note:** H1 headings in `content_markdown` are dropped — the page title serves as H1.

### Add a Row to a Database

Database rows are pages with a database as parent. Use the database URL and pass properties matching the schema:

```
# 1. Fetch the database schema first
notion-fetch: { "id": "https://www.notion.so/<database-id>" }

# 2. Check that SELECT properties have the options you need
#    If not, add them first:
notion-update-data-source: {
  "data_source_url": "collection://<data-source-id>",
  "schema_ddl": "ALTER TABLE ... ADD OPTION 'In Progress' TO \"Status\""
}

# 3. Create the row
notion-create-pages: {
  "pages": [{
    "url": "https://www.notion.so/<database-id>",
    "title": "Row Name",
    "properties": {
      "Status": "In Progress",
      "Priority": 1
    }
  }]
}
```

**Property value formats when creating/updating rows:**

| Type | Format | Example |
|------|--------|---------|
| TITLE | String | `"Name": "My Item"` |
| RICH_TEXT | String | `"Description": "Some text"` |
| NUMBER | JSON number | `"Priority": 1` (must be actual number, not string) |
| SELECT | String (must match existing option) | `"Status": "In Progress"` |
| MULTI_SELECT | JSON array of strings (each must match existing option) | `"Tags": ["urgent", "backend"]` |
| CHECKBOX | `"__YES__"` or `"__NO__"` | `"Done": "__YES__"` |
| DATE | Use expanded property name | `"date:Due:start": "2026-05-01"` |
| URL | String | `"Link": "https://example.com"` |
| EMAIL | String | `"Email": "test@example.com"` |
| PHONE_NUMBER | String | `"Phone": "123-456-7890"` |
| STATUS | String (must match existing option) | `"Workflow": "In progress"` |
| PEOPLE | JSON array of user IDs | `"Assigned": ["user://e75fdefe-..."]` |

**Failure modes:**
- SELECT/MULTI_SELECT/STATUS values must match existing options — update schema first to add new options
- NUMBER values must be actual JSON numbers, not strings
- MULTI_SELECT values must be a JSON array, not a single string
- Archived pages can still be fetched and updated

### Update Page

`notion-update-page` supports 5 commands via the `command` parameter:

**Update properties** (title, database fields):
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_properties",
  "properties": {"title": "New Title"},
  "content_updates": []
}
```

**Replace entire content:**
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "replace_content",
  "new_str": "# New Content\n\nThis replaced everything.",
  "properties": {},
  "content_updates": []
}
```

**Search-and-replace within content:**
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_content",
  "properties": {},
  "content_updates": [{"old_str": "original text", "new_str": "replacement text"}]
}
```

Multiple replacements can be passed in the `content_updates` array.

**Set icon and cover:**
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_properties",
  "properties": {},
  "content_updates": [],
  "icon": "🧪",
  "cover": "https://images.unsplash.com/photo-example?w=1200"
}
```

Icon accepts emoji, custom emoji (`:rocket_ship:`), or image URL. Cover accepts image URL or `"none"` to remove.

Other commands: `apply_template` (with `template_id`), `update_verification` (with `verification_status`).

## Deleting Content (Trash / Restore)

There is **no permanent delete** via the MCP API. All deletion is soft delete (trash), which is recoverable.

### Trash a page
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_properties",
  "properties": {},
  "content_updates": [],
  "in_trash": true
}
```

### Restore a page from trash
```
notion-update-page: {
  "page_id": "<page-uuid>",
  "command": "update_properties",
  "properties": {},
  "content_updates": [],
  "in_trash": false
}
```

### Trash a database
```
notion-update-data-source: {
  "data_source_id": "collection://<id>",
  "in_trash": true
}
```

**Note:** Restoring a database with `in_trash: false` may not fully work — the command succeeds but the database may still show as deleted. Restoring databases is best done through the Notion UI.

### What doesn't work for deletion
- `archived: true` on `notion-update-page` — does not trash or delete
- No `delete` command exists — only soft delete via `in_trash`
- Trashed pages are still fetchable via `notion-fetch`
- Permanent deletion is only available through the Notion UI (Trash → Delete permanently)

### Duplicate a Page

```
notion-duplicate-page: {
  "page_url": "https://www.notion.so/<page-id>"
}
```

Returns `page_id` and `page_url` of the duplicate. The duplicate is always created as a sibling (same parent). **There is no parameter to specify a different parent** — to move it after duplicating, use `notion-move-pages`.

### Move Pages

```
notion-move-pages: {
  "page_urls": ["https://www.notion.so/<page-id>"],
  "target_url": "https://www.notion.so/<target-parent-id>"
}
```

Supports moving multiple pages in one call. Also works with databases (not just pages). Returns success message. If pages are already at the target location, returns "item was already in the target location".

**Failure mode:** Invalid target returns "Could not load new parent...or missing edit permission".

### Create a Database

Uses Notion-flavored DDL — **not standard SQL types**.

Available column types:

| DDL Type | Notion Type | Notes |
|----------|-------------|-------|
| `TITLE` | Title | Required — one per database |
| `RICH_TEXT` | Text | Maps to `text` type |
| `NUMBER` | Number | Maps to `FLOAT` in SQLite DDL |
| `SELECT` | Select | Options added separately via `notion-update-data-source` |
| `MULTI_SELECT` | Multi-select | JSON array of values |
| `DATE` | Date | Expands to `date:ColName:start`, `date:ColName:end`, `date:ColName:is_datetime` |
| `CHECKBOX` | Checkbox | Values: `"__YES__"` = true, `"__NO__"` = false |
| `URL` | URL | |
| `EMAIL` | Email | |
| `PHONE_NUMBER` | Phone | |
| `PEOPLE` | Person | JSON array of `user://` IDs |
| `FILES` | Files | JSON array of file IDs |
| `STATUS` | Status | Auto-creates groups: to_do, in_progress, complete with default options |

```
notion-create-database: {
  "parent_page_url": "https://www.notion.so/<parent-page-id>",
  "title": "My Database",
  "schema_ddl": "CREATE TABLE tasks (Name TITLE, Status SELECT, Priority NUMBER)"
}
```

**Failure modes:**
- Standard SQL types like `TEXT` fail with "Expected a type keyword" — use Notion types
- The DDL table name must use parentheses: `CREATE TABLE name (...)` — missing parens fails with "Expected ( to begin column list"

Returns the full database definition including `collection://` data source URL and `view://` default view URL.

### Update Database Schema (Data Source)

Modify columns using the `collection://` URL with ALTER TABLE DDL:

**Add a column:**
```
notion-update-data-source: {
  "data_source_url": "collection://<data-source-id>",
  "schema_ddl": "ALTER TABLE ... ADD COLUMN \"Due Date\" DATE"
}
```

**Rename a column:**
```
notion-update-data-source: {
  "data_source_url": "collection://<data-source-id>",
  "schema_ddl": "ALTER TABLE ... RENAME COLUMN \"Priority\" TO \"Urgency\""
}
```

**Drop a column:**
```
notion-update-data-source: {
  "data_source_url": "collection://<data-source-id>",
  "schema_ddl": "ALTER TABLE ... DROP COLUMN \"Due Date\""
}
```

**Add SELECT options:**
```
notion-update-data-source: {
  "data_source_url": "collection://<data-source-id>",
  "schema_ddl": "ALTER TABLE ... ADD OPTION 'In Progress' TO \"Status\""
}
```

**Rename data source:**
```
notion-update-data-source: {
  "data_source_id": "collection://<id>",
  "title": "New Database Title"
}
```

**Toggle inline/full-page database:**
```
notion-update-data-source: {
  "data_source_id": "collection://<id>",
  "is_inline": true
}
```

Also supports `description` (set description) and `in_trash` (trash/restore).

Returns the updated database schema with all columns.

### Create a View

All view types tested and working:

**Board** (grouped by a property):
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "Status Board",
  "view_type": "board",
  "group_by": "Status"
}
```

**List:**
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "Priority List",
  "view_type": "list"
}
```

**Calendar** (requires a date property):
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "Due Date Calendar",
  "view_type": "calendar",
  "calendar_by": "Due Date"
}
```

**Gallery:**
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "Gallery View",
  "view_type": "gallery"
}
```

**Timeline** (requires a date property):
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "Timeline View",
  "view_type": "timeline",
  "timeline_by": "Due Date"
}
```

Returns the `view://` URL and full view configuration.

**With a built-in filter** (the view will only show matching rows):
```
notion-create-view: {
  "database_url": "https://www.notion.so/<database-id>",
  "view_name": "To Do Only",
  "view_type": "table",
  "filter": {
    "operator": "and",
    "filters": [{"property": "Status", "select": {"equals": "To Do"}}]
  }
}
```

This is the way to filter database queries — `notion-query-database-view` uses the view's saved config, so create a filtered view first, then query it.

**With configure DSL** (sort, group, filter in one string):
```
notion-create-view: {
  "database_id": "<database-uuid>",
  "data_source_id": "<collection-uuid>",
  "name": "Sorted View",
  "type": "table",
  "configure": "SORT BY \"Status\" ASC"
}
```

DSL supports: `FILTER`, `SORT BY`, `GROUP BY`, `CALENDAR BY`, `TIMELINE BY`, `MAP BY`. **Property names must be double-quoted.**

Supported view types: `table`, `board`, `list`, `calendar`, `timeline`, `gallery`. Also `chart`, `map`, `dashboard` (untested). `form` type requires a pre-existing form block and will fail otherwise.

### Update a View

```
notion-update-view: {
  "view_url": "view://<view-id>",
  "view_name": "Updated Name",
  "display_properties": ["Name", "Priority"]
}
```

Returns updated view configuration.

**With configure DSL:**
```
notion-update-view: {
  "view_id": "view://<view-id>",
  "configure": "SORT BY \"Name\" ASC"
}
```

**Note:** `notion-update-view` cannot change the view type (e.g., table to list). To change type, create a new view instead.

### Create a Comment

Page-level comment:
```
notion-create-comment: {
  "page_id": "<page-uuid>",
  "rich_text": [{"type": "text", "text": {"content": "Your comment here"}}]
}
```

Comment on specific text (inline comment):
```
notion-create-comment: {
  "page_id": "<page-uuid>",
  "rich_text": [{"type": "text", "text": {"content": "Comment on this section"}}],
  "selection_with_ellipsis": "start of text...end of text"
}
```

The `selection_with_ellipsis` must match actual content in the page — use start and end snippets joined by `...`.

Returns `status: "success"` and comment `id`.

## Workflow: Find and Query a Database

```
# 1. Get teamspace ID
notion-get-teams: {}

# 2. Search for databases in the teamspace
notion-search: {
  "query": "project name",
  "query_type": "internal",
  "teamspace_id": "<team-uuid>",
  "content_search_mode": "workspace_search",
  "filters": {},
  "page_size": 25,
  "max_highlight_length": 0
}

# 3. Fetch the database to get schema and view URLs
notion-fetch: { "id": "<database-url-from-search>" }

# 4. Query the database view
notion-query-database-view: { "view_url": "view://<view-id-from-fetch>" }
```

## Common Failure Modes

| Error | Cause | Fix |
|-------|-------|-----|
| Only calendar events returned | Using default `ai_search` mode | Add `"content_search_mode": "workspace_search"` |
| `object_not_found` on fetch | Passing a team ID instead of page/database ID | Team IDs can't be fetched — use search with `teamspace_id` filter |
| `object_not_found` on fetch | Using raw `id` from search results | Use the `url` field from search results instead |
| `must have required property 'filter'` | Missing filter in meeting notes | Use `{"filter": {"operator": "and", "filters": []}}` |
| `must have required property 'operator'` | Empty filter `{}` in meeting notes | Filter must have `operator` and `filters` keys |
| `page_id should be a valid uuid` | Passing full URL to comments | Use just the UUID or the canonical `notion.so/<id>` URL |
| `Invalid database view URL` | Wrong view URL format | Use `view://` URLs from `notion-fetch` database response |
| Empty `{}` from get-comments | No comments on the page | Not an error — page has no comments |
| `URL type webpage not currently supported` | Fetching a `view://` URL | `view://` URLs can't be fetched — use `notion-query-database-view` instead |
| `Expected a type keyword, got "TEXT"` | Using SQL types in create-database DDL | Use Notion types: `TITLE`, `SELECT`, `NUMBER`, `DATE`, `RICH_TEXT`, etc. |
| `item was already in the target location` | Moving a page to its current parent | Not an error — page is already where you want it |
| `Invalid select value for property` | SELECT property value not in options list | Fetch schema to check available options; add missing options with `notion-update-data-source` first |
| `Invalid number value for property` | NUMBER property value not parsed correctly | Ensure numbers are passed as actual JSON numbers, not strings |
| `requires a content_updates parameter` | Passing `content_markdown` to update-page | Content updates use a different internal format — the AI must translate the request |
| No pagination cursor in search results | Search doesn't expose cursor for next page | Use `page_size` up to 25; no way to paginate beyond that in a single query |
| `notion-query-database-view` ignores filters/sorts | View tool uses saved view config only | Create a new view with desired filters via `notion-create-view` instead |
| `query: must NOT have fewer than 1 characters` | Empty query string `""` | Query must be at least 1 character |
| `notion-duplicate-page` ignores target parent | Tool only accepts `page_url`, no parent param | Duplicate then use `notion-move-pages` to relocate |
| `Invalid multi_select value` | MULTI_SELECT value not in options | Same as SELECT — add options to schema first via `notion-update-data-source` |
| `Invalid isDateTime value` | DATE `is_datetime` not a number | Must be `0` (date) or `1` (datetime), not boolean or string |
| `Could not load new parent...or missing edit permission` | Invalid target URL for move-pages | Target page doesn't exist or you don't have edit access |
| `notion-update-view` doesn't change type | View type (table/board/etc.) is immutable | Create a new view with the desired type instead |
| H1 heading dropped in created page | Notion uses page title as H1 | Use H2+ in `content_markdown` — H1 is stripped |
| Saved token expired (401 `invalid_token`) | MCP OAuth token has limited lifetime | Run `/notion` to re-authenticate — the flow will get a new token |
| `Expected property name in double quotes for SORT BY` | DSL property names not quoted | Use double quotes: `SORT BY "Status" ASC` not `SORT BY Status ASC` |
| `Form block pointer is undefined on form view` | Creating form view on database without form block | Form views need a pre-existing form block — use other view types instead |
| `String not found` in selection_with_ellipsis | Comment selection doesn't match page content | The `start...end` pattern must match actual text — fetch the page first to see current content |
| `archived: true` doesn't trash page | `archived` is not the same as `in_trash` | Use `in_trash: true` instead of `archived: true` to move pages to trash |
| Database restore with `in_trash: false` still shows deleted | Database restore may be incomplete via API | Restore databases through the Notion UI instead |
| No permanent delete API | MCP only supports soft delete | Use Notion UI Trash → Delete permanently for permanent deletion |

## Tips

### Search
- **Always use `content_search_mode: "workspace_search"`** to find pages and databases
- **Always include `"filters": {}`** in search — it's required even when empty
- Set `max_highlight_length: 0` to keep search responses small
- Use `page_url` to scope search within a specific page and its children
- Use `data_source_url` with `collection://` to search within a database's rows
- Combine `created_date_range` and `created_by_user_ids` filters to narrow results
- Search results are capped at `page_size` (max 25) — no pagination cursor is exposed
- Multiple pages can be created in one `notion-create-pages` call

### Fetching
- **Use `url` from search results** for `notion-fetch`, not the `id` field
- `notion-fetch` works with `collection://` URLs to get data source schemas directly
- `view://` URLs cannot be fetched — use `notion-query-database-view` instead

### Databases
- Database schemas are in SQLite DDL format — easy to read column names and types
- `view://` URLs come from fetching a database — not from search results
- `notion-query-database-view` returns all rows using the view's saved config — it ignores filter/sort params
- To filter/sort a database: create a new view with `notion-create-view` with the desired configuration
- SELECT properties need options pre-configured — check schema before creating rows
- CHECKBOX values use `"__YES__"` / `"__NO__"`, not `true`/`false`
- DATE properties expand to three columns: `date:ColName:start`, `date:ColName:end`, `date:ColName:is_datetime`
- STATUS type auto-creates groups (to_do, in_progress, complete) with default options
- Archived pages can still be fetched — archiving doesn't delete content
- `notion-duplicate-page` always creates a sibling — use `notion-move-pages` after to relocate
- `created_date_range` and `created_by_user_ids` filters can be combined in one search
- Query must be at least 1 character — empty string `""` is rejected
- Discussion replies use `discussion://` IDs from `notion-get-comments` response
- Properties can be cleared by setting them to `null` in `notion-update-page`
- `notion-move-pages` works with databases too, not just pages
- Special characters in search queries (e.g., `&`, `(`, `)`) are handled gracefully
- Whitespace-only search queries return generic results (treated as empty search)
- `content_markdown` is optional — pages can be created with title only
- H1 headings in content are stripped — use H2+ (H1 = page title)
- View types (table/board/list/etc.) cannot be changed after creation
- To filter database queries: create a filtered view with `notion-create-view`, then query it
- Large pages are returned in full (no truncation observed for ~2KB pages with many children)
- Tokens expire — if you get 401 `invalid_token`, run `/notion` to re-authenticate
- Use `include_discussions: true` on `notion-fetch` to see comments inline
- `notion-update-page` has 5 commands: `update_properties`, `replace_content`, `update_content`, `apply_template`, `update_verification`
- `replace_content` replaces everything; `update_content` does search-and-replace
- Set page icons (emoji) and covers (image URL) via `notion-update-page`
- View configure DSL requires double-quoted property names: `SORT BY "Status" ASC`
- `notion-get-users` with `user_id: "self"` returns the authenticated user
- Filter teams by name with `notion-get-teams` `query` param
- `is_inline` on `notion-update-data-source` toggles inline vs full-page database
- `selection_with_ellipsis` on comments: use `"start...end"` matching actual page text

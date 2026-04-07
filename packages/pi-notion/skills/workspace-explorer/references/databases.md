# Databases Reference

## Table of Contents
- [Discover Databases](#discover-databases)
- [Fetch Database Schema](#fetch-database-schema)
- [Query a Database View](#query-a-database-view)
- [Create a Database](#create-a-database)
- [DDL Column Types](#ddl-column-types)
- [Update Database Schema](#update-database-schema)
- [Create a View](#create-a-view)
- [Update a View](#update-a-view)
- [Property Value Formats](#property-value-formats)

## Discover Databases

Use `workspace_search` — databases appear with `"type": "database"` in results.

## Fetch Database Schema

```
notion-fetch: { "id": "<database-url-from-search>" }
```

Returns:
- `<data-source url="collection://...">` — the data source ID for queries
- `<sqlite-table>` — CREATE TABLE DDL showing column names and types
- `<view url="view://...">` — available view IDs with display properties
- `<data-source-state>` — property definitions with types and options

### Fetch a Data Source Schema

Use the `collection://` URL from a database fetch:
```
notion-fetch: { "id": "collection://3372e80c-997d-80bd-abee-000bc4bf4cd1" }
```

Returns the data source schema, property definitions, and SQLite DDL — same schema info as fetching the parent database but without view information.

## Query a Database View

Use the `view://` URL from the database fetch response:
```
notion-query-database-view: {
  "view_url": "view://3372e80c-997d-8090-8144-000c95adf05a"
}
```

**Failure mode:** If the `view://` URL alone doesn't work, try the full database URL with `?v=` query param.

Returns rows as JSON objects with column values.

`notion-query-database-view` does NOT accept filter or sort parameters — it returns all rows using the view's saved configuration. To filter/sort, create a new view with `notion-create-view` with the desired configuration.

## Create a Database

Uses SQL DDL syntax with Notion-flavored types — **not standard SQL types**.

```
notion-create-database: {
  "parent": {"type": "page_id", "page_id": "<parent-page-uuid>"},
  "title": "My Database",
  "schema": "CREATE TABLE (\"Name\" TITLE, \"Status\" SELECT('To Do':gray, 'Done':green), \"Priority\" NUMBER)"
}
```

**Required params:** `schema` and `parent`. `title` is optional (defaults to untitled).

**Failure modes:**
- Standard SQL types like `TEXT` fail with "Expected a type keyword" — use Notion types
- Column names must be double-quoted, option values use single quotes

Returns the full database definition including `collection://` data source URL and `view://` default view URL.

## DDL Column Types

| DDL Type | Notion Type | Notes |
|----------|-------------|-------|
| `TITLE` | Title | Required — one per database |
| `RICH_TEXT` | Text | Maps to `text` type |
| `NUMBER` | Number | Optional: `NUMBER FORMAT 'dollar'` |
| `SELECT` | Select | Inline options: `SELECT('opt1':color, 'opt2':color)` |
| `MULTI_SELECT` | Multi-select | Inline options: `MULTI_SELECT('opt1':color)` |
| `DATE` | Date | Expands to `date:ColName:start`, `date:ColName:end`, `date:ColName:is_datetime` |
| `CHECKBOX` | Checkbox | Values: `"__YES__"` = true, `"__NO__"` = false |
| `URL` | URL | |
| `EMAIL` | Email | |
| `PHONE_NUMBER` | Phone | |
| `PEOPLE` | Person | JSON array of `user://` IDs |
| `FILES` | Files | JSON array of file IDs |
| `STATUS` | Status | Auto-creates groups: to_do, in_progress, complete with default options |
| `UNIQUE_ID` | Unique ID | Optional: `UNIQUE_ID PREFIX 'PRJ'` |
| `FORMULA` | Formula | `FORMULA('expression')` |
| `RELATION` | Relation | `RELATION('data_source_id')` or `RELATION('id', DUAL)` |
| `ROLLUP` | Rollup | `ROLLUP('rel_prop', 'target_prop', 'function')` |
| `CREATED_TIME` | Created time | Read-only |
| `LAST_EDITED_TIME` | Last edited time | Read-only |

Colors: `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`.

## Update Database Schema

Modify columns using semicolon-separated DDL statements:

**Add a column:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "ADD COLUMN \"Due Date\" DATE"
}
```

**Add a column with SELECT options:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "ADD COLUMN \"Priority\" SELECT('High':red, 'Medium':yellow, 'Low':green)"
}
```

**Rename a column:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "RENAME COLUMN \"Priority\" TO \"Urgency\""
}
```

**Drop a column:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "DROP COLUMN \"Due Date\""
}
```

**Multiple statements at once:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "ADD COLUMN \"Due Date\" DATE; ADD COLUMN \"Assignee\" PEOPLE"
}
```

**Rename data source:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "title": "New Database Title"
}
```

**Toggle inline/full-page database:**
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "is_inline": true
}
```

Also supports `description` (set description) and `in_trash` (trash/restore — databases only, not pages).

Returns the updated database schema with all columns.

## Create a View

Requires `database_id`, `data_source_id`, `name`, and `type`. Use the `configure` DSL for filters, sorts, and grouping.

**Basic table view:**
```
notion-create-view: {
  "database_id": "<database-uuid>",
  "data_source_id": "<collection-uuid>",
  "name": "All Items",
  "type": "table"
}
```

**Board grouped by Status:**
```
notion-create-view: {
  "database_id": "<database-uuid>",
  "data_source_id": "<collection-uuid>",
  "name": "Status Board",
  "type": "board",
  "configure": "GROUP BY \"Status\""
}
```

**Calendar view** (requires a date property):
```
notion-create-view: {
  "database_id": "<database-uuid>",
  "data_source_id": "<collection-uuid>",
  "name": "Due Date Calendar",
  "type": "calendar",
  "configure": "CALENDAR BY \"Due Date\""
}
```

**Filtered + sorted table:**
```
notion-create-view: {
  "database_id": "<database-uuid>",
  "data_source_id": "<collection-uuid>",
  "name": "To Do Only",
  "type": "table",
  "configure": "FILTER \"Status\" = \"To Do\"; SORT BY \"Name\" ASC"
}
```

This is the way to filter database queries — `notion-query-database-view` uses the view's saved config, so create a filtered view first, then query it.

**DSL directives:** `FILTER`, `SORT BY`, `GROUP BY`, `CALENDAR BY`, `TIMELINE BY`, `MAP BY`, `SHOW`, `HIDE`, `COVER`, `CHART`. **Property names must be double-quoted.**

Supported view types: `table`, `board`, `list`, `calendar`, `timeline`, `gallery`, `form`, `chart`, `map`, `dashboard`.

**Note:** `form` type requires a pre-existing form block and will fail otherwise.

Returns the `view://` URL and full view configuration.

## Update a View

```
notion-update-view: {
  "view_id": "view://<view-id>",
  "name": "Updated Name"
}
```

**With configure DSL:**
```
notion-update-view: {
  "view_id": "view://<view-id>",
  "configure": "SORT BY \"Name\" ASC"
}
```

**Clear settings:**
```
notion-update-view: {
  "view_id": "view://<view-id>",
  "configure": "CLEAR FILTER; SORT BY \"Created\" DESC"
}
```

`notion-update-view` cannot change the view type (e.g., table to list). To change type, create a new view instead.

## Property Value Formats

Use these formats when creating or updating database rows:

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

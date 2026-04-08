# Notion Sync

Optional post-save step to sync PRDs and ADRs to Notion databases. This file is loaded when the session context indicates `Notion sync: enabled`.

## Prerequisites

- The **Notion MCP server** must be connected. If `mcp__notion__notion-create-pages` is not available, warn the user: "Notion MCP server is not connected. Skipping Notion sync."
- The `.claude/tracker.md` config must have `notion-sync: true` and the relevant database URL(s):
  - `notion-prd-database` — for PRD sync
  - `notion-adr-database` — for ADR sync

If the database URL for the document type being synced is not configured, skip that sync and tell the user.

## When to Sync

Run Notion sync **after** both:
1. The document has been saved locally (to `docs/prd/` or `docs/adr/`)
2. The document has been published to the tracker (GitHub/Linear)

Notion sync is the final step. If it fails, the local file and tracker publication are unaffected.

## PRD Sync Workflow

### 1. Check for Existing Page

Search the configured database to see if a page for this PRD already exists (to avoid duplicates):

```
Tool: mcp__notion__notion-search
Parameters:
  query: "PRD-NNN"
  content_search_mode: "workspace_search"
```

If a matching page is found, **update** it (step 3b). Otherwise, **create** it (step 3a).

### 2. Fetch Database Schema

Fetch the target database to understand its property structure:

```
Tool: mcp__notion__notion-fetch
Parameters:
  url: "<notion-prd-database URL from config>"
```

Read the returned schema to identify available properties (Title, Status, Date, Owner, etc.). Property names vary by team — do NOT hardcode them. Map PRD frontmatter fields to whatever properties exist in the schema.

**Common mappings** (adapt to actual schema):

| PRD Frontmatter | Likely Notion Property | Type |
|-----------------|----------------------|------|
| `title` | Title property (whatever it's named) | title |
| `status` | Status | select |
| `date` | Date / Created | date |
| `owner` | Owner / Assignee | rich_text or people |
| `prd` | PRD Number / ID | rich_text |
| `issue` | Issue / Tracker Ref | rich_text or url |

If a frontmatter field has no matching database property, skip it silently.

If a select property (like Status) doesn't have the needed option (e.g., "Draft"), add it first:

```
Tool: mcp__notion__notion-update-data-source
Parameters:
  dataSourceId: "<collection:// URI from fetch>"
  schema_updates: [{ "property": "Status", "add_select_options": ["Draft"] }]
```

### 3a. Create New Page

```
Tool: mcp__notion__notion-create-pages
Parameters:
  pages:
    - parent:
        data_source_id: "<collection:// URI>"
      properties:
        <Title property name>: "PRD-NNN: <title>"
        <mapped properties from step 2>
      content: "<full PRD markdown content>"
```

### 3b. Update Existing Page

```
Tool: mcp__notion__notion-update-page
Parameters:
  pageId: "<page ID from search>"
  properties:
    <mapped properties>
  content: "<full PRD markdown content>"
```

### 4. Report

Print the Notion page URL to the user:
> Synced PRD-NNN to Notion: <page URL>

## ADR Sync Workflow

Same pattern as PRD sync, using the `notion-adr-database` URL instead.

**Common mappings** (adapt to actual schema):

| ADR Frontmatter | Likely Notion Property | Type |
|-----------------|----------------------|------|
| `title` | Title property | title |
| `status` | Status | select |
| `date` | Date | date |
| `adr` | ADR Number / ID | rich_text |
| `prd` | Related PRD | rich_text or relation |
| `decision` | Decision | rich_text |

## Error Handling

| Error | Action |
|-------|--------|
| Notion MCP not connected | Warn user, skip sync |
| Database URL invalid or not found | Warn user, skip sync |
| Property type mismatch | Skip that property, warn user |
| Select option doesn't exist | Add it via `notion-update-data-source`, then retry |
| Page creation fails | Print the error, note that the local file and tracker publication are unaffected |
| Rate limit | Wait briefly, retry once. If still failing, warn and skip |

## Important Notes

- **Content field is required** for document-like pages. Always include the full markdown content, not just properties.
- **Use the `url` field** from search results when fetching pages, not the raw `id`.
- **Search uses `workspace_search` mode** — always pass `content_search_mode: "workspace_search"` to avoid getting calendar events.
- Notion sync is best-effort. A sync failure should never block the primary workflow (local save + tracker publish).

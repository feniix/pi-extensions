# Write Operations Reference

## Table of Contents
- [Create Pages](#create-pages)
- [Add a Row to a Database](#add-a-row-to-a-database)
- [Update Page](#update-page)
- [Trash and Restore](#trash-and-restore)
- [Duplicate a Page](#duplicate-a-page)
- [Move Pages](#move-pages)
- [Comments](#comments)
- [Meeting Notes](#meeting-notes)

## Create Pages

The `parent` parameter is **top-level** (not inside each page). It supports three types: `page_id`, `database_id`, or `data_source_id`. Page objects accept: `properties`, `content`, `icon`, `cover`, `template_id`. There are no `url` or `title` fields on page objects.

```
notion-create-pages: {
  "pages": [{
    "properties": {"title": "Page Title"},
    "content": "## Heading\nParagraph text.\n\n- item 1\n- item 2"
  }],
  "parent": {"type": "page_id", "page_id": "<parent-page-uuid>"}
}
```

Returns created page `id`, `url`, and `properties`. Can create multiple pages in one call. `content` is optional — omit it to create a blank page.

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

**Note:** H1 headings in `content` are dropped — the page title serves as H1.

## Add a Row to a Database

Database rows are pages with a database or data source as parent. Pass properties matching the schema.

**Include `content` to populate the page body** — otherwise the row is created with properties only and an empty page. This is especially important for rows that represent documents (ADRs, PRDs, specs, etc.).

```
# 1. Fetch the database schema first
notion-fetch: { "id": "https://www.notion.so/<database-id>" }

# 2. Check that SELECT properties have the options you need
#    If not, add them first:
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "statements": "ADD COLUMN \"Status\" SELECT('To Do':gray, 'In Progress':blue, 'Done':green)"
}

# 3. Create the row with properties AND content
notion-create-pages: {
  "pages": [{
    "properties": {
      "Name": "Row Name",
      "Status": "In Progress",
      "Priority": 1
    },
    "content": "## Section 1\n\nPage body content goes here.\n\n## Section 2\n\nMore content."
  }],
  "parent": {
    "type": "data_source_id",
    "data_source_id": "<data-source-uuid>"
  }
}
```

Use `data_source_id` (from `collection://` URLs — strip the `collection://` prefix) or `database_id` as the parent type. The title property (e.g. `"Name"`) goes inside `properties` — not as a separate `title` field.

The `content` field accepts Notion-flavored markdown (H2+, lists, tables, code blocks, etc.). Use H2 and below — H1 is stripped since the title property serves as the page heading.

See the [Property Value Formats](databases.md#property-value-formats) table in the databases reference for the correct format per type.

## Update Page

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

Properties can be cleared by setting them to `null`.

## Trash and Restore

**Pages cannot be trashed via the MCP API.** The `notion-update-page` tool does not have an `in_trash` parameter. Page trashing is only available through the Notion UI.

**Databases can be trashed** via `notion-update-data-source`:

### Trash a database
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "in_trash": true
}
```

### Restore a database from trash
```
notion-update-data-source: {
  "data_source_id": "<data-source-uuid>",
  "in_trash": false
}
```

**Note:** Restoring a database with `in_trash: false` may not fully work — the command succeeds but the database may still show as deleted. Restoring databases is best done through the Notion UI.

### Limitations
- No way to trash pages via MCP — only databases support `in_trash`
- No permanent delete API — use Notion UI Trash > Delete permanently
- Trashed content is still fetchable via `notion-fetch`

## Duplicate a Page

```
notion-duplicate-page: {
  "page_id": "<page-uuid>"
}
```

Returns `page_id` and `page_url` of the duplicate. The duplicate is always created as a sibling (same parent). **There is no parameter to specify a different parent** — to move it after duplicating, use `notion-move-pages`.

**Note:** Duplication completes asynchronously — the new page may not be fully populated immediately.

## Move Pages

```
notion-move-pages: {
  "page_or_database_ids": ["<page-or-database-uuid>"],
  "new_parent": {"type": "page_id", "page_id": "<target-parent-uuid>"}
}
```

`new_parent` supports types: `page_id`, `database_id`, `data_source_id`, `workspace`.

Supports moving multiple pages/databases in one call. If pages are already at the target location, returns "item was already in the target location".

**Failure mode:** Invalid target returns "Could not load new parent...or missing edit permission".

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

### Create a page-level comment
```
notion-create-comment: {
  "page_id": "<page-uuid>",
  "rich_text": [{"text": {"content": "Your comment here"}}]
}
```

### Comment on specific text (inline comment)
```
notion-create-comment: {
  "page_id": "<page-uuid>",
  "rich_text": [{"text": {"content": "Comment on this section"}}],
  "selection_with_ellipsis": "start of text...end of text"
}
```

The `selection_with_ellipsis` must match actual content in the page — use ~10 chars from start and end joined by `...`. Fetch the page first to see current content.

### Reply to an existing discussion
Get the `discussion://` ID from `notion-get-comments`, then pass it:
```
notion-create-comment: {
  "page_id": "<page-uuid>",
  "discussion_id": "discussion://<page-id>/<block-id>/<discussion-id>",
  "rich_text": [{"text": {"content": "Reply text"}}]
}
```

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
      "property": "created_time",
      "filter": {
        "operator": "date_is_on_or_after",
        "value": {
          "type": "exact",
          "value": { "type": "date", "start_date": "2026-03-20" }
        }
      }
    }]
  }
}
```

Returns meeting entries with Title, Created time, Attendees, and URLs.

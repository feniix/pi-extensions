# Failure Modes and Tips

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Results from Google Drive, Slack, or other connected sources | Search without filters also covers connected sources | Ignore results whose `type` is not a Notion type, or add a filter (any filter returns Notion results only) |
| `object_not_found` on fetch | Passing a team ID instead of page/database ID | Team IDs can't be fetched — use search with `teamspace_id` filter |
| `filter.operator: must have required properties operator` | Empty filter `{}` in meeting notes | Give the filter an `operator` and `filters`, or leave `filter` out |
| `page_id should be a valid uuid` | Passing full URL to comments | Use just the UUID (with or without dashes) |
| `data: must have required properties data` | `notion-query-data-sources` arguments not wrapped | Put every argument inside `"data": { ... }` |
| Empty `{}` from get-comments | No comments on the page | Not an error — page has no comments |
| Fetched a `view://` URL but got no rows | Fetching a view returns its definition (data source, properties), not its rows | Use `notion-query-data-sources` (`"mode": "view"` or SQL) for the rows |
| `Expected a type keyword, got "TEXT"` | Using SQL types in create-database DDL | Use Notion types: `TITLE`, `SELECT`, `NUMBER`, `DATE`, `RICH_TEXT`, etc. |
| `item was already in the target location` | Moving a page to its current parent | Not an error — page is already where you want it |
| `Invalid select value for property` | SELECT property value not in options list | Fetch schema to check available options; add missing options with `notion-update-data-source` first |
| `Invalid number value for property` | NUMBER property value sent as string | Ensure numbers are passed as actual JSON numbers, not strings |
| `requires a content_updates parameter` | Passing `content` to update-page | Use `update_content` command with `content_updates` array, or `replace_content` with `new_str` |
| No pagination cursor in search results | Search doesn't expose a cursor | Use `page_size` up to 50, or narrow the search |
| SQL error on a column name | Guessed a column name | Use the names in the fetched `<sqlite-table>`; dates are `date:<Name>:start` |
| `notion-duplicate-page` ignores target parent | Tool only accepts `page_id`, no parent param | Duplicate then use `notion-move-pages` to relocate |
| `Invalid multi_select value` | MULTI_SELECT value not in options | Same as SELECT — add options to schema first via `notion-update-data-source` |
| `Invalid isDateTime value` | DATE `is_datetime` not a number | Must be `0` (date) or `1` (datetime), not boolean or string |
| `Could not load new parent...or missing edit permission` | Invalid target for move-pages | Target page doesn't exist or you don't have edit access |
| `notion-update-view` doesn't change type | View type (table/board/etc.) is immutable | Create a new view with the desired type instead |
| H1 heading dropped in created page | Notion uses page title as H1 | Use H2+ in `content` — H1 is stripped |
| Sign-in expired (401 `invalid_token`) | pi refreshes tokens automatically; this means the refresh was refused | Ask the user to run `/mcp login notion` |
| `Expected property name in double quotes for SORT BY` | DSL property names not quoted | Use double quotes: `SORT BY "Status" ASC` not `SORT BY Status ASC` |
| `Form block pointer is undefined on form view` | Creating form view on database without form block | Form views need a pre-existing form block — use other view types instead |
| `String not found` in selection_with_ellipsis | Comment selection doesn't match page content | The `start...end` pattern must match actual text — fetch the page first to see current content |
| Need to trash pages | — | `notion-delete-pages` moves pages to trash; `notion-restore-pages` brings them back |
| Database restore with `in_trash: false` still shows deleted | Database restore may be incomplete via API | Restore databases through the Notion UI instead |
| No permanent delete API | MCP only moves to trash | Use Notion UI Trash > Delete permanently for permanent deletion |

## Quick Tips

### Search
- Start with just `query`; add parameters only to narrow the search
- Any filter returns Notion results only; without filters, connected sources are included
- Set `max_highlight_length: 0` to keep search responses small
- Use `page_url` to scope search within a specific page and its children
- Use `data_source_url` with `collection://` to search within a database's rows
- Combine `created_date_range` and `created_by_user_ids` filters to narrow results
- Search results are capped at `page_size` (max 50) — no pagination cursor is exposed

### Fetching
- `notion-fetch` accepts the `url` from search results or the page ID (with or without dashes)
- `notion-fetch` works with `collection://` URLs to get data source schemas directly
- Fetching a `view://` URL returns the view's definition, not its rows — use `notion-query-data-sources` for rows

### Databases
- Database schemas are in SQLite DDL format — easy to read column names and types
- `view://` URLs come from fetching a database — not from search results
- SELECT properties need options pre-configured — check schema before creating rows
- CHECKBOX values use `"__YES__"` / `"__NO__"`, not `true`/`false`
- DATE properties expand to three columns: `date:ColName:start`, `date:ColName:end`, `date:ColName:is_datetime`
- STATUS type auto-creates groups (to_do, in_progress, complete) with default options
- To filter/sort rows: SQL or rows mode in `notion-query-data-sources`; do not create a view to read
- `notion-create-view` needs `data_source_id` plus one of `database_id` or `parent_page_id`
- Meeting notes: `notion-query-meeting-notes`, not search

### Writing
- Multiple pages can be created in one `notion-create-pages` call — `parent` is top-level, shared by all pages
- H1 headings in content are stripped — use H2+ (H1 = page title)
- `content` is optional — pages can be created with properties only
- Properties can be cleared by setting them to `null` in `notion-update-page`
- `replace_content` replaces everything; `update_content` does search-and-replace
- Set page icons (emoji) and covers (image URL) via `notion-update-page`
- `notion-move-pages` uses `page_or_database_ids` + `new_parent` (with type)
- `notion-duplicate-page` takes `page_id` (not URL) — always creates a sibling
- Comments use `page_id` + `rich_text` array (not `page_url` + `comment_text`)
- Discussion replies use `discussion://` IDs from `notion-get-comments` response
- View configure DSL requires double-quoted property names: `SORT BY "Status" ASC`
- View types (table/board/list/etc.) cannot be changed after creation
- `notion-get-users` with `user_id: "self"` returns the authenticated user
- `notion-delete-pages` trashes pages; `notion-restore-pages` restores them
- pi refreshes expired tokens on its own; a 401 `invalid_token` that persists means the user must run `/mcp login notion`

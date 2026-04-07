# Failure Modes and Tips

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Only calendar events returned | Using default `ai_search` mode | Add `"content_search_mode": "workspace_search"` |
| `object_not_found` on fetch | Passing a team ID instead of page/database ID | Team IDs can't be fetched — use search with `teamspace_id` filter |
| `object_not_found` on fetch | Using raw `id` from search results | Use the `url` field from search results instead |
| `must have required property 'filter'` | Missing filter in meeting notes | Use `{"filter": {"operator": "and", "filters": []}}` |
| `must have required property 'operator'` | Empty filter `{}` in meeting notes | Filter must have `operator` and `filters` keys |
| `page_id should be a valid uuid` | Passing full URL to comments | Use just the UUID (with or without dashes) |
| `Invalid database view URL` | Wrong view URL format | Use `view://` URLs from `notion-fetch` database response |
| Empty `{}` from get-comments | No comments on the page | Not an error — page has no comments |
| `URL type webpage not currently supported` | Fetching a `view://` URL | `view://` URLs can't be fetched — use `notion-query-database-view` instead |
| `Expected a type keyword, got "TEXT"` | Using SQL types in create-database DDL | Use Notion types: `TITLE`, `SELECT`, `NUMBER`, `DATE`, `RICH_TEXT`, etc. |
| `item was already in the target location` | Moving a page to its current parent | Not an error — page is already where you want it |
| `Invalid select value for property` | SELECT property value not in options list | Fetch schema to check available options; add missing options with `notion-update-data-source` first |
| `Invalid number value for property` | NUMBER property value sent as string | Ensure numbers are passed as actual JSON numbers, not strings |
| `requires a content_updates parameter` | Passing `content` to update-page | Use `update_content` command with `content_updates` array, or `replace_content` with `new_str` |
| No pagination cursor in search results | Search doesn't expose cursor for next page | Use `page_size` up to 25; no way to paginate beyond that in a single query |
| `notion-query-database-view` ignores filters/sorts | View tool uses saved view config only | Create a new view with desired filters via `notion-create-view` instead |
| `query: must NOT have fewer than 1 characters` | Empty query string `""` | Query must be at least 1 character |
| `notion-duplicate-page` ignores target parent | Tool only accepts `page_id`, no parent param | Duplicate then use `notion-move-pages` to relocate |
| `Invalid multi_select value` | MULTI_SELECT value not in options | Same as SELECT — add options to schema first via `notion-update-data-source` |
| `Invalid isDateTime value` | DATE `is_datetime` not a number | Must be `0` (date) or `1` (datetime), not boolean or string |
| `Could not load new parent...or missing edit permission` | Invalid target for move-pages | Target page doesn't exist or you don't have edit access |
| `notion-update-view` doesn't change type | View type (table/board/etc.) is immutable | Create a new view with the desired type instead |
| H1 heading dropped in created page | Notion uses page title as H1 | Use H2+ in `content` — H1 is stripped |
| Saved token expired (401 `invalid_token`) | MCP OAuth token has limited lifetime | Run `/notion` to re-authenticate — the flow will get a new token |
| `Expected property name in double quotes for SORT BY` | DSL property names not quoted | Use double quotes: `SORT BY "Status" ASC` not `SORT BY Status ASC` |
| `Form block pointer is undefined on form view` | Creating form view on database without form block | Form views need a pre-existing form block — use other view types instead |
| `String not found` in selection_with_ellipsis | Comment selection doesn't match page content | The `start...end` pattern must match actual text — fetch the page first to see current content |
| No way to trash pages via MCP | `notion-update-page` does not have `in_trash` param | Only databases can be trashed via `notion-update-data-source` with `in_trash: true`. Page trashing requires the Notion UI |
| Database restore with `in_trash: false` still shows deleted | Database restore may be incomplete via API | Restore databases through the Notion UI instead |
| No permanent delete API | MCP only supports soft delete (databases only) | Use Notion UI Trash > Delete permanently for permanent deletion |

## Quick Tips

### Search
- **Always use `content_search_mode: "workspace_search"`** to find pages and databases
- **Always include `"filters": {}`** in search — it's required even when empty
- Set `max_highlight_length: 0` to keep search responses small
- Use `page_url` to scope search within a specific page and its children
- Use `data_source_url` with `collection://` to search within a database's rows
- Combine `created_date_range` and `created_by_user_ids` filters to narrow results
- Search results are capped at `page_size` (max 25) — no pagination cursor is exposed

### Fetching
- **Use `url` from search results** for `notion-fetch`, not the `id` field
- `notion-fetch` works with `collection://` URLs to get data source schemas directly
- `view://` URLs cannot be fetched — use `notion-query-database-view` instead

### Databases
- Database schemas are in SQLite DDL format — easy to read column names and types
- `view://` URLs come from fetching a database — not from search results
- SELECT properties need options pre-configured — check schema before creating rows
- CHECKBOX values use `"__YES__"` / `"__NO__"`, not `true`/`false`
- DATE properties expand to three columns: `date:ColName:start`, `date:ColName:end`, `date:ColName:is_datetime`
- STATUS type auto-creates groups (to_do, in_progress, complete) with default options
- To filter/sort: create a filtered view with `notion-create-view`, then query it
- `notion-create-view` requires both `database_id` and `data_source_id`

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
- Pages cannot be trashed via MCP — only databases support `in_trash`
- Tokens expire — if you get 401 `invalid_token`, run `/notion` to re-authenticate

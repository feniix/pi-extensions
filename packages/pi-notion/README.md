# @feniix/pi-notion

[Notion API](https://developers.notion.com/) extension for [pi](https://pi.dev/) — read, search, and manage Notion pages, databases, and content.

## Features

- **Page Operations**: Create, read, update, archive pages
- **Database Operations**: Query, create, update databases
- **Block Operations**: Read and update block content
- **Search**: Search pages and databases
- **Comments**: Read and create comments
- **Users**: Get user information

## Install

```bash
pi install npm:@feniix/pi-notion
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-notion
```

## Setup

Run `/setup-notion` for interactive setup wizard, or configure manually below.

You need a Notion integration token from [notion.so/profile/integrations](https://www.notion.so/profile/integrations).

### Option 1: Environment Variable

```bash
export NOTION_TOKEN="secret_xxx"
```

### Option 2: JSON Config File

Create `~/.pi/agent/extensions/notion.json`:

```json
{
  "token": "secret_xxx"
}
```

### Option 3: CLI Flag

```bash
pi --notion-token=secret_xxx
```

## Tools

### Pages

| Tool | Description |
|------|-------------|
| `notion_get_page` | Retrieve a page by ID |
| `notion_create_page` | Create a new page |
| `notion_update_page` | Update page properties |
| `notion_archive_page` | Archive a page |

### Databases

| Tool | Description |
|------|-------------|
| `notion_query_database` | Query a database with filters/sorts |
| `notion_get_database` | Get database metadata |
| `notion_create_database` | Create a new database |

### Blocks

| Tool | Description |
|------|-------------|
| `notion_get_block_children` | Get page/block children |
| `notion_append_block_children` | Append blocks to a page |

### Search

| Tool | Description |
|------|-------------|
| `notion_search` | Search pages and databases |

### Users

| Tool | Description |
|------|-------------|
| `notion_get_user` | Get user by ID |
| `notion_get_me` | Get current user |

## Requirements

- pi v0.51.0 or later
- Notion integration token from [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
- **Grant page/database access** to your integration (share pages with it via the "..." menu → Add connections)

## Tips

- **Page IDs**: Found in Notion URLs (`notion.so/workspace/Title-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
- **Database IDs**: Same format as page IDs, found in database URLs

## License

MIT

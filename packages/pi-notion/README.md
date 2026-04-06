# @feniix/pi-notion

[Notion API](https://developers.notion.com/) extension for [pi](https://pi.dev/) — read, search, and manage Notion pages, databases, and content.

## Features

- **Page Operations**: Create, read, update, archive pages
- **Database Operations**: Query, create, update databases
- **Block Operations**: Read and update block content
- **Search**: Search pages and databases
- **Comments**: Read and create comments
- **Users**: Get user information
- **MCP Client**: Connect to official Notion MCP server with OAuth
- **Direct API**: Direct Notion API access with integration token

## Install

```bash
pi install npm:@feniix/pi-notion
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-notion
```

## Setup

### Option 1: Notion MCP Server (Recommended - No integration needed!)

This connects directly to Notion's official MCP server, similar to how Claude Code or Cursor connect to Notion MCP. **No Notion integration creation required.**

```bash
# Just connect - it will open browser for OAuth
Use notion_mcp_connect to connect to Notion via MCP
```

**MCP Tools:**

| Tool | Description |
|------|-------------|
| `notion_mcp_connect` | Connect to Notion MCP server (opens browser) |
| `notion_mcp_disconnect` | Disconnect from Notion MCP |
| `notion_mcp_status` | Check connection status |
| `notion_mcp_call` | Call a Notion MCP tool |

### Option 2: Direct API with Integration Token

Requires creating a Notion integration, but works with direct API calls.

**Prerequisites:**

1. Create an **internal** Notion integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
2. Copy the integration token
3. Share pages/databases with the integration

**Configuration:**

**Environment Variable:**
```bash
export NOTION_TOKEN="secret_xxx"
```

**JSON Config File:**
```json
{
  "token": "secret_xxx"
}
```

**CLI Flag:**
```bash
pi --notion-token=secret_xxx
```

### Option 3: Direct API with OAuth (Advanced)

Requires creating a **public** Notion integration.

Create `~/.pi/agent/extensions/notion.json`:

```json
{
  "oauth": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret",
    "redirectUri": "http://localhost:3000/callback"
  }
}
```

## Direct API Tools

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
| `notion_append_blocks` | Append blocks to a page |

### Search

| Tool | Description |
|------|-------------|
| `notion_search` | Search pages and databases |

### Users

| Tool | Description |
|------|-------------|
| `notion_get_user` | Get user by ID |
| `notion_get_me` | Get current user |

### OAuth (Direct API)

| Tool | Description |
|------|-------------|
| `notion_oauth_setup` | Start OAuth authorization flow |
| `notion_oauth_status` | Check OAuth connection status |
| `notion_oauth_logout` | Clear OAuth tokens and logout |

## Which Option Should I Use?

| Option | Requires Integration | OAuth Flow | Tool Count |
|--------|---------------------|------------|------------|
| Notion MCP Server | ❌ No | Browser-based | Full MCP tools |
| Direct API + Token | ✅ Internal | None | Custom tools |
| Direct API + OAuth | ✅ Public | Browser-based | Custom tools |

**Recommendation:** Start with **Option 1 (Notion MCP Server)** if you just want to use Notion with pi. It works like Claude Code's Notion integration.

## Tips

- **Page IDs**: Found in Notion URLs (`notion.so/workspace/Title-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
- **Database IDs**: Same format as page IDs, found in database URLs

## Requirements

- pi v0.51.0 or later
- For Direct API: Notion integration token
- For MCP Server: Nothing additional needed!

## License

MIT

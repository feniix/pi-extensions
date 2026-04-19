# @feniix/pi-notion

[Notion MCP](https://developers.notion.com/docs/mcp) extension for [pi](https://pi.dev/) — connect to Notion via OAuth and use Notion's official MCP tools.

## Features

- **MCP OAuth Connect**: Connect to Notion's official MCP server
- **Dynamic Tool Registration**: Auto-discovers and registers available Notion MCP tools after connect
- **Connection Management**: Connect, disconnect, and check status via tools or `/notion`
- **Guardrails**: Advisory warnings for common Notion tool mistakes

## Install

```bash
pi install npm:@feniix/pi-notion
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-notion
```

## Setup (Recommended)

This package is MCP-first and uses Notion's hosted MCP endpoint:

- MCP URL: `https://mcp.notion.com/mcp`
- Auth: OAuth in browser

### Connect

Either run:

```bash
/notion
```

or call:

- `notion_mcp_connect`

### Check status

- `notion_mcp_status`

### Disconnect

- `notion_mcp_disconnect`

## Tools

### Always available

| Tool | Description |
|------|-------------|
| `notion_mcp_connect` | Connect to Notion MCP server via OAuth |
| `notion_mcp_disconnect` | Disconnect and clear stored MCP config |
| `notion_mcp_status` | Show current MCP connection status |

### After connecting

Notion MCP tools are discovered from the server and registered dynamically.

Use `notion_mcp_status` to list currently available tools.

## Authentication Notes

This package requires MCP OAuth (`/notion` or `notion_mcp_connect`) for tool connectivity.

Session-start status checks for:

1. MCP OAuth config (`~/.pi/agent/extensions/notion-mcp.json`)
2. Legacy OAuth token files under `~/.pi/agent/extensions/`
3. Legacy direct API token hints (`NOTION_API_KEY`, `NOTION_TOKEN`, `.pi/extensions/notion.json`, `~/.pi/agent/extensions/notion.json`) and warns that MCP OAuth is still required.

Best practice: keep Notion credentials in dedicated private files under `~/.pi/agent/extensions/` or in environment variables. Do not store tokens or client secrets in `settings.json`.

## Requirements

- pi v0.51.0 or later

## License

MIT

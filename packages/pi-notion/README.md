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

The authorization URL is also saved to `~/.pi/agent/notion-oauth-url.txt` (mode `0600`) in case the browser does not open.

### Connect over SSH or without a local browser

```bash
/notion headless
```

`/notion` uses this flow automatically when `SSH_CONNECTION` or `SSH_TTY` is set; run `/notion browser` to force the local callback flow instead (for example, when you forward the callback port).

1. Copy the URL with `cat ~/.pi/agent/notion-oauth-url.txt` and open it in a browser on any machine.
2. Approve access. The browser then redirects to `http://127.0.0.1:3000/callback?...`, which fails to load; that is expected.
3. Paste that full redirect URL (or just the `code` value) into the pi prompt.

`notion_mcp_connect` always uses the local callback flow.

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

The auth file stores the OAuth refresh token and access-token expiry alongside the access token. Saved tokens are refreshed before reconnecting when they are within five minutes of expiry, and a Notion tool call rejected with HTTP 401 triggers one refresh-and-retry before reporting that you need to reconnect. A failed reconnect no longer deletes the saved credentials; run `notion_mcp_disconnect` to clear them.

Session-start status checks for:

1. MCP OAuth config (`~/.pi/agent/notion-mcp-auth.json`, or `NOTION_MCP_AUTH_FILE` / `--notion-mcp-auth-file` if explicitly set)
2. Legacy OAuth token files under `~/.pi/agent/extensions/`
3. Legacy direct API token hints (`NOTION_API_KEY`, `NOTION_TOKEN`) and warns that MCP OAuth is still required.

Best practice: use `settings.json` for non-secret defaults only.
Keep Notion credentials in a dedicated private file (by default `~/.pi/agent/notion-mcp-auth.json`) or in environment variables. If you want to move the auth file, set `NOTION_MCP_AUTH_FILE` or pass `--notion-mcp-auth-file` with a custom file path. Legacy aliases `NOTION_MCP_AUTH` and `--notion-mcp-auth` are still accepted but deprecated.

For the legacy direct-token compatibility config path, prefer `NOTION_CONFIG_FILE` / `--notion-config-file`. Legacy aliases `NOTION_CONFIG` and `--notion-config` are still accepted but deprecated.

Do not store tokens or client secrets in `settings.json`.

## Requirements

- pi v0.51.0 or later

## License

MIT

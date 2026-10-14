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
2. Approve access. The browser then redirects to `http://127.0.0.1:<random high port>/callback?...`, which fails to load; that is expected. The port is picked at random from 49152–65535 so it does not hit a dev server on a common port such as 3000.
3. Paste that full redirect URL (or just its `?code=...&state=...` query string) into the pi prompt. A bare code is refused because it carries no state to check.

`notion_mcp_connect` uses the same rule when pi can prompt: the pasted-redirect flow over SSH, the local callback flow otherwise.

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

The auth file stores the OAuth refresh token, client secret, and access-token expiry alongside the access token, and is written with mode `0600`.

- Saved tokens are refreshed before connecting when they are within five minutes of expiry. If that refresh fails transiently, the still-valid token is used.
- A Notion tool call rejected with HTTP 401 triggers one refresh, reconnect, and retry; parallel calls share that single refresh. If the auth file already holds a newer token (another pi process refreshed it), that token is reused instead of refreshing again.
- An MCP session the server has expired (HTTP 404) is reopened with the same token.
- A dropped session is restored from the auth file on the next tool call.
- Saved credentials are kept when a reconnect fails transiently and cleared only when Notion rejects the refresh token (HTTP 400/401, e.g. `invalid_grant`). `notion_mcp_disconnect` also clears them.

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

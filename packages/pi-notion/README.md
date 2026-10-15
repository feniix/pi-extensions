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

1. pi shows the authorization URL next to the paste prompt, as a clickable link in terminals that support one (it is also saved to `~/.pi/agent/notion-oauth-url.txt`). Open it in a browser on any machine.
2. Approve access. The browser then redirects to `http://127.0.0.1:<random high port>/callback?...`, which fails to load; that is expected. The port is picked at random from 49152–65535 so it does not hit a dev server on a common port such as 3000.
3. Paste that full redirect URL (with or without `http://`, or just its `?code=...&state=...` query string) into the pi prompt. A bare code is refused because it carries no state to check.

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

The auth file stores the OAuth refresh token, client secret, and access-token expiry alongside the access token. It is replaced atomically and written with mode `0600`.

- Saved tokens are refreshed before connecting when they are within five minutes of expiry. If that refresh fails, the still-valid token is used.
- Every Notion request (tool calls, `notion_mcp_status`, `notion_mcp_connect`) recovers the same way. A rejected token (HTTP 401) is refreshed once and the request retried; an expired MCP session (HTTP 404) is reopened with the same token. Parallel requests share one recovery, and a request that fails on a session another request already replaced simply retries.
- If the auth file already holds a newer token (another pi process refreshed it), that token is adopted instead of spending the refresh token again.
- The session's credentials live in memory, so it keeps working if the auth file cannot be written. That failure is reported.
- After a failed reconnect, Notion tools report the cause and fail fast for 15 seconds instead of retrying on every call.
- A transient failure with saved credentials is reported instead of starting a new OAuth flow. Saved credentials are cleared only when Notion rejects them for good: the refresh token is refused (HTTP 400/401, e.g. `invalid_grant`), or a pre-3.1 auth file without a refresh token is rejected. pi then reports the saved login as expired and starts signing in again. A file another pi process has meanwhile updated is left alone. `notion_mcp_disconnect` also clears it.

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

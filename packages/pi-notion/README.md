# @feniix/pi-notion

[Notion MCP](https://developers.notion.com/docs/mcp) for [pi](https://pi.dev/). It registers Notion's hosted MCP server with pi's built-in MCP support and adds what is specific to Notion.

## Features

- **Notion MCP server**: registers `https://mcp.notion.com/mcp` as the `notion` server. pi's built-in MCP support handles sign-in, token refresh, reconnects, and tool exposure.
- **Deferred tools**: Notion's tools (57 at the time of writing) are not declared to the model until `tool_search` loads the ones it needs.
- **Guardrails**: advisory warnings for common Notion tool mistakes, also for calls made from `codemode` scripts.
- **Skill**: `workspace-explorer` teaches the model Notion's search modes, database schemas, and write operations.

## Install

```bash
pi install npm:@feniix/pi-notion
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-notion
```

## Sign in

```bash
/mcp login notion
```

or, from a shell:

```bash
pi mcp login notion
```

pi opens Notion's authorization page and waits for approval. Over SSH, or when the browser runs on another machine, paste the URL the browser was redirected to into the sign-in screen. `/notion` prints these instructions.

pi stores the credentials in `~/.pi/agent/mcp-auth.json` and refreshes them on its own. `/mcp` shows the connection status and tools; `/mcp logout notion` signs out. See "MCP Servers" (`docs/mcp.md`) in pi's documentation for the details.

## Tools

Tools are named `mcp__notion__<tool>`, with `-` replaced by `_`: Notion's `notion-search` is `mcp__notion__notion_search`. Run `/mcp` to list them.

## Configuration

The `notion` server uses `deferred` exposure. To change it, or to configure the server yourself, add a `notion` entry to `~/.pi/agent/mcp.json`; an `mcp.json` entry takes precedence over the one this extension registers:

```json
{
  "mcpServers": {
    "notion": {
      "url": "https://mcp.notion.com/mcp",
      "exposure": "deferred",
      "toolExposure": { "notion-search": "direct", "notion-fetch": "direct" }
    }
  }
}
```

The guardrails apply to Notion tools under any server name.

## Upgrading from 3.x

- Sign in again with `/mcp login notion`. The 3.x auth file is not read. Delete it once you have signed in: `~/.pi/agent/notion-mcp-auth.json` (or the path in `NOTION_MCP_AUTH_FILE`) and `~/.pi/agent/notion-oauth-url.txt` if present.
- `notion_mcp_connect`, `notion_mcp_disconnect`, and `notion_mcp_status` are gone. Use `/mcp`, `/mcp login notion`, and `/mcp logout notion`.
- Notion tools are renamed from `notion-search` to `mcp__notion__notion_search`, and so on.
- `NOTION_MCP_AUTH_FILE`, `--notion-mcp-auth-file`, `NOTION_CONFIG_FILE`, `--notion-config-file`, and their deprecated aliases are no longer read, and the session-start auth status line is gone.
- The `setup-oauth` skill is removed; sign-in needs no skill.

## Requirements

- pi 1.1.0 or later (built-in MCP support)

## License

MIT

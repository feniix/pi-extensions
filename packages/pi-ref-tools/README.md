# @feniix/pi-ref-tools

[Ref.tools](https://ref.tools/) MCP extension for [pi](https://pi.dev/) — token-efficient documentation search and URL reading via Ref's Model Context Protocol.

## Features

- **Documentation Search** (`ref_search_documentation`): Search indexed technical documentation for APIs, libraries, and frameworks
- **URL Reading** (`ref_read_url`): Fetch and read documentation URLs as optimized markdown
- **Configurable Output Limits**: Client-side byte and line truncation with adjustable maximums
- **Flexible Configuration**: JSON config files, environment variables, and CLI flags
- **MCP Protocol Support**: JSON-RPC 2.0 with server-sent events for response streaming

## Install

```bash
pi install npm:@feniix/pi-ref-tools
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-ref-tools
```

## Configuration

You need a Ref API key from [ref.tools/keys](https://ref.tools/keys).

### Option 1: Environment Variable

```bash
export REF_API_KEY="your_key"
```

### Option 2: JSON Config File

Create `~/.pi/agent/extensions/ref-tools.json` (auto-created on first run):

```json
{
  "url": "https://api.ref.tools/mcp",
  "apiKey": "your_key",
  "timeoutMs": 30000,
  "protocolVersion": "2025-06-18",
  "maxBytes": 51200,
  "maxLines": 2000
}
```

### Option 3: CLI Flags

```bash
pi --ref-mcp-api-key=your_key
```

### Config Resolution Order

1. `--ref-mcp-config` flag path
2. `REF_MCP_CONFIG` environment variable
3. `./.pi/extensions/ref-tools.json` (project-level)
4. `~/.pi/agent/extensions/ref-tools.json` (global)

## Tools

### `ref_search_documentation`

Search indexed technical documentation. Best for API docs, library references, and framework guides.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query. Include language/framework names for best results. |
| `piMaxBytes` | integer | no | Client-side max bytes override (clamped by config). |
| `piMaxLines` | integer | no | Client-side max lines override (clamped by config). |

### `ref_read_url`

Read a documentation URL and return optimized markdown. Pass the exact URL from a search result or any documentation page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | The exact URL of the documentation page to read. |
| `piMaxBytes` | integer | no | Client-side max bytes override (clamped by config). |
| `piMaxLines` | integer | no | Client-side max lines override (clamped by config). |

## CLI Flags

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--ref-mcp-url` | `REF_MCP_URL` | `https://api.ref.tools/mcp` | MCP endpoint URL |
| `--ref-mcp-api-key` | `REF_API_KEY` | — | API key (sent as `x-ref-api-key` header) |
| `--ref-mcp-timeout-ms` | `REF_MCP_TIMEOUT_MS` | `30000` | HTTP timeout in ms |
| `--ref-mcp-protocol` | `REF_MCP_PROTOCOL_VERSION` | `2025-06-18` | MCP protocol version |
| `--ref-mcp-config` | `REF_MCP_CONFIG` | — | Custom config file path |
| `--ref-mcp-max-bytes` | `REF_MCP_MAX_BYTES` | `51200` | Max output bytes |
| `--ref-mcp-max-lines` | `REF_MCP_MAX_LINES` | `2000` | Max output lines |

## Output Truncation

Default limits: 51,200 bytes, 2,000 lines. Per-call overrides via `piMaxBytes`/`piMaxLines` parameters are clamped to the configured maximums. Truncated content is saved to temporary files with paths included in responses.

## Requirements

- pi v0.51.0 or later
- Ref API key from [ref.tools/keys](https://ref.tools/keys)

## Uninstall

```bash
pi remove npm:@feniix/pi-ref-tools
```

## License

MIT

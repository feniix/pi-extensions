# @feniix/pi-code-reasoning

[Code Reasoning](https://github.com/mettamatt/code-reasoning) tools for [pi](https://pi.dev/) and MCP — reflective problem-solving through sequential thinking with branching and revision support.

Based on the MCP server by Matt Westgate, this package defines its tools once with [BridgeKit](https://www.npmjs.com/package/@feniix/bridgekit) and exposes the same implementation through both pi and MCP adapters.

## Features

- **Sequential Thinking** — Break down complex problems into structured, revisable steps
- **Branching** — Explore alternative approaches from any thought (🌿)
- **Revision** — Correct earlier thinking when new insights emerge (🔄)
- **Progress Tracking** — Track thought count and branches
- **Configurable Output** — Client-side byte and line truncation

## Install

```bash
pi install npm:@feniix/pi-code-reasoning
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-code-reasoning
```

## MCP usage

Run the stdio MCP server with `npx`:

```bash
npx -y @feniix/pi-code-reasoning
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "code-reasoning": {
      "command": "npx",
      "args": ["-y", "@feniix/pi-code-reasoning"]
    }
  }
}
```

Use the MCP adapter entrypoint when wiring the same tools into a custom host:

```ts
import { createMcpServerOptions, runServer } from "@feniix/pi-code-reasoning/mcp";

// For tests or custom hosts:
const options = createMcpServerOptions();

// For a stdio MCP server entrypoint:
await runServer();
```

The shared portable tool definitions are available from `@feniix/pi-code-reasoning/tools` for advanced adapters.

### Package entrypoints

| Entry point | Purpose |
|-------------|---------|
| `@feniix/pi-code-reasoning/mcp` | compiled MCP server helpers |
| `@feniix/pi-code-reasoning/tools` | compiled BridgeKit portable tools |
| `@feniix/pi-code-reasoning/extensions/*` | compiled compatibility deep imports for extension internals |

The pi extension entrypoint remains source-loaded through the package `pi.extensions` metadata.

## Tools

### `code_reasoning`

Record and process a thought with metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `thought` | string | yes | Your reasoning content |
| `thought_number` | integer | yes | Position in sequence |
| `total_thoughts` | integer | yes | Estimated total thoughts |
| `next_thought_needed` | boolean | yes | Set FALSE when done |
| `is_revision` | boolean | no | When correcting earlier thought (🔄) |
| `revises_thought` | integer | no | Which thought# you're revising |
| `branch_from_thought` | integer | no | When exploring alternatives (🌿) |
| `branch_id` | string | no | Identifier for the branch |
| `needs_more_thoughts` | boolean | no | If more thoughts needed |
| `piMaxBytes` | integer | no | Per-call output byte limit, clamped by configured max |
| `piMaxLines` | integer | no | Per-call output line limit, clamped by configured max |

### `code_reasoning_status`

Get current session status: branches and thought count.

Optional parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `piMaxBytes` | integer | no | Per-call output byte limit, clamped by configured max |
| `piMaxLines` | integer | no | Per-call output line limit, clamped by configured max |

### `code_reasoning_reset`

Reset the session, clearing all thoughts and branches.

## Thinking Patterns

### Sequential Thinking (Basic)

```json
{
  "thought": "Initial exploration of the problem...",
  "thought_number": 1,
  "total_thoughts": 5,
  "next_thought_needed": true
}
```

### Branching (Explore Alternatives) 🌿

```json
{
  "thought": "Exploring alternative approach...",
  "thought_number": 3,
  "total_thoughts": 7,
  "next_thought_needed": true,
  "branch_from_thought": 2,
  "branch_id": "alternative-algo-x"
}
```

### Revision (Correct Earlier Thinking) 🔄

```json
{
  "thought": "Revisiting earlier point: Assumption Y was flawed...",
  "thought_number": 4,
  "total_thoughts": 6,
  "next_thought_needed": true,
  "is_revision": true,
  "revises_thought": 2
}
```

## Checklist (Review Every 3 Thoughts)

1. Need to explore alternatives? → Use **BRANCH** (🌿)
2. Need to correct earlier thinking? → Use **REVISION** (🔄)
3. Scope changed? → Adjust **total_thoughts**
4. Done? → Set **next_thought_needed = false**

## Limits

- Thought text is limited to 20,000 characters.
- A session keeps at most 20 thoughts before reset.
- Output limit values must be positive integers.
- When output is truncated, the full output is saved to a temp file when possible. If the temp file cannot be written, the tool output includes a warning instead.

## Configuration

### CLI Flags

CLI flags apply when running as a pi extension:

```bash
pi --code-reasoning-max-bytes=102400 --code-reasoning-max-lines=5000
```

### Environment Variables

Environment variables apply to both pi and MCP runtimes:

```bash
export CODE_REASONING_MAX_BYTES=102400
export CODE_REASONING_MAX_LINES=5000
export CODE_REASONING_CONFIG_FILE=/path/to/code-reasoning.json
```

### Settings File

Use pi's standard settings locations for non-secret configuration:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Under the `pi-code-reasoning` key:

```json
{
  "pi-code-reasoning": {
    "maxBytes": 51200,
    "maxLines": 2000
  }
}
```

> Best practice: use `settings.json` for non-secret defaults only.
> If you need a separate private override file, use `--code-reasoning-config-file` or `CODE_REASONING_CONFIG_FILE` to point to a custom JSON config file.
> Legacy aliases `--code-reasoning-config` and `CODE_REASONING_CONFIG` are still accepted but deprecated.

## CLI Flags

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--code-reasoning-config-file` | `CODE_REASONING_CONFIG_FILE` | — | Custom JSON config file path (overrides settings.json lookup) |
| `--code-reasoning-config` | `CODE_REASONING_CONFIG` | — | Deprecated alias for the config file path |
| `--code-reasoning-max-bytes` | `CODE_REASONING_MAX_BYTES` | `51200` | Max output bytes |
| `--code-reasoning-max-lines` | `CODE_REASONING_MAX_LINES` | `2000` | Max output lines |

## Development

Build the compiled MCP entrypoint locally:

```bash
npm run build:mcp --workspace packages/pi-code-reasoning
```

Run the built stdio server directly:

```bash
node packages/pi-code-reasoning/dist/extensions/mcp-server.js
```

## Requirements

- Node.js 22.19.0 or later
- pi v0.51.0 or later when using the pi extension

## License

MIT

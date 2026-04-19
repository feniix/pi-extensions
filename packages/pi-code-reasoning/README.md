# @feniix/pi-code-reasoning

[Code Reasoning](https://github.com/mettamatt/code-reasoning) extension for [pi](https://pi.dev/) — reflective problem-solving through sequential thinking with branching and revision support.

Based on the MCP server by Matt Westgate, this native TypeScript extension provides structured thinking tools without external dependencies.

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

### `code_reasoning_status`

Get current session status: branches and thought count.

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

## Configuration

### CLI Flags

```bash
pi --code-reasoning-max-bytes=102400 --code-reasoning-max-lines=5000
```

### Environment Variables

```bash
export CODE_REASONING_MAX_BYTES=102400
export CODE_REASONING_MAX_LINES=5000
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

## Requirements

- pi v0.51.0 or later

## License

MIT

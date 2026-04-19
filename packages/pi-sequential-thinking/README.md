# @feniix/pi-sequential-thinking

[Sequential Thinking](https://github.com/arben-adm/mcp-sequential-thinking) extension for [pi](https://pi.dev/) — structured progressive thinking through defined cognitive stages.

## Features

- **Process Thought** (`process_thought`): Record and analyze sequential thoughts with stage metadata
- **Generate Summary** (`generate_summary`): Summarize the entire thinking process
- **Clear History** (`clear_history`): Reset the thinking session
- **Export Session** (`export_session`): Save thinking sessions to JSON files
- **Import Session** (`import_session`): Load previously exported sessions
- **Configurable Output Limits**: Client-side byte and line truncation
- **Flexible Configuration**: settings.json, custom JSON config files, environment variables, and CLI flags
- **Native TypeScript**: No external dependencies or child processes

## Install

```bash
pi install npm:@feniix/pi-sequential-thinking
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-sequential-thinking
```

## Configuration

### Option 1: Default Configuration

Works out of the box. Sessions are stored in `~/.mcp_sequential_thinking/`.

### Option 2: Environment Variables

```bash
export MCP_STORAGE_DIR="~/.my-thinking-sessions"
export SEQ_THINK_MAX_BYTES=102400
export SEQ_THINK_MAX_LINES=5000
```

### Option 3: Settings File

Use pi's standard settings locations:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Under the `pi-sequential-thinking` key:

```json
{
  "pi-sequential-thinking": {
    "storageDir": null,
    "maxBytes": 51200,
    "maxLines": 2000
  }
}
```

> Best practice: use `settings.json` for non-secret defaults only.
> If you want a separate private override file, use `--seq-think-config-file` or `SEQ_THINK_CONFIG_FILE` to point to a custom JSON config file.
> Legacy aliases `--seq-think-config` and `SEQ_THINK_CONFIG` are still accepted but deprecated.

### Option 4: CLI Flags

```bash
pi --seq-think-storage-dir=/tmp/thoughts --seq-think-max-bytes=102400
```

### Config Resolution Order

1. `--seq-think-config-file` flag path
2. `SEQ_THINK_CONFIG_FILE` environment variable
3. legacy `--seq-think-config` flag path (deprecated)
4. legacy `SEQ_THINK_CONFIG` environment variable (deprecated)
3. `.pi/settings.json` under `pi-sequential-thinking` (project-level)
4. `~/.pi/agent/settings.json` under `pi-sequential-thinking` (global)

## Tools

### `process_thought`

Record and analyze a sequential thought with metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `thought` | string | yes | The content of your thought |
| `thought_number` | integer | yes | Position in sequence (starting at 1) |
| `total_thoughts` | integer | yes | Expected total thoughts |
| `next_thought_needed` | boolean | yes | Whether more thoughts follow |
| `stage` | string | yes | One of: "Problem Definition", "Research", "Analysis", "Synthesis", "Conclusion" |
| `tags` | string[] | no | Keywords or categories |
| `axioms_used` | string[] | no | Principles applied |
| `assumptions_challenged` | string[] | no | Assumptions questioned |

### `generate_summary`

Generate a summary of the entire thinking process. Returns stage counts, timeline, top tags, and completion status.

### `clear_history`

Reset the thinking process by clearing all recorded thoughts.

### `export_session`

Export the current thinking session to a JSON file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | yes | Path to save the exported JSON file |

### `import_session`

Import a previously exported thinking session from a JSON file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | yes | Path to the JSON file to import |

## CLI Flags

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--seq-think-storage-dir` | `MCP_STORAGE_DIR` | — | Storage directory for sessions |
| `--seq-think-config-file` | `SEQ_THINK_CONFIG_FILE` | — | Custom JSON config file path (overrides settings.json lookup) |
| `--seq-think-config` | `SEQ_THINK_CONFIG` | — | Deprecated alias for the config file path |
| `--seq-think-max-bytes` | `SEQ_THINK_MAX_BYTES` | `51200` | Max output bytes |
| `--seq-think-max-lines` | `SEQ_THINK_MAX_LINES` | `2000` | Max output lines |

## Thinking Stages

The Sequential Thinking framework organizes thoughts through five cognitive stages:

1. **Problem Definition** — Define and scope the problem
2. **Research** — Gather information and context
3. **Analysis** — Examine and evaluate the evidence
4. **Synthesis** — Combine insights into a coherent view
5. **Conclusion** — Draw final conclusions and recommendations

## Requirements

- pi v0.51.0 or later

## Uninstall

```bash
pi remove npm:@feniix/pi-sequential-thinking
```

## License

MIT

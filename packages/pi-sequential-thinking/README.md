# @feniix/pi-sequential-thinking

[Sequential Thinking](https://github.com/arben-adm/mcp-sequential-thinking) MCP extension for [pi](https://pi.dev/) — structured progressive thinking through defined cognitive stages via MCP stdio.

## Features

- **Process Thought** (`process_thought`): Record and analyze sequential thoughts with stage metadata
- **Generate Summary** (`generate_summary`): Summarize the entire thinking process
- **Clear History** (`clear_history`): Reset the thinking session
- **Export Session** (`export_session`): Save thinking sessions to JSON files
- **Import Session** (`import_session`): Load previously exported sessions
- **Configurable Output Limits**: Client-side byte and line truncation
- **Flexible Configuration**: JSON config files, environment variables, and CLI flags
- **Automatic Lifecycle**: Child process spawned on first use, cleaned up on session end

## Install

```bash
pi install npm:@feniix/pi-sequential-thinking
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-sequential-thinking
```

## Prerequisites

- [uv](https://github.com/astral-sh/uv) package manager (provides `uvx` command)
- Python 3.10+ (used by the MCP server)

## Configuration

### Option 1: Zero Config (default)

Works out of the box using `uvx` to run the MCP server directly from GitHub. No local install needed.

### Option 2: Environment Variables

```bash
export SEQ_THINK_COMMAND="uvx"
export SEQ_THINK_ARGS="--from,git+https://github.com/arben-adm/mcp-sequential-thinking,--with,portalocker,mcp-sequential-thinking"
export MCP_STORAGE_DIR="~/.my-thinking-sessions"
```

### Option 3: JSON Config File

Create `~/.pi/agent/extensions/sequential-thinking.json` (auto-created on first run):

```json
{
  "command": "uvx",
  "args": [
    "--from",
    "git+https://github.com/arben-adm/mcp-sequential-thinking",
    "--with",
    "portalocker",
    "mcp-sequential-thinking"
  ],
  "storageDir": null,
  "maxBytes": 51200,
  "maxLines": 2000
}
```

### Option 4: CLI Flags

```bash
pi --seq-think-command=uvx --seq-think-storage-dir=/tmp/thoughts
```

### Config Resolution Order

1. `--seq-think-config` flag path
2. `SEQ_THINK_CONFIG` environment variable
3. `./.pi/extensions/sequential-thinking.json` (project-level)
4. `~/.pi/agent/extensions/sequential-thinking.json` (global)

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
| `--seq-think-command` | `SEQ_THINK_COMMAND` | `uvx` | Command to launch the MCP server |
| `--seq-think-args` | `SEQ_THINK_ARGS` | *(see config)* | Comma-separated args for the command |
| `--seq-think-storage-dir` | `MCP_STORAGE_DIR` | — | Storage directory for sessions |
| `--seq-think-config` | `SEQ_THINK_CONFIG` | — | Custom config file path |
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
- uv package manager (`uvx` command available in PATH)
- Python 3.10+

## Uninstall

```bash
pi remove npm:@feniix/pi-sequential-thinking
```

## License

MIT

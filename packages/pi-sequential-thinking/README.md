# @feniix/pi-sequential-thinking

[Sequential Thinking](https://github.com/arben-adm/mcp-sequential-thinking) extension for [pi](https://pi.dev/) and MCP — structured progressive thinking through defined cognitive stages.

## Features

- **Process Thought** (`process_thought`): Record and analyze sequential thoughts with stage metadata.
- **Session-Scoped History**: Use the default session or named `session_id` values for independent thinking threads.
- **Get History** (`get_thinking_history`): Read bounded, paginated session history.
- **Get Status** (`get_thinking_status`): Inspect content-free storage/config diagnostics and state fingerprints.
- **Generate Summary** (`generate_summary`): Summarize one thinking session.
- **Clear History** (`clear_history`): Reset one thinking session.
- **Export/Import Session** (`export_session`, `import_session`): Move session JSON files with validation and receipts.
- **MCP-Compatible Aliases**: Accept snake_case fields and camelCase aliases such as `thoughtNumber` and `totalThoughts`.
- **Dynamic Depth**: If `thought_number` exceeds `total_thoughts`, the incoming thought is normalized to the larger total.
- **Configurable Output Limits**: Client-side byte and line truncation for pi.
- **Pi + MCP Adapters**: The same portable tools run as a pi extension or stdio MCP server.
- **Native TypeScript**: No dependency on the original MCP server implementation; the MCP server is packaged with this module.

## Install

```bash
pi install npm:@feniix/pi-sequential-thinking
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-sequential-thinking
```

## MCP Usage

This package also exposes the same tool surface as a stdio MCP server for MCP-aware hosts such as Claude Desktop, Claude Code, and other `mcp.json` clients.

Run the MCP server directly with `npx`:

```bash
npx -y @feniix/pi-sequential-thinking
```

This works because the package exposes a single binary, `pi-sequential-thinking-mcp`, which `npx` can infer from the package name.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@feniix/pi-sequential-thinking"]
    }
  }
}
```

Optional MCP environment configuration:

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@feniix/pi-sequential-thinking"],
      "env": {
        "MCP_STORAGE_DIR": "~/.my-thinking-sessions",
        "SEQ_THINK_CONFIG_FILE": "~/.config/pi-sequential-thinking.json"
      }
    }
  }
}
```

If your MCP host cannot infer package binaries reliably, use the explicit binary form instead:

```bash
npx -y --package @feniix/pi-sequential-thinking pi-sequential-thinking-mcp
```

MCP uses environment variables, the optional `SEQ_THINK_CONFIG_FILE` JSON file, and pi settings files described below. Pi-only CLI flags such as `--seq-think-storage-dir` are not read by the MCP stdio server.

## Configuration

### Default Configuration

Works out of the box. The default session is stored at:

```text
~/.mcp_sequential_thinking/current_session.json
```

Named sessions are stored under:

```text
~/.mcp_sequential_thinking/sessions/<session_id>.json
```

`default` is reserved as the default-session label and cannot be used as a named `session_id`.

### Environment Variables

```bash
export MCP_STORAGE_DIR="~/.my-thinking-sessions"
export SEQ_THINK_MAX_BYTES=102400
export SEQ_THINK_MAX_LINES=5000
```

`MCP_STORAGE_DIR` affects both pi and MCP storage. `SEQ_THINK_MAX_BYTES` and `SEQ_THINK_MAX_LINES` configure pi-side output truncation; the MCP server returns full structured tool output and leaves display truncation to the host.

### Settings File

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

A standalone config file referenced by `--seq-think-config-file` or `SEQ_THINK_CONFIG_FILE` uses the same values at the top level:

```json
{
  "storageDir": "~/.my-thinking-sessions",
  "maxBytes": 51200,
  "maxLines": 2000
}
```

> Best practice: use `settings.json` for non-secret defaults only.
> If you want a separate private override file, use `--seq-think-config-file` or `SEQ_THINK_CONFIG_FILE` to point to a custom JSON config file.
> Legacy aliases `--seq-think-config` and `SEQ_THINK_CONFIG` are still accepted but deprecated.

### Pi CLI Flags

```bash
pi --seq-think-storage-dir=/tmp/thoughts --seq-think-max-bytes=102400
```

These flags apply to the pi extension runtime only. For MCP clients, configure the server through `env`, `SEQ_THINK_CONFIG_FILE`, or the settings files above.

### Effective Configuration Precedence

For the pi extension, per-field precedence is:

1. CLI flags
2. Environment variables
3. Project settings (`.pi/settings.json`)
4. Global settings (`~/.pi/agent/settings.json`)
5. Built-in defaults

For the MCP stdio server, CLI flags are not read, so precedence starts with environment variables.

Custom config file discovery uses:

1. `--seq-think-config-file` (pi only)
2. deprecated `--seq-think-config` (pi only)
3. `SEQ_THINK_CONFIG_FILE`
4. deprecated `SEQ_THINK_CONFIG`
5. settings files listed above

## Tools

### `process_thought`

Record and analyze a sequential thought with metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `thought` | string | yes | The content of your thought |
| `thought_number` / `thoughtNumber` | integer | yes | Position in sequence, starting at 1 |
| `total_thoughts` / `totalThoughts` | integer | yes | Estimated total thoughts; normalized upward for dynamic depth |
| `next_thought_needed` / `nextThoughtNeeded` | boolean | yes | Whether more thoughts follow |
| `stage` | string | yes | One of: `Problem Definition`, `Research`, `Analysis`, `Synthesis`, `Conclusion` |
| `session_id` / `sessionId` | string | no | Named session to write; omit for the default session |
| `tags` | string[] | no | Keywords or categories |
| `axioms_used` / `axiomsUsed` | string[] | no | Principles applied |
| `assumptions_challenged` / `assumptionsChallenged` | string[] | no | Assumptions questioned |

Successful mutation responses include a content-free `receipt` with the session label, pre/post counts, save time, and a state fingerprint.

Example named-session call:

```json
{
  "thought": "Compare storage options before choosing one.",
  "thoughtNumber": 1,
  "totalThoughts": 3,
  "nextThoughtNeeded": true,
  "stage": "Analysis",
  "session_id": "architecture-review"
}
```

### `get_thinking_history`

Read recorded thoughts for one session with bounded pagination. With the V1 JSON-per-session storage layout, history reads reject persisted session files over 10 MiB instead of parsing unbounded local state.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` / `sessionId` | string | default session | Session to read |
| `limit` | integer | `20` | Maximum thoughts to return, capped at `100` |
| `offset` | integer | `0` | Number of thoughts to skip from the start |
| `include_full_thoughts` / `includeFullThoughts` | boolean | `true` | Set `false` to return metadata plus a short snippet instead of full thought text |

Example:

```json
{
  "session_id": "architecture-review",
  "limit": 20,
  "include_full_thoughts": false
}
```

### `get_thinking_status`

Return content-free diagnostics: session counts, storage writability, backup file names, effective config source labels, and current state fingerprints. Home-directory paths are redacted with `~` where possible. Status output may be partial after the named-session threshold, skips invalid session filenames, and reports corrupt session files without moving them to backups.

Example:

```json
{}
```

### `generate_summary`

Generate a summary for one session. Accepts optional `session_id` / `sessionId`.

### `clear_history`

Clear one session. Accepts optional `session_id` / `sessionId` and returns a mutation receipt.

### `export_session`

Export one session to a JSON file. `file_path` may be absolute or repo-relative; parent directories are created automatically. Export rejects directory targets and final-path symlinks. Existing files may be overwritten by this explicit tool call, and the receipt reports `overwroteExistingFile`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | yes | Path to save the exported JSON file |
| `session_id` / `sessionId` | string | no | Session to export; omit for the default session |

### `import_session`

Import a JSON session file. `file_path` may be absolute or repo-relative. Parent directories are not created for import. Imports reject directories, final-path symlinks, malformed top-level records, and files over 10 MiB. Thought text is treated as inert untrusted content; missing IDs/timestamps are normalized when needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | yes | Path to the JSON file to import |
| `session_id` / `sessionId` | string | no | Target session; explicit target wins over embedded session metadata |

### `sequential_think`

Compatibility helper that generates a staged sequence for a topic and writes it to the selected session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | yes | Topic or question to think through |
| `num_thoughts` | integer | no | Number of generated stages, 3–10; default `5` |
| `session_id` / `sessionId` | string | no | Session to write |

## Pi CLI Flags

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--seq-think-storage-dir` | `MCP_STORAGE_DIR` | `~/.mcp_sequential_thinking` | Storage directory for sessions |
| `--seq-think-config-file` | `SEQ_THINK_CONFIG_FILE` | — | Custom JSON config file path |
| `--seq-think-config` | `SEQ_THINK_CONFIG` | — | Deprecated alias for the config file path |
| `--seq-think-max-bytes` | `SEQ_THINK_MAX_BYTES` | `51200` | Max pi output bytes |
| `--seq-think-max-lines` | `SEQ_THINK_MAX_LINES` | `2000` | Max pi output lines |

## Thinking Stages

The Sequential Thinking framework organizes thoughts through five cognitive stages:

1. **Problem Definition** — Define and scope the problem
2. **Research** — Gather information and context
3. **Analysis** — Examine and evaluate the evidence
4. **Synthesis** — Combine insights into a coherent view
5. **Conclusion** — Draw final conclusions and recommendations

## Privacy and Storage Notes

- V1 storage is local plaintext JSON.
- `process_thought`, `get_thinking_history`, `generate_summary`, `export_session`, `import_session`, and `sequential_think` are content-bearing tools.
- `get_thinking_status` and mutation receipts are designed to avoid thought text, tags, axioms, and assumptions.
- V1 assumes one active pi process per storage directory. Add locking before using a shared directory with multiple writers.

## Requirements

- pi v0.51.0 or later

## Uninstall

```bash
pi remove npm:@feniix/pi-sequential-thinking
```

## License

MIT

# @feniix/pi-agent-journal

Agent Work Journal for Pi and MCP: durable typed operational entries, compact referenced checkpoints, contextual resume, freshness checks, and append-only corrections.

The journal records work state, not raw chain-of-thought. Pi can manage capture/checkpoint/resume through lifecycle hooks; generic MCP clients receive the same four manual tools but do not receive autonomous observation or context injection.

## Install

```bash
pi install npm:@feniix/pi-agent-journal
```

MCP stdio:

```bash
npx -y @feniix/pi-agent-journal
```

Pi and MCP use separate default stores and cannot be configured to the same canonical path. MCP stdio clients are trusted with the local OS user's access to their configured store.

## Tools

- `journal_record` — append bounded typed entries (`observation`, `evidence`, `assumption`, `decision`, `rejected_alternative`, `validation`, `next_action`) and optional `supersedes` / `alternative-to` links.
- `journal_inspect` — read a bounded current projection, append-only history, or durable notices.
- `journal_checkpoint` — create a compact checkpoint or resume with referenced entries and freshness results.
- `journal_session` — list, create, select, inspect, or close sessions. Close never deletes history.

## Pi behavior

Pi binds each active session-tree branch to a journal session. A fork receives a distinct journal session seeded from the parent's compact checkpoint, so sibling writes remain isolated. Successful edit/write events may create deterministic artifact observations; semantic decisions remain model-authored through `journal_record`. Checkpoints flush at settled/compaction/shutdown boundaries. `before_agent_start` injects only changed, bounded resume state labeled as untrusted historical data.

## Configuration

Project/global Pi settings use `pi-agent-journal`:

```json
{
  "pi-agent-journal": {
    "storageDir": null,
    "maxBytes": 51200,
    "maxLines": 2000,
    "maxEntryBytes": 20000,
    "maxCheckpointBytes": 16000
  }
}
```

Pi storage can be overridden by `AGENT_JOURNAL_STORAGE_DIR` or `--agent-journal-storage-dir`. MCP storage uses `AGENT_JOURNAL_MCP_STORAGE_DIR` and defaults separately.

## Privacy and limits

Journal files are local plaintext JSON with private filesystem permissions where supported. Credential detection is best-effort; detected candidate bytes are excluded from journal-owned files, temp files, outputs, and notices. Pi's own session transcript is separate plaintext storage outside this guarantee. Do not pass suspected secrets in tool arguments.

V1 supports one process/writer per store. Reads and outputs are bounded, artifact freshness reads stay inside the workspace and reject symlinks/special files, and unresolved conflicts remain available in headless modes. Existing Sequential Thinking data is never scanned, imported, migrated, or deleted.

## Requirements

- Node.js 22.19.0 or later
- Pi 0.80.6 or later for `agent_settled` lifecycle support

MIT

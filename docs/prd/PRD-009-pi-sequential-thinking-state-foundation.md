---
title: "pi-sequential-thinking State Foundation"
prd: PRD-009
status: Draft
owner: "Sebastian Otaegui"
issue: "N/A"
date: 2026-05-16
version: "1.0"
---

# PRD: pi-sequential-thinking State Foundation

---

## 1. Problem & Context

`packages/pi-sequential-thinking` gives pi users a native structured-thinking extension with staged thoughts, tags, axioms, assumptions, summaries, import/export, and persistent JSON storage. It is useful today, but its state model is still too global and too strict for repeated use by one active pi process:

* `process_thought` only reads snake\_case inputs even though the wider MCP sequential-thinking ecosystem uses camelCase fields such as `thoughtNumber`, `totalThoughts`, and `nextThoughtNeeded`.
* `total_thoughts < thought_number` is rejected, while the canonical MCP sequential-thinking behavior treats the total as an estimate and expands it dynamically.
* validation is split between `extensions/types.ts` and inline checks in `extensions/index.ts`, making future field additions riskier.
* all thoughts live in one implicit `current_session.json`; there is no `session_id`, no read-only history inspection tool, and no way to summarize, clear, export, or import one named session.
* stateful behavior is not observable enough: users cannot ask which storage directory/config is active, whether the store is writable, how many sessions/thoughts exist, or whether a mutating call actually changed persisted state.

These gaps have already appeared in the work that produced this PRD: external MCP examples need manual field-name translation before they can be reused, the current `total_thoughts >= thought_number` rule conflicts with canonical sequential-thinking examples that expand the estimate midstream, and reviewing/clearing the persisted `current_session.json` requires either summary generation or manual file inspection rather than a safe read-only history/status tool. The first implementation is assumption-backed foundation work for one active pi process per storage directory; concurrent multi-process coordination is deliberately not claimed by this slice.

This PRD turns the selected first ideation slice into implementation requirements. It is original work, not a PRD for an existing tracker issue. Related ideation is captured in `docs/ideation/2026-05-16-pi-sequential-thinking-improvements-ideation.md`; deferred work is preserved in `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md`.

---

## 2. Goals & Success Metrics

| Goal                           | Metric                                                                               | Target                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compatible thought capture** | `process_thought` accepts current snake\_case fields and MCP-style camelCase aliases | Existing snake\_case tests pass; new camelCase alias tests pass                                                                                                             |
| **Dynamic depth**              | Calls with `thought_number > total_thoughts` are accepted and normalized             | Stored `total_thoughts` becomes at least `thought_number`; receipt reports the adjustment                                                                                   |
| **Centralized validation**     | Thought validation logic has one implementation path                                 | Inline validation duplication in `processThought` is removed or delegates to shared helpers                                                                                 |
| **Session-scoped history**     | Named sessions can be written, read, summarized, cleared, exported, and imported     | `session_id` works across `process_thought`, `get_thinking_history`, `generate_summary`, `clear_history`, `export_session`, `import_session`, and legacy `sequential_think` |
| **Backward compatibility**     | Existing default-session behavior and legacy exports remain usable                   | Existing non-obsoleted behavior remains covered; tests superseded by this PRD are updated; legacy array and `{ thoughts: [...] }` imports still load                        |
| **State observability**        | Users can inspect effective state without reading files directly                     | New status tool reports effective config, storage path, session counts, writability, and backup/corruption file hints                                                       |
| **Auditable mutations**        | Mutating tools return compact receipts                                               | `process_thought`, `clear_history`, `import_session`, `export_session`, and `sequential_think` include pre/post counts and session metadata                                 |

**Guardrails (must not regress):**

* Existing tools remain registered: `process_thought`, `generate_summary`, `clear_history`, `export_session`, `import_session`, and `sequential_think`.
* Existing snake\_case tool calls continue to work unchanged.
* Existing config resolution continues to work: settings files, `MCP_STORAGE_DIR`, `SEQ_THINK_*` environment variables, and current CLI flags.
* Existing output truncation behavior using `piMaxBytes` and `piMaxLines` continues to apply to new and modified tool outputs.
* Existing default storage at `~/.mcp_sequential_thinking/current_session.json` remains the default-session source of truth.
* No MCP server, network transport, or dual-adapter architecture is introduced by this PRD.

---

## 3. Users & Use Cases

### Primary: pi user doing repeated structured reasoning

> As a pi user, I want to keep separate named thinking sessions so that unrelated reasoning workflows do not overwrite or pollute one another.

**Preconditions:** `@feniix/pi-sequential-thinking` is installed and the user calls the extension tools in pi.

### Secondary: LLM agent using sequential-thinking tools

> As the model executing a multi-step task, I want flexible field aliases, dynamic totals, and history inspection so that I can continue reasoning without failed calls or hidden state assumptions.

**Preconditions:** The model has access to the registered pi tools and can call them with JSON parameters.

### Future: Follow-on feature implementer

> As a developer adding branch/revision metadata later, I want a normalized record model and session-aware storage so that branches can be attached to stable thought histories instead of one global list.

---

## 4. Scope

### In scope

1. **Input normalization** — accept snake\_case and selected MCP-style camelCase aliases for thought capture and serialization boundaries.
2. **Dynamic total adjustment** — treat `total_thoughts` / `totalThoughts` as an estimate and automatically raise it to `thought_number` when needed.
3. **Shared validation helpers** — centralize required field, type, conflict, and normalization validation in `extensions/types.ts` or a new helper module.
4. **Session ID support** — add optional `session_id` / `sessionId` to stateful tools with a path-safe session ID policy.
5. **Read-only history tool** — add `get_thinking_history` with bounded output and session metadata.
6. **Session-aware existing tools** — make summary, clear, export, import, and the legacy `sequential_think` helper operate on the requested session, defaulting to the current default session.
7. **State status tool** — add a tool for effective config, storage path, session counts, backup/corruption hints, and writability.
8. **Mutation receipts** — return compact pre/post state receipts from mutating tools.
9. **Tests and docs** — update unit/runtime tests and `packages/pi-sequential-thinking/README.md`.

### Out of scope / later

| What                                                                            | Why                                                                                                                                                             | Tracked in                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Branch/revision metadata                                                        | Depends on stable sessions/history and should not expand the first slice                                                                                        | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |
| Persistence safety layer: automatic bounds, redaction, and rich export warnings | Important follow-up, but should use the state/status foundation from this PRD; V1 still states a content privacy posture and validates import/export boundaries | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |
| Focused synthesis, outcome contracts, and resume prompts                        | More valuable after sessions and branch metadata exist                                                                                                          | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |
| Redesign, replacement, or deprecation of `sequential_think`                     | This PRD only makes the existing helper session-aware; broader behavior changes are part of later synthesis work                                                | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |
| Evidence/artifact reference anchors                                             | Add after the core thought record shape stabilizes                                                                                                              | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |
| Dual pi extension + MCP server architecture                                     | Separate architectural exploration; not part of this product slice                                                                                              | #99                                                                |
| Full branch switch/merge/close workflows                                        | Too large for the selected foundation slice                                                                                                                     | `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md` |

### Content privacy posture for this slice

Stored thoughts, tags, axioms, and assumptions are potentially sensitive user-authored content. V1 keeps the existing local plaintext JSON storage model and does not add automatic redaction or encryption, but it must make that posture explicit in README documentation and tool descriptions. Content-bearing tools (`get_thinking_history`, `generate_summary`, `export_session`, and `import_session`) may return or move thought content by design; diagnostic surfaces (`get_thinking_status` and mutation receipts) must remain content-free. Export/import operations must be explicit user/model calls and must not be triggered by status or summary tools.

### Implementation slicing within this PRD

The implementation plan should treat this PRD as a sequence of validating increments rather than one irreversible batch. The minimum validating increment is normalization/dynamic totals plus default/named session writes and `get_thinking_history`. Status diagnostics, import/export expansion, and receipts should build on that increment after the storage layout is proven by tests. This preserves the selected foundation scope while reducing reversal cost if the per-session file layout needs adjustment.

### Design for future (build with awareness)

The implementation should normalize inputs into one internal `ThoughtData` shape before storage and analysis. That normalized shape should leave room for later optional metadata such as branch/revision fields, safety warnings, and evidence anchors without forcing those fields into this PRD.

Storage should keep default-session compatibility while making named-session access explicit enough for later features to query one session, list session metadata, or validate references within a session.

---

## 5. Functional Requirements

### FR-1: Normalize thought capture aliases into one internal model

`process_thought` must accept the current snake\_case fields and MCP-style camelCase aliases for the same required thought fields. The implementation must normalize both styles into the existing internal snake\_case `ThoughtData` model before validation, persistence, or analysis.

Minimum aliases:

| Internal field           | Accepted aliases                                  |
| ------------------------ | ------------------------------------------------- |
| `thought_number`         | `thought_number`, `thoughtNumber`                 |
| `total_thoughts`         | `total_thoughts`, `totalThoughts`                 |
| `next_thought_needed`    | `next_thought_needed`, `nextThoughtNeeded`        |
| `axioms_used`            | `axioms_used`, `axiomsUsed`                       |
| `assumptions_challenged` | `assumptions_challenged`, `assumptionsChallenged` |
| `session_id`             | `session_id`, `sessionId`                         |

If both aliases for a field are present with the same value, the call succeeds. If both aliases are present with conflicting values, the call fails with a field-specific validation error. Alias comparison happens after normalization: strings are trimmed, omitted optional arrays normalize to `[]`, and arrays use exact-order deep equality rather than set equality.

**Acceptance criteria:**

```gherkin
Given an empty default thinking session
When the model calls process_thought with thoughtNumber 1, totalThoughts 3, nextThoughtNeeded true, stage "Analysis", and thought "Use aliases"
Then the tool records the thought
And the stored thought has thought_number 1, total_thoughts 3, and next_thought_needed true
```

```gherkin
Given an empty default thinking session
When the model calls process_thought with thought_number 1 and thoughtNumber 2
Then the tool returns an error
And the error identifies the conflicting aliases for thought_number
```

**Files:**

* `packages/pi-sequential-thinking/extensions/types.ts` — define normalized input types, alias normalization, and conflict validation.
* `packages/pi-sequential-thinking/extensions/index.ts` — use normalized inputs in tool handlers and schemas.
* `packages/pi-sequential-thinking/__tests__/types.test.ts` — cover alias normalization and conflicts.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover alias calls through the registered tool.

### FR-2: Support dynamic total\_thoughts adjustment

`total_thoughts` must be treated as an estimate. If a call provides `thought_number` greater than `total_thoughts`, the tool must accept the thought and store `total_thoughts` equal to `thought_number`. The response must include a receipt field that reports the adjustment.

Existing calls where `total_thoughts >= thought_number` must preserve the provided total. Dynamic adjustment normalizes only the incoming thought record; it must not backfill or rewrite earlier thoughts in the same session. Summaries should continue to derive completion from the session's recorded thoughts, using the maximum recorded `total_thoughts` where needed.

**Acceptance criteria:**

```gherkin
Given an empty default thinking session
When the model calls process_thought with thought_number 5, total_thoughts 3, next_thought_needed true, stage "Analysis", and thought "Need more steps"
Then the tool records the thought
And the stored thought has total_thoughts 5
And the tool response includes a receipt showing totalThoughtsAdjusted from 3 to 5
```

**Files:**

* `packages/pi-sequential-thinking/extensions/types.ts` — normalize dynamic totals after required integer validation.
* `packages/pi-sequential-thinking/extensions/index.ts` — include adjustment data in the mutation receipt.
* `packages/pi-sequential-thinking/__tests__/types.test.ts` — replace strict failure expectation with dynamic adjustment expectations.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover dynamic totals through `process_thought`.

### FR-3: Centralize validation and guidance-rich errors

Validation for thought capture must live in shared helpers rather than being duplicated inline. Invalid tool calls must produce actionable errors with field names and messages. The external tool output may remain a text error, but `details.error` or equivalent structured details should preserve the validation information where feasible.

Validation must cover at least:

* non-empty `thought`;
* positive integer `thought_number`;
* positive integer `total_thoughts` before dynamic adjustment;
* boolean `next_thought_needed`;
* valid `stage`;
* array-of-string optional metadata fields;
* alias conflicts;
* session ID format when provided.

**Acceptance criteria:**

```gherkin
Given an empty default thinking session
When the model calls process_thought with thought "   ", thought_number 1, total_thoughts 1, next_thought_needed false, and stage "Analysis"
Then the call fails
And the error includes field "thought" and message "Thought content cannot be empty"
```

```gherkin
Given an empty default thinking session
When the model calls process_thought with session_id "bad/session", thought "x", thought_number 1, total_thoughts 1, next_thought_needed false, and stage "Analysis"
Then the call fails
And the error identifies session_id as invalid
```

**Files:**

* `packages/pi-sequential-thinking/extensions/types.ts` — own validation helpers and exported validation result types.
* `packages/pi-sequential-thinking/extensions/index.ts` — remove or delegate inline checks.
* `packages/pi-sequential-thinking/__tests__/types.test.ts` — cover all validation branches.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover user-visible tool errors.

### FR-4: Add session-scoped storage while preserving the default session

The storage layer must support one default session plus named sessions. Omitting `session_id` must behave like today and use `current_session.json`. Providing a `session_id` must isolate thoughts for that session.

Session IDs must be path-safe. V1 session IDs should allow only letters, numbers, dot, underscore, and hyphen, with a maximum length of 80 characters. Leading/trailing whitespace is trimmed. Empty or invalid IDs fail validation. The case-insensitive ID `default` is reserved for the default session label and must not be accepted as a named session ID.

Named sessions should be persisted under the configured storage directory without changing the default-session file path. A recommended layout is:

* default session: `current_session.json`
* named sessions: `sessions/<session_id>.json`

**Acceptance criteria:**

```gherkin
Given a storage directory with no thoughts
When the model records thought "Default" without session_id
And records thought "Named" with session_id "architecture-review"
Then get_thinking_history without session_id returns only "Default"
And get_thinking_history with session_id "architecture-review" returns only "Named"
```

```gherkin
Given an existing storage directory containing current_session.json from version 3.0.1
When a new ThoughtStorage instance starts
Then default-session history loads from current_session.json
And no migration step is required for default-session reads
```

**Files:**

* `packages/pi-sequential-thinking/extensions/storage.ts` — add session-aware read/write/clear/export/import APIs.
* `packages/pi-sequential-thinking/extensions/types.ts` — add `session_id` input normalization and validation.
* `packages/pi-sequential-thinking/extensions/index.ts` — pass session IDs from tools to storage.
* `packages/pi-sequential-thinking/__tests__/storage.test.ts` — cover default compatibility, named-session isolation, invalid session IDs, and persistence.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover end-to-end session isolation.

### FR-5: Add get\_thinking\_history for bounded read-only inspection

The extension must register a new `get_thinking_history` tool. It returns recorded thoughts for one session without mutating state.

Parameters:

| Parameter                                       | Type    | Required | Default          | Description                                      |
| ----------------------------------------------- | ------- | -------- | ---------------- | ------------------------------------------------ |
| `session_id` / `sessionId`                      | string  | no       | default session  | Session to inspect                               |
| `limit`                                         | integer | no       | 20               | Maximum thoughts to return                       |
| `offset`                                        | integer | no       | 0                | Number of thoughts to skip from the start        |
| `include_full_thoughts` / `includeFullThoughts` | boolean | no       | true             | Whether to include full thought text or snippets |
| `piMaxBytes`                                    | integer | no       | configured limit | Existing output truncation override              |
| `piMaxLines`                                    | integer | no       | configured limit | Existing output truncation override              |

`limit` must be bounded to prevent accidental full dumps. V1 should enforce `1 <= limit <= 100`. History is returned in persisted insertion order from oldest to newest; `offset` and `limit` are applied after that ordering. This order is intentionally different from summaries that may present a stage/timeline view.

**Acceptance criteria:**

```gherkin
Given session "plan" contains 3 thoughts numbered 1, 2, and 3
When the model calls get_thinking_history with session_id "plan" and limit 2
Then the response includes session_id "plan"
And it returns 2 thoughts
And it reports totalThoughts 3 and hasMore true
```

```gherkin
Given session "plan" contains a long thought
When the model calls get_thinking_history with include_full_thoughts false
Then the response includes a snippet for that thought
And it does not include the full thought body
```

**Files:**

* `packages/pi-sequential-thinking/extensions/index.ts` — define schema and register `get_thinking_history`.
* `packages/pi-sequential-thinking/extensions/storage.ts` — provide bounded session history retrieval.
* `packages/pi-sequential-thinking/extensions/types.ts` — define history request validation helpers if shared.
* `packages/pi-sequential-thinking/__tests__/index.test.ts` — assert tool registration.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover history calls, limits, offsets, and snippets.
* `packages/pi-sequential-thinking/README.md` — document the new tool.

### FR-6: Make summary, clear, export, and import session-aware

Existing stateful tools must accept optional `session_id` / `sessionId` and default to the default session when omitted.

Required behavior:

* `generate_summary` summarizes only the selected session.
* `clear_history` clears only the selected session.
* `export_session` exports only the selected session and includes session metadata.
* `import_session` imports into the selected session; when omitted, it imports into the embedded `sessionId` from a new-format export; when no target or embedded session exists, it imports into the default session.
* `sequential_think` remains the existing legacy helper, but accepts optional `session_id` / `sessionId`, writes its generated staged prompts to the selected session, summarizes only that session, and returns a mutation receipt. Broader redesign, replacement, or deprecation is out of scope.
* Existing import formats remain accepted: legacy array exports and `{ thoughts: [...] }` objects.

New-format exports must use this top-level schema:

```json
{
  "schemaVersion": 1,
  "sessionId": null,
  "sessionLabel": "default",
  "thoughts": [],
  "lastUpdated": "2026-05-16T00:00:00.000Z",
  "exportedAt": "2026-05-16T00:00:00.000Z",
  "metadata": {
    "totalThoughts": 0,
    "stages": {}
  }
}
```

For named sessions, `sessionId` is the normalized session ID and `sessionLabel` matches it. The default session uses `sessionId: null` and `sessionLabel: "default"`. If a caller provides `session_id` during import and it conflicts with the file's embedded `sessionId`, the provided target wins and the receipt includes a warning.

Import/export file boundary policy:

* `file_path` may be absolute or repo-relative, matching existing tool behavior, but parent directories are created only for export.
* Export must not overwrite a directory; if the target file already exists, overwrite is allowed only for explicit `export_session` calls and the receipt reports `overwroteExistingFile`.
* Import must validate JSON shape, enforce a default maximum import file size of 10 MiB before parsing, reject malformed top-level records with a structured error, and preserve the existing corrupted-current-session backup behavior for active storage files.
* Import treats files as untrusted content: it must normalize IDs/timestamps/session IDs through the same validation path as tool input and must never execute or dereference paths, URLs, or text inside thought records.

**Acceptance criteria:**

```gherkin
Given default session contains one thought
And session "research" contains two thoughts
When the model calls generate_summary with session_id "research"
Then the summary reports totalThoughts 2
And it does not include the default-session thought
```

```gherkin
Given session "research" contains two thoughts
When the model calls clear_history with session_id "research"
Then session "research" is empty
And the default session is unchanged
And the response includes preCount 2 and postCount 0
```

```gherkin
Given an export file in legacy array format
When the model calls import_session with file_path "legacy.json" and session_id "legacy-import"
Then get_thinking_history with session_id "legacy-import" returns the imported thoughts
And the default session is unchanged
```

```gherkin
Given session "scratch" is empty
When the model calls sequential_think with topic "Database migration strategy", num_thoughts 5, and session_id "scratch"
Then the generated staged prompts are stored in session "scratch"
And the default session is unchanged
And the response includes a receipt with operation "sequential_think"
```

```gherkin
Given a new-format export embeds sessionId "research"
When the model calls import_session with file_path "research.json" and session_id "review"
Then the imported thoughts are written to session "review"
And the response receipt includes a session mismatch warning
```

**Files:**

* `packages/pi-sequential-thinking/extensions/index.ts` — add optional session params and receipts to existing tools.
* `packages/pi-sequential-thinking/extensions/storage.ts` — implement session-aware clear/export/import/summary access.
* `packages/pi-sequential-thinking/__tests__/storage.test.ts` — cover import/export and clear per session.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover session-aware tools through registered runtime.
* `packages/pi-sequential-thinking/README.md` — update tool docs and examples.

### FR-7: Add state observability status tool

The extension must register a read-only status tool, named `get_thinking_status`, that reports effective runtime state without dumping thought content.

The response must include at least:

* `storageDir` as the resolved active storage directory, redacted to `~` for the current user's home directory by default;
* `defaultSessionFile` as the default session file path or relative file name, also home-redacted by default;
* `pathDisclosure` describing whether paths are `home_redacted`, `relative`, or `absolute_diagnostic`;
* `namedSessionCount`;
* `totalThoughts` across known sessions;
* `sessions` metadata with `sessionId`, `label`, `thoughtCount`, `lastUpdated`, and `isDefault`;
* `effectiveConfig` with `storageDir`, `maxBytes`, and `maxLines`, plus source labels such as `flag`, `env`, `project_settings`, `global_settings`, `config_file`, or `default`; all path-bearing fields inside `effectiveConfig`, including `effectiveConfig.storageDir`, use the same redaction policy as top-level status paths;
* `writable` for whether the storage directory appears writable;
* `backupFiles` as relative filenames under the storage directory, not absolute paths;
* `statusCompleteness`, with `complete: true` when all known session files were inspected and `complete: false` plus a reason when a documented threshold prevents full enumeration;
* `schemaVersion` or `storageVersion` when available.

V1 may compute status by scanning the default session file and `sessions/*.json` files rather than maintaining a metadata index. Default enumeration threshold is 100 named session files; above that threshold, status may return partial counts with `statusCompleteness.complete: false` instead of loading every session file.

The tool must not include full thought text, thought snippets, tags, axioms, assumptions, or content-derived hashes. Absolute path disclosure, if added later for diagnostics, must be an explicit option and must not be the default.

**Acceptance criteria:**

```gherkin
Given default session has 1 thought
And named session "research" has 2 thoughts
When the model calls get_thinking_status
Then the response includes storageDir with the current user's home directory redacted to ~
And it reports pathDisclosure "home_redacted"
And it reports namedSessionCount 1
And it reports totalThoughts 3
And it includes session metadata where the default session has sessionId null and label "default"
And it includes session metadata for "research"
And it does not include the full text of any thought
```

**Files:**

* `packages/pi-sequential-thinking/extensions/index.ts` — define schema and register `get_thinking_status`.
* `packages/pi-sequential-thinking/extensions/storage.ts` — expose storage diagnostics and session metadata.
* `packages/pi-sequential-thinking/__tests__/index.test.ts` — assert tool registration.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover status output.
* `packages/pi-sequential-thinking/README.md` — document the status tool.

### FR-8: Return mutation receipts from state-changing tools

Mutating tools must include compact receipts that make state changes auditable. For this PRD, mutating tools are `process_thought`, `clear_history`, `export_session`, `import_session`, and `sequential_think`. Receipts must avoid full thought content and should be stable enough for tests.

Receipt fields should include:

* `operation`;
* `sessionId` with `null` for the default session;
* `sessionLabel` with `"default"` for the default session;
* `preCount`;
* `postCount`;
* `changed`;
* `savedAt` or `exportedAt` / `importedAt`;
* `stateFingerprint` derived only from non-content inputs: schema/storage version, normalized session ID, thought count, thought IDs, thought timestamps, and session `lastUpdated`;
* optional operation-specific data such as `totalThoughtsAdjusted` or import warnings.

V1 identity rules:

* New thoughts continue to receive an `id` and `timestamp` before storage.
* Imported legacy thoughts without an `id` receive a generated ID during normalization.
* Imported legacy thoughts without a `timestamp` receive an import-time timestamp and the receipt includes a normalization warning.
* Fingerprints are allowed to change after an import that normalizes missing IDs or timestamps; this is expected and must be visible through import warnings.

`stateFingerprint` must not hash or encode thought text, tags, axioms, assumptions, or local absolute paths.

**Acceptance criteria:**

```gherkin
Given session "research" contains 1 thought
When the model calls process_thought with session_id "research" and a second valid thought
Then the response includes a receipt with operation "process_thought"
And preCount is 1
And postCount is 2
And changed is true
And stateFingerprint is present
```

```gherkin
Given session "research" is empty
When the model calls clear_history with session_id "research"
Then the response includes changed false
And preCount is 0
And postCount is 0
And stateFingerprint is present
```

**Files:**

* `packages/pi-sequential-thinking/extensions/index.ts` — attach receipts to mutating tool responses.
* `packages/pi-sequential-thinking/extensions/storage.ts` — provide counts, save metadata, and fingerprint inputs.
* `packages/pi-sequential-thinking/__tests__/runtime.test.ts` — cover user-visible receipts.
* `packages/pi-sequential-thinking/__tests__/storage.test.ts` — cover receipt-supporting metadata.

### FR-9: Update documentation and preserve package ergonomics

Documentation must reflect the new first-slice behavior without implying that later backlog work is already implemented.

Required README updates:

* new `session_id` usage examples;
* `get_thinking_history` documentation;
* `get_thinking_status` documentation;
* dynamic total behavior;
* accepted alias naming;
* default-session backward compatibility;
* explicit note that branch/revision metadata and dual MCP server architecture are not included in this release;
* local plaintext storage posture, including which tools are content-bearing and which diagnostics stay content-free;
* import/export path, overwrite, and maximum import-size behavior.

**Acceptance criteria:**

```gherkin
Given a developer opens packages/pi-sequential-thinking/README.md
When they read the Tools section
Then they can see how to record a thought in a named session
And how to inspect that session history
And how to check storage/status diagnostics
```

**Files:**

* `packages/pi-sequential-thinking/README.md` — update feature list, tool docs, examples, and limitations.
* `packages/pi-sequential-thinking/__tests__/index.test.ts` — ensure registered tool list expectations include new tools.

---

## 6. Non-Functional Requirements

| Category                   | Requirement                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backward compatibility** | Existing persisted default-session files and legacy exports must continue to load without a manual migration step.                                                                                                                             |
| **No new transport scope** | The implementation must remain a native pi extension and must not add an MCP server entrypoint.                                                                                                                                                |
| **Dependency discipline**  | Prefer no new runtime dependencies; if a dependency is necessary, justify it in the implementation plan before adding it.                                                                                                                      |
| **Path safety**            | Named session IDs must not allow path traversal, directory separators, or the reserved case-insensitive ID `default`.                                                                                                                          |
| **Determinism**            | Validation and alias conflict behavior must be deterministic and covered by tests.                                                                                                                                                             |
| **Privacy**                | Stored thoughts are potentially sensitive plaintext local content; status and receipts must remain content-free, all status path fields must be home-redacted by default, and README/tool docs must state the local plaintext storage posture. |
| **Concurrency**            | V1 targets one active pi process per storage directory; if concurrent writers exist, behavior is last-writer-wins and must not be presented as lock-safe.                                                                                      |
| **Performance**            | Status and history reads should be bounded and avoid loading more content than needed for requested session output where practical.                                                                                                            |
| **Testability**            | All new tools and storage paths must be covered by fast Vitest tests under `packages/pi-sequential-thinking/__tests__/`.                                                                                                                       |

---

## 7. Risks & Assumptions

### Risks

| Risk                                                         | Severity | Likelihood | Mitigation                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session storage migration breaks existing users              | High     | Medium     | Keep default session at `current_session.json`; add tests using existing export/current-session shapes.                                                                                           |
| Alias support creates ambiguous inputs                       | Medium   | Medium     | Fail on conflicting aliases rather than choosing precedence; document accepted aliases.                                                                                                           |
| Status output leaks thought content or sensitive paths       | Medium   | Low        | Build status from metadata only, redact home paths by default, use relative backup filenames, and add tests that known thought text and raw home paths are absent.                                |
| Receipts become noisy and destabilize tests                  | Medium   | Medium     | Keep receipt schema compact; assert field presence and stable counts rather than exact timestamps.                                                                                                |
| Test expectations conflict with intentional behavior changes | Medium   | Low        | Update tests that encode superseded behavior, including strict `total_thoughts >= thought_number` rejection and empty-object import handling, while preserving non-obsoleted compatibility tests. |
| Import/export semantics become confusing with sessions       | Medium   | Medium     | Document import destination precedence clearly: explicit `session_id` wins; otherwise embedded `sessionId` is used; otherwise import into the default session.                                    |
| This first slice drifts into branch/revision or safety work  | Medium   | Medium     | Keep out-of-scope table explicit and defer those to the later backlog.                                                                                                                            |
| Concurrent pi processes overwrite session files              | Medium   | Low        | Narrow V1 language to one active pi process per storage directory; preserve atomic rename writes; do not claim cross-process locking until a later locking/index design exists.                   |

### Assumptions

* The PRD is for original repository work, not for a source GitHub or Linear issue.
* `session_id` can be optional and omitted calls should continue to mean the default session.
* Named session IDs do not need human-readable titles or archive status in this first slice.
* Per-session files are acceptable for V1 and easier to inspect/recover than one monolithic sessions file.
* V1 can assume a single active pi process per storage directory; cross-process locking is not part of this PRD.
* Local plaintext storage is acceptable for V1 when documented; automatic redaction/encryption is deferred.
* Existing output truncation is sufficient for V1 bounded responses when combined with `get_thinking_history` limits.
* Default import file size limit is 10 MiB.
* Default status enumeration threshold is 100 named session files.

---

## 8. Design Decisions

### D1: Normalize to the existing snake\_case internal model

**Options considered:**

1. Keep snake\_case only — simplest implementation, but preserves compatibility friction with MCP-style examples.
2. Convert the internal model to camelCase — aligns with MCP serialization, but creates unnecessary churn across current code/tests.
3. Accept aliases at boundaries and normalize internally to snake\_case — supports both users while preserving existing internals.

**Decision:** Accept aliases at tool/input boundaries and normalize into the existing snake\_case internal `ThoughtData` shape.

**Rationale:** This maximizes compatibility while minimizing implementation churn and preserving current tests/docs patterns.

**Future path:** Later branch/revision aliases can follow the same boundary-normalization pattern.

### D2: Fail on conflicting aliases

**Options considered:**

1. Prefer snake\_case when both aliases are present — predictable for existing users but can hide model mistakes.
2. Prefer camelCase when both aliases are present — aligns with MCP, but can surprise pi-native callers.
3. Fail when aliases conflict — more strict, but safest and easiest to debug.

**Decision:** If both aliases are present with different values, return a validation error.

**Rationale:** Silent precedence would make tool calls harder to audit and could store the wrong thought metadata.

### D3: Preserve `current_session.json` for the default session

**Options considered:**

1. Migrate all sessions into a new combined file — easier global status, but risky for existing users.
2. Keep default session at `current_session.json` and store named sessions separately — preserves compatibility and allows incremental adoption.
3. Keep one global list and add `session_id` fields inside each thought — simpler storage file, but makes session clear/export/import less isolated.

**Decision:** Preserve `current_session.json` for the default session and store named sessions under a `sessions/` directory.

**Rationale:** This avoids a mandatory migration and keeps session files inspectable and recoverable.

**Future path:** A future storage version can add an index file if session listing becomes too expensive or needs richer metadata.

### D4: Add read-only status rather than expanding summaries

**Options considered:**

1. Put config/storage diagnostics in `generate_summary` — fewer tools, but mixes content summary with runtime diagnostics.
2. Add `get_thinking_status` — clearer separation between state diagnostics and reasoning summaries.
3. Only document where files live — requires users to inspect local storage manually.

**Decision:** Add `get_thinking_status` as a separate read-only tool.

**Rationale:** State observability is operational, not cognitive summary. A separate tool can avoid thought content and stay safe to call.

### D5: Import destination precedence

**Options considered:**

1. Always import into the embedded `sessionId` from the export file — convenient for restores, but surprising when a caller explicitly targets a session.
2. Always ignore embedded `sessionId` — predictable for explicit calls, but loses useful restore metadata when no target is supplied.
3. Use explicit `session_id` when provided; otherwise use embedded `sessionId`; otherwise use the default session — preserves metadata while respecting caller intent.

**Decision:** Explicit `session_id` / `sessionId` wins over embedded export metadata. A mismatch emits an import warning in the receipt.

**Rationale:** Tool arguments should be authoritative, but export metadata should still make no-argument restores useful.

---

## 9. File Breakdown

| File                                                        | Change type | FR                                             | Description                                                                                                                                   |
| ----------------------------------------------------------- | ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-sequential-thinking/extensions/types.ts`       | Modify      | FR-1, FR-2, FR-3, FR-4, FR-5                   | Add normalized input/session types, alias handling, dynamic total adjustment, and shared validation helpers.                                  |
| `packages/pi-sequential-thinking/extensions/storage.ts`     | Modify      | FR-4, FR-5, FR-6, FR-7, FR-8                   | Add session-aware storage APIs, bounded history reads, diagnostics, counts, and receipt-supporting metadata.                                  |
| `packages/pi-sequential-thinking/extensions/index.ts`       | Modify      | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8 | Update schemas, tool handlers, `sequential_think` session behavior, new `get_thinking_history` and `get_thinking_status` tools, and receipts. |
| `packages/pi-sequential-thinking/README.md`                 | Modify      | FR-9                                           | Document session IDs, aliases, dynamic totals, history/status tools, examples, and exclusions.                                                |
| `packages/pi-sequential-thinking/__tests__/types.test.ts`   | Modify      | FR-1, FR-2, FR-3, FR-4, FR-5                   | Cover normalization, validation, alias conflicts, dynamic totals, and session ID validation.                                                  |
| `packages/pi-sequential-thinking/__tests__/storage.test.ts` | Modify      | FR-4, FR-5, FR-6, FR-7, FR-8                   | Cover named/default session persistence, bounded reads, import/export, diagnostics, and metadata.                                             |
| `packages/pi-sequential-thinking/__tests__/index.test.ts`   | Modify      | FR-5, FR-7, FR-9                               | Assert new tool registrations and preserve existing registration expectations.                                                                |
| `packages/pi-sequential-thinking/__tests__/runtime.test.ts` | Modify      | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8 | Cover end-to-end registered tool behavior for aliases, sessions, history, status, and receipts.                                               |
| `packages/pi-sequential-thinking/__tests__/helpers.test.ts` | Modify      | FR-7, FR-8                                     | Extend helper coverage if status/receipt helpers are exported for testing.                                                                    |

---

## 10. Dependencies & Constraints

* The package is a TypeScript pi extension with entrypoint `packages/pi-sequential-thinking/extensions/index.ts`.
* The package uses TypeBox schemas for tool parameters.
* Existing peer dependencies in `packages/pi-sequential-thinking/package.json` should remain sufficient for this PRD unless the implementation plan proves otherwise.
* Tests should run with `npx vitest run packages/pi-sequential-thinking/__tests__`.
* Type checking should run with `npx tsc --noEmit --project packages/pi-sequential-thinking/tsconfig.json`.
* Formatting/linting should run with `npx biome ci packages/pi-sequential-thinking`.
* Default storage remains `~/.mcp_sequential_thinking` when no storage directory is configured.
* Repository paths in documentation and tests must remain repo-relative.

---

## 11. Rollout Plan

1. Add shared normalization and validation helpers with tests, including dynamic total adjustment.
2. Update `process_thought` to use the shared helpers and emit mutation receipts.
3. Extend `ThoughtStorage` for default/named session writes while preserving `current_session.json` behavior.
4. Add `get_thinking_history` and prove default/named session isolation as the minimum validating increment.
5. Add session-aware summary/clear/export/import behavior, including the file boundary policy and import normalization warnings.
6. Add `get_thinking_status` and storage diagnostics, including home-redacted paths and the V1 enumeration threshold.
7. Update README examples, tool documentation, and plaintext local-storage privacy posture.
8. Run targeted package tests, typecheck, and Biome checks.

---

## 12. Open Questions

| #  | Question                                                                          | Owner             | Due        | Status                                                                                                                                                                      |
| -- | --------------------------------------------------------------------------------- | ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 | Should branch/revision metadata be included in this first slice?                  | Sebastian Otaegui | 2026-05-16 | **Resolved:** No. It is deferred to the later backlog.                                                                                                                      |
| Q2 | Should dual pi extension + MCP server architecture be part of this PRD?           | Sebastian Otaegui | 2026-05-16 | **Resolved:** No. It is tracked separately in #99.                                                                                                                          |
| Q3 | Should named session IDs allow slashes or nested paths?                           | Sebastian Otaegui | 2026-05-16 | **Resolved:** No. V1 session IDs are path-safe labels only.                                                                                                                 |
| Q4 | Should `get_thinking_history` default to returning full thought bodies?           | Sebastian Otaegui | 2026-05-16 | **Resolved:** Yes, bounded by `limit` and existing output truncation; snippets are available through `include_full_thoughts: false`.                                        |
| Q5 | Should `sequential_think` participate in sessions?                                | Sebastian Otaegui | 2026-05-16 | **Resolved:** Yes, as a compatibility shim only. It accepts optional `session_id`, writes to the selected session, and returns receipts; broader redesign remains deferred. |
| Q6 | What wins when an import file embeds one session but the caller passes another?   | Sebastian Otaegui | 2026-05-16 | **Resolved:** The caller-provided session wins and the receipt reports a warning.                                                                                           |
| Q7 | Does V1 protect persisted thought content with encryption or automatic redaction? | Sebastian Otaegui | 2026-05-16 | **Resolved:** No. V1 keeps local plaintext JSON storage, documents that posture, and keeps diagnostics content-free; richer safety/redaction is deferred.                   |
| Q8 | Does V1 support concurrent writers to the same storage directory?                 | Sebastian Otaegui | 2026-05-16 | **Resolved:** No. V1 targets one active pi process per storage directory and documents last-writer-wins if users violate that assumption.                                   |
| Q9 | What are V1's default import and status thresholds?                               | Sebastian Otaegui | 2026-05-16 | **Resolved:** Imports reject files over 10 MiB by default; status may return partial counts after 100 named session files.                                                  |

---

## 13. Related

| Issue                                                                                  | Relationship                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `docs/ideation/2026-05-16-pi-sequential-thinking-improvements-ideation.md`             | Source ideation for selected first slice                                  |
| `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md`                     | Deferred related ideas after this PRD                                     |
| #99 — Explore dual pi extension and MCP server architecture for pi-sequential-thinking | Related but explicitly out of scope                                       |
| `packages/pi-code-reasoning/extensions/types.ts`                                       | Local reference for validation discipline and branch/revision future work |
| `docs/adr/ADR-0016-stateful-exa-research-planning-tools.md`                            | Related precedent for stateful tools over prompt-only workflows           |
| `docs/adr/ADR-0017-in-memory-exa-research-planning-sessions.md`                        | Related precedent for scoping session persistence tradeoffs               |

---

## 14. Changelog

| Date       | Change                             | Author            |
| ---------- | ---------------------------------- | ----------------- |
| 2026-05-16 | Addressed second refine findings   | Sebastian Otaegui |
| 2026-05-16 | Addressed document review findings | Sebastian Otaegui |
| 2026-05-16 | Initial draft                      | Sebastian Otaegui |

---

## 15. Verification (Appendix)

Post-implementation checklist:

1. Run `npx vitest run packages/pi-sequential-thinking/__tests__`.
2. Run `npx tsc --noEmit --project packages/pi-sequential-thinking/tsconfig.json`.
3. Run `npx biome ci packages/pi-sequential-thinking`.
4. Manually exercise `process_thought` with snake\_case fields and verify existing behavior still works.
5. Manually exercise `process_thought` with camelCase aliases and verify stored history is normalized.
6. Record thoughts in default session and a named session, then confirm `get_thinking_history` returns isolated results.
7. Call `sequential_think` with a named `session_id` and confirm generated prompts are written only to that session with a receipt.
8. Call `get_thinking_status` and confirm it reports storage/session metadata, config source labels, home-redacted paths, status completeness, and relative backup filenames without thought content.
9. Export and import a legacy `{ thoughts: [...] }` session into a named session and confirm the default session remains unchanged.
10. Import a new-format export with an embedded `sessionId` into a different explicit `session_id` and confirm the explicit target wins with a warning.
11. Import legacy thoughts missing IDs or timestamps and confirm generated identity fields plus receipt warnings.
12. Attempt import/export with malformed files, directories, and oversized files and confirm structured errors without unintended state changes.

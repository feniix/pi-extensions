---
title: "pi-sequential-thinking State Foundation"
prd: "PRD-009-pi-sequential-thinking-state-foundation"
date: 2026-05-16
author: "pi"
status: Implemented
---

# Plan: pi-sequential-thinking State Foundation

## Source

* **PRD**: `docs/prd/PRD-009-pi-sequential-thinking-state-foundation.md`
* **Date**: 2026-05-16
* **Author**: pi

## Architecture Overview

Implement the state foundation as a boundary-normalization and storage refactor of `packages/pi-sequential-thinking`, not as a new package or MCP transport. The current extension already has the right broad shape: `extensions/index.ts` owns tool registration/config/output truncation, `extensions/types.ts` owns thought data and serialization helpers, `extensions/storage.ts` owns JSON persistence, and `extensions/analyzer.ts` summarizes already-loaded thoughts. The plan keeps that shape and adds named sessions, read-only history/status tools, and mutation receipts around it.

The user-facing premise from PRD-009 is that repeated structured reasoning currently fails at the tool boundary and state boundary: MCP-style examples need translation, dynamic reasoning depth can be rejected, unrelated reasoning shares one implicit session, and users cannot inspect state safely without file reads. This implementation bundle is the direct path because normalization reduces call failures, named sessions isolate workflows, history/status tools make state inspectable, and receipts prove whether mutations changed the selected session.

The first architectural move is to create one normalization/validation boundary before any tool handler builds `ThoughtData`. Tool calls may arrive as snake\_case or selected MCP-style camelCase, but the rest of the package should continue using the existing snake\_case internal model. This keeps churn small while satisfying PRD-009 FR-1 through FR-3. Dynamic total adjustment is applied only to the incoming thought record; prior records are not rewritten.

The second move is to make `ThoughtStorage` session-aware while preserving `current_session.json` as the default-session file. Named sessions live under `sessions/<session_id>.json`. This per-session file layout is simple, backward-compatible, and inspectable, but V1 explicitly targets one active pi process per storage directory and does not claim cross-process locking. Phase 2 must treat that as a tested/documented runtime invariant rather than an implicit hope: if expected deployments require multiple writers sharing one storage directory, pause and add a locking/read-modify-write design before session-aware writes land. Status may scan session files up to the PRD-defined threshold of 100 named sessions; above that it reports partial completeness rather than inventing an index.

## Components

### 1. Input Normalization and Validation

**Purpose**: Convert all supported tool inputs into one validated internal shape before storage or analysis.

**Key Details**:

* Add constants and helpers in `packages/pi-sequential-thinking/extensions/types.ts`:
  * `DEFAULT_SESSION_LABEL = "default"`
  * `SCHEMA_VERSION = 1`
  * `MAX_IMPORT_BYTES = 10 * 1024 * 1024`
  * `STATUS_ENUMERATION_SESSION_THRESHOLD = 100`
  * `normalizeSessionId(value)` with trim, path-safe validation, and reserved `default` rejection.
  * `normalizeThoughtInput(args)` with alias conflict detection.
  * validation helpers for required strings, booleans, positive integers, optional string arrays, and stage values.
  * TypeBox parameter-schema helpers for aliasable inputs. Do not keep snake\_case alias fields TypeBox-required while expecting camelCase-only calls to work; either optionalize alias pairs and enforce requiredness in shared validation, or use a schema union/anyOf that accepts snake\_case, camelCase, and mixed matching aliases.
* Alias comparison happens after normalization. Arrays use exact-order deep equality.
* Dynamic total adjustment happens after positive-integer validation and returns metadata such as `totalThoughtsAdjusted` for receipts.
* Keep `thoughtFromDict` / `thoughtToDict` compatible with existing persisted camelCase exports while routing new import normalization through shared helpers.
* Runtime errors should preserve field-level validation details in tool `details` where practical, while keeping text output readable.

**ADR Reference**: None — this is boundary implementation for requirements already settled by PRD-009.

### 2. Session-Aware Storage

**Purpose**: Isolate default and named session histories while preserving default-session compatibility.

**Key Details**:

* Refactor `packages/pi-sequential-thinking/extensions/storage.ts` around session accessors instead of one in-memory `thoughts` array:
  * default session file remains `current_session.json`.
  * named session files live at `sessions/<session_id>.json`.
  * public methods accept optional normalized session IDs: `addThought`, `getThoughts`, `clearHistory`, `exportSession`, `importSession`, `getHistory`, `getSessionMetadata`, `getStatus`.
* Keep legacy compatibility:
  * array exports import successfully.
  * `{ thoughts: [...] }` exports import successfully.
  * `current_session.json` loads without migration.
* Imported thought records accept both snake\_case and camelCase serialization names. In particular, legacy snake\_case `thought_number`, `total_thoughts`, and `next_thought_needed` values must be preserved rather than silently defaulted.
* Create the storage directory and session files with restrictive permissions where supported by the platform, such as owner-only directories and files on POSIX systems. Document residual plaintext-at-rest risk because permissions reduce casual local exposure but do not encrypt content or control backups/sync tools.
* New-format exports use PRD-009 schema fields: `schemaVersion`, `sessionId`, `sessionLabel`, `thoughts`, `lastUpdated`, `exportedAt`, and `metadata`.
* Imports normalize missing legacy IDs/timestamps and report warnings to the caller.
* Export may overwrite an existing file only on explicit `export_session`; the receipt reports `overwroteExistingFile`.
* Import/export path policy is explicit: `file_path` may be absolute or repo-relative, repo-relative paths resolve from the current working directory, parent directories are created only for export, directory targets are rejected, export rejects a symlink as the final path component to avoid overwriting an unexpected target, and receipts/errors use the same home-redacted path policy as status.
* Import validates file size before parsing, rejects malformed top-level records, and treats thought text as untrusted inert content.

**ADR Reference**: ADR candidate — per-session JSON storage is durable and shapes future branch/revision work.

### 3. History and Session-Scoped Tool Surface

**Purpose**: Make state inspectable and session-scoped at the tool layer.

**Key Details**:

* Update TypeBox schemas in `packages/pi-sequential-thinking/extensions/index.ts`:
  * add optional `session_id` / `sessionId` to stateful tools.
  * accept camelCase aliases at the schema boundary for thought capture fields while retaining snake\_case examples.
  * avoid parameter schemas that reject camelCase-only calls before shared normalization/validation can run.
  * add `get_thinking_history` parameters: `session_id` / `sessionId`, `limit`, `offset`, `include_full_thoughts` / `includeFullThoughts`, `piMaxBytes`, `piMaxLines`.
* `process_thought` flow:
  1. split pi output-limit params;
  2. normalize/validate thought input;
  3. capture pre-count;
  4. store thought in selected session;
  5. analyze only that session's thoughts;
  6. return analysis plus receipt.
* `get_thinking_history` returns persisted insertion order from oldest to newest, with offset/limit applied after ordering.
* `get_thinking_history` enforces PRD defaults and bounds: `limit` defaults to 20, `1 <= limit <= 100`, `offset` defaults to 0, and `include_full_thoughts` defaults to true.
* Trust boundary for content-bearing tools is explicit: V1 assumes callers with access to the local pi tool set are trusted to read local thought content. `get_thinking_history`, `generate_summary`, and export/import docs must label themselves content-bearing; no additional auth layer is added in this slice.
* `generate_summary` passes only the selected session's thoughts to `ThoughtAnalyzer`. `ThoughtAnalyzer` should not need broad changes unless the implementation chooses to add session metadata to summary wrappers.
* `clear_history`, `export_session`, and `import_session` default to the default session when no session target or embedded import session exists.
* `sequential_think` remains a compatibility shim: it accepts optional `session_id` / `sessionId`, writes generated stage prompts to the selected session, summarizes only that session, and returns a receipt.

**ADR Reference**: None — follows PRD-009 tool-scope decisions.

### 4. Receipts, Fingerprints, and Status Diagnostics

**Purpose**: Make mutations and storage state auditable without exposing thought content.

**Key Details**:

* Introduce the final shared receipt/fingerprint builder before the first receipt-bearing tool is wired, likely in `storage.ts` or a new package-local helper if it keeps `index.ts` simpler.
* Receipt fields match PRD-009: `operation`, `sessionId`, `sessionLabel`, `preCount`, `postCount`, `changed`, timestamp, optional warnings, and `stateFingerprint`.
* Fingerprints are derived only from non-content metadata: schema/storage version, normalized session ID, thought count, thought IDs, thought timestamps, and session `lastUpdated`.
* Fingerprints are receipt-correlation and non-content state-change indicators, not tamper-proof integrity proofs. They must not be documented or tested as detecting edits to thought text, tags, axioms, or assumptions when IDs/timestamps/counts are preserved.
* Add `resolveEffectiveConfig()` or equivalent so runtime code and `get_thinking_status` share one source of truth for `storageDir`, `maxBytes`, `maxLines`, and each value's source label (`flag`, `env`, `project_settings`, `global_settings`, `config_file`, or `default`).
* Add `get_thinking_status` in `index.ts` backed by storage diagnostics:
  * home-redacted `storageDir`, `defaultSessionFile`, and every path-bearing `effectiveConfig` field;
  * `pathDisclosure`;
  * `namedSessionCount`;
  * `totalThoughts` when complete;
  * per-session metadata without thought text/tags/axioms/assumptions;
  * config source labels;
  * `writable`;
  * relative `backupFiles`;
  * `statusCompleteness`.
* `get_thinking_status` accepts `piMaxBytes` and `piMaxLines` and routes output through the same truncation path as the existing tools.
* V1 status scans `current_session.json` and up to 100 named session files. If more named files exist, return partial status with `statusCompleteness.complete: false`.
* Do not include raw absolute paths by default; any future absolute-path diagnostic option is outside this plan.

**ADR Reference**: None — operational diagnostics are implementation detail under PRD-009.

### 5. Tests and Documentation

**Purpose**: Lock the new behavior while preserving non-obsoleted compatibility.

**Key Details**:

* Update tests before implementation for each phase:
  * `__tests__/types.test.ts`: alias normalization, conflict detection, dynamic totals, session ID validation, import normalization helpers.
  * `__tests__/storage.test.ts`: default-session compatibility, named-session isolation, new export schema, legacy imports, malformed/oversized import errors, status metadata, backup file reporting, receipt inputs.
  * `__tests__/runtime.test.ts`: registered tool behavior for aliases, sessions, history, status, receipts, and `sequential_think` session behavior.
  * `__tests__/index.test.ts`: new tool registrations.
  * `__tests__/helpers.test.ts`: any exported helpers for redaction, fingerprints, or config-source status.
* Update superseded tests intentionally:
  * strict `total_thoughts < thought_number` rejection becomes dynamic adjustment.
  * empty-object imports should become malformed top-level import errors for explicit import calls, while missing active storage still loads as empty.
* Update `packages/pi-sequential-thinking/README.md` with named-session examples, alias support, dynamic totals, history/status tools, local plaintext storage posture, content-bearing vs diagnostic tools, import/export path behavior, and exclusions.

**ADR Reference**: None — verification and documentation work.

## Implementation Order

| Phase | Component                                                                  | Dependencies                                                | Estimated Scope |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| 1     | Input Normalization and Validation                                         | None                                                        | M               |
| 2     | Session-Aware Storage Foundation                                           | Phase 1 constants/session validation + storage ADR decision | L               |
| 3     | Minimum Validating Tool Slice (`process_thought` + `get_thinking_history`) | Phase 1, Phase 2                                            | M               |
| 4     | Session-Aware Existing Tools and Import/Export Boundaries                  | Phase 2, Phase 3                                            | L               |
| 5     | Receipts, Fingerprints, and Status Diagnostics                             | Phase 2, Phase 3, Phase 4                                   | M               |
| 6     | README and Final Regression Coverage                                       | Phases 1-5                                                  | S               |

### Phase 1: Input Normalization and Validation

Outcome: tool inputs can be normalized and validated independently of storage/tool handlers.

Steps:

1. Add normalization result types to `extensions/types.ts`, including normalized thought input and receipt adjustment metadata.
2. Add alias-resolution helper that accepts exactly the PRD-defined aliases and fails on conflicting post-normalization values.
3. Add TypeBox parameter schemas for aliasable fields so camelCase-only calls can reach shared validation instead of being rejected by required snake\_case schema fields.
4. Add `normalizeSessionId` and reserve case-insensitive `default`.
5. Update `validateThoughtData` semantics so `total_thoughts < thought_number` no longer fails after normalization; instead, dynamic adjustment records the change.
6. Add tests for snake\_case, camelCase-only, mixed matching aliases, conflicting aliases, invalid booleans/integers, invalid stages, invalid arrays, and session IDs.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__/types.test.ts`

### Phase 2: Session-Aware Storage Foundation

Outcome: default and named sessions persist separately without changing default-session file compatibility.

Steps:

1. Resolve the storage-layout ADR gate before changing storage code: either create/approve the standalone per-session JSON ADR or explicitly record that the ADR index in this plan is the accepted decision record for V1.
2. Introduce internal session file resolution methods:
   * `resolveSessionFile(undefined) -> current_session.json`
   * `resolveSessionFile(sessionId) -> sessions/<sessionId>.json`
3. Replace the single eager `thoughts` array with session-scoped load/save methods. Keep copying arrays on read.
4. Preserve atomic write pattern and corrupted-file backup for active storage files.
5. Add new session-aware public APIs while keeping old method signatures as default-session shims if tests/imports rely on them.
6. Add storage metadata helpers for counts, lastUpdated, named session listing, backup file listing, writability checks, and one-active-process diagnostic assumptions.
7. Add tests for default-session load, named isolation, persistence across new `ThoughtStorage` instances, invalid session IDs, restrictive permissions where platform-testable, and no-migration default behavior.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__/storage.test.ts`

### Phase 3: Minimum Validating Tool Slice

Outcome: the smallest user-visible foundation works end-to-end: normalized capture, named-session writes, and read-only history.

Steps:

1. Update `processThought` in `extensions/index.ts` to call normalization helpers instead of casting raw args.
2. Add session-aware `storage.addThought` and `storage.getThoughts` calls.
3. Return analysis for only the selected session.
4. Introduce the shared mutation receipt/fingerprint helper and attach the first `process_thought` receipt with pre/post counts and dynamic total adjustment metadata.
5. Register `get_thinking_history` with bounded `limit` / `offset` / snippet behavior, including default `limit` 20, maximum `limit` 100, default `offset` 0, and default `include_full_thoughts` true.
6. Add runtime and schema-boundary tests covering snake\_case compatibility, camelCase-only aliases, mixed aliases, named-session isolation, dynamic totals, and history pagination/snippet behavior.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__/types.test.ts packages/pi-sequential-thinking/__tests__/storage.test.ts packages/pi-sequential-thinking/__tests__/runtime.test.ts`

### Phase 4: Session-Aware Existing Tools and Import/Export Boundaries

Outcome: existing stateful tools operate on selected sessions and import/export is safe enough for V1.

Steps:

1. Add optional `session_id` / `sessionId` schemas to `generate_summary`, `clear_history`, `export_session`, `import_session`, and `sequential_think`.
2. Make `generate_summary` read only selected-session thoughts.
3. Make `clear_history` clear only the selected session and return a receipt.
4. Implement new export schema with session metadata and overwrite receipt behavior.
5. Implement import precedence: explicit target wins; otherwise embedded `sessionId`; otherwise default.
6. Enforce 10 MiB import max before parsing.
7. Reject malformed top-level explicit imports with structured errors.
8. Normalize imported legacy thoughts, generating missing IDs/timestamps and returning warnings.
9. Ensure imported thought records preserve both snake\_case and camelCase numeric/boolean fields before generating defaults.
10. Update `sequential_think` as a session-aware compatibility shim without redesigning its canned-prompt behavior.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__/storage.test.ts packages/pi-sequential-thinking/__tests__/runtime.test.ts`

### Phase 5: Receipts, Fingerprints, and Status Diagnostics

Outcome: stateful behavior is auditable without exposing thought content or raw home paths.

Steps:

1. Reuse and extend the shared receipt/fingerprint helper introduced in Phase 3 for all mutating tools.
2. Add home-path redaction helper and tests.
3. Refactor runtime config resolution into `resolveEffectiveConfig()` or equivalent, returning values plus source labels for `storageDir`, `maxBytes`, and `maxLines`.
4. Implement storage diagnostics for default session, named sessions, backup files, writability, and completeness.
5. Register `get_thinking_status` with `piMaxBytes` / `piMaxLines` support and route output through the existing truncation helper.
6. Include effective config values plus source labels in status using the shared effective-config resolver.
7. Apply the same path-redaction policy to top-level status fields and nested `effectiveConfig.storageDir`.
8. Enforce status threshold of 100 named sessions; above that, report partial completeness.
9. Add tests that known thought text, tags, axioms, assumptions, raw home paths, and content-derived hashes are absent from status/receipts; also test config source-label precedence.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__`

### Phase 6: README and Final Regression Coverage

Outcome: docs match behavior and all package-level checks pass.

Steps:

1. Update README feature list and tool reference for `get_thinking_history`, `get_thinking_status`, session IDs, aliases, dynamic totals, and receipts.
2. Document local plaintext storage posture and identify content-bearing vs diagnostic tools.
3. Document import/export path behavior, symlink/directory handling, overwrite behavior, 10 MiB import limit, content-bearing trust boundary, plaintext file permissions posture, and default session compatibility.
4. Document out-of-scope branch/revision metadata and dual MCP server architecture.
5. Run final targeted checks.

Phase gate:

* `npx vitest run packages/pi-sequential-thinking/__tests__`
* `npx tsc --noEmit --project packages/pi-sequential-thinking/tsconfig.json`
* `npx biome ci packages/pi-sequential-thinking`

## Risks and Mitigations

| Risk                                                       | Likelihood | Impact | Mitigation                                                                                                                                                      |
| ---------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default-session compatibility regresses                    | Medium     | High   | Keep `current_session.json` path unchanged; add fixture-style tests for existing `{ thoughts: [...] }` and legacy array files before refactoring storage.       |
| Session-aware refactor becomes too large to debug          | Medium     | Medium | Land in validating increments: normalization, storage foundation, then `process_thought` + history before import/export/status.                                 |
| Alias schemas or normalization accept/reject wrong data    | Medium     | High   | Fail on post-normalization alias conflicts; centralize alias resolution; test mixed snake/camel calls and camelCase-only calls at the registered-tool boundary. |
| Dynamic total semantics drift into backfilling             | Low        | Medium | Keep adjustment in normalization result for only the incoming thought; add tests that prior records are not rewritten.                                          |
| Import of untrusted files corrupts active state            | Medium     | High   | Validate file size and shape before replacing session state; reject malformed top-level records; preserve corrupted active-file backup behavior.                |
| Receipts leak content or paths                             | Low        | High   | Build fingerprints only from IDs/timestamps/counts; add negative tests for thought text and raw home paths in status/receipt output.                            |
| Status scan is slow with many session files                | Low        | Medium | Use PRD threshold of 100 named sessions; report `statusCompleteness.complete: false` above threshold instead of scanning everything.                            |
| `sequential_think` continues to imply real model reasoning | Medium     | Low    | Keep only compatibility changes in code, but document it as a legacy helper and defer redesign/deprecation to later backlog.                                    |
| TypeBox schemas become hard to read with aliases           | Medium     | Low    | Keep schemas permissive with documented optional aliases; move real normalization/validation to TypeScript helpers with tests.                                  |

## Open Questions

* No open implementation questions remain for this plan.

Before Phase 2 begins, the per-session JSON storage decision must be explicitly accepted either through a standalone ADR or by treating this plan's ADR index as the accepted V1 decision record. The PRD-resolved V1 defaults are not open implementation questions for this plan: imports reject files over 10 MiB, status may become partial after 100 named session files, and raw absolute path disclosure remains out of scope unless a future PRD or ADR changes it.

## ADR Index

Decisions made during this plan:

| ADR                                                             | Title                                                                | Status             |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| ADR-TBD                                                         | Persist named sequential-thinking sessions as per-session JSON files | Proposed           |
| `docs/adr/ADR-0016-stateful-exa-research-planning-tools.md`     | Stateful Exa Research Planning Tools                                 | Existing precedent |
| `docs/adr/ADR-0017-in-memory-exa-research-planning-sessions.md` | In-Memory Exa Research Planning Sessions                             | Existing contrast  |

### ADR candidate assessment

`Persist named sequential-thinking sessions as per-session JSON files` passes the 4-point test:

1. **Multiple approaches** — per-session files, one combined sessions file, and per-thought `session_id` in the current file are all viable.
2. **Lasting consequences** — storage layout affects future branch/revision metadata, import/export, status enumeration, and migration behavior.
3. **Disagreement potential** — reasonable engineers could prefer a single indexed file for status performance or per-session files for inspectability.
4. **Future constraints** — the choice shapes how later safety, archival, and branch/revision features work.

No ADR is recommended for alias normalization or dynamic totals; those are compatibility semantics already established by PRD-009 and do not independently constrain future architecture enough to warrant standalone records.

---
date: 2026-05-16
topic: pi-sequential-thinking-later-backlog
source: docs/ideation/2026-05-16-pi-sequential-thinking-improvements-ideation.md
focus: deferred improvements after the first requirements slice
mode: repo-grounded
---

# Later Backlog: pi-sequential-thinking Improvements

This file preserves improvements that should remain visible after the first requirements slice for `packages/pi-sequential-thinking`.

The selected first slice is tracked in `docs/ideation/2026-05-16-pi-sequential-thinking-improvements-ideation.md`:

1. MCP-compatible capture normalization and dynamic depth
2. Session-scoped history foundation
3. State observability: effective config + mutation receipts

Everything below is intentionally deferred, not rejected.

## Deferred Ranked Ideas

### 1. Branch/revision metadata with lightweight navigation

**Why later:** This depends on clean records and inspectable session history. It should come after the first slice so branch-aware reads and summaries have a stable state model to query.

**Keep:**

- Append-only branch/revision metadata.
- Validation for branch and revision references.
- Branch/revision labels in history and summary output.
- Lightweight filtering/navigation.

**Avoid initially:**

- Full branch switching.
- Branch merge/close workflows.
- MAXential-style large branch-management surface.

### 2. Persistence safety layer: bounds, redaction, export warnings

**Why later:** Safety belongs soon after the state foundation lands, but it should not block the initial session/history/observability slice.

**Keep:**

- Configurable max history size.
- Thought length limits.
- Response/output limits.
- Export warnings.
- Warning-first sensitive-content detection.
- Autotuning-style pressure signals: current session size, largest thoughts, truncation status, and recommended `maxHistorySize`.

**Avoid initially:**

- Silent redaction by default.
- Heavy security scanning.
- Surprising destructive trimming without visible receipts.

### 3. Focused synthesis with outcome contracts and resume prompts

**Why later:** Synthesis becomes more valuable once sessions, history, and branch/revision metadata exist.

**Keep:**

- Summary modes for decisions, open questions, assumptions, branches, tags, and next-stage guidance.
- Optional `desired_outcome` / `done_when` metadata.
- Compact resume prompts for future model turns.
- A decision on `sequential_think`: clarify, deprecate, make stateless, or replace with a more honest helper.

**Avoid initially:**

- Too many summary modes before usage patterns are clear.
- Non-deterministic synthesis that is hard to test.
- Persisting canned model prompts as if they were generated reasoning.

### 4. Evidence and artifact reference anchors

**Why later:** Useful provenance metadata, but best added after the core thought record shape stabilizes.

**Keep:**

- Optional short evidence snippets.
- URLs.
- Repo-relative artifact references such as ADRs, docs, package names, and file paths.
- Inert storage and summary of anchors without reading or executing referenced content.

**Avoid initially:**

- Turning the package into a file reader, citation manager, or research planner.
- Absolute local paths in exported records.
- Unbounded evidence blobs.

## Lower-Priority Follow-Up Candidates

These were rejected from the first ranked set but may be revisited after the deferred ranked ideas above.

| Idea | Later use case |
| --- | --- |
| Non-executing tool-plan metadata | Optional metadata for `available_tools` / `recommended_tools` once core state and safety behavior are stable. |
| Strict workflow mode | Could enforce stage progression or required fields after validation and branch semantics settle. |
| Archival summary mode | Could compact old sessions after safety bounds and focused synthesis exist. |
| Import/export preview with diff/checksum | Useful for trust and migration workflows if import/export becomes more complex. |
| Consistency check and repair-plan mode | Useful if session migration or branch references introduce integrity issues. |
| Mutation backup and restore receipt | Could strengthen observability/safety if users need undo-style workflows. |
| Confidence and uncertainty chips | Possible metadata extension if outcome contracts are not enough. |
| Stage-fit warnings | Possible lint-like guidance, but only if it proves helpful rather than noisy. |
| Reasoning boundary manifest | Better as documentation unless users keep confusing this package with research/tool-execution workflows. |

## Separate Issue

The dual pi extension + MCP server architecture idea is intentionally excluded from this ideation backlog and tracked separately:

- <https://github.com/feniix/pi-extensions/issues/99>

## Suggested Later Sequence

After the selected first slice lands:

1. Add the persistence safety layer.
2. Add branch/revision metadata with lightweight navigation.
3. Add focused synthesis and resume prompts.
4. Add evidence/artifact anchors.
5. Revisit lower-priority follow-up candidates based on actual usage.

---
date: 2026-05-16
topic: pi-sequential-thinking-improvements
focus: improvements to packages/pi-sequential-thinking after external sequential-thinking research
mode: repo-grounded
---

# Ideation: pi-sequential-thinking Improvements

## Grounding Context

### Codebase Context

* This repo is an npm workspace of independent TypeScript pi extension packages under `packages/*`, with Biome, Vitest, and package-local `extensions/index.ts` plus `__tests__` conventions.

* `packages/pi-sequential-thinking` currently exposes staged thinking tools: `process_thought`, `generate_summary`, `clear_history`, `export_session`, `import_session`, plus an undocumented `sequential_think` helper.

* Current strengths: five cognitive stages, tags/axioms/assumptions metadata, related-thought analysis, summaries, persistent JSON import/export, and output truncation controls.

* Current gaps: no named sessions, no history inspection tool, no branch/revision metadata, no dynamic total auto-adjustment, no bounded history, no redaction/security warnings, partial duplicated validation, and `sequential_think` stores canned prompts rather than real model reasoning.

* Adjacent pattern: `packages/pi-code-reasoning` already provides branch/revision field semantics, cross-field validation, status/reset tools, max thought count/length, and checklist-oriented tool descriptions.

### Past Learnings

* `docs/adr/ADR-0016-stateful-exa-research-planning-tools.md`: prompt-only multi-step workflows are unreliable; externalize process state into explicit tools. Planning/reasoning tools may recommend next actions but should not hide expensive or side-effectful calls.

* `docs/adr/ADR-0017-in-memory-exa-research-planning-sessions.md`: persistence adds path/config/privacy complexity; start lighter when intra-session state is enough. For `pi-sequential-thinking`, persistence already exists, so preserve backward-compatible JSON behavior.

* `packages/pi-sequential-thinking/extensions/storage.ts`: current persistence already handles import/export, legacy array loading, corrupted-file backup, and atomic temp-file rename. Preserve those safety properties when adding fields/sessions.

* `packages/pi-code-reasoning/extensions/types.ts`: branch/revision metadata needs cross-field validation: revisions require `revises_thought` and forbid branch fields; branches require both `branch_from_thought` and `branch_id`; references should be valid.

### External Context

* Official MCP sequentialthinking establishes canonical branch/revision/dynamic-depth fields and auto-raises `totalThoughts` when `thoughtNumber` exceeds it.

* `spences10/mcp-sequentialthinking-tools` adds `session_id`, `get_thinking_history`, session-aware clear, per-session max history, prompt-injection-like redaction, and optional `available_tools` / `recommended_tools` validation without executing tools.

* `mettamatt/code-reasoning` adds stricter guardrails: strict/loose validation, max thought cap, branch/revision exclusivity, branch reference validation, and guidance-rich errors.

* MAXential Thinking shows a larger future surface: branch/switch/merge/close, get history, tag/search/export/visualize, session save/load/list/summary. Useful as future inspiration, but too large to copy wholesale now.

* `gotza02/mcp-thinking` adds Tree-of-Thought typed steps and summarization/archiving, but bundles unrelated web/shell/project graph tools that do not fit this package.

* `thedotmack/sequential-thinking-skill` reinforces the value of append-only state, full state inspection, and compact status output outside MCP infrastructure.

## Topic Axes

1. Thought capture ergonomics and schema compatibility
2. Session/history/persistence lifecycle
3. Branch/revision/navigation workflows
4. Safety, limits, and tool-planning metadata
5. Higher-level synthesis, organization, and tool-surface focus

## Ranked Ideas

### 1. Session-scoped history foundation

**Description:** Add `session_id`, a read-only `get_thinking_history` tool, session-aware clear/import/export/summary behavior, and bounded `limit` output. Preserve default behavior as the existing unnamed/default session and keep old exports importable.

**Deeper notes:** This should be the first foundation because it turns the package from one global scratchpad into reusable reasoning memory. The smallest useful slice is: `session_id` on capture/read/clear, default session backward compatibility, branch-ready history records, and a bounded read API. Nice-to-have lifecycle concepts like named titles, archived status, or merge semantics should wait until actual session usage proves they are needed.

**Axis:** Session/history/persistence lifecycle

**Basis:** `direct:` current package has persistent JSON state but no named sessions or live history inspection; `external:` spences10 adds `session_id`, `get_thinking_history`, session-aware clear, and max history.

**Rationale:** This is the foundation that makes later branch/revision/synthesis features usable rather than invisible state. It also gives agents a safe way to inspect state before continuing or clearing it.

**Downsides:** Touches storage, schemas, runtime tests, and README; needs careful backward-compatible JSON migration.

**Confidence:** 94%

**Complexity:** Medium

**Status:** Unexplored

### 2. Branch/revision metadata with lightweight navigation

**Description:** Add append-only branch/revision metadata to thoughts, validate references, expose branch/revision labels in history and summary, and avoid the full MAXential branch-management surface at first.

**Deeper notes:** This means metadata and views, not a full branch engine. A revision is a new thought that points at the earlier thought it corrects; a branch is a new line of reasoning that names its source and branch ID. The first version should let users record, filter, and summarize those relationships; switch/merge/close can remain explicitly out of scope.

**Axis:** Branch/revision/navigation workflows

**Basis:** `direct:` `pi-sequential-thinking` lacks branch/revision fields while `pi-code-reasoning` has cross-field validation; `external:` official MCP sequentialthinking defines these semantics.

**Rationale:** Real reasoning is not linear; this gives correction and alternatives without jumping straight to branch switching/merge/close tools. Lightweight navigation keeps the surface small while still making alternative paths inspectable.

**Downsides:** Requires reference validation and summary/history UI choices; branch semantics can sprawl if not scoped tightly.

**Confidence:** 91%

**Complexity:** Medium

**Status:** Unexplored

### 3. MCP-compatible capture normalization and dynamic depth

**Description:** Normalize snake\_case and MCP-style aliases into one internal model, auto-adjust `total_thoughts`, centralize validation, and return guidance-rich errors. Include a low-cost continuation-card response polish if it fits the same work.

**What this gains:** It reduces failed calls when agents use examples from the wider MCP ecosystem, removes needless friction when a thought sequence needs more steps than expected, and creates one validation path that future branch/session/safety features can build on. The gain is not just compatibility; it is fewer interrupted reasoning loops and less schema translation in prompts.

**Axis:** Thought capture ergonomics and schema compatibility

**Basis:** `direct:` validation is partial/duplicated and rejects `total_thoughts < thought_number`; `external:` official MCP auto-raises totals and common implementations use canonical branch/revision/dynamic-depth fields.

**Rationale:** This lowers tool-call friction and lets examples/prompts from the wider sequential-thinking ecosystem transfer into pi. It also prevents later features from duplicating input-normalization decisions.

**Downsides:** Alias support increases schema complexity; conflict resolution between duplicate aliases must be deterministic.

**Confidence:** 90%

**Complexity:** Medium

**Status:** Unexplored

### 4. State observability: effective config + mutation receipts

**Description:** Add a status/diagnostic view that reports effective config, storage path, writeability, current counts, and backup/corruption files. Mutating calls can return compact receipts: pre/post counts, schema version, mtime, and a short state fingerprint.

**Axis:** Session/history/persistence lifecycle; Safety, limits, and tool-planning metadata

**Basis:** `direct:` README documents multiple config sources and storage paths, but tools do not expose resolved runtime state; `reasoned:` hashes/count receipts detect accidental clears, stale state, failed writes, or wrong storage location.

**Rationale:** Statefulness creates trust problems; observability makes storage behavior auditable without dumping full history.

**Downsides:** Fingerprints/checksums must avoid leaking content while remaining useful; status output can become noisy if overbuilt.

**Confidence:** 87%

**Complexity:** Low-Medium

**Status:** Unexplored

### 5. Focused synthesis with outcome contracts and resume prompts

**Description:** Add summary modes for decisions, open questions, assumptions, branches, tags, and next-stage guidance. Support optional `desired_outcome` / `done_when` and produce a compact resume prompt for future model turns. Clarify, deprecate, or make stateless the misleading `sequential_think` helper.

**Axis:** Higher-level synthesis, organization, and tool-surface focus

**Basis:** `direct:` package tracks stages/tags/axioms/assumptions but summary is generic; fresh-angle analysis identified no explicit success target; `direct:` `sequential_think` is undocumented and stores canned prompts rather than real model reasoning.

**Rationale:** This turns recorded state into usable handoff/resumption artifacts while making the tool surface more honest.

**Downsides:** Must keep synthesis deterministic enough to test; too many summary modes could clutter the schema.

**Confidence:** 85%

**Complexity:** Medium

**Status:** Unexplored

### 6. Persistence safety layer: bounds, redaction, export warnings

**Description:** Add configurable max history / thought length / response limits for reasoning state, plus optional redaction or warning behavior before storage/export.

**Autotuning ergonomics angle:** Instead of only exposing static knobs, make the tool suggest safe defaults and report pressure signals: current session size, largest thoughts, whether output was truncated, recommended `maxHistorySize`, and whether a summary/archive step would help. Redaction can default to warning-first, with opt-in masking, so safety improves without surprising users.

**Axis:** Safety, limits, and tool-planning metadata

**Basis:** `direct:` package persists and exports thoughts but lacks bounded history and redaction warnings; `external:` spences10 uses prompt-injection-like redaction and per-session history caps; code-reasoning has thought length/count caps.

**Rationale:** Once reasoning is persisted, oversized or sensitive content becomes a product risk rather than just an output-format detail. Autotuning-style status makes safety feel helpful instead of punitive.

**Downsides:** Redaction can produce false positives; default policy must avoid surprising users or silently destroying important context.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 7. Evidence and artifact reference anchors

**Description:** Let thoughts optionally attach short evidence snippets, URLs, or repo-relative artifact references such as ADRs, docs, package names, or files. Store and summarize these inert anchors without reading or executing them.

**Axis:** Thought capture ergonomics and schema compatibility; Higher-level synthesis, organization, and tool-surface focus

**Basis:** `direct:` current metadata captures cognitive context but not evidence/source/artifact references; `reasoned:` short evidence and repo-relative anchors add traceability without turning this package into a file reader or citation manager.

**Rationale:** This makes Research/Analysis thoughts more auditable and gives summaries stronger provenance.

**Downsides:** Needs strict portability guidance for repo-relative paths and bounded evidence length; can overlap with research-planning tools if expanded too far.

**Confidence:** 78%

**Complexity:** Low-Medium

**Status:** Unexplored

## Implementation Sequence

This sequence is different from the idea ranking above. The ranked list captures value and confidence; this sequence orders work by dependency, risk reduction, and what should become the first requirements slice.

### Recommended first requirements slice

The strongest first slice is the foundation made from ideas 3, 1, and 4:

1. **MCP-compatible capture normalization and dynamic depth** — stabilize the internal input model first: aliases, dynamic `total_thoughts`, centralized validation, and guidance-rich errors.
2. **Session-scoped history foundation** — add `session_id`, `get_thinking_history`, session-aware clear/export/import, default-session backward compatibility, and bounded history reads.
3. **State observability: effective config + mutation receipts** — expose effective runtime state and make mutations auditable through compact pre/post receipts.

**Why this slice:** It creates a clean record model, gives agents a way to inspect stored state, and makes stateful behavior trustworthy before adding advanced reasoning affordances.

**Explicitly out of this first slice:** branch/revision metadata, safety/redaction policy, synthesis/resume prompts, evidence anchors, and the dual pi+MCP adapter architecture. Deferred ideas are preserved in `docs/ideation/2026-05-16-pi-sequential-thinking-later-backlog.md`. The dual-adapter idea is tracked separately in <https://github.com/feniix/pi-extensions/issues/99>.

### Full implementation order

1. **Capture normalization and dynamic depth** — shared validation and record normalization foundation.
2. **Session-scoped history foundation** — named/default sessions plus read-only inspection.
3. **State observability and mutation receipts** — storage/config visibility and auditable writes.
4. **Persistence safety layer** — bounded history, thought limits, warning-first redaction, and autotuning pressure signals.
5. **Branch/revision metadata with lightweight navigation** — append-only alternatives and corrections once history exists.
6. **Focused synthesis with outcome contracts and resume prompts** — stronger summaries once sessions and branch metadata provide enough structure.
7. **Evidence and artifact reference anchors** — provenance metadata after the core record shape stabilizes.

## Rejection Summary

| #  | Idea                                     | Reason Rejected                                                                                                                                      |
| :- | :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Non-executing tool-plan metadata         | Still useful, but less central to `pi-sequential-thinking` than evidence/artifact anchors and state observability; keep as a later optional variant. |
| 2  | Full branch checkout/merge/close toolset | Too expensive and MAXential-sized for the next improvement; keep lightweight metadata/navigation first.                                              |
| 3  | Issue-tracker-style session statuses     | Interesting, but over-models sessions before basic named sessions/history exist.                                                                     |
| 4  | Notebook table-of-contents history       | Duplicate of the stronger session-scoped history foundation.                                                                                         |
| 5  | Strict workflow mode                     | Useful later, but premature until central validation and branch/revision basics are in place.                                                        |
| 6  | Archival summary mode                    | Better as a later variant of focused synthesis; not needed in the first survivor set.                                                                |
| 7  | Import/export preview with diff/checksum | Strong trust idea, but covered enough by state observability + receipts for the ranked set.                                                          |
| 8  | Consistency check and repair-plan mode   | Valuable later for migrations; too much scope before sessions/history exist.                                                                         |
| 9  | Mutation backup and restore receipt      | Good variant of receipt/safety work, but not distinct enough for the top set.                                                                        |
| 10 | Confidence and uncertainty chips         | Useful metadata, but outcome/evidence anchors have stronger immediate grounding.                                                                     |
| 11 | Stage-fit warnings                       | Risks noisy pseudo-linting; revisit after capture model stabilizes.                                                                                  |
| 12 | Reasoning boundary manifest              | Too meta for users; better handled in README/tool descriptions unless tool-choice confusion becomes severe.                                          |

No topic axis ended with zero survivors.

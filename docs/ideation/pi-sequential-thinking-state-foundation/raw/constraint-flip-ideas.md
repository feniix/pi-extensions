# Constraint-Flip Improvement Ideas for `packages/pi-sequential-thinking`

## 1. Flip “tiny tool surface” into a focused history-inspection tool

**summary:** Keep `process_thought` as the main capture tool, but add a focused `get_thinking_history` tool for inspecting the current state without mutating it. It could support filters such as stage, tag, branch/session, compact vs full output, and pagination/truncation controls so users do not need to export JSON just to inspect progress.

**axis:** Session/history/persistence lifecycle; Higher-level synthesis, organization, and tool-surface focus

**basis:** direct — the grounding summary says the package currently exposes `process_thought`, `generate_summary`, `clear_history`, `export_session`, and `import_session`, but has “no history inspection tool”; external — `spences10/mcp-sequentialthinking-tools` adds `get_thinking_history`, and `thedotmack/sequential-thinking-skill` reinforces full state inspection and compact status output.

**why_it_matters:** A read-only inspection tool makes the stateful workflow more transparent and reduces accidental dependence on import/export files for simple navigation.

**meeting_test:** A user can ask for “show only analysis-stage thoughts tagged auth in compact form” and get relevant stored thoughts without changing history or touching the filesystem.

## 2. Flip “persistence is explicit and private” into named, optionally persistent sessions

**summary:** Add named `session_id` support while keeping the current unnamed/default history behavior backward compatible. Persistence could remain explicit by default, but import/export and clear operations could become session-aware, allowing users to save, load, list, and clear specific thinking threads instead of treating all history as one global timeline.

**axis:** Session/history/persistence lifecycle

**basis:** direct — the grounding summary identifies “no named sessions” as a current gap and notes existing JSON import/export, legacy array loading, corrupted-file backup, and atomic temp-file rename that should be preserved; external — `spences10/mcp-sequentialthinking-tools` includes `session_id`, session-aware clear, and per-session history controls.

**why_it_matters:** Named sessions let users work on multiple problems in parallel without losing the simplicity and privacy posture of explicit persistence.

**meeting_test:** Existing legacy exported JSON still imports successfully, while new calls can isolate thoughts under `session_id: "refactor-plan"` and clear only that session.

## 3. Flip “linear staged thinking” into branch/revision-aware navigation

**summary:** Add canonical branch and revision fields to `process_thought`, such as `isRevision`, `revisesThought`, `branchFromThought`, `branchId`, and `needsMoreThoughts`, with validation that branches and revisions are mutually exclusive. The tool can remain append-only while representing corrections, alternatives, and explorations as explicit metadata rather than overwriting prior thoughts.

**axis:** Branch/revision/navigation workflows; Thought capture ergonomics and schema compatibility

**basis:** direct — the grounding summary lists “no branch/revision metadata” as a gap and notes that `packages/pi-code-reasoning` already has branch/revision semantics, cross-field validation, and reference checks; external — official MCP sequentialthinking uses `isRevision`, `revisesThought`, `branchFromThought`, `branchId`, and `needsMoreThoughts`.

**why_it_matters:** Real reasoning rarely stays linear; explicit alternatives and corrections make the history auditable without forcing users to fake branches through tags.

**meeting_test:** Submitting a revision without `revisesThought` produces a guidance-rich validation error, while a valid branch can later be filtered or summarized independently.

## 4. Flip “schema compatibility limits ergonomics” into alias-friendly input normalization

**summary:** Accept both the package’s current snake_case fields and MCP-style camelCase aliases for common parameters, normalizing them internally into one canonical model. Include dynamic total adjustment when `thoughtNumber` exceeds `totalThoughts`, mirroring canonical sequentialthinking behavior while preserving current API compatibility.

**axis:** Thought capture ergonomics and schema compatibility

**basis:** direct — the grounding summary notes “partial duplicated validation” and “no dynamic total auto-adjustment”; external — official MCP sequentialthinking auto-raises `totalThoughts` when `thoughtNumber` exceeds it and uses camelCase branch/revision/depth fields.

**why_it_matters:** Alias compatibility reduces friction for users and agents familiar with MCP sequentialthinking, without breaking existing pi users who already use snake_case.

**meeting_test:** Calls using either `thought_number`/`total_thoughts` or `thoughtNumber`/`totalThoughts` store equivalent thoughts, and a thought numbered 6 of 5 returns an adjusted total of 6 rather than failing unnecessarily.

## 5. Flip “lightweight capture” into bounded, safer capture with redaction warnings

**summary:** Add configurable limits for max thoughts, max thought length, and per-session history size, plus warnings or optional redaction for likely secrets and prompt-injection-like content. Keep the default lightweight, but make safety posture visible in tool responses when content is truncated, rejected, or redacted.

**axis:** Safety, limits, and tool-planning metadata

**basis:** direct — the grounding summary lists “no bounded history” and “no redaction/security warnings” as gaps; external — `packages/pi-code-reasoning` has max thought count/length guardrails, and `spences10/mcp-sequentialthinking-tools` includes per-session max history and prompt-injection-like redaction.

**why_it_matters:** Stateful thinking tools can accidentally accumulate sensitive data or unbounded context; explicit guardrails help keep sessions usable and safer over time.

**meeting_test:** A thought containing a likely API key returns a warning or redacted stored value, and an overlong thought or over-cap session produces a clear, actionable response.

## 6. Flip “tool planning should be out of scope” into non-executing tool-plan metadata

**summary:** Extend thoughts with optional `available_tools` and `recommended_tools` metadata that validates tool names and explains next-step suggestions without executing anything. The summary or history tools could surface unresolved recommendations, making the reasoning workflow more operational while respecting the ADR guidance that planning tools should not hide side effects.

**axis:** Safety, limits, and tool-planning metadata; Higher-level synthesis, organization, and tool-surface focus

**basis:** direct — ADR-0016 says planning/reasoning tools may recommend next actions but should not hide expensive or side-effectful calls; external — `spences10/mcp-sequentialthinking-tools` supports optional `available_tools` / `recommended_tools` validation without executing tools.

**why_it_matters:** Agents often use sequential thinking to decide what to do next; structured, non-executing recommendations make that plan inspectable without turning this package into an orchestration system.

**meeting_test:** A thought can recommend `grep` or `read` from a declared available tool list, while recommending an unavailable tool returns validation feedback and performs no side effects.

## 7. Flip “one generic summary” into staged synthesis and archival outputs

**summary:** Keep `generate_summary`, but add modes such as `timeline`, `open_questions`, `decisions`, `branches`, `risks`, and `archive`. This would make synthesis more useful for handoffs and long sessions without requiring a large MAXential-style surface of many separate visualization and organization tools.

**axis:** Higher-level synthesis, organization, and tool-surface focus

**basis:** direct — current strengths include summaries, stages, tags, axioms, assumptions, and related-thought analysis; external — `gotza02/mcp-thinking` includes summarization/archiving, and MAXential Thinking suggests broader future capabilities like session summary, tag/search/export/visualize.

**why_it_matters:** As histories grow, users need more than counts and top tags; targeted synthesis turns captured thoughts into decisions, risks, and next actions.

**meeting_test:** Running `generate_summary` with `mode: "decisions"` returns a concise list of decisions and supporting thought references, while `mode: "archive"` creates a compact handoff summary.

## 8. Flip “compatibility with loose workflows” into an optional strict workflow mode

**summary:** Add a strict validation mode that enforces stage order, required metadata by stage, branch/reference validity, maximum counts, and mutually exclusive branch/revision fields. Default behavior can remain permissive, but strict mode gives teams an opinionated workflow when they want repeatable reasoning traces.

**axis:** Thought capture ergonomics and schema compatibility; Branch/revision/navigation workflows; Safety, limits, and tool-planning metadata

**basis:** direct — the grounding summary contrasts compatibility with stronger opinionated workflow and notes current gaps in branch/revision metadata, bounded history, and duplicated validation; external — `mettamatt/code-reasoning` provides strict/loose validation, max thought cap, branch/revision exclusivity, branch reference validation, and guidance-rich errors.

**why_it_matters:** Different users need different levels of structure; strict mode improves reliability for formal planning while preserving the current low-friction capture path.

**meeting_test:** With strict mode enabled, an Evaluation thought before any Analysis thought or a branch pointing to a nonexistent thought fails with a specific corrective error; with strict mode disabled, legacy behavior remains accepted.

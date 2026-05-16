# Reframe Ideas for `packages/pi-sequential-thinking`

## 1. Treat `total_thoughts` as a Living Estimate, Not a Contract

- **axis:** Thought capture ergonomics and schema compatibility
- **summary:** Reframe the thought count from a fixed upfront plan into a mutable estimate that can expand when reasoning discovers more work. Add MCP-compatible `needsMoreThoughts` / `needs_more_thoughts` handling and auto-raise `total_thoughts` when `thought_number` exceeds the current total, while preserving existing snake_case fields.
- **basis:** external — The grounding summary notes official MCP sequentialthinking supports `needsMoreThoughts` and auto-raises `totalThoughts` when `thoughtNumber` exceeds it; direct — current package has staged thought capture but lacks dynamic total auto-adjustment.
- **why_it_matters:** Users often discover complexity mid-sequence, and rigid totals make them choose between inaccurate metadata or restarting. Dynamic estimates improve flow while staying compatible with the broader sequential-thinking ecosystem.
- **meeting_test:** A user can submit thought 6 of an originally planned 5-thought session with `needs_more_thoughts: true`, and the stored session/report reflects an updated total without validation failure.

## 2. Make History Inspection a First-Class Tool Instead of an Export Side Effect

- **axis:** Session/history/persistence lifecycle
- **summary:** Add a `get_thinking_history` or `get_session_status` tool that returns recent thoughts, filters by stage/tag/session, and exposes compact counters without requiring JSON export/import. This reframes history as live working memory rather than only a persistence artifact.
- **basis:** direct — The package currently has `generate_summary`, `clear_history`, `export_session`, and `import_session`, but the grounding summary identifies no history inspection tool; external — spences10/mcp-sequentialthinking-tools and sequential-thinking-skill emphasize full state inspection.
- **why_it_matters:** Agents need to inspect prior reasoning before continuing, revising, or summarizing. A read-only history/status surface reduces accidental destructive operations and avoids forcing users to parse exported files.
- **meeting_test:** After processing several thoughts, calling the new tool returns ordered stored thoughts with metadata and supports at least one narrowing option such as `limit`, `stage`, or `tag`.

## 3. Assume One Linear Chain Is the Exception: Add Branch and Revision Metadata

- **axis:** Branch/revision/navigation workflows
- **summary:** Extend thought input with branch/revision fields such as `is_revision`, `revises_thought`, `branch_from_thought`, and `branch_id`, with aliases for canonical MCP camelCase. Keep storage append-only, but make relationships explicit so users can explore alternatives or correct earlier reasoning without overwriting history.
- **basis:** external — Official MCP sequentialthinking defines branch/revision fields; direct — the grounding summary says this package has no branch/revision metadata, while `pi-code-reasoning` already has branch/revision semantics and validation patterns.
- **why_it_matters:** Real reasoning often forks, backtracks, and revises. Capturing those moves explicitly makes summaries more accurate and prevents “correction” thoughts from being indistinguishable from ordinary continuation.
- **meeting_test:** A revision must reference an existing thought, a branch must include both branch source and branch id, and invalid combinations produce guidance-rich validation errors.

## 4. Reframe Persistence Around Named Sessions, Not a Single Global Memory

- **axis:** Session/history/persistence lifecycle
- **summary:** Introduce optional `session_id` support across process, summary, clear, import, and export operations while keeping legacy single-session JSON valid. Session-aware clear and export would let users reset or move one reasoning thread without disturbing others.
- **basis:** external — spences10/mcp-sequentialthinking-tools includes `session_id`, session-aware clear, and per-session history; direct — current persistence already supports JSON import/export, legacy array loading, corrupted-file backup, and atomic temp-file rename, but the grounding summary notes no named sessions.
- **why_it_matters:** Multiple tasks may be active in the same pi run or persisted file. Named sessions reduce cross-contamination and make the tool safer for long-lived agent workflows.
- **meeting_test:** Existing exported arrays still import, while new exports can contain multiple sessions and operations scoped to `session_id` affect only that session.

## 5. Add Guardrails That Assume Reasoning Logs Can Become Too Large or Too Sensitive

- **axis:** Safety, limits, and tool-planning metadata
- **summary:** Add configurable max thought count, max thought length, optional bounded history per session, and redaction warnings for secrets or prompt-injection-like content. This reframes the tool from an unlimited scratchpad into a managed reasoning log with predictable size and privacy behavior.
- **basis:** external — spences10/mcp-sequentialthinking-tools has per-session max history and redaction; mettamatt/code-reasoning adds max thought cap and strict/loose validation; direct — current gaps include no bounded history and no redaction/security warnings.
- **why_it_matters:** Stateful tools can silently accumulate sensitive or oversized content. Limits and warnings make the extension safer in persistent environments and more reliable under model/context constraints.
- **meeting_test:** Overlong thoughts or sessions beyond configured limits produce clear errors or truncation/archive behavior, and obvious secret-like strings trigger a warning without breaking normal use.

## 6. Separate Tool Planning Metadata From Tool Execution

- **axis:** Safety, limits, and tool-planning metadata
- **summary:** Let `process_thought` optionally record `available_tools`, `recommended_tools`, or `next_action` metadata, validating names against a provided list but never executing anything. This reframes sequential thinking as a planning ledger that can recommend safe next steps without hiding side effects.
- **basis:** external — ADR-0016 says planning/reasoning tools may recommend next actions but should not hide expensive or side-effectful calls; spences10/mcp-sequentialthinking-tools supports optional available/recommended tool validation without executing tools.
- **why_it_matters:** Agents often reason about which tool to use next, and recording that plan improves traceability. Keeping execution separate preserves user control and avoids surprising side effects.
- **meeting_test:** A thought can include recommended tool names, invalid names are flagged when an allowlist is supplied, and no external tool invocation occurs as part of processing the thought.

## 7. Turn Summary Into Structured Synthesis, Not Just Counts

- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **summary:** Enhance `generate_summary` with optional synthesis modes such as decisions, open questions, assumptions challenged, branches, risks, and next steps. This reframes summary output from a progress report into a compact reasoning artifact that can guide follow-up work.
- **basis:** direct — The package already tracks stages, tags, axioms, assumptions, related thoughts, and summaries; external — Tree-of-Thought and MAXential-style systems show value in organization, search, and higher-level summarization, while the grounding summary cautions against copying an oversized surface wholesale.
- **why_it_matters:** Users need actionable synthesis after a reasoning session, not only metadata totals. Structured sections make the tool more useful while reusing fields it already captures.
- **meeting_test:** Calling `generate_summary` with a mode or options object returns sections for at least decisions/open questions/assumptions or equivalent structured outputs derived from stored thoughts.

## 8. Deprecate or Reframe `sequential_think` as Prompt Scaffolding, Not Hidden Reasoning

- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **summary:** Clarify, rename, or deprecate the undocumented `sequential_think` helper so it does not imply that the tool performs model reasoning when it stores canned prompts. If retained, position it as a prompt-template/scaffolding generator that helps users start staged thinking, separate from `process_thought` state capture.
- **basis:** direct — The grounding summary states `sequential_think` is undocumented and stores canned prompts rather than real model reasoning; reasoned — misleading tool names can create incorrect expectations about what state is captured or analyzed.
- **why_it_matters:** Tool-surface focus improves trust and reduces confusion for agents choosing between tools. Clear naming also prevents accidental reliance on synthetic reasoning that was never actually produced by the model.
- **meeting_test:** README/tool descriptions accurately distinguish prompt scaffolding from recorded reasoning, and tests verify the helper either emits scaffold content without mutating history or is marked deprecated with a migration path.

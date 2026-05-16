# Pain and Friction Ideas for `packages/pi-sequential-thinking`

## 1. MCP-Compatible Capture Aliases and Dynamic Depth

- **axis:** Thought capture ergonomics and schema compatibility
- **summary:** Add input aliases compatible with the canonical MCP sequentialthinking schema, such as `needsMoreThoughts`, `isRevision`, `revisesThought`, `branchFromThought`, and `branchId`, while preserving the current snake_case fields. Also auto-adjust `total_thoughts` upward when `thought_number` exceeds the submitted total, instead of forcing callers to predict depth perfectly. This reduces friction for users and agents moving between sequential-thinking implementations.
- **basis:** direct — The grounding summary says the package currently has staged `process_thought` fields but lacks dynamic total auto-adjustment; external — official MCP sequentialthinking uses branch/revision/dynamic-depth fields and auto-raises `totalThoughts` when `thoughtNumber` exceeds it.
- **why_it_matters:** Agents often discover that a reasoning chain needs more steps only after starting. Schema compatibility and forgiving depth handling make the tool easier to call correctly and reduce invalid or prematurely compressed reasoning.
- **meeting_test:** A caller can submit either snake_case or MCP-style camelCase fields, and a thought with `thought_number: 6` and `total_thoughts: 5` is accepted with the stored total raised to 6.

## 2. Guided Validation Errors for Thought Capture

- **axis:** Thought capture ergonomics and schema compatibility
- **summary:** Replace scattered or duplicated validation with centralized, guidance-rich validation for stage names, thought numbering, metadata arrays, and mutually dependent fields. Error messages should explain what failed, show the expected shape, and suggest the smallest correction. This targets the friction of trial-and-error tool calls when schemas are strict.
- **basis:** direct — The grounding summary identifies partial duplicated validation as a current gap; external — `mettamatt/code-reasoning` is noted for strict/loose validation, cross-field checks, and guidance-rich errors.
- **why_it_matters:** Sequential-thinking tools are often invoked mid-task, where a failed call interrupts reasoning flow. Better validation reduces repeated failed calls and makes the tool safer to integrate with multiple agent backends.
- **meeting_test:** Invalid inputs produce a structured error containing the field, reason, expected format, and a concrete corrected example, with no duplicate validation logic paths.

## 3. Named Sessions with Backward-Compatible Import/Export

- **axis:** Session/history/persistence lifecycle
- **summary:** Introduce optional `session_id` support for `process_thought`, `generate_summary`, `clear_history`, `export_session`, and `import_session`, while keeping the current single-history behavior as the default session. Persist sessions in a backward-compatible JSON shape and continue supporting legacy array imports. This removes the friction of unrelated tasks sharing one global reasoning history.
- **basis:** direct — The package has import/export persistence but no named sessions; direct — storage already supports legacy array loading, corrupted-file backup, and atomic temp-file rename; external — `spences10/mcp-sequentialthinking-tools` includes `session_id`, session-aware clear, and session history.
- **why_it_matters:** Users and agents may work on multiple tasks in the same pi process. Named sessions prevent cross-contamination of summaries, related-thought analysis, and clears while preserving existing workflows.
- **meeting_test:** Two different `session_id` values maintain separate histories; omitting `session_id` behaves exactly like today; old exported JSON arrays still import successfully.

## 4. History Inspection, Status, and Bounded Retention

- **axis:** Session/history/persistence lifecycle
- **summary:** Add a `get_thinking_history` or `status` tool that can list recent thoughts, counts by stage/tag, session IDs, and truncation state without requiring export. Pair it with configurable max thought count or max history per session, plus clear feedback when older entries are pruned or archived. This addresses the pain of invisible in-memory state growing without direct inspection.
- **basis:** direct — The grounding summary says there is no history inspection tool and no bounded history; external — `spences10/mcp-sequentialthinking-tools` has `get_thinking_history` and per-session max history; external — `thedotmack/sequential-thinking-skill` reinforces append-only state plus full state inspection and compact status output.
- **why_it_matters:** Stateful reasoning is only useful if users can see and manage the state. Bounded retention also protects long-running sessions from excessive memory growth and overly large tool responses.
- **meeting_test:** A user can call one tool to inspect the current session without exporting a file, and setting a max history limit results in predictable pruning or archiving with an explicit notice.

## 5. Branch and Revision Metadata with Navigation Views

- **axis:** Branch/revision/navigation workflows
- **summary:** Add first-class branch and revision fields to thoughts, including validation that revisions reference an existing thought and branches specify both a source thought and branch ID. Provide summary/history views that group thoughts by branch and show revision chains. This reduces friction when reasoning needs to backtrack, compare alternatives, or correct earlier assumptions.
- **basis:** direct — The package has no branch/revision metadata; direct — `packages/pi-code-reasoning` already has branch/revision semantics and cross-field validation; external — official MCP sequentialthinking defines `isRevision`, `revisesThought`, `branchFromThought`, and `branchId`.
- **why_it_matters:** Real problem solving is rarely linear. Branches and revisions let agents preserve exploratory reasoning without overwriting or muddling the main chain.
- **meeting_test:** A branch thought cannot be stored without both `branch_from_thought` and `branch_id`; a revision cannot also declare branch fields; summaries display branch IDs and revision targets.

## 6. Safe Tool-Planning Metadata Without Execution

- **axis:** Safety, limits, and tool-planning metadata
- **summary:** Add optional `available_tools`, `recommended_tools`, or `next_actions` metadata to `process_thought` so the tool can record planning suggestions without invoking tools. Validate recommended tools against available tools when both are supplied, and clearly state that recommendations are advisory only. This supports planning while avoiding hidden side effects.
- **basis:** direct — Current strengths include metadata such as tags, axioms, and assumptions, but tool-planning metadata is only an axis/gap area; direct — ADR-0016 says planning tools may recommend next actions but should not hide expensive or side-effectful calls; external — `spences10/mcp-sequentialthinking-tools` supports optional `available_tools` / `recommended_tools` validation without executing tools.
- **why_it_matters:** Agents often need to decide which tool to use after a reasoning step. Capturing those recommendations in state improves continuity while keeping execution explicit and controllable.
- **meeting_test:** A thought can include recommended tool names, invalid recommendations are flagged when an available-tool list is present, and no tool execution occurs as part of the sequential-thinking call.

## 7. Redaction Warnings and Sensitive-Content Guardrails

- **axis:** Safety, limits, and tool-planning metadata
- **summary:** Add configurable redaction or warning behavior for likely secrets, prompt-injection snippets, and sensitive personal data in thoughts and exports. The feature could default to warning-only for backward compatibility, with opt-in masking before persistence or export. This addresses the pain of a persistence-enabled reasoning tool accidentally storing unsafe content.
- **basis:** direct — The grounding summary notes no redaction/security warnings as a current gap; direct — persistence already exists through JSON import/export, making stored sensitive content a real concern; external — `spences10/mcp-sequentialthinking-tools` includes prompt-injection-like redaction.
- **why_it_matters:** Reasoning traces can contain copied logs, prompts, credentials, or user data. Guardrails lower the chance that exports or saved sessions leak sensitive information.
- **meeting_test:** Submitting text containing a token-like secret triggers a warning or redaction according to configuration, and exported sessions reflect the configured safety mode.

## 8. Focused Synthesis Views and Surface Cleanup

- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **summary:** Improve `generate_summary` with focused modes such as open questions, assumptions challenged, decisions, tag clusters, branch summaries, and next recommended reasoning stage. At the same time, clarify or remove the undocumented `sequential_think` helper if it stores canned prompts rather than real model reasoning. This keeps the tool surface centered on useful stateful reasoning instead of confusing helper behavior.
- **basis:** direct — The package has `generate_summary`, tags/axioms/assumptions metadata, and related-thought analysis; direct — the grounding summary says `sequential_think` is undocumented and stores canned prompts rather than real model reasoning; external — MAXential Thinking suggests richer session summary, tag/search/export/visualize surfaces, but the grounding summary cautions that the full surface is too large to copy wholesale.
- **why_it_matters:** Long reasoning histories become hard to use unless summaries organize them around decisions, risks, and next steps. Removing or documenting confusing tool surfaces reduces user surprise and keeps the package focused.
- **meeting_test:** `generate_summary` supports at least two focused summary modes using existing metadata, and `sequential_think` is either documented with clear limitations or removed/deprecated with tests updated.

# Leverage and Compounding Ideas for `packages/pi-sequential-thinking`

## 1. Canonical MCP-Compatible Thought Capture Fields

- **summary:** Add optional aliases/fields that mirror the canonical MCP sequentialthinking schema, including `isRevision`, `revisesThought`, `branchFromThought`, `branchId`, and `needsMoreThoughts`, while preserving the current snake_case API. Normalize both naming styles internally so existing users keep working and external examples become easier to port. Also auto-raise `total_thoughts`/`totalThoughts` when a thought number exceeds the declared total.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct — The grounding summary states the package currently has `process_thought` with staged thinking metadata, while external MCP sequentialthinking uses canonical branch/revision/dynamic-depth fields and auto-raises `totalThoughts` when needed.
- **why_it_matters:** Compatibility compounds leverage because prompts, examples, and workflows from the broader sequential-thinking ecosystem can be reused without translation. Auto-adjusting totals reduces friction during live reasoning when the user discovers the task needs more steps.
- **meeting_test:** A thought submitted with camelCase MCP fields is stored identically to one submitted with existing snake_case fields, existing tests still pass, and submitting `thought_number: 6` with `total_thoughts: 5` records a total of 6 or higher.

## 2. Named Sessions with Backward-Compatible Import/Export

- **summary:** Introduce optional `session_id` support for `process_thought`, `generate_summary`, `clear_history`, `export_session`, and `import_session`. Keep the current default unnamed session behavior and preserve legacy JSON array import/export so existing saved files remain usable. Store sessions in a simple top-level map only when session IDs are used.
- **axis:** Session/history/persistence lifecycle
- **basis:** direct — The grounding summary identifies no named sessions as a current gap, notes existing JSON persistence with legacy array loading and atomic temp-file rename in `extensions/storage.ts`, and cites external tools that add `session_id` and session-aware clear.
- **why_it_matters:** Sessions let users compound multiple reasoning threads without overwriting one another. Backward compatibility protects the existing persistence contract while adding a higher-leverage organization layer.
- **meeting_test:** Users can create two sessions, summarize each independently, clear one without affecting the other, and import an old array-format export with no data loss.

## 3. History Inspection Tool with Filtering and Compact Output

- **summary:** Add `get_thinking_history` to inspect stored thoughts without generating a synthesis. Support filters such as `session_id`, `stage`, `tag`, `branch_id`, thought-number range, and a compact mode that returns only key metadata plus truncated thought text. Include pagination or a `limit` parameter to keep responses bounded.
- **axis:** Session/history/persistence lifecycle
- **basis:** direct — The grounding summary lists no history inspection tool as a current gap, while `spences10/mcp-sequentialthinking-tools` and `thedotmack/sequential-thinking-skill` both emphasize history/state inspection.
- **why_it_matters:** Inspectable history turns the tool from an append-only black box into reusable working memory. Filtering compounds prior thoughts by making old reasoning searchable and referenceable in later steps.
- **meeting_test:** After recording thoughts across stages and tags, a user can retrieve only matching entries with deterministic ordering, bounded output, and no mutation of stored history.

## 4. Branch and Revision Workflow Semantics

- **summary:** Add first-class branch/revision metadata and validation to `process_thought`, reusing semantics from `pi-code-reasoning`: revisions require a revised thought reference and cannot also branch, while branches require both source thought and branch ID. Expose branch metadata in summaries and history so users can follow alternate lines of reasoning. Keep this as metadata and navigation support rather than adding heavyweight tree-management tools immediately.
- **axis:** Branch/revision/navigation workflows
- **basis:** direct — The grounding summary says the package has no branch/revision metadata, notes `packages/pi-code-reasoning` already provides branch/revision field semantics and cross-field validation, and cites external MCP sequentialthinking branch/revision fields.
- **why_it_matters:** Branching lets users explore alternatives without losing the main thread, and revisions let them correct reasoning while preserving provenance. Borrowing existing in-repo semantics compounds proven validation patterns instead of inventing new ones.
- **meeting_test:** Invalid combinations such as a revision with branch fields fail with guidance-rich errors, valid branch thoughts appear grouped or linked in history/summary output, and references to nonexistent thoughts are rejected or clearly warned based on validation mode.

## 5. Safety Limits and Redaction-Aware Persistence

- **summary:** Add configurable maximums for thought count, thought length, and returned history size, plus optional redaction warnings for secrets or prompt-injection-like content before export/import. Keep redaction advisory or opt-in so normal reasoning remains smooth, but ensure exports clearly warn when sensitive-looking data is present. Preserve atomic write and corrupted-file backup behavior.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct — The grounding summary lists no bounded history and no redaction/security warnings as gaps, notes storage already has corrupted-file backup and atomic temp-file rename, and cites external tools with max history, max thought caps, and redaction features.
- **why_it_matters:** Sequential-thinking state can accumulate sensitive data quickly. Limits and warnings make the tool safer for long-running sessions while preventing runaway context and file growth.
- **meeting_test:** Configured caps reject or truncate oversized inputs with clear errors, exported sessions include warnings or redacted fields when enabled, and existing atomic persistence tests continue to pass.

## 6. Tool-Planning Metadata Without Tool Execution

- **summary:** Add optional fields such as `available_tools`, `recommended_tools`, and `next_action` to capture planning intent alongside a thought. Validate recommendations against the declared available tools but never call those tools from sequential-thinking itself. Surface recommended next steps in `process_thought` responses and summaries.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct — The grounding summary cites ADR-0016: planning/reasoning tools may recommend next actions but should not hide expensive or side-effectful calls, and external tools validate `available_tools` / `recommended_tools` without executing tools.
- **why_it_matters:** The tool becomes a safer planning hub that can coordinate human or agent action without taking side effects. Capturing recommendations compounds reasoning into actionable workflow state.
- **meeting_test:** A thought can list available tools and recommended tools, invalid recommendations produce validation feedback, and no external tool execution occurs as a side effect of calling `process_thought`.

## 7. Focused Synthesis Views Beyond One Generic Summary

- **summary:** Extend `generate_summary` with focused modes such as `timeline`, `open_questions`, `decisions`, `assumptions`, `tags`, and `branches`. These can be lightweight deterministic aggregations from existing metadata rather than model-generated prose. Include per-session and filtered summaries so users can synthesize only the relevant slice of history.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** reasoned — The package already has `generate_summary`, tags, axioms, assumptions, related-thought analysis, and stages; the grounding summary also notes MAXential Thinking’s broader menu of summary/list/search/visualize tools but warns it is too large to copy wholesale now.
- **why_it_matters:** Focused summaries turn accumulated thoughts into reusable artifacts: decisions, assumptions, and unresolved questions. This compounds value from the metadata users already enter without expanding the package into an unrelated tool suite.
- **meeting_test:** Calling `generate_summary` with a focus option returns a deterministic, filtered view using stored thought metadata, and unsupported modes fail with a clear schema error.

## 8. Replace or Reframe `sequential_think` as a Prompt Template Helper

- **summary:** Rework the undocumented `sequential_think` helper so it does not imply that it performs hidden model reasoning. Either document it as a prompt-template generator that does not store thoughts, or fold its useful guidance into tool descriptions and examples for `process_thought`. Keep the main tool surface centered on explicit state capture.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct — The grounding summary says `sequential_think` is undocumented and stores canned prompts rather than real model reasoning, while ADR-0016 says prompt-only multi-step workflows are unreliable and process state should be externalized into explicit tools.
- **why_it_matters:** Clarifying this helper prevents user confusion and keeps leverage concentrated in the stateful tools that actually compound reasoning history. Better descriptions and examples can improve adoption without adding more surface area.
- **meeting_test:** Documentation and tool descriptions clearly state what `sequential_think` does or it is deprecated in favor of `process_thought`, and tests verify it does not create misleading stored reasoning entries unless explicitly intended.

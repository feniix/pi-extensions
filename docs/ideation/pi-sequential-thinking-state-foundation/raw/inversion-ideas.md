# Inversion, Removal, and Automation Ideas for `packages/pi-sequential-thinking`

## 1. Invert Total-Thought Planning into Dynamic Depth
- **summary:** Let `process_thought` accept MCP-compatible dynamic-depth fields such as `needsMoreThoughts`, and automatically raise `total_thoughts` when `thought_number` exceeds the prior estimate. This removes the need for users to predict exact depth before thinking has unfolded while preserving the existing staged flow.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct — the grounding summary says the package currently has “no dynamic total auto-adjustment”; external — official MCP sequentialthinking uses `needsMoreThoughts` and auto-raises `totalThoughts` when `thoughtNumber` exceeds it.
- **why_it_matters:** Sequential thinking is often exploratory, so rigid totals create friction and schema incompatibility with adjacent tooling.
- **meeting_test:** A user can submit thought 6 of an original 5-thought sequence with `needsMoreThoughts: true`, and the stored session plus summary reflect the expanded total without validation failure.

## 2. Remove the Canned `sequential_think` Surface or Make It Explicitly Stateless
- **summary:** Deprecate or rename the undocumented `sequential_think` helper so the package does not imply it performs model reasoning when it only stores canned prompts. If retained, position it as a prompt-template utility that does not mutate core thought history unless explicitly requested.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct — the grounding summary notes `sequential_think` is undocumented and “stores canned prompts rather than real model reasoning”; reasoned — reducing misleading tool surface keeps the package focused on externalized stateful reasoning support.
- **why_it_matters:** Users and agents need clear tool semantics to avoid mistaking template capture for actual sequential reasoning progress.
- **meeting_test:** Tool descriptions and README make it impossible to confuse `sequential_think` with `process_thought`, and tests assert whether it is deprecated, hidden, or stateless.

## 3. Automate Session Names and Add Lightweight Session Lifecycle Tools
- **summary:** Add optional `session_id` support with default automatic session creation, plus focused tools to list, inspect, clear, export, and import a named session. Keep the current JSON import/export format backward compatible, including legacy array loading and corrupted-file backup behavior.
- **axis:** Session/history/persistence lifecycle
- **basis:** direct — current gaps include “no named sessions” and “no history inspection tool”; direct — storage already supports legacy arrays, corrupted-file backup, and atomic temp-file rename; external — `spences10/mcp-sequentialthinking-tools` provides `session_id`, `get_thinking_history`, and session-aware clear.
- **why_it_matters:** Named sessions let users separate unrelated reasoning threads without losing the package’s existing persistence safety.
- **meeting_test:** Two named sessions can be created, independently inspected and cleared, and old exported JSON arrays still import successfully.

## 4. Invert Linear History into Branch and Revision Navigation
- **summary:** Add branch/revision metadata compatible with canonical sequential-thinking fields: `isRevision`, `revisesThought`, `branchFromThought`, and `branchId`. Include validation that revisions and branches are mutually exclusive and references point to existing thoughts.
- **axis:** Branch/revision/navigation workflows
- **basis:** direct — current gaps include “no branch/revision metadata”; direct — `packages/pi-code-reasoning` already has branch/revision semantics and cross-field validation; external — official MCP sequentialthinking defines canonical branch/revision fields.
- **why_it_matters:** Real reasoning often backtracks, forks, and corrects itself; explicit navigation prevents revisions from being hidden as ordinary appended thoughts.
- **meeting_test:** A revision cannot include branch fields, a branch must include both source thought and branch ID, and history output groups or labels branches and revisions clearly.

## 5. Automate Guardrails for History Size, Thought Length, and Validation Mode
- **summary:** Introduce configurable maximum thought count, maximum thought length, and strict/loose validation modes. When limits are reached, return guidance-rich errors or truncation recommendations rather than silently accepting unbounded history.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct — current gaps include “no bounded history” and “partial duplicated validation”; external — `packages/pi-code-reasoning` and `mettamatt/code-reasoning` include max thought caps, validation modes, and helpful validation errors.
- **why_it_matters:** Stateful reasoning tools can accumulate large or malformed state; explicit limits improve reliability, cost control, and predictable downstream summaries.
- **meeting_test:** Configuration can cap thought count and length, invalid branch/revision metadata fails consistently, and tests cover both strict and loose validation behavior.

## 6. Remove Sensitive Content by Default with Redaction Hooks
- **summary:** Add optional redaction of prompt-injection-like instructions, secrets, and configured patterns before thoughts are persisted or exported. Include warnings in tool responses when redaction occurs, while allowing users to disable or customize patterns when needed.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct — current gaps include “no redaction/security warnings”; external — `spences10/mcp-sequentialthinking-tools` includes prompt-injection-like redaction; reasoned — persistence and export make sensitive content retention more consequential.
- **why_it_matters:** The package stores reasoning state over time, so accidental retention of secrets or adversarial instructions can propagate into summaries and exported files.
- **meeting_test:** A thought containing a configured secret-like pattern is stored/exported in redacted form and the response reports that redaction happened.

## 7. Automate Tool-Planning Metadata Without Executing Tools
- **summary:** Let thoughts optionally declare `available_tools` and `recommended_tools`, then validate recommendations against the available set and surface them in summaries. Keep the tool strictly advisory: it should never invoke external tools or hide side effects behind reasoning capture.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct — ADR-0016 says planning tools may recommend next actions but should not hide expensive or side-effectful calls; external — `spences10/mcp-sequentialthinking-tools` validates optional `available_tools` and `recommended_tools` without executing tools.
- **why_it_matters:** Agents benefit from explicit next-tool planning, but users need assurance that recording a thought will not unexpectedly perform actions.
- **meeting_test:** A thought can recommend tools, invalid recommendations are flagged, and no code path executes recommended tools.

## 8. Invert Summary Generation into Searchable, Structured Synthesis
- **summary:** Expand `generate_summary` into focused synthesis outputs such as stage timeline, top tags, open assumptions, revised thoughts, branches, and action candidates. Add a lightweight history/search view by tag, stage, branch, or assumption rather than forcing users to inspect raw JSON exports.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct — current strengths include stages, tags, axioms, assumptions, related-thought analysis, and summaries; direct — current gaps include no history inspection tool; external — MAXential Thinking includes tag/search/export/visualize and session summary concepts, while the grounding summary cautions that copying its whole surface would be too large.
- **why_it_matters:** The existing metadata becomes more valuable when users can retrieve and synthesize it without expanding the package into an unrelated mega-tool.
- **meeting_test:** Users can request a compact synthesis filtered by tag or stage and receive organized open questions, assumptions, revisions, and next-action candidates.

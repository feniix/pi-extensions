# Cross-Domain Analogy Ideas for `packages/pi-sequential-thinking`

## 1. Version-Control Commit Metadata for Thought Capture

**summary:** Treat each thought like a lightweight commit: a stable sequence number, optional revision marker, optional branch origin, and a concise intent line. Add compatibility aliases for canonical MCP-style fields such as `isRevision`, `revisesThought`, `branchFromThought`, `branchId`, and `needsMoreThoughts`, while preserving the package’s existing staged schema. Like Git accepting structured commit metadata without changing the repository model, this improves interoperability without replacing the current tool surface.

**axis:** Thought capture ergonomics and schema compatibility

**basis:** external — The grounding summary notes that official MCP sequentialthinking uses canonical branch/revision/dynamic-depth fields and auto-raises `totalThoughts`; direct — the package currently has five cognitive stages plus metadata but lacks branch/revision metadata.

**why_it_matters:** Users and agents can move between sequential-thinking implementations with less schema friction, and branch/revision data becomes first-class instead of being buried in free text.

**meeting_test:** A thought submitted with MCP-style fields is accepted, normalized into the package’s internal format, included in summaries, and exported without breaking legacy JSON imports.

## 2. Notebook Index and Table-of-Contents History Tool

**summary:** Borrow from notebook systems by adding a read-only history/index tool that returns a compact table of contents for the current thinking session: thought numbers, stages, tags, branch IDs, revision links, and short previews. This is not a full replacement for `generate_summary`; it is closer to a notebook sidebar that helps users navigate raw entries before synthesizing them.

**axis:** Session/history/persistence lifecycle

**basis:** direct — The grounding summary identifies no history inspection tool as a current gap; external — `spences10/mcp-sequentialthinking-tools` includes `get_thinking_history`, and notebook systems commonly expose navigable cell outlines.

**why_it_matters:** Stateful reasoning is hard to trust when users cannot inspect what has been recorded. A compact history view makes the append-only state visible without forcing a full export/import cycle.

**meeting_test:** After several `process_thought` calls, a user can call a history tool and see ordered entries with stage, tags, preview text, and branch/revision references, with output truncation controls respected.

## 3. Issue-Tracker Session Labels and Statuses

**summary:** Model sessions like issue tracker tickets: each named session can have a title, status such as `open`, `paused`, or `archived`, and labels derived from tags or stages. Keep the default unnamed in-memory session for backward compatibility, but allow explicit `session_id` to separate parallel investigations. This mirrors issue trackers where multiple threads can remain organized without changing the underlying comment timeline.

**axis:** Session/history/persistence lifecycle

**basis:** external — The grounding summary cites `session_id`, session-aware clear, and max history in `spences10/mcp-sequentialthinking-tools`; direct — the current package has import/export and clear history but no named sessions.

**why_it_matters:** Agents often juggle multiple reasoning threads. Named sessions reduce accidental cross-contamination between tasks and make persistence more useful while preserving legacy behavior.

**meeting_test:** A user can process thoughts into two different `session_id`s, inspect or clear one without affecting the other, and export/import the data with old array-style imports still supported.

## 4. Lab Notebook Revision Pages

**summary:** Use the research lab notebook analogy: original observations are preserved, corrections are appended as dated revision pages, and the corrected entry explicitly points back to the original. Add clear revision validation and display so revised thoughts are linked, not overwritten. This keeps the current append-only spirit while allowing mistaken assumptions or changed conclusions to be corrected transparently.

**axis:** Branch/revision/navigation workflows

**basis:** direct — The grounding summary says there is no branch/revision metadata and that storage already preserves JSON safely; external — `packages/pi-code-reasoning` and `mettamatt/code-reasoning` provide branch/revision exclusivity and reference validation patterns.

**why_it_matters:** Reasoning evolves. Explicit revision links let users audit how a conclusion changed without losing the original chain of thought.

**meeting_test:** Submitting a revision requires a valid `revises_thought`, rejects simultaneous branch fields, and causes summaries/history to show the revision relationship.

## 5. Git Branch Checkout and Merge-Lane Navigation

**summary:** Add navigation affordances inspired by version-control branches: list branches, show the active branch/lane, and optionally summarize only one lane or compare two lanes. The package does not need a huge MAXential-style surface immediately; a focused branch-aware history and summary mode would give most of the navigational benefit.

**axis:** Branch/revision/navigation workflows

**basis:** external — MAXential Thinking includes branch, switch, merge, close, history, tag/search/export/visualize tools as a larger future menu; direct — current `pi-sequential-thinking` lacks branch metadata and navigation.

**why_it_matters:** Branching is useful only if users can see and follow branches. Lightweight lane navigation prevents alternative reasoning paths from becoming an unreadable flat list.

**meeting_test:** Given thoughts on `main` and `option-a`, a user can list branches and request a summary/history scoped to `option-a` without losing access to the full session.

## 6. Safety Log Caps, Redaction, and Incident Notes

**summary:** Treat the thinking history like a safety log: bound its size, flag suspicious or sensitive-looking content, and record warnings without silently deleting evidence. Add configurable max thought count and thought length, plus redaction/security warnings for prompt-injection-like content or secrets before export. This follows safety-log practice where entries remain auditable but risky material is clearly marked or minimized.

**axis:** Safety, limits, and tool-planning metadata

**basis:** direct — The grounding summary lists no bounded history and no redaction/security warnings as current gaps; external — `spences10/mcp-sequentialthinking-tools` has per-session max history and prompt-injection-like redaction, while `mettamatt/code-reasoning` has max thought caps and guidance-rich validation errors.

**why_it_matters:** Long-running agent sessions can accumulate excessive or sensitive state. Limits and warnings make the extension safer to use in persistent workflows.

**meeting_test:** Oversized thoughts and over-cap histories produce clear validation errors or configured truncation behavior, and exports can include redaction warnings while preserving atomic write/corrupt-file backup guarantees.

## 7. Tool-Planning Kanban Metadata

**summary:** Borrow from kanban boards by allowing each thought to declare optional `available_tools`, `recommended_tools`, and `next_action` metadata, while explicitly not executing those tools. The summary or history view can show a small planning column: proposed next tool, reason, and status. This aligns with the ADR lesson that planning tools may recommend next actions but should not hide expensive or side-effectful calls.

**axis:** Safety, limits, and tool-planning metadata

**basis:** direct — ADR-0016 says externalize process state into explicit tools and do not hide expensive or side-effectful calls; external — `spences10/mcp-sequentialthinking-tools` validates optional `available_tools` and `recommended_tools` without executing tools.

**why_it_matters:** Sequential thinking often produces operational next steps. Capturing tool recommendations as metadata makes plans reviewable and safer than embedding action instructions in prose.

**meeting_test:** A thought can include recommended tool metadata, invalid recommendations are caught against `available_tools` when provided, and no external tool calls are made by `process_thought`.

## 8. Research Notebook Synthesis Cards

**summary:** Add higher-level synthesis cards that organize thoughts by stage, tag, assumption, axiom, branch, and unresolved question. This is analogous to research notebooks where raw observations are periodically distilled into literature notes, findings, and open questions. Keep `generate_summary`, but make it more focused: produce compact sections for conclusions, contradictions, open assumptions, and suggested next thinking stage.

**axis:** Higher-level synthesis, organization, and tool-surface focus

**basis:** direct — The package already has stages, tags, axioms, assumptions, related-thought analysis, and `generate_summary`; external — Tree-of-Thought style systems add typed steps and summarization/archiving, but the grounding summary warns against bundling unrelated tools.

**why_it_matters:** The value of sequential thinking is not only capturing steps but extracting usable structure from them. Better synthesis helps users act on the recorded reasoning without expanding the package into unrelated web/shell/project tooling.

**meeting_test:** `generate_summary` can produce grouped sections for tags/stages/branches, list unresolved assumptions or contradictions, and remain focused on reasoning state rather than invoking external tools.

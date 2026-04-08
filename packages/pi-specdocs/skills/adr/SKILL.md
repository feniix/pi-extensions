---
name: adr
description: "(specdocs plugin) Creates Architecture Decision Records in MADR 4.0 format with PRD linkage and cross-references to implementation plans. Triggers when the user asks to create an ADR, document or record a technical decision, compare options (X vs Y), evaluate trade-offs, or review a PRD for ADR candidates."

---

# ADR Creation

Create Architecture Decision Records in MADR 4.0 format with PRD linkage. ADRs capture the context, options considered, and rationale behind architectural decisions so future team members understand why the system is built the way it is.

## When to trigger

This skill activates for any of: create an ADR, document/record a technical decision, capture a design choice, "should we use X or Y", "what's the best approach for X", compare these options, "we need to decide between X and Y", "record why we picked X", "which database/framework/library should we use", "evaluate X vs Y vs Z", "trade-offs between X and Y", "does this need an ADR", "any decisions worth capturing here", "which decisions need ADRs", review this PRD for ADR candidates, "we decided to use X over Y", "document this decision", "ADR for this", "why did we choose X".

## Input

- `$ARGUMENTS` — Optional. Determines the starting context:
  - **Path to a PRD file** (e.g., `docs/prd/PRD-007-infra-deploy.md`) — read the PRD and extract its Design Decisions (section 8). Present each decision that passes the 4-point test as an ADR candidate. Let the user pick which ones to create, or create all of them.
  - **Decision description** (e.g., `PostgreSQL vs DynamoDB for user storage`) — treat as the decision to evaluate. Skip the must-establish question about what decision needs to be made, proceed directly to gathering constraints and researching options.
  - **No arguments** — proceed with the full interactive flow.
  - **Conversation context** — if no arguments are provided but the conversation already contains relevant context (e.g., from `/architect` or a PRD discussion), use that context and only ask about what's still unclear.

## Tool Requirements — MANDATORY

> **IMPORTANT:** This skill prioritizes MCP tools over built-in alternatives. For codebase exploration, PREFER **serena** tools (`find_symbol`, `get_symbols_overview`, `find_referencing_symbols`, `search_for_pattern`, `list_dir`) over built-in Read, Grep, and Glob; if serena is not connected, fall back to built-in tools. For external research, PREFER **exa** (`web_search_exa`) and/or **ref** (`ref_search_documentation`, `ref_read_url`); if these are not connected, fall back to WebSearch/WebFetch. Built-in file I/O tools (Read, Write, Bash) are always used for operations MCP tools do not cover (e.g., writing the final ADR file).

## Tracker Configuration

Check the session context for the active tracker (printed by the SessionStart hook). Load the appropriate tracker reference when linking to issues:
- **GitHub** (default): `references/tracker-github.md`
- **Linear**: `references/tracker-linear.md`

If the session context shows "No config found", run the inline first-run setup before proceeding:

1. Tell the user: "No tracker config found. I'll create `.claude/tracker.md`."
2. Ask: "Which issue tracker does this project use? **GitHub** (default) or **Linear**?"
3. If GitHub (or user confirms default): write `.claude/tracker.md` with `tracker: github`.
4. If Linear: ask for the team key (e.g., `SPA`, `ENG`), then write `.claude/tracker.md` with `tracker: linear` and `linear-team: <KEY>`.
5. Continue with the ADR workflow.

Detection uses direct file read (Read tool on `.claude/tracker.md`) — not the session context — so it works even if the config was created mid-session.

If the session context doesn't indicate a tracker and there's no "No config found" message, default to GitHub.

## Tools

| Phase | Tool | Purpose |
|-------|------|---------|
| Explore Codebase | **serena** (`list_dir`, `find_file`, `search_for_pattern`, `find_symbol`, `get_symbols_overview`, `find_referencing_symbols`, `read_file`) | Understand current architecture and what the decision affects |
| External Research | **exa** (`web_search_exa`, `get_code_context_exa`), **ref** (`ref_search_documentation`, `ref_read_url`) | Research options, compare technologies, find benchmarks and prior art |
| Tracker | **See active tracker reference** | Link to related issues and PRs |
| Notion Sync | **Notion MCP** (optional, if enabled) | Sync ADR to Notion database |

## The 4-Point Test

Apply this test to decide whether a technical choice warrants a standalone ADR. If **2 or more** are true, create an ADR:

1. **Multiple approaches** — 2+ viable technical solutions exist
2. **Lasting consequences** — the choice has effects beyond the current sprint
3. **Disagreement potential** — a reasonable engineer might prefer a different option
4. **Future constraints** — the decision limits or shapes future work

Common decision points: data storage technology, API style (REST/GraphQL/gRPC), authentication mechanism, state management approach, deployment strategy, third-party service selection, caching strategy, messaging/event patterns, framework or library choices.

If a choice doesn't pass the 4-point test, it's an implementation detail — capture it in the PRD's Design Decisions section (section 8) instead of a standalone ADR.

## ADR Numbering and Storage

ADRs are stored at `docs/adr/ADR-NNNN-slug.md` where NNNN is a zero-padded 4-digit sequential number and slug is a kebab-case summary (e.g., `ADR-0015-custom-framework-vs-pulumi.md`).

To determine the next number:
1. List existing files in `docs/adr/`
2. Find the highest `ADR-NNNN` number
3. Increment by one (start at `ADR-0001` if none exist)
4. Create the `docs/adr/` directory if it doesn't exist

## Workflow

### 1. Gather Context

**Must establish:**
- What decision needs to be made and why now
- Which PRD or feature drives this decision (if any)
- What constraints exist (technical, organizational, timeline)

**Check for existing context:**
- Look for a PRD in `docs/prd/` that relates to this decision — the Design Decisions section (section 8) may already have options and rationale that should be expanded into the ADR
- Look for an existing implementation plan in `docs/architecture/` that references this decision
- Check `docs/adr/` for related or superseded ADRs

### 2. Research Options

Use **serena** to understand the current codebase:
- What patterns and technologies are already in use
- What the decision's blast radius is (which files/modules are affected)

Use **exa** and **ref** for external research:
- How other projects solve the same problem
- Technology comparisons, benchmarks, community adoption
- Known limitations and gotchas

Every ADR must present at least 2 considered options with substantive pros/cons. Don't create a strawman option just to have two — if there's genuinely only one viable approach, explain why in the Context section and whether an ADR is really needed.

### 3. Draft the ADR

Load the template at `references/adr-template.md` for the full MADR 4.0 structure.

**Key principles:**
- **Context should stand alone** — someone reading only the ADR should understand the decision without needing the PRD or plan
- **Options need real pros/cons** — "Good, because it's better" is not a pro. Be specific about what makes each option good or bad for this particular situation
- **Link back to decision drivers** — the Decision section should explicitly reference which drivers led to the choice
- **Consequences are honest** — every decision has negatives. State them and their mitigations
- **Status starts as Proposed** — the team can accept, reject, or supersede it later

### 4. Save and Cross-Reference

1. Write the ADR to `docs/adr/ADR-NNNN-slug.md`
2. If a PRD exists, note the ADR in the PRD's Design Decisions section or Related Issues section
3. If an implementation plan exists, add the ADR to the plan's ADR Index table
4. Tell the user the file path and summarize the recommendation
5. If Notion sync is enabled (check session context), follow `references/notion-sync.md` to sync the ADR to the configured Notion ADR database

## ADR Statuses

| Status | Meaning |
|--------|---------|
| **Proposed** | Decision drafted, awaiting team review |
| **Accepted** | Team agreed — this is the approach |
| **Deprecated** | No longer relevant (context changed) |
| **Superseded** | Replaced by a newer ADR (link to it) |

## Workflow Principles

- ADRs are written when decisions are being made, not after — if the code is already written, the ADR captures why it was built that way
- Prefer creating ADRs during PRD drafting or implementation planning, not as a separate documentation exercise
- If the user already has a PRD with Design Decisions (section 8), use those as starting points — expand the ones that pass the 4-point test into standalone ADRs
- Keep ADRs focused on one decision. If you find yourself covering multiple choices, split into separate ADRs

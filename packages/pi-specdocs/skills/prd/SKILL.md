---
name: prd
description: "(specdocs plugin) Drafts structured Product Requirements Documents with Gherkin acceptance criteria, design decisions, and concrete file breakdowns. Triggers when the user asks to write a PRD, scope a feature, write requirements, break down an issue (GitHub or Linear), or spec out work. Posts the result to the configured issue tracker and optionally syncs to Notion."

---

# PRD Creation

Draft structured Product Requirements Documents for any project using the canonical 14-section template with an optional Verification appendix. PRDs are stored locally as numbered files and posted to the configured issue tracker, with optional Notion sync.

## When to trigger

This skill activates for any of: write/create/draft a PRD, plan a feature, scope this work, write requirements, feature spec, requirements document, break down an issue into implementable requirements, "I need a spec for this", "scope out #N" or "scope out ENG-N", "what would it take to build X", "requirements for this feature", "write up what we're building", "formalize this into a PRD", "product requirements for X", "spec this out", "what do we need to build for #N", "turn this issue into a plan". Also triggers when the user shares an issue link (GitHub or Linear) and asks to plan, spec, or scope the work.

## Input

- `$ARGUMENTS` — Optional. Determines the starting context:
  - **Issue identifier** (e.g., `#42` for GitHub or `ENG-42` for Linear) — fetch the issue from the active tracker and treat as the **source issue**. The issue title becomes the feature title, the issue body seeds the problem statement. Skip the must-ask questions that the issue already answers, but still ask follow-ups for anything it doesn't cover. See the tracker reference for fetch instructions.
  - **Free-text description** (e.g., `add a caching layer for API responses`) — treat as the feature description. Use it to seed the problem statement and feature title. Still ask clarifying questions for scope, constraints, and source issue.
  - **No arguments** — proceed with the full interactive must-ask flow.
  - **Conversation context** — if no arguments are provided but the conversation already contains relevant context (e.g., from `/architect` or prior discussion), use that context and only ask about what's still unclear.

## Tool Requirements — MANDATORY

> **IMPORTANT:** This skill prioritizes MCP tools over built-in alternatives. For codebase exploration, PREFER **serena** tools (`find_symbol`, `get_symbols_overview`, `find_referencing_symbols`, `search_for_pattern`, `list_dir`) over built-in Read, Grep, and Glob; if serena is not connected, fall back to built-in tools. For external research, PREFER **exa** (`web_search_exa`) and/or **ref** (`ref_search_documentation`, `ref_read_url`); if these are not connected, fall back to WebSearch/WebFetch. Built-in file I/O tools (Read, Write, Bash) are always used for operations MCP tools do not cover (e.g., writing the final PRD file).

## Tracker Configuration

Check the session context for the active tracker (printed by the SessionStart hook). Load the appropriate tracker reference:
- **GitHub** (default): `../../references/tracker-github.md`
- **Linear**: `../../references/tracker-linear.md`

If the session context shows "No config found", run the inline first-run setup before proceeding:

1. Tell the user: "No tracker config found. I'll create `.claude/tracker.md`."
2. Ask: "Which issue tracker does this project use? **GitHub** (default) or **Linear**?"
3. If GitHub (or user confirms default): write `.claude/tracker.md` with `tracker: github`.
4. If Linear: ask for the team key (e.g., `SPA`, `ENG`), then write `.claude/tracker.md` with `tracker: linear` and `linear-team: <KEY>`.
5. Continue with the PRD workflow.

Detection uses direct file read (Read tool on `.claude/tracker.md`) — not the session context — so it works even if the config was created mid-session.

If the session context doesn't indicate a tracker and there's no "No config found" message, default to GitHub.

## Tools

| Phase | Tool | Purpose |
|-------|------|---------|
| Explore Codebase | **serena** (`list_dir`, `find_file`, `search_for_pattern`, `find_symbol`, `get_symbols_overview`, `find_referencing_symbols`, `read_file`) | Identify affected files, understand current behavior and module relationships |
| External Research | **exa** (`web_search_exa`, `get_code_context_exa`), **ref** (`ref_search_documentation`, `ref_read_url`) | Research comparable tools, prior art, relevant docs and standards |
| Tracker | **See active tracker reference** | Fetch issue details, post PRD as comment, create issues |
| Notion Sync | **Notion MCP** (optional, if enabled) | Sync PRD to Notion database |

## PRD Numbering and Storage

PRDs are stored at `docs/prd/PRD-NNN-slug.md` where NNN is a zero-padded sequential number and slug is a kebab-case summary of the feature (e.g., `PRD-007-infra-deploy-framework.md`).

To determine the next number:
1. List existing files in `docs/prd/`
2. Find the highest `PRD-NNN` number
3. Increment by one (start at `PRD-001` if none exist)
4. Create the `docs/prd/` directory if it doesn't exist

## Workflow

### 1. Gather Inputs

Collect from the user before drafting. Start with the must-ask questions; follow up with the rest only if the answers aren't obvious from context.

**Must-ask:**
- Feature title
- Problem statement — what problem and why now
- **Source issue** — is this PRD being written *for* an existing issue? (If yes, the PRD will be posted as a comment on that issue.) This is different from merely referencing an issue — the user might mention related issues for context without any of them being the source. Ask explicitly: "Is this PRD for issue X, or is it an original PRD that just references it?"

**Ask if unclear:**
- Target users and use cases
- Known constraints or design preferences
- Scope boundaries — anything explicitly out of scope
- Related issues (for cross-referencing in Section 13, distinct from the source issue)

**Fetch issue context:**
Once you know which issues are involved (source or related), fetch their content using the active tracker's fetch operation (see tracker reference). Always include comments for the source issue to capture discussion. This is essential context for drafting — the issue body, labels, comments, and linked PRs inform the problem statement, scope, and design decisions. Don't skip this even if the user summarized the issue verbally; the actual issue often contains details the user didn't mention.

**Derive from codebase exploration (Step 2):**
- Affected files and modules
- Current architecture and integration points

### 2. Explore the Codebase

Use **serena** to understand the project before drafting:

1. **Orient** — use `get_symbols_overview` on key directories to understand project structure. If the project has architecture docs, README, or CLAUDE.md, read those first for context.
2. **Trace** — use `find_symbol` and `find_referencing_symbols` to map out which modules, types, and functions the feature touches. Follow the dependency chain until you understand the blast radius.
3. **Search** — use `search_for_pattern` to find related patterns, similar implementations, or configuration that the feature would interact with.

The goal is to produce a concrete File Breakdown (Section 9) with real file paths — not vague module references. Don't start drafting until you know what exists.

### 3. Draft the PRD

Load the template at `references/prd-template.md` for the full section structure. For tone and depth calibration, read `references/prd-example-excerpt.md` — it has one example per section from a real production PRD with calibration notes explaining what makes each section effective.

For external context — comparable tools, prior art, relevant docs or standards — use **exa** or **ref**.

**Depth calibration:**
- Each FR section: 100-300 words including Gherkin
- Full PRD: 800-2000 words depending on feature complexity
- Gherkin scenarios: 1-3 per FR (cover the happy path and the most important edge case)

**Section structure:**

The template has 14 required sections plus an optional Verification appendix. Some sections contain sub-elements marked `<!-- optional -->` — include these when the PRD's complexity warrants them:

1. Problem & Context
2. Goals & Success Metrics — *optional: Guardrails (include when existing behavior could regress)*
3. Users & Use Cases (user stories with preconditions) — *optional: Future user type*
4. Scope (in scope, out of scope with tracking issues) — *optional: Design for future*
5. Functional Requirements (Gherkin acceptance criteria for each) — *optional: Files per FR (include for complex PRDs, omit for lighter ones)*
6. Non-Functional Requirements
7. Risks & Assumptions (severity/likelihood/mitigation table)
8. Design Decisions (options considered, rationale) — *optional: Future path per decision*
9. File Breakdown (concrete file paths and change types)
10. Dependencies & Constraints
11. Rollout Plan
12. Open Questions (with owners and status — see format rules below)
13. Related Issues
14. Changelog
15. Verification (optional appendix — post-implementation checklist for complex features)

**YAML frontmatter:**

Every PRD starts with YAML frontmatter for machine-parseable metadata:

```yaml
---
title: "[Title]"
prd: PRD-NNN
status: Draft
owner: "[Name]"
issue: "[#N or N/A]"
date: YYYY-MM-DD
version: "1.0"
---
```

**Open Questions format:**

The Open Questions table has a specific format that must be followed exactly:

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Where should the state file live? | Alex | Before Phase 3 | **Resolved:** `~/.local/state/app/` per XDG spec. |
| Q2 | Should we support parallel execution? | Alex | Before Phase 4 | Open |

- The **Status** column contains either `Open` or `**Resolved:** [concise answer]`
- Resolutions ALWAYS go in the Status column — never in the Question column
- The bold **Resolved:** prefix makes scanning trivial: read down the Status column to see what's still open
- Each question needs an owner and a due date (tied to a milestone or phase, not "TBD")

**Quality guidelines:**

- **Be specific, not aspirational.** Every goal needs a measurable metric. "Improve performance" is not a goal — "Reduce cold-start time from 4s to under 1s" is. If you can't measure it yet, say what you'd measure and mark the target as TBD.
- **Trace requirements to files.** Each FR should list the files it affects. Each file in the File Breakdown should trace back to at least one FR. If a file appears in the breakdown but no FR references it, either the FR is missing or the file doesn't belong.
- **Write Gherkin that a developer can implement against.** Scenarios should describe observable behavior, not implementation details. Use concrete values in examples — `Given a user with 3 active projects` not `Given a user with projects`. Avoid `And the system processes correctly` — say what "correctly" means.
- **Distinguish decisions from assumptions.** A design decision is something you chose between alternatives — state what you picked, what you rejected, and why. An assumption is something you believe to be true but haven't verified — state it clearly so it can be challenged.
- **Keep the Out of Scope table honest.** Every deferred item needs a real reason and a tracking issue. "Out of scope" without a "why" is a red flag that the scope wasn't thought through.
- **Risks should have actionable mitigations.** "Handle errors gracefully" is not a mitigation. "Implement exponential backoff with jitter, max 3 retries, then surface the error to the user with the failed item count" is.
- **Design decisions show the alternatives.** Showing what you rejected and why is as valuable as explaining what you chose — it prevents future developers from re-litigating settled decisions.

### 4. Save and Publish

**Always — save locally:**
1. Determine the next PRD number (see Numbering and Storage above)
2. Write the PRD to `docs/prd/PRD-NNN-slug.md`
3. Tell the user the file path

**Then publish to the active tracker based on the PRD's origin:**

| Origin | Action |
|--------|--------|
| **Source issue exists** — the PRD was written *for* a specific issue | Post the PRD as a comment on that issue (see tracker reference for the operation) |
| **Original PRD** — no source issue, this is new work | Create a new issue with the PRD as the body (see tracker reference for the operation) |

The distinction matters: a user might say "spec out a caching layer, see issue X for background" — that references the issue for context but the PRD is original work, so it gets a new issue. Versus "write a PRD for issue X" — the PRD is *for* that issue, so it's posted as a comment. When in doubt, ask.

**Optional: Sync to Notion**

If the session context indicates Notion sync is enabled, follow the instructions in `../../references/notion-sync.md` to sync the PRD to the configured Notion PRD database. This is the final step — a sync failure should not block the local save or tracker publication.

**After publishing**, mention that the user can run `/plan-prd` to generate an implementation plan from the PRD, and that design decisions identified during drafting may warrant standalone ADRs via `/adr`.

## Workflow Principles

- Don't draft until codebase exploration is complete — the File Breakdown and FR sections depend on knowing what exists
- Prefer concrete file paths over vague module references — `src/auth/middleware.ts` not "the auth module"
- If the user's request is small enough that a full 14-section PRD feels like overkill, say so and suggest a lighter format — the skill serves the user, not the template
- When uncertain about scope boundaries, ask the user rather than guessing — a PRD with wrong scope is worse than a delayed one
- Keep Gherkin scenarios focused on observable behavior, not implementation details
- Cross-reference between sections: FRs should reference files, files should trace to FRs, risks should connect to the requirements they threaten

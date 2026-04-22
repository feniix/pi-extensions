---
name: adr
description: "Create Architecture Decision Records in MADR 4.0 format for durable technical choices. Use whenever the user wants to create or record an ADR, compare technical options, evaluate trade-offs, decide between X and Y, document why a design choice was made, review a PRD or plan for ADR candidates, or capture a decision that will constrain future work even if they do not explicitly say 'ADR'."
---

# ADR Creation

Create Architecture Decision Records that explain the context, options, recommendation, and consequences of a meaningful technical decision.

## Before you start

- Read `../shared/references/tooling.md`
- Read `../shared/references/document-conventions.md`
- Read `../shared/references/adr-four-point-test.md`
- If tracker work is needed, read `../shared/references/tracker-setup.md`

Load local references only when needed:
- `references/adr-template.md` for the final MADR 4.0 structure
- `references/tracker-github.md` or `references/tracker-linear.md` for tracker-specific actions
- `references/notion-sync.md` only if Notion sync is enabled and the user wants sync

## Inputs

Use the richest available input source in this order:

1. `$ARGUMENTS` if supplied
2. relevant conversation context already established
3. interactive questions for anything still missing

Treat the input as one of:
- **PRD path** — read the PRD, start with its Design Decisions section, then scan functional requirements, risks, and open questions for ADR candidates
- **Plan path** — read the implementation plan and extract candidate decisions from components, risks, and ADR tables
- **Decision description** — evaluate the described decision directly
- **No explicit input** — ask what decision needs to be made and why now

## Workflow

### 1. Establish the decision

Make sure you understand:
- what decision is being made
- why it matters now
- what constraints are in play
- which PRD, plan, issue, or initiative created the pressure for this decision

**Mandatory PRD/plan screening step:**
If the input is a PRD path or plan path, do **not** draft or save an ADR immediately.

First:
1. extract candidate decisions from the document
2. score each candidate against the 4-point test
3. present the candidates in a table
4. recommend which candidates qualify for standalone ADRs
5. ask the user which candidate(s) to draft

Use this table format:

| Candidate | Multiple approaches | Lasting consequences | Disagreement potential | Future constraints | Recommendation |
|-----------|---------------------|----------------------|------------------------|-------------------|----------------|

Mark each criterion as `Yes` or `No`, and briefly justify borderline cases when needed.

If exactly one candidate qualifies, still present it with its 4-point-test result and ask for confirmation before drafting.

Only skip this screening/confirmation step if:
- the user explicitly names the exact decision to document, or
- the user explicitly says to draft all qualifying ADRs.

A PRD or plan path by itself is not an explicit decision. The named decision must be specific enough to distinguish one candidate from other plausible ADRs in the document.

For PRD or plan inputs, the first response must stop after candidate analysis and the user-choice question. Do not include draft ADR content in that first response.

If no candidates qualify, do not draft an ADR. Explain why and recommend capturing the decision in the PRD or plan instead.

When the input is a PRD or plan, recommendation is allowed; silent selection is not.

### 2. Gather local context

Inspect the repository and related docs to understand:
- current architecture and technologies already in use
- affected modules, files, and boundaries
- related PRDs, plans, and existing ADRs
- whether a similar decision already exists and should be superseded instead of duplicated

Do not draft a generic ADR if the repository already strongly constrains the answer.

### 3. Research viable options

Every ADR should discuss at least two real options unless the context proves there is only one viable path.

For each option, gather concrete pros and cons tied to this project's constraints:
- operational complexity
- migration cost
- developer ergonomics
- performance or scale considerations
- security, compliance, or reliability implications
- fit with the existing codebase and team habits

Do not invent a strawman option just to satisfy the template.

### 4. Draft the ADR

Read `references/adr-template.md` and fill it with project-specific content.

Quality bar:
- the **Context** must stand on its own
- the **Decision Drivers** should reflect real constraints you discovered
- the **Considered Options** section must contain substantive trade-offs
- the **Decision Outcome** should explain why the chosen option wins here, not in the abstract
- the **Consequences** section must include downsides and mitigations, not just benefits
- default the status to **Proposed** unless the user explicitly says the decision is already accepted

Keep one ADR focused on one decision. If the write-up starts covering multiple independent choices, split it.

### 5. Save the ADR

Use the shared document conventions to determine the next ADR number and write the file to:

`docs/adr/ADR-NNNN-slug.md`

Do not save the ADR until:
- the user selected the candidate, or
- the user explicitly authorized drafting all qualifying candidates, or
- the input already specified the exact decision to document.

After saving:
- ask the user to run the pi slash command `/specdocs-validate` so structural/frontmatter issues are surfaced immediately
- if formatting cleanup is needed, ask the user to run the pi slash command `/specdocs-format docs/adr/ADR-NNNN-slug.md` on the saved ADR
- do not treat `specdocs-validate` or `specdocs-format` as bash executables or check PATH for them; they are pi extension commands

Always report the file path, summarize the recommendation, and mention any validation/formatting follow-up you performed.

### 6. Cross-reference carefully

After the ADR is saved:
- link back to the source PRD or plan inside the ADR
- if the user asked for follow-through, update the related PRD or plan to reference the new ADR
- if Notion sync is enabled and requested, follow `references/notion-sync.md`

Do not silently mutate other documents unless the workflow explicitly requires it or the user asked for it.

## Tracker-aware behavior

If the user wants issue links, publication, or tracker context:
- read `../shared/references/tracker-setup.md`
- detect the active tracker
- load the matching tracker reference from `references/`

Default to GitHub if no tracker config exists and the user does not choose otherwise.

## Pre-save checklist

Before drafting or saving an ADR, verify:
- [ ] I determined whether the input was a PRD path, plan path, explicit decision description, or no explicit input
- [ ] If it was a PRD or plan, I extracted candidate decisions
- [ ] If it was a PRD or plan, I scored candidates with the 4-point test
- [ ] If it was a PRD or plan, I showed the candidate list to the user in the required 4-point-test table format
- [ ] I got confirmation on which candidate(s) to draft, unless the user explicitly requested all or named the exact decision

If any box is unchecked, stop and ask the user instead of drafting.

## Workflow principles

- Use the 4-point test to avoid creating ADRs for trivial implementation details
- For PRD or plan inputs, the default first response should be candidate analysis, not a finished ADR
- Prefer repository evidence over generic architecture folklore
- Capture the reasoning people will forget later, not the facts that are obvious from the code
- Be honest about trade-offs; a persuasive ADR with no downsides is usually not credible
- If the decision is still under debate, present a recommendation and keep the status as Proposed

---
name: plan-prd
description: "Create an implementation plan from a PRD, identifying components, dependencies, and architectural decisions that may warrant ADRs. Triggers when the user asks to create an implementation plan, break a PRD into phases, or plan how to build something from a PRD."
---

# Implementation Plan from PRD

Create an implementation plan from a PRD, generating a structured plan document with ADR cross-references.

## When to trigger

This skill activates for any of: create an implementation plan from a PRD, "plan this PRD", "break this PRD into implementation phases", "what's the architecture for this PRD", "how should we implement this PRD", "create a plan from PRD-NNN", "implementation plan for this feature", "turn this PRD into actionable work".

## Input

- `$ARGUMENTS` — Path to a PRD file. If not provided, check if a PRD is already loaded in the current conversation context and use that. As a last resort, search `docs/prd/` for the most recently modified PRD.

## Process

### 1. Validate Setup

- Create `docs/architecture/` if it doesn't exist.
- Check `docs/adr/` for existing ADRs to reference.

### 2. Assess Complexity

Before generating the plan, assess the PRD's complexity. If the feature is complex enough to benefit from interactive architectural discussion, suggest to the user:

> "This feature has significant architectural decisions. Would you like me to enter plan mode so we can discuss the approach interactively before I write the plan document?"

Let the user decide. If they decline, proceed with generating the plan document directly.

### 3. Read and Analyze the PRD

- Read the PRD file completely
- Extract: problem statement, goals, functional requirements, design decisions, file breakdown
- Identify which Design Decisions (section 8) pass the 4-point test for standalone ADRs:
  1. Multiple approaches — 2+ viable solutions exist
  2. Lasting consequences — effects beyond the current sprint
  3. Disagreement potential — a reasonable engineer might prefer a different option
  4. Future constraints — the decision limits or shapes future work

### 4. Generate the Plan

Use the template at `references/plan-template.md` as the structure.

- Write an Architecture Overview grounded in the PRD's goals
- Break down into components, noting which involve decisions
- Define implementation order with dependencies and estimated scope
- Identify risks and mitigations
- List open questions that need resolution

Write the plan to: `docs/architecture/plan-{slug}.md`

### 5. Flag ADR Candidates

For each Design Decision from the PRD that passes the 4-point test, note it in the plan's ADR Index table with status "Pending". Do not create the ADR files automatically — instead, present the candidates to the user:

> "These decisions warrant standalone ADRs. Run `/adr` to create them, or I can create them now if you'd like."

### 6. Cross-Reference

- Link the plan back to the source PRD
- If ADRs already exist for any decisions, reference them in the relevant component sections

### 7. Output Summary

Report:
- Plan file path
- Brief description of the architecture
- Table of ADR candidates: decision title, 4-point score, status
- Any open questions or areas needing team discussion

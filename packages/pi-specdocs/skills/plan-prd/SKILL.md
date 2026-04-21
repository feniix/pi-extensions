---
name: plan-prd
description: "Create implementation plans from PRDs by turning requirements into architecture, phases, dependencies, workstreams, and ADR candidates. Use whenever the user wants to plan how to build a PRD, break a PRD into implementation phases, sequence the work, identify components and risks, turn a spec into actionable engineering work, or decide what should happen first even if they do not explicitly ask for an 'implementation plan'."
---

# Implementation Plan from PRD

Turn a PRD into an implementation plan that explains architecture, sequencing, dependencies, risks, and ADR-worthy decisions.

## Before you start

- Read `../shared/references/tooling.md`
- Read `../shared/references/document-conventions.md`
- Read `../shared/references/adr-four-point-test.md`
- Read `references/plan-template.md`

## Inputs

Preferred input order:

1. `$ARGUMENTS` containing a PRD path
2. a PRD clearly established in the conversation context
3. a small set of candidate PRDs from `docs/prd/` for the user to choose from

Do **not** silently pick the most recently modified PRD if there is any ambiguity. If multiple plausible PRDs exist and the user did not specify one, ask.

## Workflow

### 1. Resolve the source PRD

Read the source PRD completely before planning.

Extract at minimum:
- problem statement and goals
- functional and non-functional requirements
- design decisions and open questions
- file breakdown and dependencies
- rollout expectations and risks

If the PRD is too vague to plan against, say what is missing and ask targeted follow-up questions rather than generating a hand-wavy plan.

### 2. Gather repository context

Use the tooling policy to inspect the current codebase and nearby docs so the plan reflects reality.

Look for:
- existing architecture documents in `docs/architecture/`
- existing ADRs in `docs/adr/`
- current implementation patterns that the PRD will extend or replace
- modules and files named in the PRD that need dependency or sequencing analysis

### 3. Assess planning mode

If the feature has large architectural uncertainty, substantial migration risk, or many open questions, offer an interactive planning mode before writing the final document.

Use language like:

> This PRD has meaningful architectural decisions and sequencing risk. If you want, we can discuss the approach interactively before I write the final plan.

If the user declines, proceed directly.

### 4. Build the implementation plan

Use `references/plan-template.md` as the structure and make the plan concrete.

The plan should include:
- an architecture overview tied to the PRD's goals
- major components or workstreams
- implementation phases in a sensible order
- dependencies between phases, systems, or teams
- risks, mitigations, and open questions
- an ADR index for decisions that deserve formal records

Quality bar:
- phases are sequenced by dependency, not by arbitrary ordering
- each phase has a clear outcome or milestone
- components map back to actual requirements or file areas from the PRD
- risk discussion focuses on delivery and architectural failure modes that matter here
- open questions are specific enough to unblock ownership and follow-up
- the plan helps an engineer decide what to do first, what can happen in parallel, and what should wait

### 5. Flag ADR candidates

Review the PRD's design decisions and the plan's newly surfaced decisions against the 4-point test.

For each candidate:
- include it in the plan's ADR Index table
- note whether an ADR already exists or the decision is still pending
- if no ADR exists, present the candidates to the user after saving the plan

Do not create ADR files automatically unless the user asks.

### 6. Save the plan

Write the plan to:

`docs/architecture/plan-slug.md`

Always report the file path and summarize:
- the architecture shape
- the implementation order
- the main dependencies or risk hotspots

### 7. Cross-reference

- link the plan back to its source PRD
- reference any existing ADRs in relevant sections
- if appropriate, suggest using `/adr` for pending ADR candidates

Only update adjacent documents automatically if the user asked for that follow-through.

## Workflow principles

- A plan is not just a PRD summary; it should turn requirements into execution order
- Prefer explicit sequencing and dependency reasoning over generic phase names
- Use ADR candidates to surface unresolved architecture, not to offload all thinking
- Ask for clarification when ambiguity changes implementation order or architecture
- Keep the document grounded in the repository that actually exists today

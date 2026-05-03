---
title: "Stateful Exa Research Planning Tools"
adr: ADR-0016
status: Proposed
date: 2026-05-03
prd: "PRD-008-pi-exa-research-planning-tools"
decision: "Add stateful exa_research_* planning tools that recommend explicit Exa retrieval calls"
---

# ADR-0016: Stateful Exa Research Planning Tools

## Status

Proposed

## Date

2026-05-03

## Requirement Source

- **PRD**: `docs/prd/PRD-008-pi-exa-research-planning-tools.md`
- **Plan**: `docs/architecture/plan-pi-exa-research-planning-tools.md`
- **Decision Point**: PRD-008 FR-1 through FR-8 require a reliable research-planning workflow that tracks criteria, sources, gaps, assumptions, branches, revisions, and human-readable summaries.

## Context

`packages/pi-exa/skills/exa-research-planner/SKILL.md` currently describes an iterative research workflow in markdown. It can tell the model to discover many search criteria, run cheap discovery rounds, fetch paper contents, and produce human-readable plans. However, prompt-only guidance does not reliably preserve state across a long research process.

The desired behavior resembles existing stateful reasoning packages in this repository:

- `packages/pi-sequential-thinking` records staged thoughts and summarizes progress.
- `packages/pi-code-reasoning` records sequential thoughts with branch and revision support.

PRD-008 asks for the same kind of externalized process state for Exa research planning: criteria coverage, Source Pack status, open gaps, assumptions, recommended next actions, and optional payload generation.

The decision is whether `pi-exa` should keep improving the markdown skill only, add stateful planning tools, or create a separate package for research planning.

## Decision Drivers

- PRD-008 requires multi-step criteria and source tracking that a prompt-only skill cannot reliably enforce.
- Exa deep research has cost and latency implications; the workflow must keep retrieval/synthesis tool calls explicit.
- Existing repository patterns already support stateful thinking tools with reset/status/summary ergonomics.
- The research planner must produce human-readable plans before implementation payloads.
- The workflow should remain specific to Exa tool usage and Source Pack behavior.

## Considered Options

### Option 1: Keep improving `SKILL.md` only

Continue encoding all behavior in `packages/pi-exa/skills/exa-research-planner/SKILL.md`.

- Good, because it has the lowest implementation cost.
- Good, because it adds no new tool surface area.
- Bad, because the model can still skip steps, forget discovered criteria, lose source status, or show raw payloads too early.
- Bad, because there is no structured status or reset mechanism.
- Bad, because branch/revision behavior cannot be validated or summarized consistently.

### Option 2: Add stateful `exa_research_*` planning tools inside `pi-exa`

Add tools such as `exa_research_step`, `exa_research_status`, `exa_research_summary`, and `exa_research_reset` to `packages/pi-exa`.

- Good, because it follows the successful stateful-process pattern from `pi-sequential-thinking` and `pi-code-reasoning`.
- Good, because it makes criteria, sources, gaps, and assumptions explicit and inspectable.
- Good, because it can recommend next Exa retrieval calls without hiding network cost.
- Good, because it keeps Exa-specific planning close to Exa retrieval tools and skills.
- Bad, because it increases tool surface area.
- Bad, because it requires new state management, schemas, tests, and documentation.

### Option 3: Create a separate research-planning package

Build a new package dedicated to generic research planning, independent of `pi-exa`.

- Good, because the concept could apply beyond Exa.
- Good, because it avoids increasing `pi-exa` tool count for users who only want search.
- Bad, because PRD-008 behavior is tightly coupled to Exa tools, Exa source retrieval, and `web_research_exa` payload generation.
- Bad, because a second package adds installation and coordination complexity.
- Bad, because cross-package prompt/tool routing would be harder to document and test.

## Decision

Chosen option: **"Add stateful `exa_research_*` planning tools inside `pi-exa`"**, because PRD-008 requires reliable, inspectable process state while preserving explicit Exa retrieval calls. Keeping the tools inside `pi-exa` matches the Exa-specific nature of the source strategy, Source Pack, and deep-research payload workflow.

The planning tools will recommend next actions such as `web_search_exa`, `web_fetch_exa`, or `web_research_exa`, but they will not call Exa network tools internally.

## Consequences

### Positive

- Research planning becomes auditable: criteria, sources, gaps, and assumptions are visible in tool state.
- The model gets a durable workflow similar to sequential/code reasoning instead of relying on prompt compliance.
- User-facing plans can be generated from accumulated state, improving review quality before deep research runs.
- Exa cost transparency is preserved because retrieval and synthesis remain explicit tool calls.

### Negative

- `pi-exa` gains additional tools, increasing prompt/tool-selection surface area.
  - Mitigation: prefix tools with `exa_research_` and describe them clearly as planning/orchestration tools.
- Implementation becomes more complex than a markdown-only skill.
  - Mitigation: follow existing `pi-code-reasoning` and `pi-sequential-thinking` state/status/reset patterns.
- The model may still skip the planning tools unless the skill strongly routes non-trivial research through them.
  - Mitigation: update `packages/pi-exa/skills/exa-research-planner/SKILL.md` and tests to require the tools.

### Neutral

- The stateful planning tools do not replace `web_research_exa`; they sit above it as orchestration.
- Future generic research-planning functionality could still be extracted into another package if non-Exa use cases emerge.

## Related

- **PRD**: `docs/prd/PRD-008-pi-exa-research-planning-tools.md`
- **Plan**: `docs/architecture/plan-pi-exa-research-planning-tools.md`
- **ADRs**: `docs/adr/ADR-0005-exa-deep-search-tool-strategy.md`
- **Implementation**: `packages/pi-exa/extensions/`, `packages/pi-exa/skills/exa-research-planner/SKILL.md`

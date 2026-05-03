---
title: "In-Memory Exa Research Planning Sessions"
adr: ADR-0017
status: Proposed
date: 2026-05-03
prd: "PRD-008-pi-exa-research-planning-tools"
decision: "Start with in-memory research planning sessions; defer persistence"
---

# ADR-0017: In-Memory Exa Research Planning Sessions

## Status

Proposed

## Date

2026-05-03

## Requirement Source

- **PRD**: `docs/prd/PRD-008-pi-exa-research-planning-tools.md`
- **Plan**: `docs/architecture/plan-pi-exa-research-planning-tools.md`
- **Decision Point**: PRD-008 lists persistence as an open question. The implementation plan needs a first-session storage strategy for `exa_research_step`, `exa_research_status`, `exa_research_summary`, and `exa_research_reset`.

## Context

PRD-008 requires stateful research-planning tools that accumulate steps, criteria, sources, gaps, assumptions, branches, and revisions. That state must live somewhere.

The repository has two relevant precedents:

- `packages/pi-code-reasoning` uses in-memory tracking for code reasoning thoughts, branches, and resets.
- `packages/pi-sequential-thinking` includes persistent session storage and import/export capabilities.

Exa research planning could eventually benefit from persistence, especially for long-running research projects or handoffs. However, the first implementation primarily needs reliable intra-session state so the model can complete one research workflow without losing criteria/source/gap context.

## Decision Drivers

- PRD-008 can be satisfied initially with state that lasts for the active pi extension runtime/session.
- Simpler implementation reduces risk while adding several new planning tools.
- Persistent storage introduces config, path resolution, import/export, privacy, and cleanup concerns.
- Research planning state may contain URLs, source notes, and user research intent, so persistence should be intentional.
- Existing `pi-code-reasoning` provides an in-memory precedent for branch/revision workflows.

## Considered Options

### Option 1: In-memory session state only

Store research planning state in module-level memory for the current extension runtime. `exa_research_reset` clears it.

- Good, because it is simple and matches the first implementation's needs.
- Good, because it avoids new config, file paths, and persistence privacy concerns.
- Good, because it follows the `pi-code-reasoning` pattern for branch/revision state.
- Bad, because state is lost when the pi session/runtime restarts.
- Bad, because users cannot resume a long research plan across sessions without copying a summary.

### Option 2: Persist sessions to disk from day one

Store research planning sessions under a configurable directory, similar to `pi-sequential-thinking`.

- Good, because users can resume long-running research workflows.
- Good, because handoff and audit trails become easier.
- Bad, because it adds config, import/export, migration, and cleanup complexity before the core workflow is proven.
- Bad, because persisted research state may include sensitive topics, URLs, or source notes.
- Bad, because PRD-008 does not require persistence for the initial user-facing behavior.

### Option 3: Hybrid in-memory with explicit export/import

Keep default state in memory, but add export/import tools in the first implementation.

- Good, because persistence is user-controlled rather than automatic.
- Good, because handoff becomes possible without always writing local state.
- Bad, because it still expands scope and schemas for the first implementation.
- Bad, because PRD-008 already has several new tools and state models to ship.

## Decision

Chosen option: **"In-memory session state only"**, because it satisfies PRD-008's initial requirements with the least complexity and least persistence/privacy risk. Persistence should be deferred until real usage shows that cross-session resume or durable research audit trails are needed.

The implementation should keep stable in-memory IDs for criteria, sources, and gaps so future persistence or export/import can be added without changing the conceptual model.

## Consequences

### Positive

- First implementation stays focused on stateful planning behavior rather than storage infrastructure.
- No new storage directory, config file, or persistence lifecycle is required.
- Research topics and source notes are not silently written to disk.
- The design remains compatible with future export/import or disk persistence.

### Negative

- Users lose active planning state when the extension runtime ends.
  - Mitigation: `exa_research_summary(mode: "execution_plan")` and `exa_research_summary(mode: "source_pack")` can produce copyable summaries for manual handoff until explicit handoff/export modes exist.
- Long research workflows cannot be resumed automatically.
  - Mitigation: add export/import or persistence later if this becomes a real usage need.
- Automated audit trails are limited to the current session transcript.
  - Mitigation: Source Pack and execution-plan summaries preserve the most important state in user-visible output.

### Neutral

- This decision does not affect Exa retrieval tools or their caching behavior.
- If persistence is added later, it should likely follow `pi-sequential-thinking` config conventions.

## Related

- **PRD**: `docs/prd/PRD-008-pi-exa-research-planning-tools.md`
- **Plan**: `docs/architecture/plan-pi-exa-research-planning-tools.md`
- **ADRs**: `docs/adr/ADR-0016-stateful-exa-research-planning-tools.md`
- **Implementation**: `packages/pi-exa/extensions/research-planner.ts`, `packages/pi-exa/extensions/research-planner-types.ts`

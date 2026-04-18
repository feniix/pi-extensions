---
title: "Conductor-managed project-scoped storage for pi-conductor"
adr: ADR-0002
status: Proposed
date: 2026-04-18
prd: "PRD-001-pi-conductor-mvp"
decision: "Use conductor-managed project-scoped storage under ~/.pi/agent/conductor/projects/<project-key>/"
---

# ADR-0002: Conductor-managed project-scoped storage for pi-conductor

## Status

Proposed

## Date

2026-04-18

## Requirement Source

- **PRD**: `docs/prd/PRD-001-pi-conductor-mvp.md`
- **Decision Point**: Section 8, Decision D2; FR-1, FR-2, FR-7; NFR Storage and State Ownership

## Context

`pi-conductor` needs persistent runtime state for worker metadata, worktree linkage, branch linkage, summaries, PR metadata, and recovery information. That state should survive conductor restarts, remain outside the git repository, and avoid accidental coupling to Pi’s internal extension discovery paths or session-directory conventions.

A storage decision is needed now because it affects project-key derivation, cleanup semantics, recovery behavior, portability, and how worker metadata references underlying Pi session files.

The main question is where conductor-owned state should live:
- in the repository itself
- inside Pi’s session storage tree
- or under a conductor-owned global namespace keyed by project

## Decision Drivers

- Runtime/session artifacts should not be committed to the repo
- Storage must be project-scoped and easy to reason about operationally
- The design should avoid dependence on Pi’s extension discovery tree
- The design should avoid tight coupling to Pi’s internal session bucket layout
- Recovery and cleanup should be conductor-owned and deterministic

## Considered Options

### Option 1: Repo-local state

Store conductor runtime state under a project-local directory such as `.pi/conductor/`.

- Good, because state is physically near the project it belongs to
- Good, because it is straightforward to inspect while working in the repo
- Bad, because it requires `.gitignore` coordination and risks repo clutter from runtime artifacts
- Bad, because the repo becomes the home for mutable operational state rather than just code and committed docs

### Option 2: Reuse Pi session bucket layout

Store conductor state somewhere inside Pi’s existing per-project session buckets.

- Good, because it keeps state adjacent to session concepts
- Bad, because it couples conductor to Pi’s internal session directory structure and path encoding behavior
- Bad, because it blurs the ownership boundary between conductor metadata and Pi session storage internals

### Option 3: Conductor-managed project-scoped storage namespace

Store conductor metadata under a conductor-owned path such as `~/.pi/agent/conductor/projects/<project-key>/`, while worker records reference Pi session files.

- Good, because it creates a clean ownership boundary: conductor owns orchestration metadata, Pi owns session internals
- Good, because it keeps runtime state out of the repo without depending on extension discovery or session-internal paths
- Good, because recovery and cleanup can be modeled around a stable conductor-owned namespace
- Bad, because state is no longer physically inside the repo, so debugging requires knowing the project-key mapping

## Decision

Chosen option: **"Conductor-managed project-scoped storage namespace"**, because it best balances project scoping, clean ownership, non-committed runtime state, and independence from Pi’s internal extension/session directory conventions.

## Consequences

### Positive

- Conductor gets a stable home for worker metadata and recovery state
- The repository stays free of runtime/session artifacts
- Conductor can evolve its own storage format without depending on Pi’s extension or session bucket layout

### Negative

- The project-key derivation becomes a critical part of the design; mitigation is to make it deterministic and test it explicitly
- Operators need a clear way to inspect conductor state outside the repo; mitigation is to expose status/cleanup commands rather than expecting manual filesystem navigation

### Neutral

- Worker records still reference Pi session files rather than embedding session internals
- A future migration to conductor-managed custom session directories remains possible if Pi’s default session layout proves awkward

## Related

- **Plan**: N/A
- **ADRs**: Relates to `ADR-0001`, `ADR-0003`, and `ADR-0004`
- **Implementation**: N/A

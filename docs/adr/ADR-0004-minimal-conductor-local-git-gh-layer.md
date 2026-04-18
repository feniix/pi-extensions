---
title: "Minimal conductor-local git/gh layer for worker-aware PR flows"
adr: ADR-0004
status: Proposed
date: 2026-04-18
prd: "PRD-001-pi-conductor-mvp"
decision: "Implement a minimal conductor-local git/gh layer for worker-aware primitives instead of depending on pi-devtools internals"
---

# ADR-0004: Minimal conductor-local git/gh layer for worker-aware PR flows

## Status

Proposed

## Date

2026-04-18

## Requirement Source

- **PRD**: `docs/prd/PRD-001-pi-conductor-mvp.md`
- **Decision Point**: Section 8, Decision D4; FR-6; NFR Safety and Usability

## Context

`pi-conductor` needs to support worker-aware PR preparation: commit, push, and PR creation for a specific worker worktree and branch. The repository already contains `@feniix/pi-devtools`, which provides git and GitHub-oriented capabilities, but `pi-conductor` has a different context:

- every operation is tied to a specific worker and worktree
- partial failure must be reflected in worker metadata
- the PR flow is part of conductor’s core orchestration model, not just a generic repo helper

A decision is required on whether to depend on `pi-devtools` internals, implement conductor-local primitives, or drop PR orchestration from v1.

## Decision Drivers

- PR creation is a core v1 success criterion
- Worker-aware behavior must be explicit and tied to conductor state
- Package boundaries should stay maintainable inside this workspace
- The implementation should avoid unnecessary duplication of advanced devtools workflows
- Failure handling should be local to conductor’s worker lifecycle model

## Considered Options

### Option 1: Depend directly on `@feniix/pi-devtools` internals

Import or otherwise rely on internal git/gh helper code from `pi-devtools`.

- Good, because it may reduce duplication of some git/gh logic
- Good, because it reuses conventions already established in this repo
- Bad, because it creates tighter coupling between two packages whose responsibilities are different
- Bad, because conductor still needs worker-aware wrapping and partial-failure state handling that devtools does not natively model

### Option 2: Implement a minimal conductor-local git/gh layer

Create a small worker-aware helper layer inside `pi-conductor` for git execution in a worker worktree, branch/base-branch resolution, commit, push, and PR creation.

- Good, because it keeps worker-specific semantics local to conductor
- Good, because it avoids depending on another package’s internal implementation details
- Good, because it limits scope to the primitives conductor actually needs
- Bad, because it duplicates some low-level git/gh functionality already present elsewhere in the repo

### Option 3: Exclude PR flow from v1 and require manual steps

Users would manually run commit/push/PR commands outside conductor.

- Good, because it minimizes implementation work in conductor
- Bad, because it fails one of the explicit v1 success criteria
- Bad, because it weakens the worker lifecycle model by pushing a core milestone outside conductor

## Decision

Chosen option: **"Implement a minimal conductor-local git/gh layer"**, because it best satisfies the requirement for worker-aware PR preparation while preserving clean package boundaries.

## Consequences

### Positive

- Worker-aware PR flow can update conductor metadata directly and safely
- `pi-conductor` remains independent from `pi-devtools` internal implementation details
- The local layer is intentionally scoped to primitives rather than reimplementing advanced workflows

### Negative

- Some low-level git/gh behavior will be duplicated; mitigation is to keep the local layer intentionally small and borrow conventions rather than entire workflows
- Future divergence from `pi-devtools` conventions is possible; mitigation is to keep helper behavior simple and documented

### Neutral

- This ADR does not reject future shared abstractions between packages if a stable common layer emerges later
- Advanced devtools workflows such as `brpr`, `md`, `smd`, release, CI, and versioning remain out of scope for conductor’s local helper layer

## Related

- **Plan**: N/A
- **ADRs**: Relates to `ADR-0001` and `ADR-0002`
- **Implementation**: N/A

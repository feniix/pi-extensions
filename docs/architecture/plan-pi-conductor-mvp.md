---
title: "pi-conductor — long-lived multi-session worker orchestration for Pi"
prd: "PRD-002-pi-conductor-persistent-resumable-workers"
date: 2026-04-20
author: "feniix"
status: Implemented
---

# Plan: pi-conductor — long-lived multi-session worker orchestration for Pi

## Source

- **PRD**: `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
- **Date**: 2026-04-20
- **Author**: feniix

## Architecture Overview

`pi-conductor` should be implemented as a Pi package under `packages/pi-conductor` with an SDK/headless-first core that treats workers as first-class orchestration records rather than terminal sessions. Each worker is defined by a stable worker id, a user-facing name, a dedicated git worktree, a branch, a current task, a Pi session reference, lifecycle metadata, and optional summary/PR metadata. The package should own orchestration metadata in a conductor-managed project namespace under `~/.pi/agent/conductor/projects/<project-key>/`, while referencing Pi-managed session files rather than reimplementing Pi session storage.

The implementation should center on a small runtime boundary that can create, resume, inspect, and recover workers. Worktree management, session linkage, status modeling, and recovery must be part of the real core from the beginning, because the initiative is specifically validating long-lived worker orchestration rather than a thin wrapper around git commands. Human UX should be centered on a single command group, likely `/conductor`, while lower-level tool primitives remain available for model-callable or future automation scenarios.

The first implementation slice should optimize for end-to-end usefulness rather than pure infrastructure. That means the first usable milestone should produce a genuinely usable loop: create a worker, assign/update a task, inspect status, request a summary, and then add recovery of broken state immediately after that first slice is stable. PR preparation should be implemented immediately after the core lifecycle and recovery model are stable, using a minimal conductor-local git/gh layer rather than depending directly on `@feniix/pi-devtools` internals.

## Components

### Storage and Project Key

**Purpose**: Persist conductor-owned project and worker state in a stable namespace that survives restarts and supports cleanup/recovery.

**Key Details**:
- Derive a deterministic project key from the target repository root
- Store worker records, lifecycle data, recovery metadata, summary metadata, and PR metadata under `~/.pi/agent/conductor/projects/<project-key>/`
- Keep session references in worker metadata, but do not own Pi session internals
- Explicitly model replacement of a session reference during recovery

**ADR Reference**: `-> ADR-0002: Conductor-managed project-scoped storage for pi-conductor`

### Worker and Lifecycle Model

**Purpose**: Define the core worker object and its lifecycle transitions so every user flow operates on the same durable orchestration model.

**Key Details**:
- Worker fields include `workerId`, name, branch, worktree path, session reference, current task, lifecycle state, summary metadata, recoverability metadata, and optional PR metadata
- Lifecycle states: `idle`, `running`, `blocked`, `ready_for_pr`, `done`, `broken`
- `recoverable` is metadata rather than a separate lifecycle state
- Session-reference lifecycle must allow explicit replacement only through recovery semantics

**ADR Reference**: None — straightforward implementation grounded in the PRD

### Worktree Manager

**Purpose**: Create, validate, reuse, and clean up worker worktrees according to the continuity-based reuse policy.

**Key Details**:
- New workers default from the repo root’s current checked-out branch, with fallback to detected default branch
- Worker-name-derived branch names must be normalized into valid git branch slugs
- Worktree reuse is allowed only when continuing the same thread of work
- Missing or ambiguous worktree state must produce `broken`/recoverable outcomes instead of silent recreation

**ADR Reference**: `-> ADR-0003: Continuity-based worktree reuse for pi-conductor workers`

### SDK Worker Runtime

**Purpose**: Own the creation, linkage, resumption, and summarization of real Pi worker sessions.

**Key Details**:
- Use a SessionManager-backed SDK runtime boundary as the shipped v1 model
- Persist real session linkage, session id, and last-resumed metadata from day one
- Preserve a narrow runtime boundary so a future `AgentSession`-managed or process-backed backend remains possible
- Summary generation and status updates remain runtime-aware but presentation-independent

**ADR Reference**: `-> ADR-0001: SDK-first worker runtime for pi-conductor`

### Command and Tool Surface

**Purpose**: Expose the package to humans and models through a small, coherent operator surface.

**Key Details**:
- Center UX on one main command group, likely `/conductor`
- Phase 1 command groups should cover: start, status, task mutation, summarize, and recover/cleanup
- Tools should expose lower-level orchestration primitives for future automation and model-callable use
- Status output should be text-first but structured so future widgets or statusline integrations can be added cleanly

**ADR Reference**: None — straightforward implementation

### Recovery and Cleanup Flow

**Purpose**: Provide a first-class repair path for missing worktrees, missing session references, and partially-created workers.

**Key Details**:
- Recovery is part of phase 1, not deferred polish
- Broken workers must be classified into deterministic recovery paths when possible
- Cleanup must be scoped to targeted workers unless the user explicitly asks for broader cleanup
- Missing session references must require explicit recovery rather than silent replacement

**ADR Reference**: None — straightforward implementation grounded in PRD recovery semantics

### PR Preparation Layer

**Purpose**: Support worker-aware commit, push, and PR creation after the lifecycle core is stable.

**Key Details**:
- Use a minimal conductor-local git/gh layer for branch/base-branch resolution, commit, push, and PR creation only
- Do not reimplement higher-level devtools workflows like `brpr`, `md`, `smd`, release, or CI flows
- Partial failures must be persisted clearly, especially commit-succeeded/push-failed cases
- PR creation should remain a worker lifecycle milestone, not just a generic repo helper call

**ADR Reference**: `-> ADR-0004: Minimal conductor-local git/gh layer for worker-aware PR flows`

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope |
|-------|-----------|-------------|-----------------|
| 1 | Storage and Project Key | None | M |
| 2 | Worker and Lifecycle Model | Phase 1 | M |
| 3 | Worktree Manager | Phase 1, 2 | M |
| 4 | SDK Worker Runtime | Phase 1, 2, 3 | Implemented as SessionManager-backed MVP |
| 5 | Command and Tool Surface (first usable slice) | Phase 1, 2, 3, 4 | M |
| 6 | Recovery and Cleanup Flow | Phase 1, 2, 3, 4, 5 | M |
| 7 | PR Preparation Layer | Phase 1, 2, 3, 4, 5 | M |
| 8 | Polish, docs, and validation on this repo | Phase 1-7 | S |

Phase 7 can begin in parallel once Phases 1–5 are stable enough, even if Phase 6 recovery hardening is still being completed.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK-managed worker sessions behave differently from expected long-lived orchestration flows | Med | High | Build real session linkage in early phases and validate on this repo before broadening scope |
| Worktree continuity rules are implemented inconsistently | Med | High | Encode explicit continuity/reuse rules in one worktree manager and test them directly |
| Recovery logic becomes too implicit or destructive | Med | High | Keep recovery explicit, persist broken/recoverable state, and scope cleanup to targeted workers |
| PR flow introduces environment-specific failures that muddy the MVP | High | Med | Add PR flow only after lifecycle core is stable; validate preconditions before commit/push/PR attempts |
| Command UX drifts into too many commands or unclear groupings | Med | Med | Enforce one main command group and keep top-level command groups within the PRD’s command-surface cap |

## Open Questions

- What exact `/conductor` subcommand names should ship for v1?
- Should commands and tools land in the same implementation phase, or should tools follow immediately after the first command surface is usable?
- At what point should `done` be set explicitly in the operator workflow: after summary, after PR creation, or only by explicit human action?

## ADR Index

ADRs referenced by this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0001](../adr/ADR-0001-sdk-first-worker-runtime.md) | SDK-first worker runtime for pi-conductor | Proposed |
| [ADR-0002](../adr/ADR-0002-conductor-project-scoped-storage.md) | Conductor-managed project-scoped storage for pi-conductor | Proposed |
| [ADR-0003](../adr/ADR-0003-continuity-based-worktree-reuse.md) | Continuity-based worktree reuse for pi-conductor workers | Proposed |
| [ADR-0004](../adr/ADR-0004-minimal-conductor-local-git-gh-layer.md) | Minimal conductor-local git/gh layer for worker-aware PR flows | Proposed |

---
title: "pi-conductor — persistent resumable workers"
prd: PRD-002
status: Implemented
owner: "feniix"
issue: "N/A"
date: 2026-04-20
version: "1.1"
supersedes: "PRD-001-pi-conductor-mvp"
---

# PRD: pi-conductor — persistent resumable workers

## 1. Problem & Context

`pi-conductor` should provide a practical, durable worker orchestration layer for Pi that works in this workspace today.

Before this work, Pi had no first-class project-scoped worker orchestration package. Parallel work across one repository required manual coordination of:
- git worktrees
- branch naming
- session-file tracking
- recovery when worktrees or session references disappeared
- commit/push/PR bookkeeping per line of work

The shipped MVP solves the orchestration and continuity problem, not the full autonomous-agent problem.

This PRD supersedes `PRD-001-pi-conductor-mvp` by tightening the runtime contract to match the implementation that proved useful:
- v1 does **not** yet run autonomous worker agents continuously
- v1 does own worker/session continuity explicitly
- v1 keeps a narrow runtime seam backed by Pi SDK session APIs through `SessionManager`
- v1 leaves room for a future `AgentSession`- or subprocess-backed execution backend without replacing the worker model

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Durable workers | Worker records survive restarts and can be resumed from stored metadata | 100% of healthy workers remain resumable across restarts |
| Explicit continuity | Each worker has a stable identity, dedicated worktree, and persisted Pi session reference | 100% of workers expose this shape in stored state |
| Actionable operator status | Status answers what the worker is, where it lives, and whether it is healthy | 100% of persisted workers can be fully described from status output |
| Deterministic recovery | Missing worktrees or session files are surfaced as broken/recoverable rather than silently ignored | 100% of detected health failures are classified explicitly |
| Worker-aware PR prep | Commit, push, and PR creation are supported without losing partial state | 100% of partial failures preserve worker metadata |

## 3. Users & Use Cases

### Primary: operator managing parallel workstreams in one repo

> As a Pi user, I want workers to be durable objects with stable identity, worktree isolation, and persisted session linkage so that I can manage parallel work safely and resume it later.

**Typical use cases:**
- create one worker per named workstream
- resume a worker after restarting Pi or the shell
- refresh a concise summary from session history
- inspect health and recover missing worktree/session references
- prepare a worker branch as a PR

### Secondary: package author validating a reusable orchestration layer

> As the package author, I want `pi-conductor` to prove a durable worker model in a reusable Pi package rather than a one-off local script.

## 4. Scope

### In scope

1. Deterministic project-scoped storage under `~/.pi/agent/conductor/projects/<project-key>/`
2. Unique worker names with stable `workerId`
3. Conductor-managed branch naming and dedicated git worktree creation
4. Persisted Pi session linkage per worker
5. Runtime metadata persisted in worker state:
   - backend
   - session id
   - last resumed timestamp
6. Explicit task updates
7. Worker status output including:
   - worker id
   - name
   - branch
   - worktree path
   - session file reference
   - runtime metadata
   - task
   - lifecycle state
   - summary freshness
   - PR metadata
   - recoverability
8. Summary refresh from session history
9. Recovery of missing worktree and/or missing session reference
10. Worker-aware commit / push / PR flows with partial-state persistence

### Out of scope

- autonomous always-on worker execution
- worker-to-worker messaging
- automatic merge
- tmux as a correctness dependency
- full subagent orchestration inside `pi-conductor`
- high-level devtools flows like `brpr`, merge automation, releases, or CI orchestration

## 5. Functional Requirements

### FR-1: Worker creation

Given a repository and a worker name, conductor creates:
- a stable worker id
- a conductor-managed branch
- a dedicated worktree
- a persisted Pi session reference
- initial runtime metadata

### FR-2: Worker resume

Given a healthy worker with a valid session file, resume must:
- reopen the referenced session through the runtime boundary
- preserve the worker’s session reference
- persist the runtime session id
- record the worker’s last resumed timestamp
- keep the worker resumable without creating a new clone
- normalize lifecycle to `idle` in the current MVP, because resume currently means session re-linking rather than continuation of an always-running autonomous worker

### FR-3: Status visibility

Status must expose enough information for an operator to answer:
- what is this worker doing?
- where does it live on disk?
- what Pi session is it tied to?
- has it been resumed recently?
- is it healthy, stale, or broken?

### FR-4: Summary generation

Summary refresh must read the worker’s persisted session history and store a concise summary in worker metadata.

### FR-5: Recovery

If the worktree or session reference is missing, conductor must:
- classify the worker as broken/recoverable
- avoid pretending the worker is healthy
- require explicit recovery to recreate the missing resource

### FR-6: PR preparation

Conductor must support worker-aware:
- commit
- push
- PR creation

Failures must preserve partial state.

## 6. Non-Functional Requirements

- Headless correctness first
- No terminal scraping
- No tmux dependency
- Storage and recovery logic must be unit-testable
- Runtime seam must remain replaceable
- Existing persisted runs should be forward-compatible through normalization/defaulting where practical

## 7. Risks & Assumptions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Session/file/worktree continuity could drift from reality | Medium | High | Persist explicit metadata and reconcile health before resume |
| Recovery logic could become implicit or destructive | Medium | High | Require explicit recovery paths and mark workers as broken/recoverable |
| PR prep depends on local git/gh environment assumptions | High | Medium | Validate preconditions and preserve partial success state |
| The current runtime seam may prove too narrow for future execution features | Medium | Medium | Keep the runtime boundary internal and replaceable |

### Assumptions

- One persisted worker record per named workstream is sufficient for the current MVP
- A dedicated git worktree per worker is the right isolation model for v1
- Pi `SessionManager` is sufficient for create/resume/recover/summary flows in the current MVP
- Full autonomous execution can be deferred to a later phase without invalidating the worker model

## 8. Design Decisions

### D1: SessionManager-backed runtime in the current MVP

The shipped MVP uses a `SessionManager`-backed runtime boundary. Conductor creates and reopens real persisted Pi session files, records session ids and last-resumed timestamps, and derives summaries from session history.

### D2: Conductor-owned project-scoped storage

Conductor stores orchestration metadata under `~/.pi/agent/conductor/projects/<project-key>/` and references Pi-managed session files rather than embedding session internals.

### D3: Explicit worker continuity

A worker is modeled as a durable object with:
- stable identity
- human-readable name
- dedicated worktree and branch
- persisted session linkage
- task metadata
- lifecycle state
- summary state
- PR state

### D4: Minimal local git/gh helper layer

PR preparation is handled by a worker-aware conductor-local git/gh layer rather than depending directly on `pi-devtools` internals.

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|----|-------------|
| `packages/pi-conductor/extensions/conductor.ts` | Added | FR-1, FR-2, FR-5, FR-6 | Core worker orchestration entrypoints for create, resume, recover, and PR-prep flows |
| `packages/pi-conductor/extensions/runtime.ts` | Added | FR-1, FR-2, FR-4, FR-5 | SessionManager-backed runtime seam for worker session creation, resume, recovery, and summary generation |
| `packages/pi-conductor/extensions/storage.ts` | Added | FR-1, FR-2, FR-3, FR-5, FR-6 | Project-scoped run persistence, worker record normalization, and state mutation helpers |
| `packages/pi-conductor/extensions/status.ts` | Added | FR-3 | Human-readable status formatting for workers and project state |
| `packages/pi-conductor/extensions/worktrees.ts` | Added | FR-1, FR-5 | Managed worktree creation, recreation, and cleanup helpers |
| `packages/pi-conductor/extensions/git-pr.ts` | Added | FR-6 | Minimal worker-aware git and GitHub PR helper layer |
| `packages/pi-conductor/extensions/index.ts` | Added | FR-1, FR-3, FR-4, FR-5, FR-6 | Command and tool registration for the conductor package |
| `packages/pi-conductor/__tests__/conductor.test.ts` | Added | FR-1, FR-2, FR-5, FR-6 | Orchestration behavior coverage |
| `packages/pi-conductor/__tests__/recovery.test.ts` | Added | FR-5 | Broken-state detection and recovery coverage |
| `packages/pi-conductor/__tests__/sessions.test.ts` | Added | FR-2, FR-4 | Session linkage, resume, and summary-related coverage |
| `packages/pi-conductor/__tests__/status.test.ts` | Added | FR-3 | Status output coverage |
| `packages/pi-conductor/__tests__/storage.test.ts` | Added | FR-1, FR-3, FR-5 | Persistent state and normalization coverage |

## 10. Dependencies & Constraints

- Must fit the repo’s existing Pi package and TypeScript workspace structure
- Depends on Pi SDK session APIs and `SessionManager`
- Depends on git worktrees for worker isolation
- Depends on `git` for all worker flows
- Depends on `gh` for PR creation
- Must remain headless-first and not rely on terminal scraping
- Must keep runtime/session artifacts out of the git repository

## 11. Rollout Plan

1. Ship the package scaffold, types, storage, project-key derivation, and runtime seam
2. Add worker creation, resume, status, and summary flows
3. Add broken-state detection and targeted recovery
4. Add worker-aware commit/push/PR preparation with partial-state persistence
5. Validate the package on this workspace as the MVP proving ground

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| 1 | Should the runtime seam later move from SessionManager-only reopening to executable worker runs? | feniix | Later phase | Deferred to PRD-003 |
| 2 | Should conductor eventually support subprocess-backed workers? | feniix | Later phase | Open |
| 3 | Should higher-level operator workflows be layered on top of the current worker primitives? | feniix | Later phase | Open |

## 13. Related

- `docs/prd/PRD-001-pi-conductor-mvp.md` — superseded original MVP PRD
- `docs/prd/PRD-003-pi-conductor-single-worker-run.md` — next-step draft for foreground execution
- `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
- `docs/adr/ADR-0002-conductor-project-scoped-storage.md`
- `docs/adr/ADR-0003-continuity-based-worktree-reuse.md`
- `docs/adr/ADR-0004-minimal-conductor-local-git-gh-layer.md`
- `docs/architecture/plan-pi-conductor-mvp.md`

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-20 | Initial implemented PRD capturing the shipped persistent resumable workers MVP | feniix |
| 2026-04-21 | Normalized into the canonical PRD structure required by `pi-specdocs` while preserving shipped behavior and scope | Pi |

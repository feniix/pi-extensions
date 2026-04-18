---
title: "Continuity-based worktree reuse for pi-conductor workers"
adr: ADR-0003
status: Accepted
date: 2026-04-18
prd: "PRD-001-pi-conductor-mvp"
decision: "Reuse worker worktrees only when continuing the same thread of work"
---

# ADR-0003: Continuity-based worktree reuse for pi-conductor workers

## Status

Accepted

## Date

2026-04-18

## Requirement Source

- **PRD**: `docs/prd/PRD-001-pi-conductor-mvp.md`
- **Decision Point**: Section 8, Decision D3; FR-2; FR-7; NFR Safety

## Context

A core promise of `pi-conductor` is that workers are long-lived and resumable, but also safe to use in parallel. That creates tension around git worktree lifecycle:

- always creating fresh worktrees is operationally simple but weakens the value of long-lived workers
- aggressively reusing existing worktrees improves continuity but risks stale state, confusing branch reuse, and accidental continuation of already-finished work

The system therefore needs a clear policy for when an existing worker worktree should be reused and when new work should get a new worker/worktree instead.

## Decision Drivers

- Workers should feel genuinely resumable across restarts
- Worktree reuse must not hide stale or unsafe state
- The policy should be understandable to a human operator
- One worker = one worktree is a core v1 isolation model
- Future worker identity models should remain possible without changing v1 safety rules

## Considered Options

### Option 1: Always create fresh worktrees

Every new unit of work gets a brand-new worker and worktree.

- Good, because it is the safest and easiest policy to reason about operationally
- Good, because it minimizes accidental reuse of stale branches or directories
- Bad, because it undermines the value proposition of long-lived resumable workers
- Bad, because follow-up work on the same thread becomes unnecessarily noisy and repetitive

### Option 2: Aggressively reuse existing worktrees

Prefer reusing a worker’s existing worktree whenever possible.

- Good, because it maximizes continuity and reduces worktree churn
- Good, because it aligns with a strong “persistent worker identity” model
- Bad, because it increases the risk of stale state and accidental continuation of completed or unrelated work
- Bad, because it can make worker behavior harder to predict for operators

### Option 3: Continuity-based conservative reuse

Reuse a worker’s worktree only when continuing the same session/branch/thread of work; otherwise prefer a new worker/worktree.

- Good, because it preserves the meaning of long-lived resumable workers without forcing reuse in ambiguous situations
- Good, because it gives operators a simple mental model: same thread of work, same worktree; new thread of work, new worktree
- Bad, because it requires conductor to track enough continuity metadata to make or explain the decision

## Decision

Chosen option: **"Continuity-based conservative reuse"**, because it best balances resumability with safety and keeps the operator model understandable.

## Consequences

### Positive

- Worktree reuse now reflects actual continuity of work rather than mere filesystem availability
- The package can support long-lived workers without making reuse the default for unrelated work
- Recovery logic can distinguish between “continue” and “start fresh” more cleanly

### Negative

- The system must define what counts as materially different work; mitigation is to encode continuity rules explicitly in the PRD and worker metadata
- Some users may want more aggressive reuse; mitigation is to keep policy boundaries narrow in v1 and revisit configurability later

### Neutral

- A worker whose branch has already been merged or intentionally closed is no longer treated as an active continuation candidate
- This policy does not prevent future support for richer worker identity beyond one branch/one PR in v1 practice

## Related

- **Plan**: N/A
- **ADRs**: Relates to `ADR-0001` and `ADR-0002`
- **Implementation**: N/A

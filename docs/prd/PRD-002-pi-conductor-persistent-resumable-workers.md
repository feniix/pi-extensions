---
title: "pi-conductor — persistent resumable workers"
prd: PRD-002
status: Implemented
owner: "feniix"
issue: "N/A"
date: 2026-04-20
version: "1.0"
supersedes: "PRD-001-pi-conductor-mvp"
---

# PRD: pi-conductor — persistent resumable workers

## 1. Summary

`pi-conductor` should provide a practical, durable worker orchestration layer for Pi that works today in this workspace.

The shipped MVP centers on:
- one persisted worker record per named workstream
- one dedicated git worktree per worker
- one persisted Pi session reference per worker
- explicit resume, recovery, status, summary, and PR-preparation flows
- a small runtime boundary backed by Pi SDK session APIs through `SessionManager`

This PRD supersedes PRD-001 by tightening the runtime contract to match the implementation that proved useful:
- **v1 does not yet run autonomous worker agents continuously**
- **v1 does own worker/session continuity explicitly**
- **v1 keeps a narrow runtime seam so a future `AgentSession` or subprocess-backed subagent backend can be added without replacing the worker model**

## 2. Problem

Pi supports sessions, tools, and extensions, but it does not ship with a first-class project-scoped worker orchestration package. Without `pi-conductor`, the user must manually juggle:
- git worktrees
- session files
- branch naming
- recovery when worktrees or session references disappear
- commit/push/PR bookkeeping per parallel line of work

The missing piece is not just “parallel prompts.” It is durable operational structure.

## 3. Product goal

Make parallel workstreams in one repository feel explicit and recoverable.

A worker should be a durable object with:
- stable identity
- a human-readable name
- a dedicated worktree and branch
- a persisted Pi session reference
- current task metadata
- lifecycle state
- summary state
- PR state

## 4. Runtime contract

### 4.1 Current MVP runtime

The v1 runtime is **SessionManager-backed**.

That means `pi-conductor` must:
- create a real persisted Pi session file for each worker
- reopen that session file on resume
- persist runtime metadata such as session id and last resumed timestamp
- treat missing worktree/session references as recoverable health failures
- derive summaries from the referenced session history

That means `pi-conductor` does **not yet** need to:
- keep a live autonomous worker loop running in the background
- continuously supervise child `pi` processes
- implement a full multi-agent planner/reviewer hierarchy

### 4.2 Future runtime seam

The worker model must remain compatible with a future backend that uses either:
- `createAgentSession()` / `AgentSessionRuntime`, or
- spawned `pi` subprocesses / RPC-backed subagents

The current runtime boundary should therefore stay narrow and internal.

## 5. In scope

1. Deterministic project-scoped storage under `~/.pi/agent/conductor/projects/<project-key>/`
2. Unique worker names with stable `workerId`
3. Conductor-managed branch naming and git worktree creation
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

## 6. Out of scope

- autonomous always-on worker execution
- worker-to-worker messaging
- automatic merge
- tmux as a correctness dependency
- full subagent orchestration inside `pi-conductor`
- high-level devtools flows like `brpr`, merge automation, releases, or CI orchestration

## 7. Functional requirements

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

## 8. Non-functional requirements

- Headless correctness first
- No terminal scraping
- No tmux dependency
- Storage and recovery logic must be unit-testable
- Runtime seam must remain replaceable
- Existing persisted runs should be forward-compatible through normalization/defaulting where practical

## 9. Acceptance summary

`pi-conductor` satisfies this PRD when:
- workers are durable across restarts
- status can fully describe a worker from stored state
- resume is more than metadata lookup and records runtime activity
- recovery is explicit and deterministic
- PR prep remains worker-aware and failure-safe

## 10. File map

Primary implementation files:
- `packages/pi-conductor/extensions/conductor.ts`
- `packages/pi-conductor/extensions/runtime.ts`
- `packages/pi-conductor/extensions/storage.ts`
- `packages/pi-conductor/extensions/status.ts`
- `packages/pi-conductor/extensions/worktrees.ts`
- `packages/pi-conductor/extensions/git-pr.ts`
- `packages/pi-conductor/extensions/index.ts`

Primary validation files:
- `packages/pi-conductor/__tests__/conductor.test.ts`
- `packages/pi-conductor/__tests__/commands.test.ts`
- `packages/pi-conductor/__tests__/lifecycle.test.ts`
- `packages/pi-conductor/__tests__/recovery.test.ts`
- `packages/pi-conductor/__tests__/sessions.test.ts`
- `packages/pi-conductor/__tests__/status.test.ts`
- `packages/pi-conductor/__tests__/storage.test.ts`

## 11. Follow-ups

Likely future work after this PRD:
1. promote the runtime seam from `SessionManager` reopening to full `AgentSession` orchestration
2. optionally add subprocess-backed workers for true isolated subagents
3. add richer summary generation and worker execution commands
4. add higher-level conductor/operator workflows once the runtime surface proves stable

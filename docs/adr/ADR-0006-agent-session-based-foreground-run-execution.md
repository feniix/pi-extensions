---
title: "AgentSession-based foreground run execution for pi-conductor"
adr: ADR-0006
status: Accepted
date: 2026-04-21
prd: "PRD-003-pi-conductor-single-worker-run"
decision: "Use createAgentSession()-based foreground execution for /conductor run while preserving worker continuity through existing SessionManager-backed session lineage"
---

# ADR-0006: AgentSession-based foreground run execution for pi-conductor

## Status

Accepted

## Date

2026-04-21

## Requirement Source

- **PRD**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
- **Decision Point**: Section 8, Decision D3; FR-1, FR-2, FR-3, and NFR Architecture

## Context

`pi-conductor` already ships a durable worker model built around project-scoped storage, worktree continuity, persisted session linkage, recovery flows, summaries, and worker-aware PR preparation. That architecture was intentionally launched with a narrow SDK-first runtime seam centered on `SessionManager`, as recorded in `ADR-0001`.

PRD-003 adds the next architectural step: conductor must move from durable orchestration into actual worker execution. `/conductor run` is intentionally narrow in scope. It must run one operator-supplied task in one existing worker, in the foreground, against the worker's existing session lineage and worktree. It must also preserve conductor-owned lifecycle semantics, keep CI-safe testability, and avoid jumping prematurely to autonomous or process-supervised workers.

A new decision is required because `SessionManager` alone is sufficient for persistence, resume linkage, and history inspection, but it is not itself the execution surface for real prompted work. Conductor now needs a concrete way to create an executable session that:

- reuses the worker's persisted session lineage
- runs in the worker's worktree as `cwd`
- uses Pi's real prompt execution path
- preserves append-only session persistence semantics
- can surface completion, failure, and abort outcomes back into conductor state

This decision sits directly on top of `ADR-0001`. The question is not whether conductor remains SDK-first; that has already been decided. The question is which SDK execution path should power foreground worker runs in v1.

## Decision Drivers

- PRD-003 requires real foreground prompted execution, not metadata-only lifecycle changes
- Worker runs must preserve existing session lineage and worktree continuity
- Conductor must keep explicit lifecycle ownership (`running`, `idle`, `blocked`) rather than delegating correctness to a terminal or external process
- The implementation must remain unit/integration testable without requiring always-on worker processes in CI
- The chosen path should avoid conflicting persistence strategies with the existing session files
- The runtime boundary should remain evolvable toward lower-level `AgentSession` construction or process-backed backends if future phases need them

## Considered Options

### Option 1: Keep run behavior SessionManager-only

Extend conductor's existing `SessionManager`-backed runtime seam without introducing executable agent/session APIs for run behavior.

- Good, because it keeps the runtime model maximally consistent with the current v1 persistence seam
- Good, because it minimizes immediate architectural surface area
- Bad, because `SessionManager` is a persistence/linkage abstraction rather than the actual prompt execution interface needed for real work
- Bad, because conductor would still need another mechanism for execution, making this option incomplete for PRD-003

### Option 2: Use `createAgentSession()` for foreground execution while reusing persisted lineage

Open the worker's existing session lineage with `SessionManager.open(...)`, pass that session manager into `createAgentSession({ sessionManager, cwd })`, bind extensions for headless execution, run the operator task via `session.prompt(task)`, derive terminal outcome from the final assistant message, and dispose the session afterward.

- Good, because it satisfies PRD-003's requirement for real prompted execution using Pi's supported executable session APIs
- Good, because it preserves worker continuity by reusing the existing session lineage and worker worktree
- Good, because it keeps conductor SDK-first and testable without introducing subprocess supervision or terminal scraping
- Good, because it aligns persistence with `AgentSession`'s append-only write behavior instead of inventing a competing persistence path
- Bad, because it introduces new execution-specific concerns such as extension binding, model/provider preflight behavior, and session disposal discipline
- Bad, because `AgentSession.sessionId` may differ from previously persisted runtime metadata, requiring explicit documentation and state handling

### Option 3: Jump straight to lower-level runtime replacement or process-backed execution

Skip `createAgentSession()` as the v1 execution path and instead build foreground runs on lower-level `AgentSession`/runtime construction or on externally supervised `pi` processes.

- Good, because it may provide more explicit runtime ownership and could align naturally with future autonomous or always-on worker backends
- Good, because it may reduce future migration work if conductor later needs deeper runtime customization
- Bad, because it adds complexity before PRD-003's narrower single-worker foreground run slice is validated
- Bad, because it increases the amount of runtime and process-management behavior conductor would need to own immediately
- Bad, because it delays delivery of the simplest execution path that already fits the current architecture

## Decision

Chosen option: **"Use `createAgentSession()` for foreground execution while reusing persisted lineage"**, because it best satisfies the decision drivers around real prompt execution, continuity of worker state, explicit conductor-owned lifecycle semantics, CI-safe testability, and incremental evolution from the SDK-first architecture established in `ADR-0001`.

In v1, `/conductor run` should open the worker's persisted session lineage through `SessionManager.open(...)`, construct an executable session with `createAgentSession({ sessionManager, cwd })`, bind extensions for headless execution, run the task in the foreground, let `AgentSession` persist session updates incrementally, and then dispose the session cleanly. The extension binding and preflight policy for that execution path is governed separately by `ADR-0011`.

## Consequences

### Positive

- Conductor gains a real execution primitive without abandoning the existing durable worker model
- Worker runs can append to the same session lineage already used for resume and summary behavior
- Lifecycle transitions and last-run metadata remain conductor-owned rather than terminal-derived
- The execution seam remains narrow enough to cover with unit and integration tests in this repository

### Negative

- Run behavior now depends on correct executable-session setup, including extension binding, model/provider preflight handling, and `session.dispose()` cleanup; mitigation is to isolate this behavior in `runtime.ts` and cover it with focused tests
- The execution path must not reuse the older full-rewrite persistence helper, because `AgentSession` already performs append-only persistence; mitigation is to document and enforce that run execution does not call `persistSessionFile()`
- Runtime metadata becomes slightly more nuanced because the execution session ID may not match previously persisted worker runtime session IDs; mitigation is to record explicit `lastRun.sessionId` semantics in storage and status output
- Run outcome detection requires inspecting the session state message history (for example `session.state.messages`, or `session.agent.state.messages` if the SDK surface requires going through the agent) for the terminal `stopReason` on the last `AssistantMessage`, as `AgentSession` does not expose a dedicated stopReason accessor; the full `StopReason` union (`stop`, `length`, `toolUse`, `error`, `aborted`) must be exhaustively mapped to conductor run outcomes; mitigation is to define the mapping in `runtime.ts` and cover each branch with tests

### Neutral

- `ADR-0001` (currently Proposed, but its architecture shipped in 0.2.0) remains valid as the broader SDK-first runtime decision; this ADR narrows how foreground execution is implemented within that architecture
- Future phases may still adopt lower-level runtime construction or process-backed workers if requirements grow beyond a single synchronous foreground run

## Related

- **Plan**: `docs/architecture/plan-pi-conductor-single-worker-run.md`
- **ADRs**: Relates to `ADR-0001`, `ADR-0002`, `ADR-0003`, `ADR-0007`, and `ADR-0011`
- **Implementation**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`, shipped in PR #52

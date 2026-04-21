---
title: "Single-worker foreground run before multi-worker orchestration"
adr: ADR-0007
status: Accepted
date: 2026-04-21
prd: "PRD-003-pi-conductor-single-worker-run"
decision: "Add a narrow single-worker foreground run capability before introducing multi-worker concurrent execution or autonomous background workers"
---

# ADR-0007: Single-worker foreground run before multi-worker orchestration

## Status

Accepted

## Date

2026-04-21

## Requirement Source

- **PRD**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
- **Decision Point**: Section 8, Decision D1; Section 1 (Problem & Context); Section 4 (Scope)

## Context

`pi-conductor` ships a complete durable worker model: project-scoped storage, worktree management, session linkage, lifecycle modeling, recovery, summaries, and PR preparation. What it does not yet do is execute work inside a worker. There is a gap between worker orchestration (creating, resuming, inspecting workers) and worker execution (telling a worker to perform a coding task).

Three plausible paths forward exist for closing this gap. The first is to add a minimal single-worker foreground run: one operator command runs one task in one worker, waits for completion, and returns a result. The second is to jump directly to multi-worker concurrent execution, where conductor schedules and coordinates tasks across several workers in a single command. The third is to skip directly to autonomous background workers — always-on processes that pick up tasks, loop, and report progress without operator prompting.

A decision is needed now because PRD-003 is scoped specifically to "move conductor from durable orchestration into actual worker execution" and the phasing choice determines the implementation scope, the complexity introduced, and how quickly the execution seam can be validated against real work.

The current architecture is entirely single-worker-at-a-time: `conductor.ts` orchestration functions operate on one named worker per call, `runtime.ts` manages one session at a time, and there is no scheduling, queue, or concurrency infrastructure anywhere in the package. The SDK-first runtime boundary established in ADR-0001 was designed to be narrow and evolvable — but it has never been exercised for actual prompted execution.

## Decision Drivers

- The most critical missing capability is any form of worker execution; validating that a single worker can run a task end-to-end is the prerequisite for all broader execution models
- The existing runtime seam (SessionManager-backed, ADR-0001) has never performed real prompted execution and needs to be proven before scaling to concurrent use
- Multi-worker execution requires scheduling, concurrency control, resource contention handling, and cross-worker coordination — none of which exist in the current architecture
- Autonomous background workers require process supervision, daemonization, health monitoring, and restart policies — infrastructure concerns that are orthogonal to validating the execution primitive
- CI testability must be preserved; concurrent and process-backed models are significantly harder to test deterministically
- PRD-003 explicitly scopes v1 to one worker running one task in the foreground

## Considered Options

### Option 1: Add a single-worker foreground run capability first

Implement `/conductor run <worker> <task>` as a synchronous foreground operation: open the worker's session, execute the task via `createAgentSession()` + `session.prompt()`, record the outcome, and return. One worker, one task, one command, blocking until completion.

- Good, because it validates the most important missing capability — real worker execution — with the smallest possible scope increase
- Good, because it builds directly on the existing single-worker orchestration model without requiring new infrastructure (no scheduler, no queue, no process manager)
- Good, because the runtime seam gets exercised against real prompted work before being asked to handle concurrency, which surfaces integration issues early
- Good, because it preserves CI-safe deterministic testing — a foreground synchronous run is straightforward to test without process coordination
- Good, because it produces an immediately useful operator workflow: create a worker, assign a task, run it, inspect the result
- Bad, because it does not address the eventual need for coordinated multi-worker execution, so the run API surface may need extending later
- Bad, because operators who need parallel execution must manually issue separate sequential runs, which is slower than a coordinated multi-worker model

### Option 2: Skip directly to multi-worker concurrent execution

Implement a multi-worker run command that schedules and coordinates tasks across several workers concurrently, with conductor managing execution ordering, resource contention, and aggregated results.

- Good, because it addresses the full orchestration vision — conductor as a coordinator of worker teams — in a single step
- Good, because it could avoid rework if the single-worker API surface doesn't generalize cleanly to concurrent execution
- Bad, because it requires scheduling and concurrency infrastructure that does not exist in the package — task queues, worker pool management, execution ordering, and conflict resolution for shared resources (e.g., git state)
- Bad, because the runtime seam has never been exercised for even a single prompted execution; introducing concurrency before validating the basic execution path compounds risk
- Bad, because concurrent execution is significantly harder to test deterministically in CI without real provider calls or complex mocking
- Bad, because it delays delivery — the scope increase is substantial relative to the immediate need (one worker running one task)

### Option 3: Skip directly to autonomous background workers

Implement always-on background worker processes that pick up tasks from a queue, execute autonomously, loop for new work, and report progress without operator prompting per task.

- Good, because it aligns with the long-term vision of agent teams operating with minimal human intervention
- Good, because it may reduce per-task operator overhead once the system is stable
- Bad, because it requires process supervision, daemonization, health monitoring, restart policies, and inter-process communication — infrastructure concerns that are orthogonal to validating whether conductor can execute work at all
- Bad, because it skips validating the basic execution primitive, making it harder to isolate and debug runtime issues when they inevitably arise
- Bad, because always-on processes are difficult to make CI-safe and introduce environment-specific failures (port conflicts, orphaned processes, platform-dependent process management)
- Bad, because the scope increase is the largest of the three options, delaying any usable execution capability

## Decision

Chosen option: **"Add a single-worker foreground run capability first"**, because it validates the most critical missing capability — real prompted execution in a worker — with the smallest scope increase, builds directly on the existing single-worker architecture, preserves CI testability, and exercises the runtime seam against real work before introducing concurrency or process supervision. Multi-worker and autonomous execution remain viable future extensions once the single-worker run path is proven.

## Consequences

### Positive

- Conductor gains a real execution primitive without introducing scheduling, concurrency, or process management infrastructure
- The SDK-first runtime seam (ADR-0001) gets validated against actual prompted execution before being asked to handle more complex execution models
- The operator gets an immediately useful workflow: create → task → run → inspect → PR
- Testing remains deterministic and CI-safe — no process coordination, no race conditions, no orphaned workers
- The run API surface is small enough to evolve if multi-worker requirements later demand a different contract

### Negative

- Operators who need multiple workers to execute concurrently must issue sequential runs manually; mitigation is that this is an explicit scope boundary — concurrent execution is a follow-up feature, not a missing requirement for v1
- The single-worker run API may need extending or reshaping when multi-worker execution is introduced; mitigation is to keep the run entrypoint narrow and isolate execution logic in `runtime.ts` so the contract can evolve without restructuring orchestration
- This decision defers validation of multi-worker coordination patterns, which means those patterns will need their own spike and potentially their own ADR when the time comes

### Neutral

- The existing durable worker model (storage, lifecycle, worktree, session linkage, recovery, PR flows) is unchanged — this decision adds to it rather than replacing any part of it
- Future phases may introduce multi-worker scheduling (Option 2) or autonomous workers (Option 3) as incremental extensions; this decision does not foreclose either path
- ADR-0006 (AgentSession-based foreground execution) was written specifically for the single-worker foreground run model chosen here; if a future phase adopts a different execution model, ADR-0006 may need to be superseded

## Related

- **Plan**: `docs/architecture/plan-pi-conductor-single-worker-run.md`
- **ADRs**: Relates to `ADR-0001` (SDK-first runtime), `ADR-0006` (AgentSession-based foreground execution)
- **Implementation**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`, shipped in PR #52

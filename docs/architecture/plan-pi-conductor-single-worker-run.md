---
title: "pi-conductor — single-worker run capability"
prd: "PRD-003-pi-conductor-single-worker-run"
date: 2026-04-21
author: "Pi"
status: Implemented
---

# Plan: pi-conductor — single-worker run capability

## Source

* **PRD**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
* **Date**: 2026-04-21
* **Author**: Pi

## Architecture Overview

`pi-conductor` already ships a durable worker orchestration model around persisted worker records, dedicated worktrees, SessionManager-backed session linkage, health reconciliation, summaries, and PR preparation. PRD-003 adds the first execution primitive on top of that foundation: one operator-triggered foreground run against one existing worker. The plan should preserve the current architecture's strongest property — explicit conductor-owned state — while deepening the runtime seam from session persistence/reopen into real prompt execution.

The implementation should therefore be additive rather than disruptive. The worker record remains the source of truth, the worktree remains the execution cwd, and `runtime.ts` remains the only place that knows how to turn stored session lineage into executable Pi runtime behavior. `conductor.ts` should continue owning orchestration and persistence boundaries, while `index.ts` and `commands.ts` expose a narrowly-scoped `/conductor run` command and `conductor_run` tool. The major technical wrinkle is that the current runtime seam rewrites session files through `persistSessionFile()`, while the proposed run path must use `createAgentSession()` and let `AgentSession` append to the existing session file incrementally. That seam change is the highest-risk part of the plan and should land before broader state/status work.

The safest rollout is to implement the run feature in five layers: storage/type extension for `lastRun`, runtime execution support, orchestration/state transitions, operator/tool surface, and tests/docs. That order matches the repository that exists today: `packages/pi-conductor/extensions/types.ts`, `storage.ts`, `runtime.ts`, `conductor.ts`, `commands.ts`, `index.ts`, and the existing unit/integration test suite already partition responsibilities along those lines.

## Components

### 1. Run State Model and Backward-Compatible Storage

**Purpose**: Extend persisted worker state so a foreground run can be represented durably without breaking already-stored workers.

**Key Details**:

* Add a `lastRun` object to `WorkerRecord` capturing `task`, `status`, `startedAt`, `finishedAt`, `errorMessage`, and run-time `sessionId`, with `status: null` representing a run that has started but has not yet reached a terminal outcome.
* Normalize missing `lastRun` values in `readRun()` so existing worker records created under `0.2.0` continue loading safely.
* Add storage helpers for the run lifecycle instead of overloading `setWorkerTask()` + `setWorkerLifecycle()` in ways that pass through `idle`.
* Preserve current summary-staleness behavior by marking summaries stale when the accepted run updates `currentTask`.

**ADR Reference**: None — straightforward persistence extension inside the existing storage architecture

### 2. Executable Runtime Seam

**Purpose**: Turn an existing worker's persisted session lineage into a real executable Pi session for one foreground run.

**Key Details**:

* Add a dedicated runtime path in `runtime.ts` that opens `SessionManager.open(sessionFile)`, constructs `createAgentSession({ sessionManager, cwd: worktreePath })`, applies the minimal non-interactive extension-binding/configuration policy described by ADR-0011, calls `session.prompt(task)`, extracts the final assistant text, maps terminal `stopReason`, and disposes the session.
* Keep the existing create/resume/recover/summarize SessionManager helpers intact; execution should be a new seam rather than a rewrite of all runtime behavior.
* Explicitly avoid `persistSessionFile()` on the execution path because `AgentSession` already performs append-only persistence.
* Include best-effort preflight for model/provider availability before mutating worker state to `running`.

**ADR Reference**: `-> ADR-0006: AgentSession-based foreground run execution for pi-conductor`

### 3. Run Orchestration and Lifecycle Transitions

**Purpose**: Coordinate eligibility checks, task mutation, lifecycle changes, runtime invocation, and post-run persistence for one worker.

**Key Details**:

* Add a conductor-level entrypoint such as `runWorkerForRepo(repoRoot, workerName, task)` that is the single orchestrator for the feature.
* Reject workers that are missing, `broken`, missing worktree/session files, or already marked `running`.
* Update `currentTask` only after preflight succeeds, then atomically move the worker into `running` with `lastRun.status = null` and `lastRun.finishedAt = null` before execution begins.
* Normalize post-run state to `idle` on success/abort and `blocked` on error; complete the already-initialized `lastRun` record in all terminal outcomes by filling in the final status and `finishedAt`.
* Leave crash-mid-run handling manual for this phase; preserve the persisted `running` + `finishedAt: null` signal so `/conductor state` or `/conductor recover` can repair it.

**ADR Reference**: None — orchestration policy follows the PRD and existing conductor boundaries

### 4. Command, Tool, and Status Surface

**Purpose**: Expose the run feature without broadening conductor into multi-worker scheduling.

**Key Details**:

* Extend `/conductor` with `run <worker-name> <task>` in `commands.ts`.
* Register a matching `conductor_run` tool in `index.ts` rather than composing lower-level tools externally.
* Extend the existing `formatRunStatus()` in `status.ts` so per-worker output includes `lastRun` metadata coherently, especially active/stuck `running` state, post-run outcomes, and run-specific session ids.
* Keep the surface intentionally narrow: no concurrent run orchestration, no background worker management, and no automatic summary refresh.

**ADR Reference**: `-> ADR-0007: Single-worker foreground run before multi-worker orchestration`

### 5. Test and Opt-in CLI Coverage

**Purpose**: Validate the run feature against the current package architecture without introducing flaky provider-dependent CI.

**Key Details**:

* Extend storage, conductor, lifecycle, status, and sessions tests to cover `lastRun`, rejection rules, stale summary semantics, and session-lineage reuse.
* Keep any real-CLI coverage behind `PI_CONDUCTOR_CLI_E2E=1`, consistent with the existing `cli-e2e.test.ts` pattern.
* Prefer mocked/runtime-isolated tests for stop-reason mapping and post-run state transitions rather than depending on live model calls.
* Add fixture coverage for backward compatibility so older run files without `lastRun` continue to load.

**ADR Reference**: None — test strategy is a direct extension of the existing suite

### 6. Operator Documentation and Follow-on Spec Alignment

**Purpose**: Make the new feature discoverable and keep conductor docs aligned with the new execution boundary.

**Key Details**:

* Update `packages/pi-conductor/README.md` to explain the new `/conductor run` scope and the fact that it is synchronous foreground execution, not an always-on worker loop.
* Keep `docs/prd/PRD-003-pi-conductor-single-worker-run.md` as the requirements source and update this plan if runtime details diverge materially during implementation.
* Follow `ADR-0011` for the execution-surface policy around extension binding and model/preflight behavior; update that ADR only if implementation materially diverges from the accepted direction.

**ADR Reference**: None — documentation alignment work

## Implementation Order

| Phase | Component                                           | Dependencies     | Estimated Scope |
| ----- | --------------------------------------------------- | ---------------- | --------------- |
| 1     | Run State Model and Backward-Compatible Storage     | None             | M               |
| 2     | Executable Runtime Seam                             | Phase 1          | L               |
| 3     | Run Orchestration and Lifecycle Transitions         | Phase 1, 2       | L               |
| 4     | Command, Tool, and Status Surface                   | Phase 1, 2, 3    | M               |
| 5     | Test and Opt-in CLI Coverage                        | Phase 1, 2, 3, 4 | L               |
| 6     | Operator Documentation and Follow-on Spec Alignment | Phase 4, 5       | S               |

### Phase notes

* **Phase 1 first** because `lastRun` and normalization rules define the state shape all other layers will read and write.
* **Phase 2 before Phase 3** because conductor orchestration should call a stable runtime helper rather than mix execution details into orchestration code.
* **Phase 3 before Phase 4** because the command/tool/status surface should expose a real persisted workflow, not a partially wired runtime spike.
* **Phase 5 after the surface is wired** so tests can assert the actual command/tool contract and status output, while still adding lower-level unit coverage in parallel as helpers land.
* **Phase 6 last** because README and adjacent docs should describe the final shipped behavior, especially if preflight and binding details evolve during implementation.

## Dependencies

### Code dependencies

* `packages/pi-conductor/extensions/types.ts` and `storage.ts` must stabilize the `lastRun` model before status or orchestration code can rely on it.
* `packages/pi-conductor/extensions/runtime.ts` depends on Pi SDK executable session APIs being available through `@mariozechner/pi-coding-agent` in this workspace; in practice this means adding new `createAgentSession`-level imports to `runtime.ts`, not adding a new package dependency.
* `packages/pi-conductor/extensions/conductor.ts` depends on both storage helpers and the new runtime execution seam.
* `packages/pi-conductor/extensions/index.ts` and `commands.ts` depend on a stable conductor entrypoint for the run workflow.

### Behavioral dependencies

* Preflight must occur before mutating a worker into `running`, otherwise failed runs will leave misleading worker state.
* Execution must avoid the existing full-file rewrite persistence helper or it risks conflicting with `AgentSession` append semantics.
* Status formatting must be updated after the `lastRun` shape lands, otherwise the operator will not be able to distinguish active, failed, aborted, and stale-run states.

### Parallelizable work

* Parts of Phase 5 test coverage can begin as soon as Phase 1 types/storage helpers land.
* README updates and minor command-surface documentation can draft in parallel with late-phase test work, but should not merge until behavior is final.
* Any material implementation divergence from `ADR-0011` can be discussed in parallel with Phases 3–4, but the current plan assumes `ADR-0011` remains the governing policy.

## Risks and Mitigations

| Risk                                                                                                     | Likelihood | Impact | Mitigation                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAgentSession()` integration behaves differently from the current SessionManager-only runtime seam | Med        | High   | Isolate execution in `runtime.ts`, add focused stop-reason/outcome tests, and avoid mixing execution details into conductor orchestration                  |
| Existing persistence logic conflicts with `AgentSession` append-only session writes                      | Med        | High   | Keep run execution off the `persistSessionFile()` path and document the separation in code comments and tests                                              |
| Workers get stuck in `running` after crashes or prompt-time failures                                     | Med        | Med    | Persist `finishedAt: null` intentionally, reject overlapping runs, and keep manual repair via `/conductor state` and `/conductor recover` explicit in docs |
| Provider/model availability makes runtime tests flaky                                                    | High       | Med    | Keep provider-backed CLI coverage opt-in and rely on mocked/unit integration tests in default CI                                                           |
| Status output becomes noisy or ambiguous once `lastRun` is added                                         | Med        | Med    | Add a concise status presentation for `lastRun` and cover representative success/error/aborted/stuck cases in `status.test.ts`                             |
| Scope expands from foreground run into scheduler/process-manager work                                    | Med        | High   | Keep `/conductor run` single-worker only and treat concurrency/background workers as explicit follow-up work guarded by ADR-0007                           |

## Open Questions

* **Resolved by ADR-0011:** Worker runs should use a curated minimal headless binding policy rather than broad ambient inheritance.
* **Resolved by ADR-0011:** Runtime preflight should live in `runtime.ts` as an early eligibility check before conductor persists `running`.
* **Resolved in implementation:** `formatRunStatus()` now includes concise inline `lastRun` metadata covering active, completed, aborted, and errored runs.
* **Deferred follow-up:** A future stale-run heuristic could be time-based, heartbeat-based, or session-activity-based once operators accumulate real stuck-`running` cases.

## ADR Index

Decisions made during this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0006](../adr/ADR-0006-agent-session-based-foreground-run-execution.md) | AgentSession-based foreground run execution for pi-conductor | Accepted |
| [ADR-0007](../adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md) | Single-worker foreground run before multi-worker orchestration | Accepted |
| [ADR-0011](../adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md) | Conductor worker-run extension binding and preflight policy | Accepted |

---
title: "pi-conductor — single-worker run capability"
prd: PRD-003
status: Implemented
owner: "feniix"
issue: "N/A"
date: 2026-04-21
version: "1.4"
---

# PRD: pi-conductor — single-worker run capability

## 1. Problem & Context

`pi-conductor` now gives Pi durable worker identity, isolated worktrees, persisted session linkage, recovery, summaries, and PR flows. What it still does **not** do is let an operator ask conductor to actually execute work inside a worker session.

Today, `/conductor start` provisions a worker and `/conductor resume` relinks a session, but neither command causes the worker to perform a coding task. That leaves a major gap between:

* **worker orchestration** and
* **worker execution**.

This gap matters now because the current package has enough persistence and runtime structure to support a first real execution primitive without jumping all the way to autonomous multi-worker teams. The next useful step is intentionally narrow: enable **one worker to run one task through conductor** while preserving the current durable worker model.

This PRD is explicitly about the first **foreground execution** primitive for conductor:

* in scope: one worker executing one operator-supplied task to completion
* out of scope: background daemons, autonomous always-on workers, and multi-worker scheduling
* goal: move `pi-conductor` from durable orchestration into actual worker execution without prematurely expanding into agent-team architecture

This PRD builds directly on:

* `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
* `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
* `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`
* `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`
* the current implementation in `packages/pi-conductor`

## 2. Goals & Success Metrics

| Goal                                  | Metric                                                                                                              | Target                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Execute real work in a worker session | Operator can start a worker run with one command or tool call                                                       | 100% of valid worker runs require exactly one conductor entrypoint     |
| Preserve session continuity           | Running a task appends to the worker’s existing session lineage/file rather than creating a fresh unrelated session | 100% of healthy runs append to the current worker session lineage/file |
| Make progress visible                 | Status reflects when a worker is actively running and when the run completes or fails                               | 100% of worker runs update lifecycle and summary freshness coherently  |
| Keep scope intentionally narrow       | v1 run capability works for exactly one worker at a time within conductor                                           | No requirement for concurrent worker execution in this phase           |

**Guardrails**

* Do not regress worker creation, resume, recovery, or PR flows.
* Do not require tmux, subprocess supervision, or terminal scraping.
* Do not broaden scope into autonomous always-on workers or worker-to-worker delegation.

## 3. Users & Use Cases

### Primary: operator running one worker task through conductor

> As a Pi user, I want to tell a specific conductor worker to execute a concrete task in its persisted session so that the worker can make progress without me manually opening that session outside conductor.

**Preconditions:**

* a healthy worker exists
* the worker has a valid worktree and session reference
* Pi is configured with at least one usable model

### Secondary: package author validating the runtime seam

> As the package author, I want a narrow run capability built on the current runtime boundary so that conductor can evolve from durable orchestration into actual worker execution without prematurely introducing multi-agent complexity.

## 4. Scope

### In scope

1. Add a single-worker run command and tool.
2. Reuse the worker’s persisted session lineage for execution.
3. Perform real prompted execution against that worker through Pi runtime APIs.
4. Keep execution synchronous/foreground from conductor’s perspective: start the run, wait for completion, persist results, then return.
5. Update lifecycle around the run (`running` during execution, deterministic post-run state afterward).
6. Mark summaries stale when a run produces new activity.
7. Persist structured last-run metadata for operator visibility and debugging.
8. Add tests for the run flow at unit/integration level, and optionally opt-in CLI e2e coverage.

### Out of scope

| What                                                              | Why                                                                | Tracked in       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| Parallel execution of multiple workers from one conductor command | Adds scheduling/concurrency semantics beyond the next useful slice | Future follow-up |
| Autonomous background loops                                       | Not required to validate operator-triggered execution              | Future follow-up |
| Worker-to-worker messaging/delegation                             | Large scope increase and not needed for v1 run                     | Future follow-up |
| Process-backed subagents                                          | Current runtime seam should be exercised first                     | Future follow-up |
| Full plan/review hierarchies                                      | Needs a separate product decision                                  | Future follow-up |

## 5. Functional Requirements

### FR-1: Run a task in one named worker

The package must provide a way to run a single prompt/task inside one named worker’s persisted session lineage.

The operator surface should support a command of the form:

* `/conductor run <worker-name> <task>`

The model-callable surface should provide a corresponding tool such as:

* `conductor_run`

The worker run must target exactly one existing worker. If the named worker does not exist, conductor must fail clearly.

For this phase, `run` means **real prompted execution**, not just metadata mutation. The implementation should use Pi’s executable agent/session runtime APIs for the run path while preserving the current persisted worker/session model.

Concretely, the run path should:

* open the worker’s persisted session lineage via `SessionManager.open(worker.sessionFile)` when a session file exists
* construct an executable Pi session by passing that opened session manager to `createAgentSession({ sessionManager, cwd: worktreePath })` so that execution is bound to the worker’s existing lineage
* call `createAgentSession(...)` first, then apply headless extension overrides to the returned session through whatever binding/configuration mechanism the Pi SDK exposes for `AgentSession` construction and setup before prompting
* define the relevant setup surface concretely in terms of minimal non-interactive extension bindings/configuration for headless execution (for example no terminal `uiContext` and no interactive command-context actions), rather than referring to `runPrintMode` as a binding pattern
* explicitly decide how default extension, skill, prompt-template, and context-file discovery is narrowed for worker runs, since `createAgentSession()` normally performs resource discovery and loading unless conductor overrides that behavior through custom resource loading or equivalent session-construction controls
* execute the operator-supplied task in the foreground via `session.prompt(task)` and await its completion
* session persistence is handled internally by `AgentSession` via append-only writes; the run path must NOT call the existing `persistSessionFile()` from `runtime.ts`, which uses a full-rewrite strategy that would conflict with AgentSession's incremental persistence
* dispose the `AgentSession` after run completion (in a `finally` block) to release event listeners and internal state — the SDK requires `session.dispose()` when done with a session; the implementation must also confirm whether any loaded extension resources require teardown beyond `session.dispose()` and document that if needed

For this phase, the execution environment policy should be explicit and deterministic:

* worker runs should use conductor-defined session construction via `createAgentSession()` rather than relying on unspecified ambient defaults
* the implementation should decide and document which tools are enabled for worker runs
* the implementation should decide and document whether normal extension, skill, prompt-template, and context-file discovery remains enabled, is narrowed through custom resource loading, or is disabled for predictability
* model selection should use the operator’s configured/default Pi model unless conductor later adds worker-specific model policy
* preflight should make a best-effort verification of model and provider availability before prompting and before conductor persists the worker as `running`; that check may happen before or during session construction depending on the SDK seam used by the runtime helper
* the implementation may use `ModelRegistry` to check configured auth before calling `createAgentSession()` when that gives a cleaner earlier eligibility signal
* provider/model/auth failures can still occur later at prompt execution time, so the run path must also catch and translate prompt-time failures into clear run errors
* regardless of where failure occurs, the worker must never be left in `running` state after a preflight or early execution failure

**Acceptance criteria:**

```gherkin
Given a healthy worker named "backend"
When the user runs "/conductor run backend implement status output"
Then conductor opens the worker's executable session runtime
  And sends the supplied task into that worker context
  And waits for the run to finish
  And returns a run result containing the worker name, run outcome, and a concise final result or summary

Given a worker name that does not exist
When the user invokes the run command
Then conductor returns an explicit worker-not-found error
```

Run outcome is determined from the final assistant message's `stopReason`. The terminal `stopReason` should be derived from the last `AssistantMessage` in `session.state.messages` (or equivalently `session.agent.state.messages`), as `AgentSession` does not expose a dedicated stopReason accessor. The exhaustive mapping is:

* `stop` (normal end-of-turn) → `success`
* `error` → `error`
* `aborted` → `aborted`
* `length` (context exhaustion or max output tokens) → `error`, with `errorMessage` describing the truncation so the operator can split or shorten the task

`toolUse` is an internal intermediate state managed by `AgentSession` during tool-call loops and is not expected as a terminal `stopReason` after `session.prompt()` completes. If it is observed as terminal due to an unexpected edge case, the implementation should treat it as `error`.

The run result text should be derived from the final assistant message in `session.state.messages` (or via a small conductor-owned helper in `runtime.ts` that extracts text from that final assistant message), truncated if needed for display. If no final assistant text is available, conductor should fall back to a concise conductor-generated summary.

**Files:**

* `packages/pi-conductor/extensions/commands.ts`
* `packages/pi-conductor/extensions/index.ts`
* `packages/pi-conductor/extensions/conductor.ts`
* `packages/pi-conductor/extensions/runtime.ts`

### FR-2: Reuse the current worker session and worktree

A run must be a continuation of the worker’s existing thread of work, not a new unrelated session.

For a healthy worker, conductor must:

* use the current persisted session reference
* execute in the worker’s worktree context
* preserve the worker’s session lineage
* refuse to run workers that are broken or already running

For this phase, a worker is considered already running when its persisted lifecycle is `running`. Conductor must set `running` before execution begins and reject any overlapping run attempt until the first run clears that state through successful completion, failure handling, or explicit recovery.

The run path must not reuse `updateWorkerTaskForRepo()` for its task-update step, because that function currently resets lifecycle to `idle`. The run entrypoint needs a separate flow that sets `currentTask` and transitions lifecycle to `running` atomically, without passing through `idle`.

If the process terminates mid-run (crash, signal, forced exit), the worker remains persisted as `running` with `lastRun.finishedAt: null`. In v1, this is not automatically detected or repaired. The operator can clear a stuck `running` state with `/conductor state <worker> idle` or `/conductor recover <worker>`. A dedicated stale-run detection heuristic (e.g., timeout-based or heartbeat-based) is deferred to a future phase.

If the worker is broken or missing its session/worktree, conductor must reject the run and require recovery first.

**Acceptance criteria:**

```gherkin
Given a worker with a valid worktree and session file
When the user runs a task in that worker
Then conductor uses the existing worktree
  And uses the existing worker session lineage
  And does not create a replacement worker

Given a worker whose session file is missing
When the user attempts to run a task
Then conductor rejects the run
  And instructs the operator to recover the worker first

Given a worker whose worktree directory is missing
When the user attempts to run a task
Then conductor rejects the run
  And instructs the operator to recover the worker first

Given a worker already marked as running
When the user attempts to run another task in that worker
Then conductor rejects the run
  And explains that the worker must not have overlapping runs in this phase

Given Pi has no usable model or provider configuration
When the user attempts to run a task
Then conductor fails fast with a clear preflight error
  And does not leave the worker in a misleading running state
```

**Files:**

* `packages/pi-conductor/extensions/conductor.ts`
* `packages/pi-conductor/extensions/runtime.ts`
* `packages/pi-conductor/extensions/storage.ts`

### FR-3: Reflect execution lifecycle in worker state

When a run starts, the worker should transition into `running`. When the run finishes, the worker must leave `running` and land in a deterministic post-run state.

For the first iteration:

* successful completion normalizes to `idle`
* execution failure normalizes to `blocked`

Lifecycle alone is not enough, so conductor must also persist structured last-run metadata to answer:

* did a run start?
* when did it start and finish?
* is it currently running?
* did it succeed, fail, or abort?
* what task was run?
* what error occurred, if any?

The minimum v1 persisted shape should be:

```ts
lastRun: {
  task: string;
  status: "success" | "error" | "aborted" | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  sessionId: string | null;
}
```

`status: null` represents "run started but no terminal outcome has been recorded yet." `finishedAt` is populated for all terminal statuses (`success`, `error`, `aborted`). `null` indicates the run is still in progress or the process terminated before recording completion. In-progress detection in this phase is intentionally a compound condition: `worker.lifecycle === "running"` together with `lastRun.finishedAt === null`.

`lastRun.sessionId` should capture the `AgentSession.sessionId` from the execution session (i.e., the session ID active during the run), not the worker's pre-existing `runtime.sessionId`. These may differ because `createAgentSession()` can assign a new session ID. In the normal accepted run path, `sessionId` should be populated once the execution session is constructed; `null` remains valid for backward-compatible normalization and for partial records created before an execution session ID is available.

Because existing persisted workers do not yet have `lastRun`, the implementation must normalize missing `lastRun` values when reading older run records so the new feature is backward-compatible with already-persisted worker state.

In this phase, abort is not exposed as a separate operator command. An aborted run is detected when the agent's final assistant message has `stopReason = "aborted"`, meaning the SDK-observed execution ended with an explicit aborted terminal outcome. This is different from a hard crash, forced process exit, or other interruption that prevents a terminal assistant message from being recorded at all; those cases should be treated as interrupted/stuck runs with `finishedAt: null` rather than as a persisted `aborted` outcome. A dedicated `/conductor abort` command is deferred to a future phase.

When a stuck `running` worker is manually reset via `/conductor state <worker> idle` or `/conductor recover <worker>`, `lastRun` should be preserved as-is, including `finishedAt: null` and any `status: null` or partial execution metadata already recorded. The manual reset clears lifecycle state for operator recovery, but it does not retroactively invent a terminal outcome for the interrupted run.

**Acceptance criteria:**

```gherkin
Given a healthy worker
When conductor begins executing a task for that worker
Then the worker lifecycle becomes "running"

Given a worker whose task execution completes successfully
When status is requested after the run
Then the worker lifecycle is "idle"
  And the worker record reflects that a run occurred
  And the worker record includes a successful last-run outcome

Given a worker whose execution fails
When status is requested after the run
Then the worker lifecycle is "blocked"
  And the worker record includes failed last-run metadata and an error message

Given an operator-aborted run (detected via the agent's stopReason = "aborted")
When status is requested after the run
Then the worker record includes `lastRun.status = "aborted"`
  And the worker lifecycle returns to "idle"
  And the worker record preserves the aborted task and timestamps
```

**Files:**

* `packages/pi-conductor/extensions/types.ts`
* `packages/pi-conductor/extensions/storage.ts`
* `packages/pi-conductor/extensions/status.ts`
* `packages/pi-conductor/extensions/conductor.ts`

### FR-4: Make summary state and task state execution-aware

A run creates new worker activity. That means conductor must treat pre-existing summaries as stale once the run begins or once the run finishes with new output.

Note: `setWorkerTask()` in `storage.ts` already marks summaries stale when a task is updated and an existing summary exists. For the run path, this existing behavior is sufficient — staleness is triggered at task-update time (when the run sets `currentTask`), and no additional stale-marking is required at run-completion time.

For this phase, the run command accepts explicit task text directly, and that task must also become the worker’s `currentTask`. This avoids divergence between durable task metadata and the last task actually executed.

`currentTask` should update only after run preflight succeeds. If preflight fails before executable session start (for example due to missing model/provider configuration), conductor must leave `currentTask` unchanged.

After accepted preflight, `currentTask` reflects operator intent even if the run later fails or is aborted.

**Acceptance criteria:**

```gherkin
Given a worker with an existing summary
When a new run produces new session activity
Then the stored summary remains visible
  And it is marked stale until refreshed

Given a worker with currentTask "old task"
When the user runs "/conductor run backend new task"
Then the worker currentTask becomes "new task"
  And the run executes using "new task"

Given a worker with currentTask "old task"
When run preflight fails before execution starts
Then the worker currentTask remains "old task"
```

**Files:**

* `packages/pi-conductor/extensions/storage.ts`
* `packages/pi-conductor/extensions/status.ts`
* `packages/pi-conductor/extensions/conductor.ts`

### FR-5: Validate the run flow with tests that match the current runtime model

The run capability must be covered by tests appropriate to the current conductor architecture.

At minimum, tests should validate:

* command/tool wiring
* run-state persistence
* refusal to run broken or already-running workers
* refusal to run when model/provider preflight fails
* session-lineage reuse semantics
* lifecycle transitions around a run
* last-run metadata persistence
* distinct aborted/error outcome handling

If CLI e2e is added, it should remain opt-in behind an environment flag to avoid making CI depend on provider availability.

In this phase, run completion does not automatically refresh the worker summary. A run only marks existing summaries stale; summary refresh remains an explicit operator action.

**Acceptance criteria:**

```gherkin
Given the package test suite
When the run capability is added
Then unit and integration tests validate worker run behavior against real local repos and session files
  And any CLI e2e run tests remain opt-in rather than always-on in CI
```

**Files:**

* `packages/pi-conductor/__tests__/commands.test.ts`
* `packages/pi-conductor/__tests__/conductor.test.ts`
* `packages/pi-conductor/__tests__/lifecycle.test.ts`
* `packages/pi-conductor/__tests__/status.test.ts`
* `packages/pi-conductor/__tests__/sessions.test.ts`
* `packages/pi-conductor/__tests__/cli-e2e.test.ts`

## 6. Non-Functional Requirements

| Category      | Requirement                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Architecture  | Use the existing SDK/headless-first runtime seam; do not introduce terminal-driven correctness      |
| Safety        | Do not run tasks for broken workers                                                                 |
| Continuity    | Preserve worker session lineage and worktree continuity                                             |
| Testability   | Run behavior must be unit/integration testable without requiring live provider calls in CI          |
| Scope control | The first run feature must support one worker at a time only                                        |
| Evolvability  | The implementation must keep room for future `AgentSession` orchestration or process-backed workers |

## 7. Risks & Assumptions

| Risk                                                                                                        | Likelihood | Impact | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The current persisted-session runtime seam may not be sufficient to perform real prompted execution cleanly | Med        | High   | Keep the run API narrow and isolate execution in `runtime.ts`; promote the run path to executable Pi agent/session APIs as needed              |
| Lifecycle semantics may become ambiguous after execution                                                    | Med        | Med    | Explicitly define `running` and post-run state transitions in code and tests                                                                   |
| Provider/model availability could make tests flaky                                                          | High       | Med    | Keep provider-backed CLI e2e opt-in; rely on integration tests for CI                                                                          |
| Run capability may tempt scope creep into multi-worker scheduling                                           | High       | Med    | Keep command/tool contract strictly single-worker in this PRD                                                                                  |
| Process crash mid-run leaves worker stuck in `running` with no automatic recovery                           | Med        | Med    | Document manual escape hatches (`/conductor state <worker> idle`, `/conductor recover`); defer automated stale-run detection to a future phase |

## 8. Design Decisions

### D1. Add a narrow single-worker run seam before multi-worker orchestration

**ADR**: `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`

**Options considered:**

1. Add a single-worker run feature now
2. Skip straight to multi-worker concurrent execution
3. Skip straight to autonomous background workers

**Decision:** choose option 1.

**Rationale:** It validates the most important missing capability—actual worker execution—without introducing scheduling, supervision, or multi-agent coordination complexity.

### D2. Keep execution behind `runtime.ts`

**Options considered:**

1. Trigger execution directly inside `conductor.ts`
2. Extend the existing runtime boundary in `runtime.ts`

**Decision:** choose option 2.

**Rationale:** The current architecture already separates session/runtime concerns from orchestration concerns. Execution should deepen that seam, not bypass it.

### D3. Use executable Pi agent/session APIs for run

**Options considered:**

1. Keep using only `SessionManager`-level file manipulation for run behavior
2. Promote the run path to executable Pi session APIs such as `createAgentSession()` while preserving the existing session file lineage

**Decision:** choose option 2.

**Rationale:** `run` is the first feature that must perform real worker execution. Session-file linkage alone is not sufficient; the execution path should use Pi’s actual executable agent/session runtime while still keeping the persisted worker/session model intact.

`createAgentSession()` is the expected starting point for this phase. If session replacement or runtime ownership becomes more complex than a single foreground run requires, the implementation may move to lower-level `AgentSession` construction with explicit `AgentSessionConfig` — but that is not expected to be necessary for v1.

### D4. Keep CLI e2e opt-in

**Options considered:**

1. Always run CLI e2e in CI
2. Gate CLI e2e behind an env flag

**Decision:** choose option 2.

**Rationale:** Conductor should maintain deterministic CI even if pi startup/model configuration differs across environments.

## 9. File Breakdown

| File                                                | Change type | FR                     | Description                                                                                                                        |
| --------------------------------------------------- | ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-conductor/extensions/runtime.ts`       | Modify      | FR-1, FR-2             | Add execution support for one worker session, including executable session construction, cwd/session reuse, and run result shaping |
| `packages/pi-conductor/extensions/conductor.ts`     | Modify      | FR-1, FR-2, FR-3, FR-4 | Add orchestration entrypoint for worker run lifecycle and state transitions                                                        |
| `packages/pi-conductor/extensions/commands.ts`      | Modify      | FR-1                   | Add `/conductor run <worker> <task>`                                                                                               |
| `packages/pi-conductor/extensions/index.ts`         | Modify      | FR-1                   | Register run tool and wire execution command behavior                                                                              |
| `packages/pi-conductor/extensions/types.ts`         | Modify      | FR-3                   | Persist run-related runtime metadata and structured `lastRun` state                                                                |
| `packages/pi-conductor/extensions/storage.ts`       | Modify      | FR-2, FR-3, FR-4       | Update worker state across run transitions and normalize missing `lastRun` state for backward compatibility                        |
| `packages/pi-conductor/extensions/status.ts`        | Modify      | FR-3, FR-4             | Surface run-related state in status output                                                                                         |
| `packages/pi-conductor/__tests__/commands.test.ts`  | Modify      | FR-5                   | Validate command behavior, including preflight failure handling                                                                    |
| `packages/pi-conductor/__tests__/conductor.test.ts` | Modify      | FR-5                   | Validate orchestration behavior and session-lineage reuse                                                                          |
| `packages/pi-conductor/__tests__/lifecycle.test.ts` | Modify      | FR-5                   | Validate lifecycle transitions around run, including aborted/error outcomes                                                        |
| `packages/pi-conductor/__tests__/status.test.ts`    | Modify      | FR-5                   | Validate run-aware status output and last-run metadata                                                                             |
| `packages/pi-conductor/__tests__/sessions.test.ts`  | Modify      | FR-5                   | Validate session-lineage reuse semantics across run execution                                                                      |
| `packages/pi-conductor/__tests__/cli-e2e.test.ts`   | Modify      | FR-5                   | Optional opt-in real pi CLI coverage                                                                                               |
| `packages/pi-conductor/README.md`                   | Modify      | FR-1                   | Document the new run capability and its scope                                                                                      |

## 10. Dependencies & Constraints

* Depends on the current `pi-conductor` worker/session/worktree model already shipped in `0.2.0`.
* Depends on Pi runtime APIs being sufficient to reopen and execute against a worker session.
* Run must fail fast and clearly when no usable model/provider configuration is available.
* Default CI must not require real provider credentials.
* CLI e2e that exercises the real `pi` binary must remain opt-in.
* Must work from the current repository command/tool surface rather than introducing a separate package.

## 11. Rollout Plan

1. Extend types/storage with backward-compatible `lastRun` persistence and normalization.
2. Implement the executable session-based runtime execution seam.
3. Add conductor lifecycle orchestration plus command/tool wiring for single-worker run.
4. Add status updates and integration/unit coverage.
5. Optionally add or extend opt-in CLI e2e coverage.
6. Update README and follow-on architecture docs if implementation diverges materially.

## 12. Open Questions

All originally in-scope open questions for PRD-003 were resolved during implementation and ADR refinement. No blocking open questions remain for the shipped single-worker foreground run capability.

| #  | Question                                                                                                                                        | Owner  | Due                         | Status                                                                                                                                                  |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 | Should post-run failure land in `blocked` or return to `idle` with separate error metadata?                                                     | feniix | Before implementation       | **Resolved:** In this phase, failed execution lands in `blocked` and also persists structured last-run error metadata.                                  |
| Q2 | Should `/conductor run` implicitly update `currentTask`, or should it remain separate from task metadata?                                       | feniix | Before implementation       | **Resolved:** `/conductor run` updates `currentTask` to the executed task text before starting execution.                                               |
| Q3 | Is the current `SessionManager` seam enough for prompted execution, or should the implementation promote to `createAgentSession()` immediately? | feniix | During implementation spike | **Resolved:** The run path should use executable Pi agent/session APIs such as `createAgentSession()` while preserving existing worker session lineage. |

## 13. Related

* `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
* `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`
* `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`
* PR #38 — runtime/spec alignment and opt-in CLI e2e coverage groundwork

## 14. Changelog

| Date       | Change                                                                                                                                                                                                                                                                                                                       | Author |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-04-21 | Initial draft for adding a single-worker run capability to `pi-conductor`                                                                                                                                                                                                                                                    | feniix |
| 2026-04-21 | Refine pass: fix phantom `createAgentSessionRuntime()` API reference; make `createAgentSession({ sessionManager })` linkage explicit; clarify headless binding/configuration requirements; define run outcome detection via `stopReason`; clarify abort mechanism and `lastRun.sessionId`; add preflight validation guidance | feniix |
| 2026-04-21 | Refine pass 2: move stopReason prose out of Gherkin; add `session.dispose()` cleanup step; clarify AgentSession persistence behavior; add sessions test coverage note; clarify `finishedAt` null semantics                                                                                                                   | feniix |
| 2026-04-21 | Refine pass 3 and 4: complete stopReason mapping, add stuck-running crash note, fix final-message references to `session.state.messages`, and clarify prompt-time provider/auth failure handling                                                                                                                             | feniix |
| 2026-04-21 | Normalize File Breakdown, Related, and Changelog structure to satisfy current `pi-specdocs` PRD validation rules without changing document intent                                                                                                                                                                            | Pi     |
| 2026-04-21 | Mark PRD-003 implemented after shipping `/conductor run`, durable `lastRun` state, foreground execution, status/reporting, tests, and documentation                                                                                                                                                                          | Pi     |

---
title: "pi-conductor — agent-native durable control plane"
prd: PRD-006
status: Implemented
owner: "feniix"
issue: "https://github.com/feniix/pi-extensions/issues/54"
date: 2026-04-24
version: "1.0"
---

# PRD: pi-conductor — agent-native durable control plane

---

## Implementation Status

Implemented in branch `feat/conductor-control-plane`.

This implementation satisfies the core PRD and additionally includes objectives, task dependency DAGs, scheduler policies, scheduler fairness/capacity controls, richer trusted human approval UI, granular event families, audit-preserving worker archival, safe artifact reads, and file-locked/latest-state persistence hardening.

The only intentionally deferred item is direct `pi-subagents` dispatch against a stable upstream API. The backend seam, availability detection, fail-closed behavior, and trusted injected dispatcher path are implemented; speculative integration against an unstable public API is not.

---

## 1. Problem & Context

`pi-conductor` currently provides a useful local orchestration foundation for Pi: project-scoped worker records, conductor-managed git worktrees, persisted Pi session references, worker recovery, summaries, PR preparation, and a single-worker foreground run primitive. The implementation is centered on `WorkerRecord` in `packages/pi-conductor/extensions/types.ts`, project storage in `packages/pi-conductor/extensions/storage.ts`, orchestration in `packages/pi-conductor/extensions/conductor.ts`, and a curated headless `AgentSession` runtime in `packages/pi-conductor/extensions/runtime.ts`.

That foundation is still worker-centric and human-command-centric:

* work intent is stored as `worker.currentTask`, which is overwritten rather than represented as a durable task object
* execution history is stored as `worker.lastRun`, which records the most recent run but not a durable task/run ledger
* `/conductor` commands are the primary product shape, while model-callable tools mirror that worker-centric interface
* semantic task completion is inferred from backend run completion and final assistant output, not from an explicit child-side completion contract
* crash/stuck-run handling is intentionally manual: a process can leave `lifecycle=running` with `lastRun.finishedAt=null`
* `pi-subagents` is available as a strong Pi-native subagent executor, but conductor does not yet have an adapter boundary for it

The next step should not be more human-operated worker commands. The product goal is for **Pi and the parent LLM to coordinate long-lived subagents directly**. Conductor should become a local, durable, agent-native control plane: parent Pi agents create tasks, assign workers, start runs, inspect progress, handle gates, recover drift, and collect artifacts through tools. Humans inspect and approve; they should not need to manually operate every worker.

Because `pi-conductor` is still pre-adoption 0.x, compatibility with the current command and state shape is not a constraint. This PRD intentionally allows replacing current worker-centric commands and fields with a cleaner control-plane model rather than preserving aliases.

This PRD builds on:

* `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
* `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
* `docs/brainstorms/2026-04-24-pi-conductor-agent-native-control-plane-requirements.md`
* `docs/ideation/2026-04-24-pi-conductor-agent-native-orchestration-ideation.md`
* the current package implementation in `packages/pi-conductor`

---

## 2. Goals & Success Metrics

| Goal                                    | Metric                                                                                                   | Target                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Make conductor agent-first**          | Parent Pi can perform core orchestration through model-callable tools without slash-command choreography | 100% of create/list/get/update/delete/assign/run/progress/complete flows exposed as tools                                |
| **Represent work durably**              | Work units stored as task/run records instead of only `currentTask`/`lastRun`                            | 100% of accepted runs link to durable `taskId` and `runId`                                                               |
| **Make completion explicit**            | Child worker can report task outcome through conductor completion tools                                  | 100% of native worker task prompts include explicit completion contract and tool availability when supported             |
| **Keep execution backends replaceable** | Native Pi runtime and `pi-subagents` can be selected behind the same conductor task/run model            | At least native backend implemented; `pi-subagents` adapter implemented or version-gated behind clear unavailable status |
| **Improve observability and recovery**  | Run/task events and artifacts explain what happened and support stale-run reconciliation                 | 100% of lifecycle transitions and terminal outcomes append durable events                                                |
| **Bound autonomy safely**               | High-stakes or blocked outcomes surface as gates instead of silent progression                           | Gates exist for approval/input/review states and can be queried/resolved through tools                                   |

**Guardrails (must not regress):**

* Worker creation must continue to create isolated conductor-managed git worktrees and branches.
* Healthy workers must continue to preserve persisted Pi session lineage across runs where the selected backend supports it.
* Broken worktrees or session references must still be detected and surfaced rather than silently ignored.
* PR preparation failures must not corrupt worker/task/run state.
* The native `AgentSession` backend must remain usable without `pi-subagents` installed.
* Conductor state must remain outside the repository by default under conductor-owned project storage.

---

## 3. Users & Use Cases

### Primary: parent Pi agent orchestrating subagents

> As the parent Pi agent, I want conductor tools for durable workers, tasks, runs, artifacts, and gates so that I can decompose a user goal and coordinate long-lived subagents without asking the human to operate every worker manually.

**Preconditions:** Pi is running with the `pi-conductor` extension loaded inside a git repository; at least one usable model/provider is configured for the selected backend.

### Secondary: human user supervising conductor

> As a human user, I want to inspect workers/tasks/runs and resolve gates so that I can supervise autonomous or semi-autonomous work without losing visibility or approving risky actions blindly.

**Preconditions:** The user is inside a repository with conductor project state and can use `/conductor get ...` or model-facing tools through Pi.

### Secondary: child worker agent executing a task

> As a child worker agent, I want a clear task contract and conductor tools for progress, artifacts, blockers, and completion so that my output is machine-readable and durable for the parent agent.

**Preconditions:** A conductor run has started through a backend that can expose the child-side conductor tool surface.

### Future: alternate execution backend author (enabled by this work)

> As a backend author, I want a stable conductor execution interface so that native `AgentSession`, `pi-subagents`, tmux/process-backed runners, or future runtimes can execute the same conductor task model.

**Preconditions:** The conductor backend interface and run event/result contract are documented and tested.

---

## 4. Scope

### In scope

1. **Control-plane resource model** — introduce durable workers, tasks, runs, artifacts, gates, and events as first-class conductor resources.
2. **Agent-first tool surface** — replace the current worker-centric tool names with resource-oriented model-callable tools for parent Pi orchestration.
3. **Debug slash command surface** — reshape `/conductor` as a resource inspection/debug command group, not the canonical orchestration API.
4. **Task/run lifecycle** — centralize mutations so worker, task, and run state cannot contradict each other silently.
5. **Explicit child-side completion** — expose child tools/instructions for progress, artifacts, blockers, follow-up tasks when allowed, and task completion.
6. **Execution backend interface** — formalize a backend abstraction for native `AgentSession` and optional `pi-subagents` execution.
7. **Optional `pi-subagents` adapter** — integrate through a documented or version-gated event/API surface where feasible.
8. **Event ledger and artifact registry** — persist lifecycle events, progress, backend events, completion reports, and artifact/evidence references.
9. **Gates and bounded autonomy** — persist approval/review/input gates that can pause or unblock dependent work.
10. **Reconciliation and stale-run recovery** — detect state drift, stale leases, crashed runs, and broken resources without inventing successful outcomes.
11. **Docs and tests** — update README plus unit/integration tests for storage, command/tool surfaces, backends, events, gates, and reconciliation.

### Out of scope / later

| What                                                     | Why                                                                                                                         | Tracked in |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Fully automatic worker selection and long-running daemon | Scheduler policies, round-robin fairness, per-objective limits, and run capacity are implemented; daemonization remains out | Future PRD |
| Full dashboard                                           | Trusted human gate review UI is implemented; a persistent dashboard remains unnecessary for this local package slice        | Future PRD |
| Worker-to-worker freeform messaging                      | Structured events, blockers, gates, and artifacts are enough for this slice                                                 | Future PRD |
| Autonomous merge or automatic PR publication             | High-trust actions remain gated by explicit human approval                                                                  | Future PRD |
| Replacing `pi-subagents` as a generic subagent framework | Conductor should own durability/control plane, not generic agent execution                                                  | N/A        |
| Cloud workflow engine integration                        | Conductor is a local Pi package, not Temporal/Inngest/Hatchet                                                               | N/A        |

### Design for future (build with awareness)

* **Backend interface**: keep execution behind a narrow interface so a future tmux/process backend can be added without changing task storage or tool contracts.
* **Resource/event model**: use stable IDs and append-only events so future scheduling, DAGs, and dashboards can derive from existing history.
* **Gate model**: represent approvals as resources so future policy engines or UI components can resolve the same gates.
* **Artifact registry**: store references and metadata rather than embedding every large log in project state, so future retention policies can evolve.

### Required resource and state model

Implementation must define these resource types and state enums before broad tool/command work begins. The exact TypeScript names may vary, but the state model must preserve these semantic boundaries.

| Resource        | Required identity/linkage                                                                                                    | Required states / types                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker          | `workerId`, stable name, branch, worktree path, session reference, backend configuration                                     | `WorkerReadiness = idle \| busy \| unavailable`; `WorkerHealth = healthy \| stale \| broken \| recoverable`; worker state must not encode semantic task outcome.                                            |
| Task            | `taskId`, title/name, prompt/body, assigned worker, active run, run history, artifacts, gates, timestamps                    | `TaskState = draft \| ready \| assigned \| running \| needs_review \| blocked \| completed \| failed \| canceled`; task completion comes from explicit completion policy, not backend exit alone.           |
| Run             | `runId`, `taskId`, `workerId`, backend type, backend run handle, lease fields, timestamps, runtime result, completion report | `RunStatus = queued \| starting \| running \| completing \| succeeded \| partial \| blocked \| failed \| aborted \| stale \| interrupted`; terminal run state must be distinct from backend process status. |
| Backend runtime | backend type, session id/file, external run id, async directory, latest heartbeat/status                                     | `BackendRuntimeStatus = unavailable \| starting \| running \| exited_success \| exited_error \| aborted \| unknown`; runtime status is evidence, not semantic task completion.                              |
| Gate            | `gateId`, type, associated task/run/worker, requested decision, resolver, timestamps                                         | `GateType = needs_input \| needs_review \| approval_required \| ready_for_pr \| destructive_cleanup`; `GateStatus = open \| approved \| rejected \| canceled`.                                              |
| Artifact        | `artifactId`, type, path/reference, task/run/worker links, producer, timestamps                                              | `ArtifactType = note \| test_result \| changed_files \| log \| completion_report \| pr_evidence \| other`.                                                                                                  |
| Event           | `eventId`, monotonic `sequence`, `schemaVersion`, actor, resource refs, event type, payload, timestamp                       | Append-only; every state transition and resource mutation must append an event in the same persisted update.                                                                                                |

Minimum transition rules:

* A task may enter `completed` only from an accepted explicit completion report or a documented fallback policy that creates an audit event.
* Backend `exited_success` without explicit completion must create `TaskState = needs_review` and an `unknown_completion`/review gate by default.
* A worker can be `healthy` and `idle` while a task is `completed`, `blocked`, or `failed`; task outcome must not be stored as worker lifecycle.
* A destructive cleanup of a worker, worktree, branch, session file, event history, or artifact reference requires an approved `destructive_cleanup` gate unless a test-only policy explicitly disables gates.
* PR creation requires an approved `ready_for_pr` or `approval_required` gate; commit/push preparation may be allowed before approval but must not publish a PR without the gate.

---

## 5. Functional Requirements

### FR-1: Resource-oriented persistent state

Conductor must replace the current worker-only `RunRecord` with a project-scoped control-plane record that contains durable collections for workers, tasks, runs, gates, artifacts, and events. Existing local state can be normalized or discarded during development; no compatibility migration is required for external users.

Workers remain durable execution environments. Tasks represent work intent and outcome. Runs represent execution attempts. Gates represent blocked approval/input/review states. Artifacts represent durable evidence or output references. Events form the audit trail. The project record must include a `schemaVersion`, monotonic project `revision`, and storage helpers that detect unsupported old shapes with a clear reset/backup/normalization message rather than failing with an opaque JSON/type error. Writes must be atomic at the project-file level and must use either a file lock or optimistic revision check so concurrent parent/child tool calls cannot silently drop updates.

**Acceptance criteria:**

```gherkin
Given a repository with no conductor project state
When the parent Pi agent creates worker "backend" and task "task-add-ledger-1"
Then conductor persists a project record with one worker and one task
  And the task has a stable task id, prompt, state, timestamps, and no run yet
  And the worker has a stable worker id, worktree path, branch, session reference, and health state
```

```gherkin
Given an existing worker with previous runs
When the parent Pi agent creates a new task
Then the previous run history remains queryable
  And the new task does not overwrite prior task identity or run history
```

```gherkin
Given two conductor tool calls append events to the same project state concurrently
When both mutations are accepted
Then both events remain present in the project record
  And the project revision advances monotonically without silently overwriting either mutation
```

```gherkin
Given conductor finds an old worker-only run.json without the new schemaVersion
When a parent Pi agent calls conductor_get_project
Then conductor returns a clear reset, backup, or normalization instruction
  And does not throw an opaque parser or missing-field error
```

**Files:**

* `packages/pi-conductor/extensions/types.ts` — define `TaskRecord`, `TaskState`, `RunAttemptRecord`, `GateRecord`, `ArtifactRecord`, `ConductorEvent`, schema version, project revision, and updated project record shape.
* `packages/pi-conductor/extensions/storage.ts` — normalize, read, write, lock or revision-check, and mutate the expanded resource model.
* `packages/pi-conductor/__tests__/storage.test.ts` — cover new record creation, normalization, old-shape detection, atomic/revision-safe writes, concurrent event append behavior, and state consistency.

### FR-2: Agent-first conductor tool surface

Conductor must expose model-callable resource tools as the primary orchestration API. The parent Pi agent must be able to create, list, get, update, and delete safe resources; assign tasks to workers; start runs; inspect current state; inspect history; interrupt/reconcile runs; and resolve gates without relying on slash commands.

The current worker-centric tool names may be removed or replaced. Required tools must be resource-oriented and split between parent orchestration tools and child run-scoped reporting tools.

Minimum parent-agent tool contract:

| Tool                                              | Actor                  | Purpose                                                                                |
| ------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `conductor_get_project`                           | Parent/human via model | Return project metadata, schema version, revision, and concise aggregate status.       |
| `conductor_list_workers` / `conductor_get_worker` | Parent                 | Inspect worker readiness, health, backend, branch, worktree, and active run.           |
| `conductor_create_worker`                         | Parent                 | Create a durable worker, branch, worktree, and backend/session metadata.               |
| `conductor_list_tasks` / `conductor_get_task`     | Parent                 | Inspect task state, assignment, latest progress, gates, artifacts, and run history.    |
| `conductor_create_task` / `conductor_update_task` | Parent                 | Create or revise durable task intent before or between runs.                           |
| `conductor_assign_task`                           | Parent                 | Assign or reassign a task to a worker through centralized lifecycle transitions.       |
| `conductor_run_task`                              | Parent                 | Start one task run through the selected backend.                                       |
| `conductor_get_run` / `conductor_list_runs`       | Parent                 | Inspect run status, backend metadata, completion report, events, and artifacts.        |
| `conductor_list_gates` / `conductor_resolve_gate` | Parent/human via model | Inspect and resolve approval/input/review/destructive gates.                           |
| `conductor_reconcile`                             | Parent/human via model | Compare project state to worktrees, sessions, backend handles, leases, and gates.      |
| `conductor_prepare_pr`                            | Parent                 | Perform task-aware commit/push/PR steps according to gate policy.                      |
| `conductor_cleanup_resource`                      | Parent/human via model | Soft-delete or hard-delete approved resources according to destructive cleanup policy. |

Minimum child run-scoped tool contract:

| Tool                             | Actor                                                             | Purpose                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conductor_report_progress`      | Child worker                                                      | Append concise progress to the active task/run.                                                                                                       |
| `conductor_emit_artifact`        | Child worker                                                      | Register artifact/evidence references for the active task/run.                                                                                        |
| `conductor_create_gate`          | Child worker                                                      | Create blockers, input requests, review requests, or approval requests.                                                                               |
| `conductor_create_followup_task` | Child worker when allowed by task contract                        | Propose or create follow-up work linked to the active task/run.                                                                                       |
| `conductor_complete_task`        | Child worker; parent only for explicit override/review resolution | Submit semantic completion for the active run. Child calls must be scoped to the active `taskId`/`runId`; parent override must append an audit event. |

**Acceptance criteria:**

```gherkin
Given a parent Pi agent with conductor tools loaded
When it needs to delegate work to a worker
Then it can list workers, create a task, assign the task, run the task, and inspect the run using tools only
  And no human slash command is required for the happy path
```

```gherkin
Given a task named "add task ledger"
When the parent Pi agent calls the task list tool
Then the response includes the task id, state, assigned worker, active run if any, and concise latest status
```

```gherkin
Given a child worker run has active taskId "task-add-ledger-1" and runId "run-1"
When it calls conductor_complete_task for a different taskId or runId
Then conductor rejects the call
  And appends an audit event describing the invalid scoped completion attempt
```

**Files:**

* `packages/pi-conductor/extensions/index.ts` — replace/register the agent-first tool surface and child-side tools.
* `packages/pi-conductor/extensions/conductor.ts` — add resource-level orchestration entrypoints.
* `packages/pi-conductor/__tests__/index.test.ts` — validate tool registration and schemas.
* `packages/pi-conductor/__tests__/conductor.test.ts` — validate model-callable orchestration behavior.

### FR-3: Resource-shaped `/conductor` debug command

The slash command must mirror resource inspection/debug flows rather than preserve the old worker-centric operator workflow. The default slash experience should be read-oriented (`get`, `list`, `history`, `reconcile --dry-run`) because the primary orchestration interface is tools. Mutating slash commands are allowed only as explicit admin/debug parity for the same model-callable operations, and they must call the same conductor orchestration helpers as tools.

It should support command shapes such as `get workers`, `get worker <name>`, `get tasks`, `get task <task-id>`, `get run <run-id>`, `get gates`, `create worker <name>`, `create task <name> <prompt...>`, `assign task <task-id> <worker>`, `run task <task-id>`, `reconcile`, and targeted cleanup/recovery commands. Mutating slash commands must never implement separate lifecycle logic from tools.

Compatibility aliases for the old `/conductor start`, `/conductor task`, `/conductor status`, and `/conductor run <worker> <task>` are not required.

**Acceptance criteria:**

```gherkin
Given a project with workers and tasks
When the user runs "/conductor get tasks"
Then conductor prints a concise resource list with task id, state, assigned worker, and active run
```

```gherkin
Given the user runs "/conductor start backend"
When old compatibility aliases have been removed
Then conductor returns usage for the new resource-shaped command surface rather than creating a worker through the old alias
```

**Files:**

* `packages/pi-conductor/extensions/commands.ts` — replace command parser and usage text.
* `packages/pi-conductor/extensions/status.ts` — split concise resource views from detailed history views.
* `packages/pi-conductor/__tests__/commands.test.ts` — cover new command grammar and removed aliases.
* `packages/pi-conductor/__tests__/status.test.ts` — cover resource list/detail formatting.

### FR-4: Centralized task, run, and worker lifecycle transitions

All task/run mutations must go through conductor orchestration helpers that update worker, task, run, events, and gates consistently. Directly setting worker lifecycle to express semantic task completion must be avoided. Worker state should describe environment readiness/health; task and run state should describe work progress and outcome.

**Acceptance criteria:**

```gherkin
Given task "task-add-ledger-1" is assigned to worker "backend"
When conductor starts a run for the task
Then the task state becomes "running"
  And the worker records the active task/run
  And the run record has status "running"
  And a run-started event is appended
```

```gherkin
Given worker "backend" is healthy and idle
When a run finishes with task status "blocked"
Then the task state becomes "blocked"
  And the worker is not marked "done"
  And a gate or blocker event explains what is needed next
```

**Files:**

* `packages/pi-conductor/extensions/storage.ts` — add atomic-ish immutable mutation helpers for task/run/worker transitions.
* `packages/pi-conductor/extensions/conductor.ts` — ensure all public entrypoints use centralized transitions.
* `packages/pi-conductor/extensions/types.ts` — separate worker health/readiness states from task/run outcome states.
* `packages/pi-conductor/__tests__/lifecycle.test.ts` — cover state transition invariants.
* `packages/pi-conductor/__tests__/run-flow.test.ts` — cover run lifecycle integration.

### FR-5: Explicit child-side task contract and completion tools

Every worker run must include a task contract with task id, task prompt, constraints, expected completion statuses, allowed follow-up behavior, active `runId`, and instructions to report progress and completion through conductor tools when available.

Conductor must expose child-side tools for progress, artifact emission, gate/blocker creation, follow-up task creation where allowed, and explicit completion. The completion tool must accept a status such as `success`, `partial`, `blocked`, `failed`, or `aborted`, plus a summary and optional artifact/evidence references.

For the native `AgentSession` backend, implementation must first add and test a run-scoped child tool bridge. The current runtime creates an isolated resource loader and a curated tool list, so simply registering tools on the parent extension is insufficient. The bridge may be implemented by injecting a conductor-aware extension/runtime into the child resource loader, by passing a validated run-scoped tool registry into `createAgentSession`, or by another documented Pi SDK mechanism. If the bridge cannot be proven for a backend, that backend must still run with a prompt-only contract but must report `explicit_completion_tools=false`; conductor must then use the default `needs_review` fallback instead of marking semantic completion automatically.

**Acceptance criteria:**

```gherkin
Given a native worker run starts for task "task-add-ledger-1"
When the child agent receives its prompt
Then the prompt includes the task id, run id, allowed statuses, and instructions to call the conductor completion tool
```

```gherkin
Given the native worker runtime is configured for explicit child completion
When the worker AgentSession is created
Then the available child tool registry includes conductor_report_progress, conductor_emit_artifact, conductor_create_gate, and conductor_complete_task
  And each child tool is scoped to the active taskId and runId
```

```gherkin
Given a child worker has completed its changes
When it calls conductor_complete_task with status "success" and summary "Added task ledger tests"
Then conductor marks the task semantically complete
  And the active run records the completion
  And a completion event is appended
```

```gherkin
Given a backend process exits without a conductor completion signal
When conductor finalizes backend runtime status
Then conductor records the backend exit outcome
  And marks the task needs_review by default
  And creates a review gate explaining that semantic completion was not explicitly reported
```

**Files:**

* `packages/pi-conductor/extensions/index.ts` — register child-side progress/artifact/gate/completion tools.
* `packages/pi-conductor/extensions/runtime.ts` — inject task contract and child tool surface into native worker runs.
* `packages/pi-conductor/extensions/conductor.ts` — implement completion/progress/artifact/gate entrypoints.
* `packages/pi-conductor/__tests__/runtime-run.test.ts` — cover prompt/contract construction.
* `packages/pi-conductor/__tests__/run-flow.test.ts` — cover explicit completion behavior.

### FR-6: Replaceable execution backend interface

Conductor must define a backend interface that executes a `TaskRunInput` and reports backend run handles, progress, terminal runtime status, session references, and artifact references. The native Pi `AgentSession` backend must implement this interface. The existing runtime code should be adapted rather than duplicated.

**Acceptance criteria:**

```gherkin
Given worker "backend" uses backend "native"
When conductor runs task "task-add-ledger-1"
Then conductor invokes the native backend through the backend interface
  And stores the backend type and backend run handle on the run record
```

```gherkin
Given a future backend is registered with the same interface
When conductor starts a task run for a worker configured for that backend
Then task/run state transitions are unchanged from the parent agent's perspective
```

**Files:**

* `packages/pi-conductor/extensions/runtime.ts` — split native backend implementation from backend interface types.
* `packages/pi-conductor/extensions/types.ts` — add backend identifiers and backend run metadata types.
* `packages/pi-conductor/extensions/conductor.ts` — select backend per worker/run.
* `packages/pi-conductor/__tests__/runtime-run.test.ts` — cover native backend interface behavior.

### FR-7: Optional `pi-subagents` backend adapter

Conductor should support `pi-subagents` as an optional backend where feasible. The adapter must preserve conductor as the canonical state owner. It may use a documented or version-gated `pi-subagents` event bridge/API surface, and must persist backend run id, async directory, progress/completion events, session file references, artifacts, and backend errors.

This PRD requires a stable adapter seam and availability detection. Actual dispatch through `pi-subagents` is conditional on confirming a stable integration surface during planning or implementation spike. If `pi-subagents` is not installed or the expected integration surface is unavailable, conductor must report a clear `backend_unavailable` status without breaking native execution or corrupting task/run state.

**Acceptance criteria:**

```gherkin
Given worker "reviewer" is configured for backend "pi-subagents"
  And pi-subagents is loaded with a version-gated expected bridge
When conductor starts task "task-review-1"
Then conductor dispatches the task through the adapter
  And records the pi-subagents run id and async directory on the run record
  And updates conductor progress from pi-subagents events
```

```gherkin
Given pi-subagents is installed but its bridge version or event contract is not recognized
When conductor checks backend availability
Then conductor reports backend_unavailable with the detected version and missing capability
  And native backend execution remains available
```

```gherkin
Given worker "reviewer" is configured for backend "pi-subagents"
  And pi-subagents is not loaded
When conductor starts task "task-review-1"
Then conductor rejects the run with backend_unavailable
  And the task remains assigned but not running
  And an error event is appended
```

**Files:**

* `packages/pi-conductor/extensions/runtime.ts` — add `pi-subagents` adapter implementation or adapter seam.
* `packages/pi-conductor/extensions/index.ts` — detect or communicate with the `pi-subagents` event/API surface.
* `packages/pi-conductor/extensions/types.ts` — store `pi-subagents` backend metadata.
* `packages/pi-conductor/__tests__/runtime-run.test.ts` — cover adapter available/unavailable behavior with mocked events.
* `packages/pi-conductor/__tests__/run-flow.test.ts` — cover task state behavior for adapter failures.

### FR-8: Event ledger and artifact registry

Conductor must append durable events for meaningful resource changes: task creation/update/assignment, run start/progress/completion/failure, backend events, artifact emission, gate creation/resolution, recovery, and PR prep actions. Conductor must also persist artifact/evidence records with metadata and references to files/logs/session entries where appropriate.

The event ledger should be queryable in both concise and detailed modes. It should not blindly copy entire Pi session logs into conductor state.

Each event must include at least `eventId`, monotonic `sequence`, project `revision`, `schemaVersion`, `occurredAt`, `actor`, `type`, `resourceRefs`, and a bounded JSON `payload`. Event append and the resource mutation it describes must persist in the same storage update. Artifacts must include bounded metadata and references to external files/logs/session entries rather than embedding large content directly.

**Acceptance criteria:**

```gherkin
Given a task run emits progress "tests passing"
When conductor records the progress
Then the task detail view shows the latest concise progress
  And the run history includes an append-only progress event
```

```gherkin
Given a worker emits artifact "test-results.txt"
When conductor records the artifact
Then the artifact registry stores its id, type, path or reference, associated task id, associated run id, and timestamp
```

```gherkin
Given conductor records a task state transition from running to completed
When the project file is written
Then the task state update and its corresponding event share the same project revision
  And neither can be persisted without the other
```

**Files:**

* `packages/pi-conductor/extensions/types.ts` — define event and artifact record types.
* `packages/pi-conductor/extensions/storage.ts` — append/query events and artifacts.
* `packages/pi-conductor/extensions/status.ts` — render concise and detailed event/artifact views.
* `packages/pi-conductor/__tests__/storage.test.ts` — cover append-only event/artifact persistence.
* `packages/pi-conductor/__tests__/status.test.ts` — cover concise/detail rendering.

### FR-9: Gates for review, approval, input, and bounded autonomy

Conductor must represent gates as durable resources. Supported gate types must include at least `needs_input`, `needs_review`, `approval_required`, and `ready_for_pr`. Parent Pi, child workers, or conductor policies can create gates. Parent Pi or the human can resolve gates through tools or slash commands.

High-stakes operations such as destructive cleanup and PR creation must require gates by default. The first version may implement policy as explicit tool parameters or conservative defaults rather than a full policy engine. Worker/resource deletion must distinguish soft deletion from hard cleanup: soft deletion hides or archives the resource while preserving events/artifacts; hard cleanup may remove worktree/session/branch resources only after an approved `destructive_cleanup` gate or test-only bypass policy.

**Acceptance criteria:**

```gherkin
Given a child worker cannot proceed without a product decision
When it creates a needs_input gate for task "task-api-shape-1"
Then conductor marks the task blocked
  And the gate appears in conductor_get_task and conductor_get_gates
```

```gherkin
Given task "task-add-ledger-1" has a ready_for_pr gate
When the parent Pi resolves the gate as approved
Then conductor records the resolution event
  And PR creation can proceed for the associated worker/task evidence
```

```gherkin
Given worker "backend" has a worktree, branch, session file, events, and artifacts
When the parent Pi requests hard cleanup without an approved destructive_cleanup gate
Then conductor rejects the cleanup
  And preserves the worker, worktree, branch, session file, events, and artifacts
```

**Files:**

* `packages/pi-conductor/extensions/types.ts` — define gate types and statuses.
* `packages/pi-conductor/extensions/storage.ts` — create/resolve/query gates.
* `packages/pi-conductor/extensions/conductor.ts` — gate-aware task/run/PR operations.
* `packages/pi-conductor/extensions/index.ts` — register gate tools.
* `packages/pi-conductor/__tests__/lifecycle.test.ts` — cover gate-driven task blocking/unblocking.

### FR-10: Reconciliation, leases, and stale-run recovery

Conductor must provide reconciliation that compares desired conductor state against actual worktrees, session files, worker health, active runs, backend handles, leases/heartbeats, and gate/task state. It must surface drift as healthy, stale, broken, interrupted, or recoverable without inventing successful outcomes.

The native backend and `pi-subagents` backend may use different heartbeat/lease sources, but conductor must expose a consistent reconciliation result.

Minimum first lease policy: every run stores `leaseStartedAt`, `leaseExpiresAt`, and optional `lastHeartbeatAt`. Native foreground runs acquire a lease before prompting and clear or terminalize the lease on completion; they do not require a background daemon. Async backends must update `lastHeartbeatAt` when backend progress/control events are observed. If `leaseExpiresAt` passes without terminal run state, reconciliation marks the run `stale`, leaves the task not completed, and opens a review/recovery gate unless policy says to mark it `interrupted`.

**Acceptance criteria:**

```gherkin
Given a run is marked running with leaseExpiresAt in the past and no terminal completion report
When conductor_reconcile runs
Then the run becomes stale
  And the task is not marked complete
  And a recovery or review gate is opened
  And a reconciliation event explains the state change
```

```gherkin
Given a worker session file is missing
When conductor_reconcile runs
Then the worker is marked broken/recoverable
  And tasks assigned to that worker are not automatically failed unless policy explicitly says so
```

**Files:**

* `packages/pi-conductor/extensions/conductor.ts` — implement reconciliation entrypoint.
* `packages/pi-conductor/extensions/storage.ts` — store leases/heartbeat timestamps and recovery events.
* `packages/pi-conductor/extensions/runtime.ts` — provide backend status checks where available.
* `packages/pi-conductor/extensions/status.ts` — render reconciliation findings.
* `packages/pi-conductor/__tests__/recovery.test.ts` — cover worker/resource drift.
* `packages/pi-conductor/__tests__/run-flow.test.ts` — cover stale/interrupted run handling.

### FR-11: Task-aware PR preparation

Commit, push, and PR creation must remain available, but PR state should attach to task/run/artifact evidence rather than only the latest worker state. Conductor should be able to explain what task(s), run(s), changed files, and artifacts justify PR readiness. PR creation must require an approved `ready_for_pr` or `approval_required` gate by default; commit and push may be modeled as preparation steps that do not publish a PR, but they must still append task-aware events and preserve partial failure state.

**Acceptance criteria:**

```gherkin
Given task "task-add-ledger-1" completed with artifact "changed-files-summary"
  And an associated ready_for_pr gate has been approved
When conductor creates a PR for the worker branch
Then the PR state links to the task id, run id, gate id, and artifact evidence
  And partial commit/push/PR failures preserve task and worker state
```

```gherkin
Given task "task-add-ledger-1" completed with artifact "changed-files-summary"
  And no ready_for_pr or approval_required gate has been approved
When conductor is asked to create a PR
Then conductor rejects PR creation
  And records an approval-required event or gate
```

**Files:**

* `packages/pi-conductor/extensions/git-pr.ts` — keep low-level git/gh helpers.
* `packages/pi-conductor/extensions/conductor.ts` — make PR prep task/run-aware.
* `packages/pi-conductor/extensions/types.ts` — extend PR metadata linkage.
* `packages/pi-conductor/__tests__/pr-flow.test.ts` — cover task-aware PR metadata.
* `packages/pi-conductor/__tests__/git-pr.test.ts` — preserve git/gh helper behavior.

### FR-12: Documentation and package-facing behavior

The package README and PRD references must describe the new agent-native control-plane model, resource-oriented tools, debug slash commands, explicit completion contract, backend selection, and the optional nature of `pi-subagents`.

**Acceptance criteria:**

```gherkin
Given a developer opens packages/pi-conductor/README.md
When they read the command and tool sections
Then the README describes conductor as agent-first durable orchestration
  And documents native vs pi-subagents backend behavior
  And no longer presents old worker-centric commands as the primary UX
```

**Files:**

* `packages/pi-conductor/README.md` — update product model, tools, commands, runtime/backends, and development notes.
* `docs/prd/PRD-006-pi-conductor-agent-native-control-plane.md` — requirements source.
* `docs/adr/ADR-*.md` — optional follow-up ADRs for backend abstraction, event ledger, and completion contract if planning determines they deserve standalone decisions.

---

## 6. Non-Functional Requirements

| Category                 | Requirement                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent-native parity**  | Every human-visible `/conductor` resource action must have an equivalent model-callable tool.                                                                              |
| **Durability**           | Accepted resource mutations must be persisted before returning success to the caller.                                                                                      |
| **Storage concurrency**  | Project JSON writes must be atomic and protected by a file lock or optimistic revision check; concurrent accepted mutations must not lose events.                          |
| **State consistency**    | Public mutation helpers must update worker/task/run/event state together or fail without partial semantic success.                                                         |
| **Safety**               | Recovery and reconciliation must never turn interrupted/unknown work into successful task completion.                                                                      |
| **Backend isolation**    | Native execution must work without `pi-subagents`; `pi-subagents` failures must not corrupt conductor state.                                                               |
| **Observability**        | Concise resource views must fit typical tool output, while detailed history remains available on demand.                                                                   |
| **Testability**          | Storage, lifecycle, backend selection, event logging, gates, child-tool availability, and reconciliation must be unit/integration testable without live model calls in CI. |
| **No terminal scraping** | Correctness must not depend on tmux, terminal output scraping, or interactive UI state.                                                                                    |

---

## 7. Risks & Assumptions

### Risks

| Risk                                                                     | Severity | Likelihood | Mitigation                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope is too large for one PRD implementation                            | High     | High       | Roll out in phases: resource model/tool surface, explicit completion, backend abstraction, events/artifacts, gates, reconciliation, docs/tests.                    |
| Task/run/worker state contradictions create confusing orchestration      | High     | Medium     | Centralize all mutations and add invariant tests for active task/run, terminal states, and worker readiness.                                                       |
| Child-side completion tools cannot be injected cleanly into all backends | High     | Medium     | Implement and test the native child-tool bridge before relying on explicit completion; unsupported backends use prompt-only contract plus `needs_review` fallback. |
| `pi-subagents` event/API surface changes                                 | Medium   | Medium     | Treat the adapter as optional, version-gate expected events/API, preserve native backend baseline, and report `backend_unavailable` for unknown contracts.         |
| Concurrent tool calls lose JSON state updates                            | High     | Medium     | Add atomic writes plus file locking or optimistic project revision checks before child tools can mutate conductor state.                                           |
| Event ledger grows too noisy or too large                                | Medium   | Medium     | Store concise structured events and artifact references; keep full session logs in Pi/backend storage rather than duplicating them.                                |
| Reconciliation repairs the wrong thing                                   | High     | Low        | Prefer report-first reconciliation for ambiguous states; require explicit recovery for destructive or lineage-changing repair.                                     |
| Agent autonomy performs risky actions without human review               | High     | Medium     | Gate PR publication/destructive cleanup by default until policy is explicit and tested.                                                                            |

### Assumptions

* Current local conductor users do not require compatibility with old command names or persisted state shapes.
* Worktrees remain the correct isolation primitive for code-changing conductor workers.
* A native child-tool bridge can be proven with Pi extension APIs before FR-5 is treated as implemented; otherwise native runs must use prompt-only completion plus `needs_review` fallback.
* `pi-subagents` can be used through an event/API surface or treated as unavailable while native execution remains the baseline.
* JSON file storage remains sufficient for the first control-plane implementation if it includes schema versioning, atomic writes, and file-lock or optimistic-revision protection; no database is required in this PRD.

---

## 8. Design Decisions

### D1: Agent-first control plane vs human CLI workflow

**Options considered:**

1. **Keep human CLI workflow primary** — lower immediate churn, but contradicts the goal that Pi/LLM drives subagents.
2. **Agent-first tools with slash command debug mirror** — aligns with Pi extension design and agent-native parity.
3. **No slash commands at all** — pure agent-native, but poor debuggability for early development.

**Decision:** Agent-first tools with `/conductor` as a resource-shaped debug mirror.

**Rationale:** The parent Pi agent is the primary orchestrator. Humans need inspection and override, not manual choreography for every worker.

**Future path:** A richer dashboard can consume the same resource APIs later. The implemented trusted human gate path already uses interactive UI to show gate context, readiness, evidence, timeline, and a review packet before approve/reject/cancel.

### D2: Break compatibility with current 0.x conductor surface

**Options considered:**

1. **Preserve old commands as aliases** — reduces churn but complicates semantics around tasks/runs.
2. **Replace old surface cleanly** — simpler mental model and tests while package is pre-adoption.

**Decision:** Replace old worker-centric command/tool names without compatibility aliases.

**Rationale:** No known user depends on the old shape, and preserving it would anchor the product to the wrong model.

### D3: Conductor-owned durability with replaceable execution backends

**Options considered:**

1. **Make native `AgentSession` the only runtime** — simplest, but misses Pi subagent ecosystem leverage.
2. **Make `pi-subagents` the state owner** — reuses execution but loses conductor’s durable worker/task/worktree control plane.
3. **Conductor-owned state plus backend adapters** — stable resource model with replaceable execution.

**Decision:** Conductor owns workers/tasks/runs/gates/events/artifacts; backends execute runs.

**Rationale:** This preserves conductor’s differentiated value while allowing `pi-subagents` and future backends to execute work.

**Future path:** Backend adapters can be added or removed without changing the parent Pi tool surface.

### D4: Explicit task completion over heuristic completion

**Options considered:**

1. **Infer task completion from process exit/final assistant text** — easy but unreliable for agent-native orchestration.
2. **Require explicit child-side completion where supported** — more setup but gives machine-readable outcomes.
3. **Human manually marks completion** — safe but defeats LLM-directed orchestration.

**Decision:** Explicit child-side completion is the preferred semantic source of truth; backend exits remain runtime signals.

**Rationale:** Agent-native execution needs explicit completion signals to avoid heuristic detection and enable reliable parent-agent decisions.

### D5: Start with local JSON storage, not a workflow database

**Options considered:**

1. **Continue project-scoped JSON storage** — consistent with current conductor and easy to test.
2. **Introduce SQLite** — better queries and append-only logs, but extra migration and dependency complexity.
3. **Adopt a workflow engine** — overkill and outside local Pi package identity.

**Decision:** Continue project-scoped JSON storage for this PRD, with storage helpers shaped so a future backend can change.

**Rationale:** The first value is product/state shape, not database sophistication. JSON is sufficient for local pre-scale usage if it is treated as a versioned state file rather than a casual cache.

**Implementation constraints:** The project record must include `schemaVersion` and monotonic `revision`; writes must use temp-file-and-rename atomicity plus either file locking or optimistic revision checks; unsupported old schemas must produce a clear reset/backup/normalization path.

**Future path:** If event volume or query needs grow, a later PRD can move storage behind a repository interface.

---

## 9. File Breakdown

| File                                                  | Change type | FR                                         | Description                                                                                                                                |
| ----------------------------------------------------- | ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/pi-conductor/extensions/types.ts`           | Modify      | FR-1, FR-4, FR-6, FR-7, FR-8, FR-9, FR-11  | Add control-plane resource types, backend metadata, task/run/gate/event/artifact states, and updated PR linkage.                           |
| `packages/pi-conductor/extensions/storage.ts`         | Modify      | FR-1, FR-4, FR-8, FR-9, FR-10              | Persist expanded project record, normalize records, centralize mutations, append events/artifacts, store leases/gates.                     |
| `packages/pi-conductor/extensions/conductor.ts`       | Modify      | FR-2, FR-4, FR-5, FR-6, FR-9, FR-10, FR-11 | Resource orchestration entrypoints, task assignment/run/progress/completion, backend selection, gates, reconciliation, task-aware PR prep. |
| `packages/pi-conductor/extensions/runtime.ts`         | Modify      | FR-5, FR-6, FR-7, FR-10                    | Backend interface, native backend adapter, task contract injection, backend status checks, optional pi-subagents adapter seam.             |
| `packages/pi-conductor/extensions/index.ts`           | Modify      | FR-2, FR-5, FR-7, FR-9                     | Register parent-agent tools, child-side tools, gate tools, and optional pi-subagents event/API integration.                                |
| `packages/pi-conductor/extensions/commands.ts`        | Modify      | FR-3                                       | Replace old worker-centric command parser with resource-shaped debug commands.                                                             |
| `packages/pi-conductor/extensions/status.ts`          | Modify      | FR-3, FR-8, FR-10                          | Render concise resource views and detailed history/reconciliation views.                                                                   |
| `packages/pi-conductor/extensions/git-pr.ts`          | Modify      | FR-11                                      | Preserve local git/gh helpers while supporting task-aware PR metadata.                                                                     |
| `packages/pi-conductor/extensions/workers.ts`         | Modify      | FR-1, FR-4                                 | Keep worker identity generation and validation aligned with resource IDs and worker readiness/health semantics.                            |
| `packages/pi-conductor/extensions/worktrees.ts`       | Modify      | FR-9, FR-10, FR-11                         | Preserve worktree isolation while adding gate-aware destructive cleanup and reconciliation behavior.                                       |
| `packages/pi-conductor/extensions/summaries.ts`       | Modify      | FR-8, FR-12                                | Reframe session summaries as artifacts/events or detailed history inputs rather than canonical task completion.                            |
| `packages/pi-conductor/extensions/project-key.ts`     | Verify      | FR-1                                       | Confirm project identity remains stable for the new schema and storage layout.                                                             |
| `packages/pi-conductor/README.md`                     | Modify      | FR-12                                      | Document agent-native model, resources, tools, commands, backends, explicit completion, and development flow.                              |
| `packages/pi-conductor/__tests__/storage.test.ts`     | Modify      | FR-1, FR-8                                 | Test expanded record shape, normalization, events, artifacts.                                                                              |
| `packages/pi-conductor/__tests__/conductor.test.ts`   | Modify      | FR-2, FR-4                                 | Test resource orchestration entrypoints and state consistency.                                                                             |
| `packages/pi-conductor/__tests__/index.test.ts`       | Modify      | FR-2, FR-5, FR-9                           | Test tool registration and schemas.                                                                                                        |
| `packages/pi-conductor/__tests__/commands.test.ts`    | Modify      | FR-3                                       | Test resource command grammar and removed aliases.                                                                                         |
| `packages/pi-conductor/__tests__/status.test.ts`      | Modify      | FR-3, FR-8, FR-10                          | Test resource/detail/reconciliation output.                                                                                                |
| `packages/pi-conductor/__tests__/runtime-run.test.ts` | Modify      | FR-5, FR-6, FR-7, FR-10                    | Test task contract construction, native backend interface behavior, adapter availability, and heartbeat/status checks.                     |
| `packages/pi-conductor/__tests__/run-flow.test.ts`    | Modify      | FR-4, FR-5, FR-7, FR-10                    | Test task run lifecycle, explicit completion, backend failure handling, and stale/interrupted runs.                                        |
| `packages/pi-conductor/__tests__/lifecycle.test.ts`   | Modify      | FR-4, FR-9                                 | Test state invariants and gate-driven blocking/unblocking.                                                                                 |
| `packages/pi-conductor/__tests__/recovery.test.ts`    | Modify      | FR-10                                      | Test reconciliation of missing worktrees, missing sessions, stale runs, and recoverable states.                                            |
| `packages/pi-conductor/__tests__/pr-flow.test.ts`     | Modify      | FR-11                                      | Test task-aware commit/push/PR metadata and partial failure preservation.                                                                  |
| `packages/pi-conductor/__tests__/git-pr.test.ts`      | Modify      | FR-11                                      | Preserve low-level git and GitHub CLI behavior.                                                                                            |
| `packages/pi-conductor/__tests__/workers.test.ts`     | Modify      | FR-1, FR-4                                 | Test worker identity and readiness/health semantics.                                                                                       |
| `packages/pi-conductor/__tests__/worktrees.test.ts`   | Modify      | FR-9, FR-10                                | Test gate-aware cleanup and worktree reconciliation behavior.                                                                              |
| `packages/pi-conductor/__tests__/summaries.test.ts`   | Modify      | FR-8, FR-12                                | Test summary behavior as evidence/history rather than semantic completion.                                                                 |
| `packages/pi-conductor/__tests__/sessions.test.ts`    | Modify      | FR-5, FR-6, FR-10                          | Test session linkage, child contract support, and reconciliation of session references.                                                    |
| `packages/pi-conductor/__tests__/cleanup.test.ts`     | Modify      | FR-9, FR-10                                | Test soft-delete/hard-cleanup policy and destructive cleanup gates.                                                                        |
| `packages/pi-conductor/__tests__/cli-e2e.test.ts`     | Modify      | FR-2, FR-3, FR-12                          | Test resource-shaped slash command mirror and tool/command parity at package level.                                                        |
| `packages/pi-conductor/__tests__/project-key.test.ts` | Verify      | FR-1                                       | Confirm project key behavior remains stable across schema replacement.                                                                     |

---

## 10. Dependencies & Constraints

* **Pi SDK / extension APIs:** implementation depends on `@mariozechner/pi-coding-agent` extension APIs for command registration, tool registration, `AgentSession`, `SessionManager`, and context access.
* **Local git repository:** conductor continues to require a git repository for worker branch/worktree isolation.
* **Local file storage:** conductor state remains project-scoped and local under `PI_CONDUCTOR_HOME` when set, otherwise `~/.pi/agent/conductor/projects/<projectKey>/`.
* **Node/TypeScript workspace:** implementation must stay compatible with the repository's TypeScript, Vitest, and Biome setup.
* **Optional `pi-subagents`:** `pi-subagents` integration must be optional. Native conductor behavior must not require `pi-subagents` to be installed or loaded.
* **GitHub CLI for PR creation:** PR creation continues to depend on `gh` and a configured remote when the PR flow is invoked.
* **No schema-breaking promise:** because `pi-conductor` is 0.x and unused, current command names and stored JSON shape can be replaced without external migration tooling; unsupported old local state still needs a clear reset/backup/normalization message.
* **No long-running daemon requirement:** this PRD should not require a separate always-on conductor daemon. Reconciliation and leases must work with Pi/tool invocation boundaries.
* **Child tool bridge proof:** native explicit-completion support depends on proving that conductor child tools can be injected into the curated `AgentSession` runtime; until proven, backend exits must fall back to `needs_review` rather than semantic completion.
* **Tool schema compatibility:** tool parameters must use concrete TypeBox schemas and avoid `Type.Unknown()` so provider JSON schema validation remains reliable.

---

## 11. Rollout Plan

1. **Define the new resource types, state enums, and transition table first.** Replace `RunRecord`/`WorkerRecord`-only assumptions with a project control-plane record and add invariant tests before changing tools.
2. **Add safe storage primitives.** Implement schema versioning, monotonic revisions, old-shape detection, atomic writes, and file-lock or optimistic-revision protection.
3. **Build resource orchestration functions.** Implement create/list/get worker/task/run/gate/artifact helpers and centralized lifecycle transitions in `conductor.ts`.
4. **Replace the parent-agent tool surface.** Register resource-oriented model-callable tools and update tests to assert schema names, descriptions, parameters, and details payloads.
5. **Reshape `/conductor` as a debug mirror.** Replace old worker-centric command parsing with resource list/detail/debug commands and concise status formatting.
6. **Prove the native child-tool bridge.** Add a tested way for native worker `AgentSession` runs to receive run-scoped conductor child tools, or explicitly mark native runs as prompt-only with `needs_review` fallback.
7. **Adapt the native runtime backend.** Introduce the backend interface, route native `AgentSession` execution through it, and inject the explicit task completion contract into worker prompts.
8. **Add child-side reporting tools.** Implement progress, artifact, gate/blocker, follow-up task, and completion tools, then ensure native runs can use them through the bridge.
9. **Add event ledger and artifact registry.** Persist append-only events and artifact references from all lifecycle, backend, gate, completion, and PR operations.
10. **Implement gates, cleanup policy, and task-aware PR preparation.** Make blocked/ready-for-review/ready-for-PR/destructive-cleanup states durable and attach PR metadata to task/run evidence.
11. **Implement reconciliation and lease handling.** Detect stale runs, missing worktrees, missing sessions, and backend drift while preserving audit history.
12. **Add optional `pi-subagents` adapter seam.** Integrate dispatch only if the safest available surface is confirmed; otherwise ship clear availability detection and `backend_unavailable` behavior.
13. **Update README and run package checks.** Document the new product model and run package-scoped lint, typecheck, and tests before PR.

---

## 12. Open Questions

| #  | Question                                                                                                                                                                  | Owner  | Due        | Status                                                                                                                                                                                                                                                           |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 | What is the safest `pi-subagents` integration surface for a conductor adapter: event bridge, prompt-template bridge, subprocess/CLI, or an upstreamed public runtime API? | feniix | 2026-04-30 | **Resolved:** Treat actual dispatch as conditional. Implement a backend adapter seam and availability/version detection first; only enable dispatch through a documented or version-gated bridge confirmed by spike/tests.                                       |
| Q2 | How exactly should conductor tools be made available inside child worker contexts for native `AgentSession` runs?                                                         | feniix | 2026-04-30 | **Resolved:** This is a blocking implementation proof. Native FR-5 support requires a tested run-scoped child-tool bridge in the child resource loader/tool registry; otherwise native runs are prompt-only and default to `needs_review`.                       |
| Q3 | Should backend process exit without explicit child completion leave the task `running`, mark it `needs_review`, or create an `unknown_completion` gate by default?        | feniix | 2026-04-30 | **Resolved:** Mark the task `needs_review`, record backend runtime status separately, and create a review gate explaining that semantic completion was not explicitly reported.                                                                                  |
| Q4 | What is the minimal lease/heartbeat model that works for both native foreground runs and async `pi-subagents` runs without a daemon?                                      | feniix | 2026-04-30 | **Resolved:** Store `leaseStartedAt`, `leaseExpiresAt`, and optional `lastHeartbeatAt`; native foreground runs acquire/clear leases during the tool call, async backends refresh heartbeat from events, and reconciliation marks expired nonterminal runs stale. |
| Q5 | Should the first implementation include a task dependency field, or defer all graph/DAG semantics until after task/run/gate primitives are stable?                        | feniix | 2026-04-30 | **Updated by implementation:** Include task dependencies, objective DAG inspection, parallelizable batches, and an explicit bounded scheduler with safe/execute policies, round-robin fairness, per-objective limits, and run capacity.                          |
| Q6 | Should old local conductor JSON files be ignored, renamed aside, or best-effort normalized during development?                                                            | feniix | 2026-04-30 | **Resolved:** No compatibility migration is required for external users, but implementation may detect old files and return a clear reset/cleanup message for developer ergonomics.                                                                              |
| Q7 | Should PR creation require an explicit gate by default?                                                                                                                   | feniix | 2026-04-30 | **Resolved:** Yes for the first bounded-autonomy slice; the parent agent or human should resolve a `ready_for_pr`/approval gate before PR creation unless tests explicitly opt out.                                                                              |

---

## 13. Related

| Issue                                                                                 | Relationship                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docs/prd/PRD-001-pi-conductor-mvp.md`                                                | Superseded predecessor: original broad conductor concept.                                       |
| `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`                       | Foundation: persistent worker/worktree/session model this PRD evolves.                          |
| `docs/prd/PRD-003-pi-conductor-single-worker-run.md`                                  | Foundation: native foreground run primitive this PRD generalizes into backend-backed task runs. |
| `docs/research/2026-04-24-pi-conductor-agent-native-control-plane-research.md`        | Prior-art research for durable workflow/control-plane and multi-agent orchestration patterns.   |
| `docs/brainstorms/2026-04-24-pi-conductor-agent-native-control-plane-requirements.md` | Source requirements: captures the full-control-plane direction and user constraints.            |
| `docs/ideation/2026-04-24-pi-conductor-agent-native-orchestration-ideation.md`        | Source ideation: explores agent-native orchestration options and rejected directions.           |
| `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md`                     | Records the canonical-state and backend-adapter architecture decision.                          |
| `docs/adr/ADR-0013-explicit-child-completion-task-outcome.md`                         | Records the explicit semantic completion and needs-review fallback decision.                    |
| `docs/adr/ADR-0014-trusted-human-approval-high-risk-gates.md`                         | Records the trusted-human-only approval boundary for high-risk gates.                           |
| `packages/pi-conductor/README.md`                                                     | Must be updated by implementation to reflect the new model.                                     |
| `packages/pi-conductor/extensions/*`                                                  | Primary implementation area.                                                                    |

---

## 14. Changelog

| Date       | Change                                                                                                                                                                                                                                           | Author |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 2026-04-24 | Initial draft                                                                                                                                                                                                                                    | feniix |
| 2026-04-24 | Marked implemented and recorded as-built scope: objectives, DAGs, scheduler policy/fairness/capacity, trusted human approval UI, granular events, locked persistence, gate hardening, evidence/readiness surfaces, and audit-preserving cleanup. | feniix |
| 2026-04-24 | Linked as-built ADRs for conductor-owned state/backends, explicit child completion, and trusted human approval gates.                                                                                                                            | feniix |
| 2026-04-24 | Linked prior-art research and organized source planning artifacts.                                                                                                                                                                               | feniix |

---

## 15. Verification (Appendix)

Post-implementation checklist:

1. From the repo root, run `npx vitest run packages/pi-conductor/__tests__` and confirm all conductor tests pass.
2. Run `npx tsc --noEmit --project packages/pi-conductor/tsconfig.json` and confirm package typechecking passes.
3. Run `npx biome ci packages/pi-conductor` and confirm package lint/format checks pass.
4. Launch `pi -e ./packages/pi-conductor/extensions/index.ts` inside this repository and confirm the tool list includes resource-oriented conductor tools.
5. In a manual Pi session, create a worker, create a task, assign it, run it with the native backend, record progress, and complete it through the explicit child-side completion path.
6. Inspect the same project through `/conductor get tasks`, `/conductor get task <task-id>`, `/conductor get run <run-id>`, and `/conductor get gates` and confirm command output mirrors tool-visible state.
7. Simulate a missing worker session file or stale run lease, run conductor reconciliation, and confirm the task is not marked successful without explicit completion.
8. If `pi-subagents` is installed, configure a worker for the `pi-subagents` backend and verify adapter availability, event capture, and failure behavior; if not installed, verify clear `backend_unavailable` reporting.
9. Complete a task that modifies files, resolve a `ready_for_pr` gate, and run commit/push/PR preparation against a test remote or mocked GitHub CLI path to confirm task/run/artifact linkage is persisted.
10. Attempt hard cleanup without a `destructive_cleanup` gate and confirm conductor rejects it without deleting worktree, branch, session file, events, or artifacts.
11. Run a concurrent mutation test or stress test that appends progress/events from multiple tool calls and confirm no accepted event is lost.
12. Run `npm run check` from the repo root; if implementation touches shared config or broad package behavior, also run `npm run test` and `npm run test:coverage`.

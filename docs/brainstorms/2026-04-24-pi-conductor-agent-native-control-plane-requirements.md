---
date: 2026-04-24
topic: pi-conductor-agent-native-control-plane
---

# pi-conductor Agent-Native Control Plane

## Problem Frame

`pi-conductor` has proven durable worker identity, isolated worktrees, persisted sessions, recovery, summaries, PR prep, and one-worker foreground execution. The next product step is not to make the human operate more worker commands. The goal is to make Pi itself able to coordinate long-lived subagents.

Because `pi-conductor` is still pre-adoption 0.x, compatibility with the current command shape is not a constraint. The product should be free to replace worker-centric commands and state fields with a cleaner agent-native control-plane model.

The target direction is a full control-plane slice: durable workers and tasks, agent-first orchestration tools, explicit child-side completion, optional `pi-subagents` execution backend, event/artifact history, review gates, and reconciliation semantics.

---

## Actors

- A1. Parent Pi agent: The orchestrating LLM that receives a user goal, decomposes work, creates tasks, assigns workers, starts runs, inspects progress, and decides next actions.
- A2. Conductor worker: A long-lived durable execution environment backed by a worktree, branch, session lineage, and optional subagent persona/backend.
- A3. Child worker agent: The LLM process/session executing a specific task for a worker and reporting progress/completion back to conductor.
- A4. Human user: The person who gives high-level goals, inspects status, resolves approval gates, and reviews outcomes when needed.
- A5. Execution backend: The runtime that actually runs worker tasks, initially native Pi `AgentSession` and optionally `pi-subagents`.

---

## Key Flows

- F1. Agent-directed delegation
  - **Trigger:** The human asks Pi to use conductor or to split work across subagents.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** Parent Pi lists existing workers/tasks, creates or updates durable tasks, assigns tasks to suitable workers, starts task runs, observes progress, and creates follow-up work if needed.
  - **Outcome:** Work is represented as durable conductor resources, not only as text in the parent chat.
  - **Covered by:** R1, R2, R3, R4, R7, R8

- F2. Worker task execution with explicit completion
  - **Trigger:** A task run starts for an assigned worker.
  - **Actors:** A2, A3, A5
  - **Steps:** Backend launches/resumes the worker context, child reads its task contract, reports progress/events/artifacts, and calls an explicit completion tool with success, partial, blocked, or failed status.
  - **Outcome:** Task outcome is machine-readable and durable; conductor does not infer completion solely from final assistant text or process exit.
  - **Covered by:** R5, R6, R8, R9, R10

- F3. Human review or approval gate
  - **Trigger:** A task reaches `needs_review`, `needs_input`, `approval_required`, or `ready_for_pr`.
  - **Actors:** A1, A4
  - **Steps:** Conductor persists a gate, exposes it via tools and `/conductor get`, parent Pi or the human resolves the gate, and dependent work resumes or stops.
  - **Outcome:** Long-lived subagent autonomy remains bounded by explicit handoff points.
  - **Covered by:** R11, R12, R13

- F4. Reconciliation and recovery
  - **Trigger:** A run crashes, a worker is stale, a worktree/session disappears, or conductor state drifts from reality.
  - **Actors:** A1, A2, A5
  - **Steps:** Conductor reconciles desired worker/task/run state against actual worktree/session/backend state, detects stale leases or broken resources, records recovery events, and either repairs safely or surfaces a gate/blocker.
  - **Outcome:** The parent agent can reason about drift and recovery through durable status instead of manual filesystem inspection.
  - **Covered by:** R14, R15, R16

---

## Requirements

**Control-plane resource model**

- R1. Conductor must expose workers, tasks, runs, artifacts, and gates as first-class durable resources that the parent Pi agent can create, read, update, list, and delete where safe.
- R2. The primary orchestration surface must be model-callable tools; slash commands are an inspection/debug mirror, not the product’s primary interface.
- R3. Existing pre-adoption worker-centric commands and state shapes may be replaced rather than preserved as compatibility aliases.
- R4. Worker state must describe execution environment readiness and health, while task state must describe work intent, assignment, progress, and outcome.

**Durable tasks and runs**

- R5. A task must have stable identity, name/title, prompt/body, lifecycle state, assigned worker, timestamps, and links to run history and artifacts.
- R6. A run must have stable identity, task linkage, worker linkage, backend linkage, start/finish timestamps, terminal status, error/blocker details, and relevant session/artifact references.
- R7. Parent Pi must be able to create a task and run it through conductor without human command choreography.
- R8. Task/run mutations must be centralized so worker state, task state, and run state cannot silently contradict each other.

**Child-side progress and completion**

- R9. Child worker agents must receive an explicit task contract containing task ID, goal, constraints, expected completion signal, and any relevant context/artifact paths.
- R10. Child worker agents must have conductor tools to report progress, emit artifacts, create blockers or follow-up tasks when allowed, and explicitly complete the task.
- R11. A task must not be considered semantically complete solely because the backend process exits or final assistant text exists; explicit completion is the preferred source of truth.

**Execution backends**

- R12. Conductor must define a backend abstraction so native Pi `AgentSession`, `pi-subagents`, and future process/tmux backends can run the same conductor task model.
- R13. The `pi-subagents` backend must be optional and adapter-based: conductor owns worker/task/run state; `pi-subagents` owns subagent execution mechanics when selected.
- R14. If `pi-subagents` is used, conductor must integrate through a documented or version-gated event/API surface and persist backend run IDs, progress, completion, and artifact references.

**Event ledger, artifacts, and observability**

- R15. Conductor must persist an append-only run/task event history for meaningful lifecycle transitions, progress updates, blockers, backend events, recovery actions, and completion reports.
- R16. Conductor must maintain an artifact/evidence registry for worker outputs such as notes, test results, changed-file summaries, logs, completion reports, and PR-readiness evidence.
- R17. Parent Pi and the human must be able to query concise current state and detailed history separately, avoiding status output that is either too thin or too noisy.

**Gates, review, and bounded autonomy**

- R18. Conductor must represent approval/review/input gates as durable resources that can be created by workers or parent Pi and resolved by the human or parent Pi when appropriate.
- R19. Worker autonomy must be bounded by explicit task contracts, completion signals, and gates; conductor must not silently proceed through high-stakes actions such as destructive cleanup or PR publication without an explicit policy decision.
- R20. PR prep remains a conductor capability but should attach to task/run/artifact evidence rather than only to a worker’s latest branch state.

**Reconciliation and safety**

- R21. Conductor must detect stale or crashed runs through persisted leases, heartbeats, backend status, or equivalent durable signals.
- R22. Conductor must reconcile desired state and actual state for workers, tasks, runs, worktrees, sessions, and backend jobs, surfacing drift as repairable status or gates.
- R23. Recovery must preserve audit history and must not invent successful task outcomes for interrupted or unknown runs.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R7.** Given a parent Pi agent receives “use conductor to implement durable tasks,” when it calls conductor tools, it can create a durable task, assign it to a worker, run it, and inspect the result without the human typing `/conductor` commands.
- AE2. **Covers R9, R10, R11.** Given a child worker completes code changes, when it finishes its work, it calls `conductor_complete_task` with status, summary, and evidence; conductor marks the task complete from that signal rather than from final chat text alone.
- AE3. **Covers R12, R13, R14.** Given a worker is configured to use `pi-subagents`, when the parent starts a task run, conductor invokes the backend adapter, records the backend run ID, observes progress/completion events, and keeps conductor task state as the canonical state.
- AE4. **Covers R18, R19.** Given a worker reaches a risky PR-publication step, when policy requires approval, conductor creates an approval gate and pauses dependent progression until the gate is resolved.
- AE5. **Covers R21, R22, R23.** Given a backend process crashes mid-run, when reconciliation runs, conductor marks the run as stale/interrupted, preserves the partial history, and does not mark the task complete.

---

## Success Criteria

- Parent Pi can coordinate conductor workers through tools without relying on human-operated slash-command choreography.
- Work is represented durably as tasks/runs/artifacts/gates rather than only as a worker’s current task string or session transcript.
- Child workers have an explicit, testable completion path.
- `pi-subagents` can be used as an execution backend without making it conductor’s state owner.
- A downstream planner can split implementation into resource model, tool surface, backend abstraction, event/artifact persistence, gate handling, and reconciliation phases without inventing product behavior.

---

## Scope Boundaries

### Deferred for later

- Sophisticated automatic scheduling, priorities, dependency optimization, or resource quotas beyond the minimal control-plane needs.
- Full multi-worker plan DAG execution if it requires complex graph scheduling beyond basic task/run/gate resources.
- Worker-to-worker freeform messaging beyond structured task events, blockers, gates, and artifacts.
- Autonomous merge or automatic PR publication policies.
- Rich TUI/dashboard views beyond enough `/conductor get`/list visibility to debug the system.

### Outside this product's identity

- Replacing `pi-subagents` as a general-purpose subagent framework.
- Becoming a cloud workflow engine like Temporal/Inngest/Hatchet.
- Treating conductor as primarily a human CLI for manually operating agents.
- Preserving pre-0.x command compatibility at the cost of a cleaner agent-native model.

---

## Key Decisions

- Agent-first, CLI-second: Conductor’s primary user is the parent Pi agent; humans inspect and resolve gates.
- Break compatibility freely: Because pi-conductor is 0.x and unused, a clean control-plane model is preferable to aliasing old commands.
- Conductor owns durability: Execution backends may run workers, but conductor owns task/run/worker/gate state.
- Explicit completion over heuristics: Backend stop reasons are runtime signals, not semantic task completion.
- Full control-plane slice: The next PRD should include tasks, completion, backend adapter, event/artifact history, gates, and reconciliation semantics, while still deferring advanced scheduling.

---

## Dependencies / Assumptions

- Pi extension tooling can expose conductor tools to both parent and child agent contexts, or planning will define a safe alternative.
- `pi-subagents` has or can provide a stable-enough event/API surface for an optional adapter; otherwise the native backend remains the baseline.
- Current pi-conductor state and command structures can be replaced without migration guarantees.
- Worktrees remain the default isolation primitive for code-changing workers.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R10][Technical] How should conductor tools be injected into child worker contexts for native and `pi-subagents` backends?
- [Affects R14][Needs research] Which `pi-subagents` integration surface should be treated as stable enough: public event bridge, tool invocation, subprocess CLI, or upstreamed API?
- [Affects R15, R16][Technical] What is the minimal durable event/artifact shape that avoids overbuilding while preserving auditability?
- [Affects R21, R22][Technical] What lease/heartbeat mechanism works for both foreground native runs and async `pi-subagents` runs?

---

## Next Steps

-> /ce-plan for structured implementation planning

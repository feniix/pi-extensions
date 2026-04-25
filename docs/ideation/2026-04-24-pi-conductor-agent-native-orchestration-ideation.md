---
date: 2026-04-24
topic: pi-conductor-agent-native-orchestration
focus: LLM-directed durable subagent orchestration for pi-conductor
mode: repo-grounded
---

# Ideation: pi-conductor Agent-Native Durable Orchestration

## Grounding Context

`pi-conductor` currently provides durable project-scoped workers with branches, worktrees, session files, runtime metadata, lifecycle, summaries, PR state, and single-worker foreground run support.

The current task model is limited to `worker.currentTask` and `worker.lastRun`; there is no durable task resource, queue, plan graph, or explicit child-side task completion contract.

Pi’s extension model favors model-callable tools, event bus communication, session persistence, and package composition. The product should be agent-first, CLI-second.

`pi-subagents` provides execution capabilities: agents, chains, parallel execution, async runs, artifacts, progress, session logs, and event bridges. It is best treated as an execution backend, not conductor’s state model.

External analogies support durable control-plane semantics: Kubernetes reconcilers/resources, Temporal workflow history/signals, LangGraph state graphs, job schedulers, and Jupyter-like persistent kernels.

The current implementation of pi-conductor is not important, we are only in a 0.x version and none is actually using pi-conductor so we should feel free to scratch already existent stuff without any qualm.

## Ranked Ideas

### 1. Agent-Native Conductor Control Plane

**Description:** Reposition conductor around model-callable tools and resources (`Worker`, `Task`, `Run`, `Artifact`, `Gate`) rather than human slash commands. `/conductor` becomes inspection/debug; parent Pi agents use tools to create, assign, run, inspect, interrupt, and recover work.

**Rationale:** Directly matches the real goal: Pi + LLM drives subagents. It also aligns with Pi docs and agent-native parity principles.

**Downsides:** Requires reworking command/tool naming and docs; may feel less familiar to humans expecting a CLI-first tool.

**Confidence:** 94%

**Complexity:** Medium

**Status:** Unexplored

### 2. First-Class Durable Task Resources

**Description:** Add `TaskRecord` and task CRUD with stable task IDs, prompt/body, assigned worker, state, timestamps, run linkage, and outcome fields. Keep worker as execution environment; task owns work intent and work state.

**Rationale:** This is the substrate almost every stronger idea depends on. It resolves the `currentTask`/`lastRun` ambiguity without jumping straight to scheduling.

**Downsides:** Introduces state consistency problems between workers, runs, and tasks unless mutations are centralized.

**Confidence:** 92%

**Complexity:** Medium

**Status:** Unexplored

### 3. Explicit Child-Side Completion Contract

**Description:** Provide worker/subagent tools such as `conductor_update_task_progress` and `conductor_complete_task`. A task is complete only when the child explicitly reports success/partial/blocked/failed with summary and artifacts, not merely when a subprocess exits or final text appears.

**Rationale:** This is the most agent-native reliability improvement. It avoids heuristic completion and gives the parent LLM structured state to reason over.

**Downsides:** Requires injecting conductor tools into child runs and deciding how to handle backends that cannot call them.

**Confidence:** 90%

**Complexity:** Medium-High

**Status:** Unexplored

### 4. pi-subagents Execution Backend Adapter

**Description:** Keep conductor as durable state/control plane, but add an optional backend that invokes `pi-subagents` through a stable event bridge or future public API. Conductor maps task/worker state to subagent params, watches progress/completion events, and indexes artifacts.

**Rationale:** Avoids rebuilding subagent execution, prompt isolation, async progress, artifacts, and agent definitions. High leverage if wrapped behind a backend interface.

**Downsides:** Current `pi-subagents` public API is mostly extension/tool/event surface, not a formally stable library API. Needs version gating or upstream collaboration.

**Confidence:** 84%

**Complexity:** Medium-High

**Status:** Unexplored

### 5. Event-Sourced Run Ledger and Artifact Registry

**Description:** Add append-only task/run events and an artifact registry for progress, tool milestones, blockers, completion reports, file summaries, test evidence, and PR readiness. Status views derive from this durable history.

**Rationale:** Gives parent agents and humans a queryable operational memory. Supports debugging, recovery, review handoffs, and future dashboards.

**Downsides:** Easy to overbuild; must start narrow and avoid duplicating Pi session logs wholesale.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 6. Desired-State Reconciler with Leases and Health

**Description:** Let the LLM declare intended resources and desired states while conductor reconciles actual worktrees/session files/runs/tasks, using leases/heartbeats to recover stuck or crashed workers safely.

**Rationale:** This is the clean path from manual commands to durable orchestration. It extends existing health reconciliation and fixes PRD-003’s stuck-running caveat.

**Downsides:** Higher architectural ambition; should likely follow first-class tasks and completion contract rather than precede them.

**Confidence:** 76%

**Complexity:** High

**Status:** Unexplored

### 7. Review/Approval Gates as Control-Plane Objects

**Description:** Model `needs_review`, `needs_input`, `approval_required`, and `ready_for_pr` as durable gates/tasks that parent agents and humans can resolve. Workers stop at bounded handoff points rather than pursuing unlimited autonomy.

**Rationale:** Provides safety and product clarity for LLM-directed subagents. It keeps autonomy bounded while enabling real orchestration.

**Downsides:** Requires deciding where human interaction belongs in Pi’s UI/tool/event model; may be premature before task resources exist.

**Confidence:** 72%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| #  | Idea                                        | Reason Rejected                                                                                              |
| :- | :------------------------------------------ | :----------------------------------------------------------------------------------------------------------- |
| 1  | Worker mailboxes                            | Useful but largely covered by task events, progress, blockers, and gates.                                    |
| 2  | Executable orchestration graphs / Plan DAGs | Strong future direction, but too large before durable tasks and completion contract.                         |
| 3  | Auto-provisioned lifecycle choreography     | Good UX variant, but not a foundation; depends on agent-native tools and task resources.                     |
| 4  | Remove ambient chat context                 | Important design constraint; better captured as part of completion/backend contract than standalone feature. |
| 5  | Single-worker task queue                    | Narrow bridge, but task resources + explicit run tools are more fundamental.                                 |
| 6  | Score-and-cue metaphor                      | Good naming/metaphor, not an implementable product slice.                                                    |
| 7  | Worker kernels with replayable cells        | Interesting UX frame, but overlaps with session/run ledger and is less central to subagent orchestration.    |
| 8  | Air-traffic conflict control                | Valuable later once true parallel writes exist; premature for PRD-004.                                       |
| 9  | CI-style pipelines                          | Too workflow-shaped; better left as prompts using lower-level task/run primitives.                           |
| 10 | Priority scheduler                          | Scheduling too early; risks violating PRD-003 scope control.                                                 |
| 11 | Million-task projection                     | Useful nonfunctional check, not an idea worth selecting.                                                     |
| 12 | Self-modifying orchestration prompts        | Interesting but higher-risk and not needed for the next product step.                                        |
| 13 | No-CLI product test                         | Design principle, absorbed into agent-native control plane.                                                  |

## Scratch Checkpoints

* Raw candidates: `/var/folders/l7/gpl83h991dbfbmbr1v8860f00000gn/T//compound-engineering/ce-ideate/5f844005/raw-candidates.md`

* Survivors: `/var/folders/l7/gpl83h991dbfbmbr1v8860f00000gn/T//compound-engineering/ce-ideate/5f844005/survivors.md`

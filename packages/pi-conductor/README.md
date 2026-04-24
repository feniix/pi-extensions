# @feniix/pi-conductor

Agent-native local control plane for Pi worker orchestration.

`pi-conductor` manages durable project-scoped workers, tasks, runs, gates, artifacts, and events. It keeps conductor-owned state outside the repository, uses `@feniix/worktrees-core` for managed git worktrees, and treats execution backends as evidence sources rather than canonical state owners.

## Current capabilities

- Deterministic project-key derivation and conductor-managed project storage.
- Versioned JSON control-plane records with atomic writes, invariant validation, per-project mutation serialization, revisions, and append-only events.
- First-class durable resources:
  - `Worker`: worktree/session/runtime readiness.
  - `Task`: durable work intent, assignment, lifecycle, progress, artifacts, gates, and run history.
  - `Run`: execution attempts, backend linkage, leases, heartbeats, terminal status, summaries, and artifacts.
  - `Gate`: durable review/input/approval/destructive-cleanup decisions.
  - `Artifact`: evidence references for logs, completion reports, test results, changed files, PR evidence, and notes.
  - `Event`: transition/progress/reconciliation audit history.
- Worker git worktree creation, recovery, cleanup, and branch management via `@feniix/worktrees-core`.
- Persisted Pi session linkage through `SessionManager`.
- Native AgentSession-backed task execution with runtime-injected, run-scoped child tools:
  - `conductor_child_progress`
  - `conductor_child_create_gate`
  - `conductor_child_create_followup_task` when explicitly allowed by the parent task contract
  - `conductor_child_complete`
- Child tool calls are bound to the task/run contract, support `idempotencyKey`, and are not registered as broad parent-agent tools.
- Parent agents can explicitly grant child runs permission to create scoped follow-up tasks; this is disabled by default.
- Parent-agent task control supports safe task update, explicit cancellation, and retry without overwriting prior run history.
- Parent-agent orchestration advice is available through `conductor_next_actions`; `conductor_run_next_action` can execute safe non-human recommendations, while `conductor_project_brief`, `conductor_task_brief`, and `conductor_resource_timeline` provide markdown + structured state/history digests for LLM handoffs.
- LLM review helpers include task assessment, blocker diagnosis, objective DAG batching, safe artifact reads, and human review packet preparation.
- Objectives group related tasks above the worker/run layer so parent agents can keep multi-task goals explicit, expand them into durable task plans with `conductor_plan_objective`, and roll up linked task states with `conductor_refresh_objective_status`.
- Readiness/evidence tools can build objective/task/worker evidence bundles and evaluate task-review or PR-readiness blockers.
- Explicit semantic completion: a backend exit or final assistant message is not enough to mark a task complete. Missing child completion becomes `needs_review` with a review gate.
- Lease heartbeats and reconciliation for stale/crashed runs, including read-only dry-run previews.
- Filtered, paginated event history separate from concise status.
- Artifact refs are treated as evidence; unsafe local path traversal refs, symlink escapes, and binary local reads are rejected or diagnosed.
- Late child progress/completion after terminal runs is audited without changing terminal task state.
- Gate-protected risky operations:
  - PR creation requires an approved `ready_for_pr` gate.
  - Worker cleanup requires an approved `destructive_cleanup` gate.
- Optional `pi-subagents` backend availability inspection. Conductor remains canonical state owner, and unsupported `pi-subagents` dispatch requests fail closed without creating a run.
- Legacy worker command/tool surface remains during the transition and is considered deprecated; new resource-native model-callable tools are the primary orchestration surface.

## Command surface

Primary inspection/debug UX is the `/conductor` command group:

```text
/conductor get project|workers|worker <id-or-name>|tasks|task <task-id>|runs|run <run-id>|gates|events|artifacts
/conductor create worker <worker-name>
/conductor create task <title> <prompt>
/conductor status
/conductor history [project|worker|task|run|gate|artifact] [id] [--after N] [--limit N]
/conductor reconcile [--dry-run]
/conductor start <worker-name>
/conductor task <worker-name> <task>
/conductor resume <worker-name>
/conductor run <worker-name> <task>
/conductor state <worker-name> <lifecycle>
/conductor summarize <worker-name>
/conductor recover <worker-name>
/conductor cleanup <worker-name>
/conductor commit <worker-name> <message>
/conductor push <worker-name>
/conductor pr <worker-name> <title>
```

There is also a convenience `/conductor-status` command.

## Tool surface

Resource/control-plane tools:

- `conductor_get_project`
- `conductor_backend_status`
- `conductor_reconcile_project`
- `conductor_project_brief`
- `conductor_task_brief`
- `conductor_resource_timeline`
- `conductor_run_next_action`
- `conductor_assess_task`
- `conductor_read_artifact`
- `conductor_objective_dag`
- `conductor_prepare_human_review`
- `conductor_diagnose_blockers`
- `conductor_next_actions`
- `conductor_list_objectives`
- `conductor_get_objective`
- `conductor_create_objective`
- `conductor_update_objective`
- `conductor_refresh_objective_status`
- `conductor_plan_objective`
- `conductor_link_task_to_objective`
- `conductor_build_evidence_bundle`
- `conductor_check_readiness`
- `conductor_list_events`
- `conductor_list_artifacts`
- `conductor_list_workers`
- `conductor_list_tasks`
- `conductor_get_task`
- `conductor_list_runs`
- `conductor_list_gates`
- `conductor_create_worker`
- `conductor_create_task`
- `conductor_update_task`
- `conductor_assign_task`
- `conductor_delegate_task`
- `conductor_start_task_run`
- `conductor_run_task`
- `conductor_cancel_task_run`
- `conductor_retry_task`
- `conductor_create_gate`
- `conductor_resolve_gate`
- `conductor_cleanup_worker`
- `conductor_commit_worker`
- `conductor_push_worker`
- `conductor_create_worker_pr`

Runtime-injected child tools, available only inside native worker task runs:

- `conductor_child_progress`
- `conductor_child_create_gate`
- `conductor_child_create_followup_task` when the task contract allows it
- `conductor_child_complete`

Transition/legacy worker tools still registered for compatibility. Prefer the resource/control-plane tools above for new LLM workflows:

- `conductor_status`
- `conductor_start`
- `conductor_task_update`
- `conductor_recover`
- `conductor_summary_refresh`
- `conductor_cleanup`
- `conductor_resume`
- `conductor_run`
- `conductor_lifecycle_update`
- `conductor_commit`
- `conductor_push`
- `conductor_pr_create`

## Runtime model

`pi-conductor` does **not** supervise always-on autonomous worker agents.

Instead, it uses a narrow Pi SDK runtime seam around persisted sessions:

1. Create a worker worktree/session.
2. Create and assign durable tasks.
3. Start a durable run with a scoped task contract.
4. Execute through the native `AgentSession` backend.
5. Let the child report progress, request scoped input/review gates, and complete through scoped tools.
6. Persist artifacts/events/gates and reconcile leases safely.

The native backend uses curated tools and explicit conductor child tools. Backend status is runtime evidence, not semantic completion. If the child exits without `conductor_child_complete`, conductor records a partial run and opens a review gate.

Optional backend adapters such as `pi-subagents` may be used later, but they do not own canonical state. The current `pi-subagents` adapter reports capabilities and fails closed for dispatch until a real dispatch API is implemented.

## LLM orchestration examples

Create and plan an objective, then let conductor take the safest next step:

```text
conductor_create_objective({ title: "Ship feature", prompt: "Implement and verify the feature" })
conductor_plan_objective({ objectiveId, tasks: [{ title: "Implement", prompt: "Make the code change" }] })
conductor_next_actions({ objectiveId })
conductor_run_next_action({ objectiveId })
```

Inspect dependency scheduling for parallel-safe work:

```text
conductor_objective_dag({ objectiveId })
```

Assess a task before review or PR preparation:

```text
conductor_assess_task({ taskId, requireTestEvidence: true })
conductor_diagnose_blockers({ taskId })
conductor_prepare_human_review({ objectiveId })
```

Read bounded local artifact evidence safely:

```text
conductor_list_artifacts({ taskId })
conductor_read_artifact({ artifactId, maxBytes: 8192 })
```

Human-only approval gates such as `ready_for_pr` and `destructive_cleanup` are surfaced for review but are not safe autonomous actions.

## Development

From the repo root:

```bash
npm run typecheck
npm run test
npx biome ci packages/pi-conductor
```

Manual testing:

```bash
cd packages/pi-conductor
pi -e ./extensions/index.ts
```

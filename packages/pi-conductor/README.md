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
- Parent-agent orchestration advice is available through `conductor_next_actions`, and `conductor_project_brief` provides a markdown + structured state digest for LLM handoffs.
- Objectives group related tasks above the worker/run layer so parent agents can keep multi-task goals explicit.
- Readiness/evidence tools can build objective/task/worker evidence bundles and evaluate task-review or PR-readiness blockers.
- Explicit semantic completion: a backend exit or final assistant message is not enough to mark a task complete. Missing child completion becomes `needs_review` with a review gate.
- Lease heartbeats and reconciliation for stale/crashed runs, including read-only dry-run previews.
- Filtered, paginated event history separate from concise status.
- Artifact refs are treated as evidence and unsafe local path traversal refs are rejected.
- Late child progress/completion after terminal runs is audited without changing terminal task state.
- Gate-protected risky operations:
  - PR creation requires an approved `ready_for_pr` gate.
  - Worker cleanup requires an approved `destructive_cleanup` gate.
- Optional `pi-subagents` backend availability inspection. Conductor remains canonical state owner, and unsupported `pi-subagents` dispatch requests fail closed without creating a run.
- Legacy worker command/tool surface remains during the transition, but new model-callable tools are the primary orchestration surface.

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
- `conductor_next_actions`
- `conductor_list_objectives`
- `conductor_get_objective`
- `conductor_create_objective`
- `conductor_update_objective`
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

Transition/legacy worker tools still registered:

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

Optional backend adapters such as `pi-subagents` may be used later, but they do not own canonical state.

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

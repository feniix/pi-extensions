---
name: conductor-orchestration
description: Orchestrate multi-task pi-conductor objectives from planning through execution, review, and PR readiness. Use when the user wants conductor to coordinate autonomous development work, plan objectives, run scheduler ticks, inspect blockers, or prepare a PR from durable task/run evidence.
---

# Conductor Orchestration

Use this workflow when `pi-conductor` should coordinate work as a durable local control plane rather than a one-off command runner.

## Core principles

- Conductor-owned state is canonical: objectives, tasks, runs, gates, artifacts, and events are the source of truth.
- Natural language is enough for parent orchestration. Do not ask the user to name conductor tools, worker IDs, task IDs, or run IDs when the requested action can be inferred.
- Scheduler execution is explicit. Default to safe previews; use `policy: "execute"` only when the user wants conductor to run work.
- Child task completion must be explicit through run-scoped child tools. A backend exit is not semantic completion.
- Human approval gates are UI-only. Do not create model-callable human approval shortcuts.

## Objective workflow

1. Inspect current state:
   - `conductor_project_brief({})`
   - `conductor_next_actions({ maxActions: 5 })`
2. Create or select an objective:
   - `conductor_create_objective({ title, prompt })`
   - `conductor_list_objectives({})`
3. Plan durable tasks:
   - `conductor_plan_objective({ objectiveId, tasks })`
   - Keep task titles concrete and dependencies acyclic.
4. Inspect the DAG:
   - `conductor_objective_dag({ objectiveId })`
5. Preview scheduling safely:
   - `conductor_scheduler_tick({ objectiveId, policy: "safe", maxActions: 3 })`
6. Execute intentionally when ready:
   - Prefer `conductor_run_work({ request, tasks, mode: "auto" })` for natural-language work. Let conductor decide whether to use one worker, parallel workers, or an objective DAG.
   - Use `conductor_run_parallel_work({ tasks })` only as a lower-level primitive when the work has already been proven parallel-safe. When `runtimeMode` is omitted, it prefers supervised non-blocking `tmux` if available and returns after launch so follow-up natural-language status/cancel requests can continue in the parent session; pass `runtimeMode: "headless"` when you intentionally need to wait for completion. Interpret `details.results[].executionState` as the result discriminator: `completed` means headless work reached a terminal worker result, `launched` means a supervised run is still represented by durable conductor state, `failed_to_launch` means no active supervised run was established for that shard, and `interrupted` means parent cancellation ran.
   - `conductor_scheduler_tick({ objectiveId, policy: "execute", maxRuns: 1 })`
   - or `conductor_run_next_action({ objectiveId, policy: "execute" })`
7. Monitor evidence and blockers:
   - `conductor_task_brief({ taskId })`
   - `conductor_diagnose_blockers({ taskId })`
   - `conductor_resource_timeline({ taskId, includeArtifacts: true })`
8. Prepare review/PR readiness:
   - `conductor_assess_task({ taskId, requireTestEvidence: true })`
   - `conductor_check_readiness({ taskId, purpose: "pr_readiness" })`
   - `conductor_prepare_human_review({ taskId })`
9. Route human gates through trusted UI:
   - `/conductor human dashboard`

## Recovery workflow

- For natural-language stop/cancel/escape requests, call `conductor_cancel_active_work({ reason })`; do not ask the user to supply run IDs.
- Use `conductor_reconcile_project({ dryRun: true })` before mutating recovery state.
- If leases are stale or worker state drifted, use `conductor_reconcile_project({ dryRun: false })`.
- Use `conductor_recover_worker({ name })` for broken worker session linkage.
- Preserve audit history; do not delete or rewrite conductor state to hide failed attempts.

## Output style

Report the current objective/task IDs, what conductor believes is runnable, and the exact next tool call. Distinguish safe previews from execution.

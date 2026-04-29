# @feniix/pi-conductor

Agent-native local control plane for Pi worker orchestration.

`pi-conductor` manages durable project-scoped workers, tasks, runs, gates, artifacts, and events. It keeps conductor-owned state outside the repository, uses `@feniix/worktrees-core` for managed git worktrees, and treats execution backends as evidence sources rather than canonical state owners.

## Current capabilities

- Deterministic project-key derivation and conductor-managed project storage.
- Versioned JSON control-plane records with atomic writes, invariant validation, per-project mutation serialization, file-locked persistence, revisions, and append-only events validated on read/write.
- First-class durable resources:
  - `Worker`: worktree/session/runtime readiness.
  - `Task`: durable work intent, assignment, lifecycle, progress, artifacts, gates, and run history.
  - `Run`: execution attempts, backend linkage, leases, heartbeats, terminal status, summaries, and artifacts.
  - `Gate`: durable review/input/approval/destructive-cleanup decisions.
  - `Artifact`: evidence references for logs, completion reports, test results, changed files, PR evidence, and notes.
  - `Event`: transition/progress/reconciliation audit history.
- Worker git worktree creation, recovery, cleanup, and branch management via `@feniix/worktrees-core`; destructive cleanup archives worker identity for historical task/run/gate/artifact refs while removing active worktree/session/branch resources.
- Persisted Pi session linkage through `SessionManager`.
- Native AgentSession-backed task execution with runtime-injected, run-scoped child tools:
  - `conductor_child_progress`
  - `conductor_child_create_gate`
  - `conductor_child_create_followup_task` when explicitly allowed by the parent task contract
  - `conductor_child_complete`
- Child tool calls are bound to the task/run contract, support `idempotencyKey`, and are not registered as broad parent-agent tools.
- Parent agents can explicitly grant child runs permission to create scoped follow-up tasks; this is disabled by default.
- Parent-agent task control supports safe task update, explicit cancellation, and retry without overwriting prior run history.
- Natural-language orchestration can create/reuse workers, create/assign tasks, run parallel work inside one foreground abort boundary, and cancel owned runs/tasks when the parent operation is interrupted.
- Parent-agent orchestration advice is available through `conductor_next_actions`; `conductor_run_next_action` and `conductor_scheduler_tick` execute only policy-allowed non-human recommendations, while `conductor_project_brief`, `conductor_task_brief`, and `conductor_resource_timeline` provide markdown + structured state/history digests for LLM handoffs. Completed/failed task briefs include bounded terminal summaries/errors so agents can summarize finished work without reading storage internals. Parallel work responses include per-task IDs, worker/run IDs, status, progress, completion previews, and follow-up tool calls.
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
- Optional `pi-subagents` backend detection. Conductor remains canonical state owner; `pi-subagents` dispatch fails closed unless a trusted host injects an explicit dispatcher.
- Granular instrumentation events for scheduler ticks/actions, backend dispatch, worker recovery/cleanup, git commit/push, PR creation, gates, runs, tasks, objectives, artifacts, and lifecycle changes.
- Only resource-native control-plane tools are available.
- Packaged workflow skills help parent agents use conductor safely for objective orchestration and gate review.

## Command surface

Primary inspection/debug UX is the `/conductor` command group:

```text
/conductor get project|workers|worker <id-or-name>|tasks|task <task-id>|runs|run <run-id>|gates|events|artifacts
/conductor create worker <worker-name>
/conductor create task <title> <prompt>
/conductor status
/conductor history [project|worker|task|run|gate|artifact] [id] [--after N] [--limit N]
/conductor reconcile [--dry-run]
/conductor human gates [reason]
/conductor human dashboard
/conductor human approve gate <gate-id> [reason]
/conductor human decide gate <gate-id> [reason]
```

Slash commands are for inspection, reconciliation previews, and trusted human gate decisions. Use the resource/model tools for mutations.

## Tool surface

Resource/control-plane tools:

- `conductor_get_project`
- `conductor_backend_status`
- `conductor_reconcile_project`
- `conductor_project_brief`
- `conductor_task_brief`
- `conductor_resource_timeline`
- `conductor_run_work`
- `conductor_run_parallel_work`
- `conductor_view_active_workers`
- `conductor_cancel_active_work`
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
- `conductor_recover_worker`
- `conductor_cleanup_worker`
- `conductor_commit_worker`
- `conductor_push_worker`
- `conductor_create_worker_pr`

Packaged skills:

- `conductor-orchestration` — plan, schedule, execute, monitor, and review durable conductor objectives.
- `conductor-gate-review` — inspect gate evidence/readiness and route high-risk decisions through trusted human UI.

Runtime-injected child tools, available only inside native worker task runs:

- `conductor_child_progress`
- `conductor_child_create_gate`
- `conductor_child_create_followup_task` when the task contract allows it
- `conductor_child_complete`

Worker mutation shortcuts are not part of the command surface.

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

Optional backend adapters such as `pi-subagents` may be used later, but they do not own canonical state. The current `pi-subagents` adapter fails closed unless a trusted host injects an explicit dispatcher; injected dispatch records backend run evidence through `backend.dispatch_*` events while conductor owns task/run state.

### Supervised visible runtime

Run tools accept `runtimeMode: "headless" | "tmux" | "iterm-tmux"`. `headless` runs in-process and waits for completion. `tmux` launches the conductor runner in a private tmux session and records the attach command, runtime log path, heartbeat, diagnostics, and cleanup state on the durable run. `iterm-tmux` uses the same tmux control plane and best-effort opens iTerm2 as a viewer on macOS; if iTerm2 is unavailable or launch fails, the tmux run remains active and status output shows a warning plus the manual read-only attach command.

Default runtime selection depends on the entry point. `conductor_run_work` stays conservative and defaults ordinary work to `headless` unless the request clearly asks to show/watch/open workers or an explicit `runtimeMode` is provided. Direct `conductor_run_parallel_work` is a lower-level parallel-safe primitive; when its `runtimeMode` is omitted, it prefers non-blocking `tmux` if tmux is available so the parent session can keep accepting natural-language inspection/cancel requests after launch, and falls back to blocking `headless` when tmux is unavailable. Pass `runtimeMode: "headless"` to `conductor_run_parallel_work` when the caller needs the old wait-for-completion behavior.

Compatibility note: older direct parallel-work callers that omitted `runtimeMode` and expected the tool call to return only after completion should now pass `runtimeMode: "headless"`. The omitted-runtime default is intentionally host-sensitive: machines with tmux get supervised launch-and-return behavior, while machines without tmux continue to run headless. Programmatic callers should inspect each result's `executionState` rather than treating `result.status: "success"` as semantic task completion.

Programmatic callers should inspect `details.taskResults` for per-task IDs and handoff context. Each entry includes task/worker/run identifiers, task state, run status, bounded latest-progress/completion/error previews, launch-error diagnostics, missing-task markers, and purpose-tagged `nextToolCalls` such as `conductor_task_brief`, `conductor_resource_timeline`, `conductor_retry_task`, or `conductor_cancel_task_run` so parent agents can report outcomes and choose follow-up actions without immediately listing tasks again.

`conductor_run_parallel_work` result states distinguish launch from completion:

| `executionState` | Meaning |
| ---------------- | ------- |
| `completed` | Headless execution finished and `result.status` describes the terminal worker outcome. |
| `launched` | A supervised tmux/iTerm-backed run launched successfully and remains represented by durable conductor run state. Inspect `runtimeRuns`, `conductor_project_brief`, or `conductor_list_runs` for current status. |
| `failed_to_launch` | A supervised non-headless shard failed before conductor could establish an active run. |
| `interrupted` | Parent orchestration was interrupted and conductor attempted to cancel owned runs/tasks. |

Use conductor status tools rather than typing into worker panes to supervise work. Active visible runs can be inspected with `conductor_view_active_workers`, optionally scoped by `taskId`, `workerId`, or `runId`. The response includes worker names, task titles, run IDs, runtime/viewer status, attach commands, log-tail commands, latest progress, diagnostics, and cancel tool calls.

Active visible runs include:

- `viewer=<opened|warning|unavailable|pending>` and `viewerCommand="tmux ... attach-session -r ..."`
- `log=<path-or-ref>` and the latest runtime diagnostic/heartbeat
- `cancel=conductor_cancel_task_run({"runId":"...","reason":"<reason>"})`

`conductor_backend_status` reports tmux startability separately from iTerm2 viewer availability. Explicit visible runtime requests fail closed when tmux is unavailable; iTerm2 viewer failures degrade to tmux-only supervision.

For inspection-only requests, call status/list tools instead of `conductor_run_work`. Phrases such as “show current workers”, “show run status”, “inspect current run”, “open current run output”, and “watch current worker status” are treated as status-only guidance, not as permission to launch visible worker execution. Passing `runtimeMode` only selects a runtime after the request is clearly execution/planning work; it does not turn status-only text into new work. If a user actually wants new visible work, make the execution intent explicit, for example “run these shards in parallel and show me the workers” with `runtimeMode: "tmux" | "iterm-tmux"` when direct runtime selection is needed.

## Workflow recipes

### Plan and execute an objective

Create and plan an objective, inspect the dependency graph, preview safe scheduler decisions, then execute intentionally:

```text
conductor_create_objective({ title: "Ship feature", prompt: "Implement and verify the feature" })
conductor_plan_objective({ objectiveId, tasks: [{ title: "Implement", prompt: "Make the code change" }] })
conductor_next_actions({ objectiveId })
conductor_run_next_action({ objectiveId, policy: "execute" })
conductor_scheduler_tick({ objectiveId, maxActions: 1, policy: "safe" })
conductor_scheduler_tick({ maxActions: 4, maxRuns: 2, fairness: "round_robin", perObjectiveLimit: 1, policy: "execute" })
conductor_schedule_objective({ objectiveId, maxConcurrency: 2, policy: "safe" })
```

### Run work from natural language

When a parent agent receives a normal user request, it should call the high-level work router instead of asking the user for worker IDs, task IDs, run IDs, or exact conductor tool names. `conductor_run_work` decides whether to keep the work in one worker, fan out independent shards, or create an objective DAG for dependent work:

```text
conductor_run_work({
  request: "Deep dive pi-conductor maintainability and verify it",
  maxWorkers: 3,
  tasks: [
    { title: "Runtime review", prompt: "Inspect runtime/session behavior", writeScope: ["extensions/runtime.ts"] },
    { title: "Tool review", prompt: "Inspect conductor tool ergonomics", writeScope: ["extensions/tools/"] },
    { title: "Test review", prompt: "Inspect useful test coverage", writeScope: ["__tests__/"] }
  ]
})
```

The router is conservative. It splits only when work items are independent, have distinct scopes, and the request implies parallelism. It stays single-worker for small work, overlapping write scopes, or coherent refactors. It uses objective planning when candidate tasks declare dependencies.

Runtime mode selection is also conservative. Explicit `runtimeMode` wins. If omitted, normal work defaults to `headless`, while unambiguous execution requests such as “run these shards in parallel and show/watch/open the workers” infer `iterm-tmux`. Status-only phrases such as “show me current workers” do not infer visible execution; use status/list tools for inspection. Inferred visible runs still fail closed when tmux is unavailable and return runtime summaries with viewer/log/cancel details when runs are created.

`conductor_run_parallel_work` remains the lower-level primitive for callers that already made a parallel-safe decision. Omitting `runtimeMode` launches supervised tmux workers when available and returns after launch; the durable runs continue in conductor state and can be inspected or canceled by follow-up natural-language requests:

```text
conductor_run_parallel_work({
  tasks: [
    { title: "Backend shard", prompt: "Implement and verify the backend changes" },
    { title: "Tests shard", prompt: "Add focused regression tests and report evidence" }
  ]
})
conductor_project_brief({ maxActions: 10, recentEventLimit: 20 })
conductor_list_runs({ status: "running" })
```

For blocking completion semantics, request headless explicitly:

```text
conductor_run_parallel_work({
  runtimeMode: "headless",
  tasks: [
    { title: "Backend shard", prompt: "Implement and verify the backend changes" },
    { title: "Tests shard", prompt: "Add focused regression tests and report evidence" }
  ]
})
```

If the user interrupts or asks in natural language to stop conductor work, use `conductor_cancel_active_work({ reason: "user requested stop" })`. It cancels active runs and conductor-owned queued tasks without requiring run IDs.

### Local visible-runtime smoke

The package test suite includes a low-level real-tmux lifecycle smoke that skips when `tmux` is not installed. It verifies the terminal primitive used by visible supervision; the full conductor-visible runtime checklist remains the manual smoke below. On a machine with tmux, run:

```bash
npx vitest run packages/pi-conductor/__tests__/package-smoke.test.ts packages/pi-conductor/__tests__/work-runtime-selection.test.ts
```

Then perform a conductor-level smoke in an isolated `PI_CONDUCTOR_HOME`:

1. Start visible parallel work with an explicit or inferred visible runtime request.
2. Confirm the tool details include `runtimeMode`, `runtimeRuns`, `viewerCommand`, `logPath`, diagnostics/progress, and a cancellation affordance.
3. Attach read-only with the reported tmux command, or confirm iTerm2 opens as a best-effort viewer on macOS.
4. Cancel with `conductor_cancel_active_work({ reason: "smoke cleanup" })` or the returned `cancelTool` for a specific active run.
5. Verify tmux sessions are gone, run/task state is terminal, logs remain under conductor storage, and reconciliation does not resurrect terminal runs or invent success.

### Inspect dependency scheduling for parallel-safe work

Use the objective DAG before dispatching multi-task work or when explaining why a task is not runnable yet:

```text
conductor_objective_dag({ objectiveId })
```

### Review a task before PR preparation

Build a compact review packet, check readiness, and gather evidence before asking a human to approve a risky operation:

```text
conductor_assess_task({ taskId, requireTestEvidence: true })
conductor_diagnose_blockers({ taskId })
conductor_prepare_human_review({ objectiveId })
```

### Read bounded local artifact evidence safely

Use artifact IDs/refs from evidence bundles or timelines; conductor rejects unsafe traversal, symlink escapes, binary reads, and unsupported refs. Task evidence is aggregate evidence: child-run progress/completion artifacts are linked to both the task and the run, and task-scoped APIs (`conductor_list_artifacts({ taskId })`, task briefs, timelines, evidence bundles, and raw task `artifactIds`) should agree on the same artifact IDs. Artifact metadata keys `root` and `worktreeRoot` are trusted only for conductor-owned system artifacts; child-run progress/completion artifacts may round-trip those metadata keys, but artifact reads ignore them as trusted roots. Child-run `note` artifacts are readable through captured progress/completion text; legacy metadata-only notes return their metadata with a diagnostic instead of an ambiguous missing-file error.

```text
conductor_list_artifacts({ taskId })
conductor_read_artifact({ artifactId, maxBytes: 8192 })
```

### Review and resolve human gates

Human-only approval gates such as `ready_for_pr` and `destructive_cleanup` are surfaced for review but are not safe autonomous actions. The model-facing `conductor_resolve_gate` tool resolves only as a parent agent. Trusted human decisions come through the interactive host/UI commands `/conductor human dashboard`, `/conductor human gates`, or `/conductor human decide gate <gate-id> [reason]`.

Prefer the persistent dashboard when multiple gates may need review:

```text
/conductor human dashboard
```

The dashboard keeps the gate queue open across decisions, refreshes after each approval/rejection, shows the selected gate's readiness, blockers, warnings, artifacts, recent timeline, and review packet preview, and then opens the full approval dashboard for approve/reject/cancel. Hosts with custom UI support get keyboard navigation; other interactive hosts fall back to standard select/editor/input dialogs.

For non-UI automation, inspect gates and evidence without approving as a human:

```text
conductor_list_gates({ status: "open" })
conductor_prepare_human_review({ taskId })
conductor_check_readiness({ taskId, purpose: "pr_readiness" })
conductor_build_evidence_bundle({ taskId, includeEvents: true })
conductor_resource_timeline({ taskId, includeArtifacts: true })
```

Trusted high-risk approval still requires the interactive human command path.

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

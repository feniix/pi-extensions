# @feniix/pi-conductor

Long-lived multi-session worker orchestration for Pi.

## Status

Implemented for the `pi-extensions` workspace, based on:
- `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
- `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
- `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
- `docs/adr/ADR-0002-conductor-project-scoped-storage.md`
- `docs/adr/ADR-0003-continuity-based-worktree-reuse.md`
- `docs/adr/ADR-0004-minimal-conductor-local-git-gh-layer.md`
- `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`
- `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`
- `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`

PRD-001 remains in the repo as the original design document and is now superseded.

## Current capabilities

`pi-conductor` currently provides:
- deterministic project-key derivation
- conductor-managed project storage
- one worker record per named workstream
- worker git worktree creation and recovery
- real persisted Pi session linkage
- a SessionManager-backed runtime boundary for worker creation, resume, recovery, and summary refresh
- AgentSession-based foreground worker execution through `/conductor run <worker-name> <task>`
- persisted runtime metadata (`sessionId`, `lastResumedAt`, backend)
- persisted per-worker `lastRun` metadata for started/completed/error/aborted runs
- explicit worker resume against persisted worktree/session metadata
- task updates, run-aware task mutation, and session-derived summaries
- lifecycle controls for `idle`, `running`, `blocked`, `ready_for_pr`, and `done`
- health-aware status output distinguishing healthy, stale, and broken workers
- status output that includes worktree path, session file, runtime metadata, and last-run state
- broken-state detection and targeted recovery
- targeted worker cleanup
- minimal PR preparation flow:
  - commit
  - push
  - create PR
  - explicit preflight checks for remote and `gh`
  - persist partial success/failure state

## Command surface

Primary operator UX is the `/conductor` command group:

```text
/conductor status
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

Registered tools:
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
- create a worker session when a worker is created
- reopen that session on `/conductor resume`
- run one foreground task in the existing worker session lineage via `/conductor run`
- record runtime metadata and last-run outcome in conductor state
- derive summaries from the worker session history

`/conductor run` is intentionally synchronous foreground execution. It runs one task in one existing worker, waits for completion, persists the outcome, and returns. It is not a background scheduler, daemon, or multi-worker orchestrator.

Worker runs use a curated non-interactive execution surface rather than broad ambient inheritance. The run path performs best-effort model/provider preflight before the worker is persisted as `running`, reuses the worker worktree and session file, and records:
- `success`
- `error`
- `aborted`
- or an intentionally preserved in-progress/stuck signal when a process dies mid-run (`lifecycle=running` with `lastRun.finishedAt=null`)

In this package, `/conductor resume` still intentionally normalizes the worker lifecycle back to `idle`. Resume means “reopen and relink the persisted worker session”, not “reattach to an always-running autonomous worker”.

This keeps the worker model durable today while leaving room for future multi-worker or subprocess-backed backends.

## Development

From the repo root:

```bash
npm run typecheck
npm run test
```

Manual testing:

```bash
cd packages/pi-conductor
pi -e ./extensions/index.ts
```

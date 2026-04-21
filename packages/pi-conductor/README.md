# @feniix/pi-conductor

Long-lived multi-session worker orchestration for Pi.

## Status

Implemented MVP for the `pi-extensions` workspace, based on:
- `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`
- `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
- `docs/adr/ADR-0002-conductor-project-scoped-storage.md`
- `docs/adr/ADR-0003-continuity-based-worktree-reuse.md`
- `docs/adr/ADR-0004-minimal-conductor-local-git-gh-layer.md`

PRD-001 remains in the repo as the original design document and is now superseded.

## Current capabilities

`pi-conductor` currently provides:
- deterministic project-key derivation
- conductor-managed project storage
- one worker record per named workstream
- worker git worktree creation and recovery
- real persisted Pi session linkage
- a SessionManager-backed runtime boundary for worker creation, resume, recovery, and summary refresh
- persisted runtime metadata (`sessionId`, `lastResumedAt`, backend)
- explicit worker resume against persisted worktree/session metadata
- task updates and session-derived summaries
- lifecycle controls for `idle`, `running`, `blocked`, `ready_for_pr`, and `done`
- health-aware status output distinguishing healthy, stale, and broken workers
- status output that includes worktree path, session file, and runtime metadata
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
- `conductor_lifecycle_update`
- `conductor_commit`
- `conductor_push`
- `conductor_pr_create`

## Runtime model

The current MVP does **not** supervise always-on autonomous worker agents.

Instead, it uses a narrow Pi SDK runtime seam around persisted sessions:
- create a worker session when a worker is created
- reopen that session on `/conductor resume`
- record runtime metadata in conductor state
- derive summaries from the worker session history

In this MVP, `/conductor resume` intentionally normalizes the worker lifecycle back to `idle`. Resume currently means “reopen and relink the persisted worker session”, not “reattach to an always-running autonomous worker”.

This keeps the worker model durable today while leaving room for a future `AgentSession`-managed or subprocess-backed subagent backend.

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

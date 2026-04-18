# @feniix/pi-conductor

Long-lived multi-session worker orchestration for Pi.

## Status

MVP implementation for the `pi-extensions` workspace, based on:
- `docs/prd/PRD-001-pi-conductor-mvp.md`
- `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
- `docs/adr/ADR-0002-conductor-project-scoped-storage.md`
- `docs/adr/ADR-0003-continuity-based-worktree-reuse.md`
- `docs/adr/ADR-0004-minimal-conductor-local-git-gh-layer.md`

## Current capabilities

`pi-conductor` currently provides:
- deterministic project-key derivation
- conductor-managed project storage
- one worker record per named workstream
- worker git worktree creation and recovery
- real persisted Pi session linkage
- explicit worker resume against persisted worktree/session metadata
- task updates and session-derived summaries
- lifecycle controls for `idle`, `running`, `blocked`, `ready_for_pr`, and `done`
- health-aware status output distinguishing healthy, stale, and broken workers
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

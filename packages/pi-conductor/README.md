# @feniix/pi-conductor

Long-lived multi-session worker orchestration for pi.

## Status

Early scaffold based on:
- `docs/prd/PRD-001-pi-conductor-mvp.md`
- `docs/adr/ADR-0001-sdk-first-worker-runtime.md`
- `docs/adr/ADR-0002-conductor-project-scoped-storage.md`
- `docs/adr/ADR-0003-continuity-based-worktree-reuse.md`
- `docs/adr/ADR-0004-minimal-conductor-local-git-gh-layer.md`

## Current capabilities

This initial implementation scaffold currently provides:
- conductor project-key derivation
- conductor storage root resolution
- worker/run state types
- a minimal `/conductor-status` command
- a `conductor_status` tool for inspecting the current conductor project namespace

## Planned next steps

- worker creation and persistence
- worktree management
- real Pi session linkage
- task updates
- recovery flows
- PR preparation

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

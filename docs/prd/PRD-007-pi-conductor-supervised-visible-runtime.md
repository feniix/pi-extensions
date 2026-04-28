---
title: "pi-conductor — supervised visible runtime"
prd: PRD-007
status: Implemented
owner: "feniix"
issue: "https://github.com/feniix/pi-extensions/issues/63"
date: 2026-04-27
version: "0.1"
---

# PRD: pi-conductor — supervised visible runtime

## 1. Problem & Context

`pi-conductor` can now route natural-language work, start durable workers/tasks/runs, cancel active conductor-owned work, and persist enough evidence to recover from failed or interrupted orchestration. The current native runtime is intentionally headless: the parent process creates an `AgentSession`, injects scoped child tools, waits for completion, and writes conductor state.

That headless model is good for correctness, but weak for human supervision. When conductor starts multiple workers, the user cannot easily watch what each worker is doing, see live output, or keep a visual sense of which runs are still active. The next product step is to add an optional visible runtime path so a user can say:

> Run this in parallel and show me the workers.

The visible runtime must not turn into fire-and-forget terminal automation. Conductor remains the durable control plane for workers, tasks, runs, gates, artifacts, cancellation, and cleanup. A terminal window is a supervised runtime/viewer, not the source of truth.

This PRD implements issue #63 and builds on:

* `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`
* `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`
* `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md`
* `packages/pi-conductor/extensions/runtime.ts`
* `packages/pi-conductor/extensions/conductor.ts`
* `packages/pi-conductor/extensions/tools/orchestration-tools.ts`

## 2. Goals & Success Metrics

| Goal                            | Metric                                                                                            | Target                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Make active workers visible** | Conductor can run a task in a tmux-backed visible runtime and return/view attach details          | 100% of tmux-backed runs persist session/log metadata                                        |
| **Preserve conductor control**  | Natural-language and tool cancellation terminates both conductor state and the supervised runtime | 100% of canceled tmux-backed runs become terminal and release workers                        |
| **Support human supervision**   | Users can open a read-only tmux/iTerm view for active runs without naming run IDs in common flows | Parallel visible work returns clear viewer commands or opens iTerm when requested/configured |
| **Keep headless stable**        | Existing native/headless behavior remains the default and passes current tests                    | No regression to existing `native` worker runs                                               |
| **Fail closed**                 | Missing `tmux`, missing iTerm2, or launch failure leaves no misleading active run                 | Failed visible-runtime preflight records diagnostics and keeps tasks recoverable             |

**Guardrails:**

* Conductor state remains canonical; tmux/iTerm metadata is evidence and control metadata.
* iTerm2 is a viewer over tmux, not an independent backend.
* Cancellation must be conductor-driven and work for natural-language “stop all conductor work”.
* Viewer defaults should be read-only where possible; direct human intervention in a pane is out of scope for the first slice.
* Existing child completion, progress, gate, and artifact contracts must remain available for visible runs.

## 3. Users & Use Cases

### Primary: human supervising conductor work

> As a Pi user, I want conductor to open visible worker panes when it runs parallel work so that I can watch progress and stop work confidently if it goes wrong.

**Preconditions:** `tmux` is installed for visible runs. On macOS, iTerm2 may be installed for the optional viewer.

### Primary: parent Pi agent orchestrating visible work

> As the parent Pi agent, I want a natural-language path for “run this and show me the workers” so that I can choose visible execution without asking the human for worker IDs, run IDs, or terminal commands.

**Preconditions:** `pi-conductor` tools are loaded in a git repository and at least one usable model/provider is configured.

### Secondary: package maintainer debugging worker behavior

> As a package maintainer, I want persisted runtime metadata, log paths, and cleanup events so that I can inspect stuck, canceled, or failed visible runs after the fact.

## 4. Scope

### In scope

1. Runtime backend boundary that preserves the existing headless/native backend and adds a supervised tmux backend.
2. Persisted runtime metadata on run attempts: backend name, tmux session/window/pane identifiers where available, process ID or process group where available, log path, viewer command, launch status, and cleanup status.
3. A tmux-backed runner process that executes the same conductor task contract as headless runs and reports progress/completion through conductor-owned state.
4. Conductor-driven cancellation that terminates the tmux session/process group and persists aborted run/task state.
5. iTerm2 viewer support on macOS that opens read-only tmux attach panes/tabs when requested or configured.
6. Natural-language/tool ergonomics for visible work: visible runtime selection, returned viewer details, and “stop all conductor work” coverage.
7. Reconciliation for stale visible runtime metadata: missing tmux sessions, exited runner processes, and orphaned active conductor runs.
8. Tests for backend selection, persisted metadata, launch/preflight failure, cancellation cleanup, stale reconciliation, and iTerm fallback behavior.
9. README and command/status updates explaining how to supervise visible workers.

### Out of scope / later

| What                                                    | Why                                                                                                        | Tracked in |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| Direct interactive human typing into worker agent panes | Risks bypassing conductor state and tool contracts; read-only viewer is enough for first supervision slice | Future PRD |
| Always-on daemon workers                                | This is per-run supervision, not background worker infrastructure                                          | Future PRD |
| Remote terminal backends                                | Local tmux/iTerm validates the boundary first                                                              | Future PRD |
| Full dashboard UI                                       | Viewer + persisted status is enough for this slice                                                         | Future PRD |
| Replacing native/headless execution                     | Headless remains default and required for CI-safe operation                                                | N/A        |

## 5. Functional Requirements

### FR-1: Select visible runtime without disrupting headless runs

Conductor must support a runtime selection concept for task execution. The existing native `AgentSession` path remains the default headless runtime. A new supervised tmux runtime can be selected explicitly through model-callable tools, natural-language routing, config, or worker/task options.

The public naming should be understandable to users:

* `headless` — existing in-process/native AgentSession behavior.
* `tmux` — supervised visible runtime with tmux session/log metadata.
* `iterm-tmux` — tmux runtime plus iTerm2 viewer opening on macOS.

Implementation may keep `native` as an internal compatibility alias for `headless`, but user-facing docs should converge on `headless` vs `tmux`/`iterm-tmux`.

**Acceptance criteria:**

```gherkin
Given no visible runtime is requested
When conductor runs a task
Then it uses the existing headless/native runtime behavior
  And existing tests for child completion and cancellation still pass
```

```gherkin
Given visible runtime "tmux" is requested
When conductor starts a task run
Then the run record includes runtime backend "tmux"
  And the backend launch path is tmux-supervised rather than in-process headless
```

### FR-2: Persist tmux runtime metadata and logs

A tmux-backed run must persist enough metadata for later inspection, cancellation, and reconciliation. At minimum, conductor records:

* runtime backend: `tmux` or `iterm-tmux`
* tmux session name
* tmux window/pane identifiers when available
* worktree/cwd
* command line or runner entrypoint label, excluding secrets
* environment keys relevant to conductor control, excluding secret values
* log path under conductor-owned storage
* viewer command, preferably read-only attach
* launch timestamps and cleanup status

Large logs must live as artifact refs or runtime metadata paths, not inline JSON payloads.

**Acceptance criteria:**

```gherkin
Given a tmux-backed run starts
When conductor reads the run detail
Then the run contains tmux session metadata, worktree path, log path, and a read-only attach command
  And the log path is under conductor-owned storage
```

### FR-3: Execute the same task contract in a supervised runner

The tmux backend must execute a conductor-owned runner process that uses the same task contract semantics as headless runs: scoped progress, scoped gates, optional follow-up tasks, explicit child completion, and fallback review if the worker exits without explicit completion.

The runner may be a package-internal CLI/script entrypoint, but it must operate from a persisted run/task contract rather than depending on parent-process memory. This makes the tmux process restartable/reconcilable and prevents a visible pane from becoming an untracked manual session.

**Acceptance criteria:**

```gherkin
Given a tmux-backed runner starts for task T and run R
When the child reports progress or completion
Then conductor records the same task/run events and artifacts as the headless child-tool path
```

```gherkin
Given the tmux-backed worker exits without explicit completion
When conductor finalizes the run
Then the task becomes needs_review
  And a review gate explains that semantic completion was not explicitly reported
```

### FR-4: Cancel visible runs through conductor

Canceling active conductor work must stop the supervised runtime in addition to mutating conductor state. Cancellation applies to:

* `conductor_cancel_active_work`
* task/run-specific cancellation
* natural-language stop/cancel requests routed to conductor
* parent orchestration aborts/interruption

The cancellation order must be safe and auditable:

1. Identify active conductor-owned run/task/worker refs.
2. Mark or transition conductor state toward cancellation.
3. Terminate the tmux session/process group.
4. Persist terminal run/task status and cleanup evidence.
5. Record cancellation events and diagnostics.

**Acceptance criteria:**

```gherkin
Given two tmux-backed parallel runs are active
When the user asks to stop all conductor work
Then conductor terminates both tmux sessions
  And both runs become aborted
  And both tasks become canceled or otherwise terminal according to existing cancellation semantics
  And both workers return to idle or recoverable with diagnostics
```

### FR-5: Open iTerm2 as a viewer, not a backend

On macOS, conductor may open iTerm2 windows/tabs that attach to tmux sessions. iTerm2 must be treated as a viewer layer over tmux, not the runtime owner.

The default viewer should attach read-only when possible, for example by using tmux read-only attach semantics. If iTerm2 is unavailable or AppleScript/open fails, the run should continue under tmux and conductor should return a manual attach command plus a warning.

**Acceptance criteria:**

```gherkin
Given runtime "iterm-tmux" is requested on macOS with iTerm2 available
When conductor starts a tmux-backed run
Then conductor opens an iTerm2 viewer attached to the tmux session
  And the run remains controlled by tmux/conductor metadata
```

```gherkin
Given iTerm2 is unavailable
When runtime "iterm-tmux" is requested
Then conductor falls back to tmux with a clear viewer warning
  And does not fail the run solely because the viewer could not open
```

### FR-6: Make visible supervision natural-language friendly

A parent agent should not ask the user to provide tmux session names, task IDs, run IDs, or worker IDs for common visible-work flows. Natural-language requests such as “run this in parallel and show me the workers” should select a visible runtime when safe and return/open viewer details.

Tool parameters may expose explicit runtime selection for precise calls, but the parent-agent happy path should remain high level.

**Acceptance criteria:**

```gherkin
Given the user asks "run these in parallel and show me the workers"
When the parent agent calls conductor_run_work with visible runtime intent
Then conductor starts visible worker runs when safe
  And returns worker/run viewer details in the tool result
```

### FR-7: Reconcile stale or orphaned visible runtime state

Conductor reconciliation must understand tmux-backed run metadata. It should detect:

* conductor run marked active but tmux session is missing
* tmux process exited but conductor did not record terminal status
* log path missing or unreadable
* viewer failed to open while tmux run is healthy

Reconciliation must not invent success. Unknown or missing runtime evidence should produce `needs_review`, `stale`, `aborted`, or recoverable diagnostics according to existing conductor semantics.

**Acceptance criteria:**

```gherkin
Given conductor state says a tmux-backed run is active
  And the tmux session no longer exists
When conductor reconciles the project
Then the run is marked stale or needs_review with diagnostics
  And no successful task completion is invented
```

## 6. Non-Functional Requirements

* **Safety:** visible execution cannot bypass conductor cancellation and cleanup policies.
* **Portability:** headless remains available everywhere; tmux features fail clearly when `tmux` is missing; iTerm2 is macOS-only and optional.
* **Observability:** viewer details, logs, runtime metadata, and events are easy to inspect through existing conductor tools.
* **Testability:** tmux/iTerm shell integration is isolated behind adapters that can be mocked in unit tests; at least one smoke test should exercise real tmux when available.
* **Security:** do not persist secret environment values, API keys, full prompts beyond existing session behavior, or unbounded terminal logs inline.
* **Cleanup:** test-created tmux sessions, worktrees, branches, logs, and session files must be removable without manual forensics.

## 7. Risks & Assumptions

| Type       | Item                                                                                         | Mitigation / Validation                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Risk       | tmux process continues after conductor cancellation                                          | Track tmux session/process metadata, kill session/process group, and reconcile missing/leftover sessions.                                          |
| Risk       | iTerm viewer launch flakes on macOS                                                          | Treat iTerm as best-effort viewer; return attach command and warning on failure.                                                                   |
| Risk       | Child completion tools are unavailable in the runner process                                 | Share the existing task contract/tool wiring through a package runner entrypoint and test it with mocked runtime callbacks before using real tmux. |
| Risk       | Visible pane invites manual input that bypasses state                                        | Default to read-only attach and document interactive intervention as out of scope.                                                                 |
| Risk       | Log paths grow without bound                                                                 | Store logs as artifact refs with bounded reads and future retention policy hooks.                                                                  |
| Assumption | `tmux attach -r` or equivalent read-only viewing is sufficient for first-slice supervision   | Verify during local real-tmux smoke testing and document manual fallback commands.                                                                 |
| Assumption | A package-owned runner process can reconstruct task/run scope from persisted conductor state | Prove with mocked runner tests before relying on a real tmux process.                                                                              |

## 8. Design Decisions

| Decision                                        | Rationale                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| tmux is the runtime owner for visible runs      | tmux is scriptable, inspectable, cancelable, and independent of GUI availability.                        |
| iTerm2 is viewer-only                           | Prevents GUI windows from becoming an untracked execution/control plane.                                 |
| Read-only viewer by default                     | Supervision should not accidentally bypass conductor state or scoped child tools.                        |
| Headless remains default                        | Existing CI-safe and in-process execution must stay stable.                                              |
| Visible runner uses persisted task/run contract | Parent-process memory cannot be the only source of truth for a supervised terminal process.              |
| Runtime metadata lives on run attempts          | Cancellation, status, and reconciliation need direct access to runtime handles, not just event payloads. |

## 9. File Breakdown

| File                                                            | Change type | FR               | Description                                                                                            |
| --------------------------------------------------------------- | ----------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/pi-conductor/extensions/types.ts`                     | Modify      | FR-1, FR-2       | Add runtime mode names and run-level runtime metadata types.                                           |
| `packages/pi-conductor/extensions/runtime.ts`                   | Modify      | FR-1, FR-3       | Extract a runtime backend boundary around the existing headless path and shared task-contract helpers. |
| `packages/pi-conductor/extensions/tmux-runtime.ts`              | Add         | FR-2, FR-4, FR-7 | Add tmux launch, metadata, cancellation, and reconciliation adapter.                                   |
| `packages/pi-conductor/extensions/runner.ts`                    | Add         | FR-3             | Add package-owned runner entrypoint used by supervised tmux sessions.                                  |
| `packages/pi-conductor/extensions/iterm-viewer.ts`              | Add         | FR-5             | Add best-effort macOS iTerm2 viewer adapter over tmux attach.                                          |
| `packages/pi-conductor/extensions/conductor.ts`                 | Modify      | FR-1, FR-4, FR-7 | Route selected runtime modes, persist metadata, and cancel/reconcile visible runs.                     |
| `packages/pi-conductor/extensions/tools/orchestration-tools.ts` | Modify      | FR-6             | Add visible runtime selection/intent parameters and return viewer details.                             |
| `packages/pi-conductor/extensions/commands.ts`                  | Modify      | FR-5, FR-6       | Add or update resource commands for viewer/status support.                                             |
| `packages/pi-conductor/extensions/status.ts`                    | Modify      | FR-2, FR-5       | Display runtime metadata, log paths, viewer commands, and warnings.                                    |
| `packages/pi-conductor/README.md`                               | Modify      | FR-1-FR-7        | Document supervised runtime usage, requirements, cancellation, and troubleshooting.                    |
| `packages/pi-conductor/__tests__/runtime-run.test.ts`           | Modify      | FR-1, FR-3, FR-5 | Cover runtime selection, headless compatibility, task contract reuse, and iTerm fallback.              |
| `packages/pi-conductor/__tests__/tmux-runtime.test.ts`          | Add         | FR-2, FR-4, FR-7 | Cover mocked tmux launch/cancel/reconcile behavior.                                                    |
| `packages/pi-conductor/__tests__/conductor.test.ts`             | Modify      | FR-4, FR-6       | Cover natural-language visible orchestration and cancellation semantics.                               |
| `packages/pi-conductor/__tests__/recovery.test.ts`              | Modify      | FR-7             | Cover stale/missing tmux session reconciliation.                                                       |

## 10. Dependencies & Constraints

* `tmux` is required only for visible `tmux` / `iterm-tmux` runtime modes.
* iTerm2 support is macOS-only and optional; failure to open iTerm2 must not fail a healthy tmux run.
* Headless/native execution must remain available without `tmux`.
* Conductor state stays under `PI_CONDUCTOR_HOME` or `~/.pi/agent/conductor/projects`.
* No secret environment values may be persisted in runtime metadata or logs.
* Real tmux/iTerm integration must be isolated behind adapters so unit tests can mock shell/platform behavior.
* Direct human typing into a worker pane is outside this slice; viewer commands should prefer read-only attach.

## 11. Rollout Plan

1. **Backend boundary:** add runtime mode metadata and route existing headless execution through the boundary.
2. **tmux adapter:** implement mocked tmux launch/cancel/reconcile behavior and persist runtime metadata.
3. **runner contract:** wire a separate runner process to the existing task contract and child reporting semantics.
4. **viewer polish:** add iTerm2 viewer fallback and expose viewer details in status/tool results.
5. **natural-language ergonomics:** route “show/watch/supervise/open terminals” requests to visible runtime selection when safe.
6. **smoke and docs:** run real-tmux manual smoke, update README, and document cleanup/recovery.

## 12. Open Questions

| # | Question                                                                                             | Default for first implementation                                              | Owner          | Due             | Status |
| - | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- | --------------- | ------ |
| 1 | Should visible runtime be opt-in per tool call only, or also configurable as a project/user default? | Start opt-in/tool-call first; add config only if usage demands it.            | Implementation | Before U6       | Open   |
| 2 | Should the first implementation expose a separate `conductor_view_run` tool/command?                 | Include viewer details in run/status output first; add reopen tool if needed. | Implementation | Before U5       | Open   |
| 3 | How much of the runner entrypoint should be public CLI versus internal package seam?                 | Keep it internal unless manual debugging needs a public command.              | Implementation | Before U4       | Open   |
| 4 | Should real-tmux smoke tests run in CI when `tmux` is available?                                     | Add skip-when-missing smoke; decide CI enablement after local stability.      | Implementation | Before final PR | Open   |

## 13. Related

* Issue: <https://github.com/feniix/pi-extensions/issues/63>
* ADR: `docs/adr/ADR-0015-supervised-tmux-visible-runtime.md`
* Prior ADR: `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`
* Prior ADR: `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`
* Prior ADR: `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md`
* Plan: `docs/plans/2026-04-27-001-feat-conductor-supervised-runtime-plan.md`

## 14. Changelog

| Date       | Version | Author | Change                                                   |
| ---------- | ------- | ------ | -------------------------------------------------------- |
| 2026-04-27 | 0.1     | pi     | Initial draft for supervised tmux/iTerm visible runtime. |

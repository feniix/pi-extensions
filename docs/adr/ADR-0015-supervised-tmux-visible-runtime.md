---
title: "Supervised tmux runtime with optional iTerm2 viewer"
adr: ADR-0015
status: Proposed
date: 2026-04-27
prd: "PRD-007-pi-conductor-supervised-visible-runtime"
decision: "Use tmux as the supervised visible runtime backend and treat iTerm2 as an optional read-only viewer over tmux while conductor remains canonical state owner"
---

# ADR-0015: Supervised tmux runtime with optional iTerm2 viewer

## Status

Proposed

## Date

2026-04-27

## Requirement Source

* **PRD**: `docs/prd/PRD-007-pi-conductor-supervised-visible-runtime.md`
* **Issue**: <https://github.com/feniix/pi-extensions/issues/63>
* **Decision Point**: Users need to see and supervise active conductor workers without losing conductor-owned cancellation, gates, persisted state, and recovery semantics.

## Context

`pi-conductor` currently executes native worker runs through an in-process `AgentSession` path. That path is deliberately headless, default-deny, and conductor-owned. It preserves child completion tools and durable task/run state, but it gives humans little live visibility into active worker behavior.

The product direction now requires visible supervision: a human should be able to ask conductor to run parallel work and show the workers. The visible surface must not become an independent source of truth. Conductor still owns workers, tasks, runs, gates, artifacts, events, cancellation, and cleanup.

This creates a runtime design question: what should own the visible worker process, and how should graphical terminal support fit without recreating fire-and-forget terminal automation?

## Decision Drivers

* Conductor must remain the canonical control plane.
* Cancellation must kill the underlying visible runtime, not just update JSON state.
* Visible runtime metadata must be persisted so runs can be inspected and reconciled later.
* The solution should work without requiring a GUI.
* macOS/iTerm2 polish is valuable but should not become a platform dependency.
* Existing headless/native execution must remain stable and CI-safe.
* Child task contracts and explicit completion semantics must continue to apply.

## Considered Options

### Option 1: Keep headless only and improve status output

Conductor would remain in-process/headless and expose richer status/log summaries without opening terminal views.

* Good, because it preserves the current architecture and avoids process supervision.
* Good, because it is easiest to test in CI.
* Bad, because it does not satisfy the user need to watch active workers live.
* Bad, because debugging long-running or parallel work remains opaque.

### Option 2: Launch iTerm2 windows directly as the runtime backend

Conductor would open iTerm2 tabs/windows that run worker commands directly.

* Good, because it is a polished human-facing experience on macOS.
* Good, because the user can immediately see worker terminals.
* Bad, because iTerm2 is GUI- and platform-specific.
* Bad, because GUI windows are harder to supervise, enumerate, cancel, and reconcile reliably.
* Bad, because it risks making iTerm2 the de facto control plane.

### Option 3: Use tmux as supervised runtime and iTerm2 as optional viewer

Conductor starts a tmux session for each visible run, persists tmux/process/log metadata, and optionally opens iTerm2 attached to that tmux session in read-only mode. Conductor cancellation kills the tmux session/process group and updates durable state.

* Good, because tmux is scriptable, inspectable, cancelable, and GUI-independent.
* Good, because iTerm2 becomes a viewer layer rather than the runtime owner.
* Good, because conductor can persist tmux session names, pane IDs, log paths, and cleanup state.
* Good, because read-only attach supports supervision without encouraging manual state-bypassing input.
* Bad, because conductor must own process supervision, launch diagnostics, and stale-session reconciliation.
* Bad, because it introduces an external dependency for visible runs.

### Option 4: Use a custom pseudo-terminal/process supervisor without tmux

Conductor would implement its own process supervision and terminal streaming layer.

* Good, because conductor could control all runtime behavior directly.
* Good, because it could avoid tmux-specific semantics.
* Bad, because it duplicates mature terminal/session management behavior.
* Bad, because it is a much larger implementation than the product need requires.
* Bad, because it still needs a viewing surface for humans.

## Decision

Chosen option: **Use tmux as supervised runtime and iTerm2 as optional viewer**.

Visible conductor runs should be backed by tmux sessions. Each tmux-backed run records runtime metadata on the conductor run attempt, including tmux session/window/pane identifiers where available, cwd/worktree path, log path, viewer command, launch status, and cleanup status.

On macOS, conductor may open iTerm2 as a viewer by attaching to the tmux session. iTerm2 is not a backend and does not own state. If iTerm2 launch fails, conductor should keep the tmux run active and return a manual attach command plus diagnostics.

The viewer should default to read-only attach semantics where practical. Human direct intervention through a pane is explicitly not part of this first decision; users supervise through view, cancellation, gates, and conductor tools.

The existing in-process native `AgentSession` runtime remains the default headless backend. User-facing naming should distinguish `headless`, `tmux`, and `iterm-tmux`; implementation may keep `native` as an internal compatibility alias for the current runtime.

## Consequences

### Positive

* Humans can see active worker execution without giving up durable conductor control.
* tmux sessions can be listed, killed, and reconciled independently of a GUI.
* iTerm2 support can provide a polished local experience while remaining optional.
* Cancellation semantics can terminate real runtime resources and persist evidence.
* Future dashboards can consume the same runtime metadata and events.

### Negative

* Conductor must now own a process-supervision adapter and corresponding tests.
* Visible runs depend on `tmux`; missing `tmux` must be diagnosed clearly.
* macOS/iTerm2 behavior requires platform-specific adapter code and best-effort handling.
* Read-only viewer behavior may not fully prevent all local manual intervention unless attach commands are carefully constructed and documented.

### Neutral

* This decision does not remove or deprecate headless/native execution.
* This decision does not require always-on worker daemons.
* This decision does not require `pi-subagents`; it is another backend option under the conductor-owned state model from `ADR-0012`.

## Implementation Notes

* Add a runtime backend interface before adding tmux launch code.
* Persist visible-runtime metadata on run attempts rather than encoding it only in events.
* Store logs as artifact refs or bounded local file refs, not inline JSON.
* Route natural-language “show me the workers” requests to visible runtime selection when safe.
* Make cancellation idempotent: repeated cancellation should not fail because the tmux session is already gone.
* Reconciliation should classify missing tmux sessions as stale/needs-review/aborted with diagnostics, never success.

## Related

* **PRD**: `docs/prd/PRD-007-pi-conductor-supervised-visible-runtime.md`
* **Plan**: `docs/plans/2026-04-27-001-feat-conductor-supervised-runtime-plan.md`
* **ADRs**: Extends `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`, `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`, and `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md`
* **Implementation**: `packages/pi-conductor/extensions/runtime.ts`, `packages/pi-conductor/extensions/conductor.ts`, `packages/pi-conductor/extensions/types.ts`, `packages/pi-conductor/extensions/tools/orchestration-tools.ts`

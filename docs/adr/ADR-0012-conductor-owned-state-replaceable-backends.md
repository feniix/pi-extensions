---
title: "Conductor-owned durable state with replaceable backend adapters"
adr: ADR-0012
status: Accepted
date: 2026-04-24
prd: "PRD-006-pi-conductor-agent-native-control-plane"
decision: "Conductor owns canonical workers, tasks, runs, gates, artifacts, and events; execution backends are replaceable evidence providers"
---

# ADR-0012: Conductor-owned durable state with replaceable backend adapters

## Status

Accepted

## Date

2026-04-24

## Requirement Source

* **PRD**: `docs/prd/PRD-006-pi-conductor-agent-native-control-plane.md`
* **Decision Point**: FR-1, FR-6, and FR-7 require durable resource records, native execution, optional `pi-subagents` support, and clear backend-unavailable behavior without corrupting conductor state.

## Context

`pi-conductor` is evolving from a worker-centric local helper into an agent-native control plane. Parent Pi agents need durable task intent, run attempts, gates, artifacts, and audit events that survive backend exits, retries, recovery, and future execution-provider changes.

The package already owns important local resources: git worktrees, branches, session references, worker identity, PR preparation, and reconciliation. At the same time, Pi has multiple possible execution paths: the native `AgentSession` runtime, optional `pi-subagents`, and possible future process/tmux/remote backends. The architecture therefore needs a boundary between canonical conductor state and backend-specific execution evidence.

The central decision is whether conductor should remain the source of truth for task/run/gate state or delegate part of that truth to an execution framework such as `pi-subagents`.

## Decision Drivers

* Parent agents need one stable resource model regardless of execution backend.
* Native execution must remain usable when `pi-subagents` is not installed.
* Optional backends must not corrupt conductor state when unavailable, incompatible, or failing.
* Worker worktrees, branches, cleanup, gates, and PR evidence are conductor responsibilities, not generic backend concerns.
* Future backend adapters should not require redesigning task/run/gate storage or model-callable tools.
* Durable audit history must be queryable even after backend handles, async directories, or sessions disappear.

## Considered Options

### Option 1: Native backend only

Conductor would implement durable task/run state only around the native `AgentSession` runtime and treat other execution frameworks as out of scope.

* Good, because it is the simplest implementation and testing path.
* Good, because conductor already has native session/runtime code.
* Bad, because it prevents conductor from using Pi's broader subagent ecosystem.
* Bad, because future backends would likely bolt on separate state conventions instead of sharing one control-plane model.

### Option 2: Let `pi-subagents` own canonical task/run state

Conductor would dispatch work to `pi-subagents` and treat `pi-subagents` run/session state as canonical, with conductor storing only worker/worktree metadata or a projection.

* Good, because it reuses a purpose-built subagent execution framework.
* Good, because async/background execution semantics could live where the backend already implements them.
* Bad, because conductor would lose authority over gates, worktrees, cleanup, PR readiness, and audit identity.
* Bad, because native execution would become second-class or dependent on `pi-subagents` availability.
* Bad, because backend API changes could invalidate conductor's persistent state model.

### Option 3: Conductor-owned state with replaceable backend adapters

Conductor owns canonical workers, objectives, tasks, runs, gates, artifacts, and events. Backends execute task runs and report handles, runtime status, progress, completion evidence, and artifacts through a narrow adapter seam.

* Good, because parent-agent tools see one durable resource model across native and optional backends.
* Good, because native execution remains independent of `pi-subagents`.
* Good, because unavailable or incompatible backends can fail closed before creating misleading durable runs.
* Good, because backend run IDs and async directories become evidence attached to conductor runs rather than state owners.
* Bad, because conductor must implement lifecycle, reconciliation, event, and adapter logic itself.
* Bad, because integrating a real backend requires a stable adapter contract instead of directly exposing backend-specific tools.

## Decision

Chosen option: **"Conductor-owned state with replaceable backend adapters"**, because it best preserves conductor's product identity as a durable local control plane while allowing native `AgentSession`, optional `pi-subagents`, and future backends to execute the same task/run model.

Conductor owns canonical state for:

* workers and archived workers
* objectives and task dependency plans
* tasks and task lifecycle state
* run attempts and leases
* gates and gate resolution
* artifacts and evidence references
* append-only events

Backends may provide:

* backend run IDs or async directories
* session references
* runtime status and heartbeat evidence
* progress/completion reports
* artifact references
* failure diagnostics

`pi-subagents` support is therefore optional and fail-closed. Installed package detection is not enough to make it available; conductor requires a trusted injected dispatcher or future documented/versioned API contract. If unavailable, conductor reports backend unavailability and preserves native behavior.

## Consequences

### Positive

* Parent-agent orchestration tools remain stable across backend changes.
* Native execution has no runtime dependency on `pi-subagents`.
* Backend failures become audit events and terminal run outcomes instead of corrupting canonical state.
* Worktree, PR, cleanup, gate, and artifact policy stays centralized in conductor.
* Future backend adapters can be added behind the same task/run/gate semantics.

### Negative

* Conductor now owns more lifecycle and consistency code than a thin backend wrapper would.
* Backend integrations need explicit adapter work and tests before being trusted.
* Some backend-native features may not surface until conductor models them as durable evidence or policy.

### Neutral

* This decision does not require JSON storage forever; a future storage backend can preserve the same canonical resource model.
* This decision does not reject `pi-subagents`; it defines `pi-subagents` as an execution provider rather than the control-plane owner.

## Related

* **Plan**: `docs/plans/2026-04-24-001-feat-conductor-control-plane-plan.md`
* **ADRs**: Relates to `docs/adr/ADR-0001-sdk-first-worker-runtime.md`, `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`, `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`, and `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`
* **Implementation**: `packages/pi-conductor/extensions/backends.ts`, `packages/pi-conductor/extensions/conductor.ts`, `packages/pi-conductor/extensions/runtime.ts`, `packages/pi-conductor/extensions/types.ts`

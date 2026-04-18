---
title: "SDK-first worker runtime for pi-conductor"
adr: ADR-0001
status: Proposed
date: 2026-04-18
prd: "PRD-001-pi-conductor-mvp"
decision: "Use an SDK-first worker runtime, with room for a future process-backed backend"
---

# ADR-0001: SDK-first worker runtime for pi-conductor

## Status

Proposed

## Date

2026-04-18

## Requirement Source

- **PRD**: `docs/prd/PRD-001-pi-conductor-mvp.md`
- **Decision Point**: Section 8, Decision D1; FR-2, FR-5, FR-6; NFR Architecture

## Context

`pi-conductor` needs to manage multiple long-lived workers, each tied to a git worktree, a branch, and a persistent Pi session. The package is explicitly scoped as SDK/headless-first for v1, while still leaving room for future tmux or process-oriented surfaces.

A runtime choice is required now because it shapes nearly every other design decision: storage format, status tracking, resume semantics, worker lifecycle transitions, testability, and the boundary between core orchestration logic and future adapters.

The main architectural choice is whether workers are managed directly through Pi SDK sessions or through spawned `pi` processes (potentially via RPC or other process supervision).

## Decision Drivers

- PRD requires a headless-first architecture for v1
- Workers must be resumable across conductor restarts
- Worker state must be explicit and not depend on terminal scraping
- The implementation should remain testable in this repo’s extension/package structure
- Future tmux or process-backed adapters should remain possible without rewriting the core worker model

## Considered Options

### Option 1: SDK-first worker runtime

`pi-conductor` creates and manages workers directly through Pi SDK session APIs.

- Good, because session lifecycle, prompting, and resume behavior can be modeled explicitly in conductor-owned code
- Good, because it aligns with the PRD’s headless-first requirement and avoids coupling correctness to terminal behavior
- Good, because it is easier to test core orchestration logic without launching separate terminal processes
- Bad, because it may expose SDK integration edge cases that do not appear in normal interactive CLI usage

### Option 2: Process/RPC-backed worker runtime

`pi-conductor` launches worker `pi` processes and supervises them externally.

- Good, because it is closer to how Pi is normally run operationally and may align naturally with future tmux surfaces
- Good, because a real process boundary can simplify some isolation concerns
- Bad, because it introduces more process-management, lifecycle, and failure-recovery complexity into the MVP
- Bad, because it increases the risk that state becomes split across conductor metadata and process/runtime behavior

### Option 3: Terminal-driven worker orchestration

Workers are treated primarily as terminal sessions, with conductor steering them indirectly.

- Good, because it may feel familiar to terminal-centric users
- Bad, because it conflicts with the PRD’s headless-first direction
- Bad, because it would make worker correctness depend on a presentation surface rather than an orchestration model

## Decision

Chosen option: **"SDK-first worker runtime"**, because it best satisfies the decision drivers around headless correctness, resumability, explicit lifecycle control, and testability. The design will preserve a runtime boundary so a future process-backed backend can be added if needed.

## Consequences

### Positive

- Conductor can own worker lifecycle semantics directly
- Status, summary, resume, and recovery behavior can be modeled without terminal coupling
- The MVP stays aligned with the Pi SDK capabilities already documented in Pi examples

### Negative

- Some real-world worker behaviors may be harder to validate than with full process supervision; mitigation is to keep the runtime boundary narrow and add a process-backed backend later if SDK limitations appear
- Future tmux integration will need an adapter layer rather than being the native runtime from day one

### Neutral

- The team will still need to decide how to represent runtime state and session references in storage
- Future process-backed execution remains possible, but is not the default v1 path

## Related

- **Plan**: N/A
- **ADRs**: Relates to `ADR-0002`, `ADR-0003`, and `ADR-0004`
- **Implementation**: N/A

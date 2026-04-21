---
title: "Conductor worker-run extension binding and preflight policy"
adr: ADR-0011
status: Proposed
date: 2026-04-21
prd: "PRD-003-pi-conductor-single-worker-run"
decision: "Use a conductor-defined minimal headless binding policy with best-effort runtime-owned preflight before mutating worker state to running"
---

# ADR-0011: Conductor worker-run extension binding and preflight policy

## Status

Proposed

## Date

2026-04-21

## Requirement Source

* **PRD**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`
* **Decision Point**: FR-1 and FR-2, especially the requirements that worker runs use explicit conductor-defined session construction, bind extensions for headless execution, make preflight checks for model/provider availability, and never leave workers misleadingly in `running` after early failure

## Context

`pi-conductor` currently ships a durable worker orchestration layer built around persisted worker records, worktrees, SessionManager-backed session linkage, recovery, summaries, and PR preparation. The current implementation does not execute work inside workers. `packages/pi-conductor/extensions/runtime.ts` only creates, reopens, recovers, and summarizes sessions through `SessionManager`, while `packages/pi-conductor/extensions/index.ts` exposes orchestration tools and commands rather than an execution path.

PRD-003 introduces the first real foreground execution primitive: `/conductor run <worker> <task>`. That feature requires `pi-conductor` to construct an executable agent session from an existing worker's persisted session lineage and run it headlessly in the worker worktree. At that point, conductor must decide two closely related policies:

1. **Extension binding policy** — which extensions and bindings are available during a worker run
2. **Preflight policy** — where and how conductor verifies model/provider availability before a run mutates worker state to `running`

A decision is needed now because these policies shape correctness, predictability, and future evolution of the run feature. If worker runs inherit whatever ambient extensions happen to be available, behavior becomes harder to reason about and harder to test. If preflight is too weak or happens too late, workers can be left in misleading states after failures. If the policy is too strict, worker runs may become less useful than ordinary Pi sessions.

The plan in `docs/architecture/plan-pi-conductor-single-worker-run.md` already surfaces this as the main new ADR candidate. The codebase also reinforces the need for a decision: current conductor state and status formatting (`packages/pi-conductor/extensions/types.ts`, `storage.ts`, `status.ts`) assume conductor owns lifecycle semantics explicitly, and the existing opt-in CLI e2e strategy (`packages/pi-conductor/__tests__/cli-e2e.test.ts`) favors deterministic, CI-safe behavior over reliance on broad ambient runtime state.

## Decision Drivers

* PRD-003 requires worker runs to use explicit conductor-defined session construction rather than unspecified ambient defaults
* Worker runs must remain headless and deterministic enough for unit/integration testing in CI
* Conductor must not leave workers in `running` after preflight or early execution failure
* The run feature should preserve useful access to project-local capabilities without turning worker behavior into an uncontrolled mirror of the operator's full environment
* The policy should leave room for future background workers or multi-worker orchestration without redefining execution semantics again
* The policy should fit the existing architecture, where `runtime.ts` owns session/runtime details and `conductor.ts` owns orchestration and lifecycle transitions

## Considered Options

### Option 1: Inherit the full ambient extension environment and do minimal late preflight

Worker runs would rely on whatever extensions, context discovery, and model/provider behavior are available in the surrounding Pi environment. Preflight would be minimal or implicit, with most failures discovered only when `session.prompt()` begins.

* Good, because it maximizes parity with a normal Pi session and reduces up-front policy work
* Good, because worker runs automatically gain capabilities from the operator's existing extension environment
* Bad, because run behavior becomes less predictable across machines, repos, and test contexts
* Bad, because failures can happen after conductor has already transitioned a worker into `running`
* Bad, because this weakens conductor's explicit ownership of execution semantics and makes future debugging harder

### Option 2: Use a conductor-defined minimal headless binding set and runtime-owned best-effort preflight

Worker runs would explicitly bind a curated minimal set of non-interactive bindings/extensions required for headless execution. In the first phase, this should be treated as a **default-deny allowlist** rather than broad ambient discovery. `runtime.ts` would perform best-effort preflight for model/provider availability before execution begins, and conductor would only persist `running` after that preflight succeeds.

* Good, because it keeps execution semantics explicit and testable
* Good, because it aligns with the current architecture where `runtime.ts` owns runtime setup and `conductor.ts` owns lifecycle/state transitions
* Good, because it reduces the chance of ambient-environment drift between local use and CI
* Good, because it leaves room to expand the curated binding policy later without promising total ambient parity now
* Bad, because some useful repo-local capabilities may not be available until they are intentionally admitted into the curated policy
* Bad, because the package must now own and document a deliberate binding policy instead of inheriting Pi defaults for free

### Option 3: Use a broad but allowlisted project-extension policy with conductor-owned orchestration preflight

Worker runs would load most normal project-local extensions through an allowlist or discovery pass, while `conductor.ts` would own a separate eligibility/preflight stage before runtime construction.

* Good, because it preserves more of the normal project experience than a very minimal binding set
* Good, because a separate orchestration preflight could make eligibility reporting explicit before runtime setup starts
* Bad, because it adds more complexity in two places at once: extension selection logic and a second preflight boundary outside `runtime.ts`
* Bad, because it blurs the runtime/orchestration separation that the current conductor package already uses successfully
* Bad, because the broader extension surface increases the risk of interactive or non-deterministic behavior slipping into headless worker runs

## Decision

Chosen option: **"Use a conductor-defined minimal headless binding policy with best-effort runtime-owned preflight before mutating worker state to running"**, because it best satisfies the decision drivers around deterministic execution, explicit lifecycle ownership, CI-safe testing, and architectural fit with the existing conductor boundaries.

For terminology, this ADR uses **extension binding/configuration policy** as the umbrella term for the headless-safe runtime setup applied to worker runs. In implementation this may map to a concrete SDK type such as `ExtensionBindings`, resource-loader controls, tool allowlists, or a combination of those mechanisms.

Concretely, the first implementation of `/conductor run` should:

* construct execution sessions through a conductor-owned runtime helper in `runtime.ts`
* bind a minimal non-interactive set of extensions/bindings suitable for headless worker execution
* treat the initial worker-run surface as **default deny, explicit allowlist** for runtime-visible capabilities rather than inheriting the full ambient extension environment
* explicitly **exclude conductor’s own orchestration and state-mutation tools** (for example worker creation, recovery, lifecycle mutation, cleanup, and PR-prep helpers) from the worker-run binding set unless a later decision intentionally allows specific ones
* enforce that exclusion through an explicit allowlist/filtering mechanism in the worker-run session construction path — preferably by using a resource-loading/configuration path that excludes the conductor extension and narrows runtime-visible capabilities before prompt execution begins; disabling conductor tool names after session construction is an acceptable fallback if the SDK does not provide a cleaner earlier filter
* prefer construction-time narrowing of both discovered resources and tool surface; use post-construction tool-name filtering only when the SDK cannot express the needed allowlist early enough
* decide intentionally, rather than implicitly, whether discovered project extensions, skills, prompt templates, and context-file discovery remain enabled, narrowed, or disabled for worker runs
* perform best-effort model/provider preflight inside that runtime layer
* treat that runtime preflight as an **early eligibility check before `session.prompt()`**, while still relying on the SDK’s own prompt acceptance/runtime behavior for the actual prompt lifecycle
* only let `conductor.ts` persist `currentTask` + `running` once the runtime helper confirms the early preflight succeeded
* still catch and translate prompt-time provider/auth failures cleanly, since preflight can only be best-effort

This intentionally does **not** guarantee full parity with ambient Pi sessions in the first phase. It prioritizes explicit, reproducible worker behavior over maximum extension surface area.

Initial allowlist guidance for v1:
- include the minimum headless-safe coding surface needed for real worker execution, such as file-system and code-analysis capabilities
- exclude interactive UI-facing capabilities, conductor self-mutation/orchestration tools, and broad ambient prompt-template or discovery behavior unless explicitly justified
- document the concrete allowlist in the implementation path (`runtime.ts` or adjacent runtime setup code) once the SDK integration details are finalized

## Consequences

### Positive

* Worker-run behavior becomes explicit and predictable instead of ambient and machine-dependent
* The runtime/orchestration split remains coherent: `runtime.ts` owns execution setup, `conductor.ts` owns lifecycle mutations
* Conductor management tools are kept out of worker runs by default, reducing the risk of recursive self-orchestration or unintended state mutation from inside a worker session
* Preflight can fail before conductor records a misleading `running` state
* CI and local tests can target a stable headless execution policy rather than a moving ambient environment
* Future background or multi-worker execution can reuse the same binding/preflight contract instead of inventing a new one

### Negative

* Some useful capabilities may be unavailable in the first iteration — especially project-discovered extensions, nonessential skills, prompt templates, context-file discovery paths, or other repo-local runtime features that are not explicitly allowlisted; mitigation is to treat the binding set as an explicit allowlist that can be expanded intentionally as real gaps appear
* A best-effort preflight cannot eliminate all prompt-time failures; mitigation is to keep prompt-time error translation and post-failure lifecycle recovery explicit in conductor state, and to treat runtime preflight as an early eligibility screen rather than a guarantee of prompt success
* The package now owns an execution-policy surface that must be documented and maintained; mitigation is to keep the first policy minimal and non-interactive rather than over-designing it up front
* The current CLI e2e harness is not sufficient by itself to validate the binding policy, because `packages/pi-conductor/__tests__/cli-e2e.test.ts` currently runs Pi with `--no-extensions`; mitigation is to add focused runtime/unit/integration coverage for binding-policy behavior, and only add a dedicated CLI e2e variant without `--no-extensions` later if end-to-end validation of the allowlist mechanism proves necessary

### Neutral

* This ADR does not decide the exact final binding list; it sets the policy direction that the list should be curated, minimal, headless-safe, and explicit about whether project-discovered extensions, skills, prompt templates, and context files participate
* This ADR does not reject richer project-extension participation in future phases; it only rejects making broad ambient inheritance the default for the first run implementation
* If future multi-worker or background execution requires a broader or more dynamic binding model, this ADR may need to be superseded rather than silently stretched

## Related

* **Plan**: `docs/architecture/plan-pi-conductor-single-worker-run.md`
* **ADRs**: Relates to `docs/adr/ADR-0001-sdk-first-worker-runtime.md`, `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`, and `docs/adr/ADR-0007-single-worker-run-before-multi-worker-orchestration.md`
* **Implementation**: `docs/prd/PRD-003-pi-conductor-single-worker-run.md`, future implementation in `packages/pi-conductor/extensions/runtime.ts`, `conductor.ts`, and `index.ts`

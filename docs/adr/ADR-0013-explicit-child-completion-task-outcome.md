---
title: "Explicit child completion as semantic task outcome"
adr: ADR-0013
status: Accepted
date: 2026-04-24
prd: "PRD-006-pi-conductor-agent-native-control-plane"
decision: "Require explicit child completion for semantic task success; backend exit or final assistant text without completion becomes needs-review evidence"
---

# ADR-0013: Explicit child completion as semantic task outcome

## Status

Accepted

## Date

2026-04-24

## Requirement Source

* **PRD**: `docs/prd/PRD-006-pi-conductor-agent-native-control-plane.md`
* **Decision Point**: FR-5 requires a child-side task contract and completion tools; the required state model says backend success without explicit completion must create review by default.

## Context

Agent-native orchestration needs a durable answer to a simple question: did the delegated task semantically finish, and with what outcome? A backend process can exit successfully while the agent did not complete the user's task, skipped validation, hit ambiguity, or only partially changed the code. Likewise, final assistant text can be optimistic, incomplete, or not machine-structured enough for a parent agent to safely schedule follow-up work or prepare a PR.

Before the control-plane rebuild, conductor's worker-centric model could infer completion from a foreground run finishing and from the assistant's final response. That is not reliable enough once tasks and runs become durable resources with dependencies, gates, artifacts, retries, and scheduler decisions.

Conductor therefore needs to separate runtime status from semantic task outcome.

## Decision Drivers

* Task completion must be machine-readable and auditable.
* Parent agents need reliable state for scheduling dependencies, retries, PR readiness, and review handoff.
* Backend runtime status is useful evidence but cannot prove semantic task success.
* Unsupported or prompt-only backends must degrade safely instead of inventing successful outcomes.
* Child tools must be scoped to the active `taskId` and `runId` so reports cannot mutate unrelated state.
* Duplicate child reports must be idempotent because retries and tool-call replay can happen.

## Considered Options

### Option 1: Infer completion from backend exit and final assistant text

A run that exits successfully, or produces a plausible final message, would mark the task complete automatically.

* Good, because it is simple and convenient for early demos.
* Good, because it works even when a backend cannot expose child tools.
* Bad, because it conflates runtime success with semantic task success.
* Bad, because parent agents and schedulers may proceed based on an unverified assumption.
* Bad, because final text is hard to validate consistently and may omit artifacts, blockers, or test evidence.

### Option 2: Let the parent or human mark completion after inspecting output

Backend exits would leave tasks in review until the parent agent or human explicitly resolves completion.

* Good, because it avoids trusting unstructured backend output.
* Good, because human review can catch ambiguous or risky outcomes.
* Bad, because it makes autonomous task graphs too manual.
* Bad, because every successful child run requires an extra parent/human step.
* Bad, because it weakens the child worker's ability to produce durable, structured evidence directly.

### Option 3: Require explicit child completion where supported, with needs-review fallback

Every task run receives a contract instructing the child to report progress and call a scoped completion tool with status, summary, and evidence. If the backend exits without that explicit completion, conductor records runtime evidence but leaves the task in `needs_review` and opens a review gate.

* Good, because it creates a structured semantic completion signal.
* Good, because runtime status and task outcome remain distinct.
* Good, because unsupported backends degrade safely to review instead of success.
* Good, because completion reports can include artifacts, summaries, statuses, and idempotency keys.
* Bad, because child-tool injection and scoped runtime tooling are more complex than prompt-only execution.
* Bad, because some legitimate successful runs will require review if the child forgets or cannot call the tool.

## Decision

Chosen option: **"Require explicit child completion where supported, with needs-review fallback"**, because it best satisfies conductor's durability, scheduling, and bounded-autonomy requirements.

A task may enter `completed` only through an accepted explicit completion report or a documented parent/review override that appends audit history. Native child runs receive a task contract that includes the active task/run IDs, allowed statuses, follow-up-task grants, idempotency guidance, and instructions to call conductor child tools.

Backend final assistant text and process exit remain runtime evidence. If a backend exits successfully but no scoped `conductor_child_complete` report was accepted, conductor records a partial/non-semantic run outcome, marks the task `needs_review`, and opens a review gate explaining that semantic completion was not explicitly reported.

Child progress and completion calls must be scoped to the active run contract and support `idempotencyKey` so repeated reports do not duplicate events or mutate terminal task state unexpectedly.

## Consequences

### Positive

* Task outcome is structured, auditable, and separated from backend mechanics.
* Parent agents can schedule follow-up work and PR readiness checks from durable task state instead of final text heuristics.
* Backends that cannot expose child tools remain safe by default through `needs_review` gates.
* Completion summaries, artifacts, and statuses become durable evidence for reviews and PRs.
* Idempotent child reports reduce duplicate-event and retry hazards.

### Negative

* Child-tool injection is required before a backend can produce first-class semantic completion.
* Prompt-only or unsupported backends will produce more review gates, even for work that may be actually complete.
* Child agents must follow the task contract; failure to do so creates extra parent/human review work.

### Neutral

* This decision does not prevent parent or human override paths; it requires those paths to be explicit and audited.
* This decision does not define every possible completion status forever; statuses can evolve as long as the explicit-completion boundary remains.

## Related

* **Plan**: `docs/plans/2026-04-24-001-feat-conductor-control-plane-plan.md`
* **ADRs**: Relates to `docs/adr/ADR-0006-agent-session-based-foreground-run-execution.md`, `docs/adr/ADR-0011-conductor-run-extension-binding-and-preflight-policy.md`, and `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md`
* **Implementation**: `packages/pi-conductor/extensions/runtime.ts`, `packages/pi-conductor/extensions/conductor.ts`, `packages/pi-conductor/extensions/index.ts`, `packages/pi-conductor/__tests__/runtime-run.test.ts`, `packages/pi-conductor/__tests__/run-flow.test.ts`

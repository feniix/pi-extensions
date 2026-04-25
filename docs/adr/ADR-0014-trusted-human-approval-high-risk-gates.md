---
title: "Trusted human-only approval for high-risk conductor gates"
adr: ADR-0014
status: Accepted
date: 2026-04-24
prd: "PRD-006-pi-conductor-agent-native-control-plane"
decision: "High-risk gates may be rejected by model-facing tools but approved only through trusted host/UI human paths"
---

# ADR-0014: Trusted human-only approval for high-risk conductor gates

## Status

Accepted

## Date

2026-04-24

## Requirement Source

* **PRD**: `docs/prd/PRD-006-pi-conductor-agent-native-control-plane.md`
* **Decision Point**: FR-9 and FR-11 require bounded autonomy, destructive-cleanup gates, and PR-readiness gates for high-trust operations.

## Context

`pi-conductor` lets parent agents coordinate workers that can change code, commit, push, prepare PRs, and clean up worktrees/branches/session resources. These operations can be useful in semi-autonomous workflows, but some of them cross a trust boundary: publishing a PR, approving a ready-for-PR state, or destructively cleaning local execution resources should not be something a model can authorize by claiming to be a human.

The control-plane model includes gates so agents can pause for review, input, or approval. The key architectural question is whether model-facing tools may resolve high-risk gates as approved, or whether approval must come from a trusted host/UI path whose actor identity is supplied by the Pi host rather than by model parameters.

This decision must be explicit because future contributors may be tempted to add convenient model-callable approval tools or expose `humanId` in tool schemas for faster demos.

## Decision Drivers

* High-risk operations such as PR creation and destructive cleanup require stronger trust than ordinary parent-agent state transitions.
* Model-facing schemas must not let a model self-declare `{ type: "human" }` or provide arbitrary human identities.
* Humans need enough evidence before approving: gate context, readiness, artifacts, timeline, and review packets.
* The parent agent still needs the ability to reject, cancel, or diagnose gates without pretending to be a human approver.
* Gate approvals should be operation-scoped and single-use to prevent stale approvals from authorizing later risky operations.
* Safety boundaries should be enforced by code and static tests, not only by prompt instructions.

## Considered Options

### Option 1: Let model-facing `conductor_resolve_gate` approve all gate types as any actor

The model-facing resolver would accept actor type or human identity fields and allow approvals for all gate types.

* Good, because it is the most convenient API for autonomous flows.
* Good, because one tool can resolve all gate states uniformly.
* Bad, because a model can self-assert human authority.
* Bad, because prompt injection or model error could approve PR publication or destructive cleanup.
* Bad, because there is no hard boundary between parent-agent judgment and human approval.

### Option 2: Allow parent-agent approval for high-risk gates but audit it distinctly

The model-facing resolver could approve high-risk gates as a parent agent, while the event ledger records that the approval was not human.

* Good, because it preserves autonomy while retaining audit visibility.
* Good, because it avoids extra UI plumbing for approvals.
* Bad, because it still allows high-risk operations to proceed without actual human approval.
* Bad, because audit-after-the-fact does not prevent unsafe operations.
* Bad, because future users may confuse parent-agent approval with human approval.

### Option 3: Require trusted host/UI human approval for high-risk gates

Model-facing tools can inspect gates and resolve ordinary/review/input gates according to policy, and can reject or cancel high-risk gates, but high-risk approval requires a trusted host/UI path. The host derives the human actor identity and presents evidence before approve/reject/cancel.

* Good, because the model cannot claim human identity through tool parameters.
* Good, because PR creation and destructive cleanup are protected by an actual trust boundary.
* Good, because the UI path can show readiness, evidence, timeline, and review packet context before approval.
* Good, because operation-scoped, single-use approvals reduce stale-approval risk.
* Bad, because fully autonomous PR publication and cleanup are intentionally blocked.
* Bad, because headless/non-interactive environments need a separate trusted approval integration before high-risk operations can proceed.

## Decision

Chosen option: **"Require trusted host/UI human approval for high-risk gates"**, because it provides a hard safety boundary for operations that can publish work or destroy local execution resources.

High-risk gates include at least:

* `ready_for_pr`
* `destructive_cleanup`
* `approval_required` when used for high-risk operations

The model-facing `conductor_resolve_gate` tool must not expose `humanId`, actor type selection, or literal/enum values that let the model claim to be human. Parent-agent actors may reject or cancel high-risk gates, but approval requires a trusted path such as `/conductor human decide gate <gate-id> [reason]` with `ctx.hasUI`.

The trusted UI path derives the human identity from the host, shows gate context plus readiness/evidence/timeline/review packet information, and records the resolution through a dedicated trusted-human resolver. High-risk approvals are operation-scoped, revision-aware where applicable, and single-use; PR creation and cleanup consume the relevant gate and reject missing, wrong-operation, expired, or already-used approvals.

## Consequences

### Positive

* A model-facing tool cannot self-authorize high-risk work by claiming human identity.
* PR creation and destructive cleanup have an explicit human-in-the-loop boundary.
* Approval decisions carry evidence and context rather than a blind yes/no prompt.
* Static tests can guard the model-facing schema against reintroducing human approval fields.
* Operation-scoped and single-use gates reduce stale approval reuse.

### Negative

* High-risk flows require an interactive UI or future trusted host integration.
* Some autonomous demos will stop at an approval gate instead of completing end-to-end.
* The code must maintain two resolution paths: model-facing parent-agent resolution and trusted-human resolution.

### Neutral

* This decision does not prevent richer approval UIs later; it requires them to preserve the trusted actor boundary.
* This decision does not prevent policy changes for what counts as high-risk; it defines how high-risk approval must be authorized once a gate requires it.

## Related

* **Plan**: `docs/plans/2026-04-24-001-feat-conductor-control-plane-plan.md`
* **ADRs**: Relates to `docs/adr/ADR-0012-conductor-owned-state-replaceable-backends.md` and `docs/adr/ADR-0013-explicit-child-completion-task-outcome.md`
* **Implementation**: `packages/pi-conductor/extensions/conductor.ts`, `packages/pi-conductor/extensions/index.ts`, `packages/pi-conductor/__tests__/human-approval-ui.test.ts`, `packages/pi-conductor/__tests__/static-safety.test.ts`, `packages/pi-conductor/__tests__/pr-flow.test.ts`, `packages/pi-conductor/__tests__/cleanup.test.ts`

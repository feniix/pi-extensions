---
name: conductor-gate-review
description: Review and resolve pi-conductor gates with evidence, readiness checks, and trusted human approval. Use when a conductor task/objective is blocked on needs_input, needs_review, approval_required, ready_for_pr, or destructive_cleanup gates; when the user asks to review conductor gates; or before PR/cleanup operations that require human approval.
---

# Conductor Gate Review

Use this workflow to inspect conductor gates without weakening the trusted-human boundary.

## Safety rules

- Never approve high-risk gates through model-callable tools.
- Treat `ready_for_pr`, `destructive_cleanup`, and `approval_required` as trusted-human decisions.
- Use `conductor_resolve_gate` only for parent-agent decisions such as reject/cancel or non-human-safe resolutions.
- For human approval, direct the user to the interactive host command path:
  - `/conductor human dashboard` for a persistent gate queue/review loop that prompts per decision.
  - `/conductor human gates [reason]` to pick one open gate from the queue.
  - `/conductor human decide gate <gate-id> [reason]` when the gate ID is already known.

## Workflow

1. List open gates:
   - `conductor_list_gates({ status: "open" })`
2. Build context for the relevant gate/task/objective:
   - `conductor_prepare_human_review({ taskId })` or `conductor_prepare_human_review({ objectiveId })`
   - `conductor_check_readiness({ taskId, purpose: "task_review" })` or `conductor_check_readiness({ taskId, purpose: "pr_readiness" })`
   - `conductor_build_evidence_bundle({ taskId, purpose: "task_review", includeEvents: true })` for task review evidence
   - `conductor_build_evidence_bundle({ taskId, purpose: "pr_readiness", includeEvents: true })` for `ready_for_pr` / PR publication gates
   - `conductor_build_evidence_bundle({ taskId, purpose: "handoff", includeEvents: true })` for general handoff or human review packets
   - `conductor_resource_timeline({ taskId, gateId, includeArtifacts: true })`
3. Summarize what is being decided:
   - gate type and requested decision
   - task/objective state
   - readiness status, blockers, and warnings
   - notable artifacts and recent events
4. If the decision is human/high-risk, ask the user to use the trusted UI command. Prefer:
   - `/conductor human dashboard`
5. After a decision, re-check:
   - `conductor_list_gates({ status: "open" })`
   - `conductor_next_actions({ taskId })` or `conductor_next_actions({ objectiveId })`

## Output style

Be concise and decision-oriented. Include exact gate IDs and exact next commands/tools.

# Agent Work Journal V2 Evaluation Contract

Status: **infrastructure freeze in progress; concrete held-out tasks are forbidden before U5 acceptance**.

## Product claim

V2 evaluates automated trustworthy status. It does not claim that journal JSON outperforms equivalent prose. Journal runs must preserve task quality and exploration efficiency, reduce avoidable owner maintenance, and correctly handle every material stale/conflict case.

## Frozen categories

1. `automated-multi-file-continuation`
2. `material-dependency-revalidation`
3. `append-only-conflict-resolution`

No concrete V2 task ID or prompt may be selected or recorded before U5 independent acceptance. V1 task IDs, prompts, and run traces cannot be reused.

## Trial contract

- Exactly three categories, with at least three baseline and three journal traces per category.
- Equal trace counts per condition.
- Tasks are selected after infrastructure freeze and were not exposed during implementation.
- Every trace declares schema/source evaluation version 2 and has a globally unique opaque run ID.
- Baseline and journal receipts must match exactly on repository snapshot, prompt digest, model, reasoning setting, context budget, resume budget, pause point, and owner-protocol digest.
- Each trial has a phase-A process that reaches the frozen pause and a distinct fresh phase-B process that resumes from phase-A state.
- Baseline phase A generates the concise owner-status artifact under the frozen owner protocol. A prewritten artifact is invalid.
- Journal phase B resumes the actual phase-A session/store. A prewritten capsule is invalid.

## Safe trace fields

Committed trace evidence contains only opaque IDs, task score, normalized repository-read count, no-restatement boolean, material-task correctness, typed interventions with sequence numbers, typed material-case outcomes, and canonical parity/harness receipts. Each harness receipt cryptographically binds the run/task IDs, frozen parity receipt, workspace receipt, raw normalizer digest, derived evidence digest, and material-case IDs. Raw Pi JSONL from both phase A and phase B is private and ephemeral, is merged for complete per-trial normalization, must remain available until independent recomputation succeeds, and must not be published or copied into the package tarball.

Avoidable owner-maintenance kinds:

- `status_create`
- `status_refresh`
- `status_correction`
- `known_context_clarification`
- `resume_restatement`

Necessary safety kinds (reported separately and never counted as avoidable maintenance):

- `material_stale_resolution`
- `material_conflict_resolution`
- `binding_ambiguity_resolution`
- `credential_exclusion_resolution`

Unknown kinds fail closed.

## Derived metrics and all-of gate

All pass values are derived from per-run traces; precomputed booleans or counts in scenario input are rejected.

1. **Task correctness:** journal median task score must be at least baseline median in every scenario, and no journal material correctness failure is allowed.
2. **Repository reads:** journal median normalized repository reads must be no more than baseline median plus the frozen absolute tolerance of **1** in every scenario.
3. **Owner maintenance:** journal median avoidable-maintenance count must be lower than baseline in at least two scenarios.
4. **Material safety:** every planted journal material case must be detected before continuation, resolved append-only, and not be a false positive. Required pass rate: **100%**.
5. **No-restatement parity:** journal strict-majority no-restatement result must be no worse than baseline in every scenario. An even split is not a majority.
6. **Evidence integrity:** all category, schema, holdout, trace-count, global-ID, and parity rules above must validate.

Failure of any clause blocks release. A failed gate records the result and stops; it does not authorize task replacement, tolerance changes, post-hoc scoring, predecessor removal, or cutover.

## U5 infrastructure acceptance

On 2026-07-12, an independent read-only acceptance review found no frozen-contract blockers and marked U1–U5 PASS. The complete package suite passed 196 tests, coverage thresholds passed, typecheck and Biome passed, and the package dry-run contained no evaluation artifacts. The infrastructure manifest remains the immutable pre-task snapshot with empty task IDs and prompts. U6 held-out task selection is authorized; no held-out task had been selected or exposed during U1–U5.

## Frozen task-selection rules

Concrete tasks may be selected only after an independent reviewer accepts U1–U5 and the infrastructure manifest still contains empty `taskIds` and `prompts` arrays. Select exactly one new task per frozen category. A candidate is invalid if its task or run ID begins with `v1-`, reproduces a V1 prompt, was used to implement or debug V2, relies on a repository state unavailable to both conditions, or was exposed before the infrastructure-freeze timestamp. Selection is one-shot: rejected or failed held-out evidence cannot be replaced by a more favorable task.

## Frozen baseline owner protocol

The owner simulator uses the same phase boundary, model, budgets, and observable repository state as the journal condition. At phase A it may perform only `status_create`, `status_refresh`, or `status_correction` actions to populate the frozen concise-status fields: objective, current status, settled decisions, evidence, open questions, next action, and material dependencies. Each action is recorded separately. It may not add hidden narrative, raw tool output, task-specific hints, or knowledge unavailable to the journal condition. Phase B may record `known_context_clarification` or `resume_restatement` only when the resumed agent actually requests already-known context.

## Frozen rubric and pause semantics

Each scenario rubric is fixed at task selection, before any trial runs, and produces a non-negative task score plus a material correctness boolean. The same rubric grades both conditions. Phase A must reach the declared pause marker, settle autonomous journal work, persist its private session/store, and exit. Phase B must be a distinct process. Baseline phase B receives only the status generated by baseline phase A. Journal phase B resumes the actual phase-A session/store and receives only the runtime-generated, at-most-4,000-byte capsule labeled as untrusted historical work data.

For material cases, the derived receipt must prove the durable notice existed after restart, stale support was withheld, detection preceded any unsafe continuation, and resolution appended new state without rewriting notice or entry history. `material_stale_resolution` and `material_conflict_resolution` are necessary-safety interventions and must never be counted as avoidable maintenance. Missed, late, false-positive, rewritten-history, or suppressed safety evidence fails closed.

## Frozen model, budgets, and retention

- Model: `openai-codex/gpt-5.6-sol`.
- Reasoning: `high`.
- Supplemental context budget: 8,000 tokens per condition.
- Resume capsule/status budget: 4,000 UTF-8 bytes.
- Minimum runs: three per condition and equal counts.
- Repository-read tolerance: journal median no more than baseline median plus one.
- Raw Pi JSONL remains in a private trial directory only until an independent recomputation verifies the safe derivation. It is then deleted.
- Committed evidence contains opaque IDs, normalized digests/counts, typed interventions/material outcomes, parity/provenance receipts, rubrics, and aggregate results. It never contains raw prompts, raw tool arguments/results, credential candidates, control sequences, or absolute trial paths.

## Pre-task infrastructure boundary

[`agent-work-journal-v2-infrastructure-manifest.json`](./agent-work-journal-v2-infrastructure-manifest.json) is the machine-readable freeze candidate. Its status is `pending-independent-review`; concrete task IDs and prompts remain absent. U6 is forbidden until independent review changes that decision outside implementation, without changing the frozen fields above.

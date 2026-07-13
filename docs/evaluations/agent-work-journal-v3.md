# Agent Work Journal V3 Evaluation Contract

Status: **terminal infrastructure FAIL; held-out selection never occurred and product outcome is not adjudicated**.

## Product claim

V3 evaluates automatically maintained trustworthy status with correctness parity, bounded exploration cost, less avoidable owner maintenance, and perfect handling of planted material stale/conflict cases.

## Immutable history

V1 and V2 plans, contracts, manifests, and results are historical evidence and must not change. Their tasks, prompts, rubrics, fixtures, mutations, and traces cannot be reused. Both predecessor packages remain active.

## Task lifecycle

- **Candidate:** private, unexposed to any model trial, and rejectable only for enumerated structural defects.
- **Frozen:** independently quarantine-validated, atomically included in the three-task set, immutable, exposed, one-shot, and non-replaceable.

The anti-tuning embargo starts before any candidate is generated or viewed. Generate at most three candidates per category in a precommitted order; the first structurally valid candidate must freeze. Allowed candidate rejection reasons are missing bytes/digests, invalid fixture, non-deterministic mutation, broken positive/negative grader, category mismatch, prior-task reuse, or unsupported runner requirement. Every rejection has an ordered safe receipt. Model outcomes are never an allowed rejection reason.

## Quarantine contract

Each candidate contains exact bytes or content-addressed references for both prompts, rubric, fixture, hidden graders, executable deterministic mutation, mutation inputs, expected pre/post hashes, phase boundaries, unsafe-continuation rule, material cases, and runner budgets. Prose-only mutation instructions are invalid.

Before freeze, two independently implemented validators reconstruct, mutate, run golden passing/failing implementations, and compare canonical receipts. They verify identical trees and expected hashes, prove mutation precondition failure, check every digest, and confirm category novelty against the V1 semantic denylist and V2 safe digests. All three tasks then freeze atomically under one task-set digest bound to the independently accepted infrastructure receipt.

## Real trial contract

- Categories: `automated-multi-file-continuation`, `material-dependency-revalidation`, `append-only-conflict-resolution`.
- Exactly three baseline and three journal traces per category: exactly 18 total; extra, missing, duplicate, or replaced traces fail.
- Detached worktree and distinct phase-A/phase-B processes per condition.
- Same task prompts, rubric, snapshot, model, reasoning, pause point, turn/tool/wall budgets across conditions.
- Baseline phase A generates the seven-field owner status through the same model; baseline B starts fresh with only that status.
- Journal B reopens the actual phase-A session/store, clears prior transcript from model context, and receives only the runtime-generated capsule as continuation context.
- Status and capsule are each at most 4,000 UTF-8 bytes.
- Native traces from both phases remain private until the final gate and independent recomputation attest the result.
- All 18 run IDs and interleaved schedule are preregistered before launch. A provider request starts an attempt. Any post-request crash, timeout, budget/provenance failure is terminal with no retry; one mechanically proven pre-provider infrastructure retry is allowed and recorded.

## Intervention taxonomy

Avoidable maintenance:
- `status_create`
- `status_refresh`
- `status_correction`
- `known_context_clarification`
- `resume_restatement`

Necessary safety:
- `material_stale_resolution`
- `material_conflict_resolution`
- `binding_ambiguity_resolution`
- `credential_exclusion_resolution`

Necessary safety never counts as avoidable maintenance. Unknown kinds fail closed.

## Frozen owner protocol

Baseline status contains exactly these seven sections: objective, current status, settled decisions, evidence, open questions, next action, and material dependencies. Phase A permits only `status_create`, `status_refresh`, and `status_correction`; phase B permits only `known_context_clarification` and `resume_restatement`. Every action is recorded, and `status_create` always counts as avoidable owner maintenance. The canonical protocol digest is bound into every parity receipt.

## Frozen gate

All clauses must pass:

1. Journal median task score is at least baseline median in every scenario, with no journal material-correctness failure.
2. Journal median normalized repository reads are no more than baseline median plus 1 in every scenario.
3. Journal median avoidable maintenance is lower than baseline in at least 2 of 3 scenarios.
4. Journal strict-majority no-restatement outcome is no worse than baseline in every scenario.
5. Journal traces must handle every planted positive material case before unsafe continuation: affected support is withheld, durable history remains unchanged, resolution appends new evidence/state, and the required safety intervention is recorded. Baseline must detect and revalidate mutations for task correctness but has no journal-history assertion. Every dependency/conflict repetition includes one unaffected control; any safety notice/intervention on a declared control is a false positive and fails.
6. Every quarantine, parity, budget, trace, provenance, recomputation, and retention receipt validates.

Failure records FAIL and stops. Pass records only cutover eligibility. Neither outcome performs cutover.

## Enforceable budgets

- Model: `openai-codex/gpt-5.6-sol`.
- Reasoning: `high`.
- Task agent per phase: at most 12 assistant turns, 40 tool calls, and 1,800 wall-clock seconds.
- Owner simulator: at most 2 assistant turns, 8 tool calls, and 600 wall-clock seconds.
- Exhaustion is terminal FAIL. Retries and parallel calls count toward the same observed budget.
- Baseline status and journal capsule: at most 4,000 UTF-8 bytes each.
- Token usage is reported post hoc, not used as an enforced gate unless termination can precede violation.

## Safe evidence and retention

Committed evidence contains only opaque IDs, categories, SHA-256 digests, normalized counts, typed outcomes, medians, safe provenance, cleanup receipts, and the final decision. It never contains prompts, fixture/grader/mutation source, raw model messages, reasoning, tool arguments/results, credentials, or absolute private paths.

Private roots are canonical owner-controlled mode-0700 directories. Mutators and graders run without shell concatenation in a disposable sandbox with sanitized allowlisted environment, no ambient credentials/network, read-only inputs, one writable trial root, resource limits, and process-tree termination. The model/provider runner receives only the separately required provider connectivity; tool subprocesses remain sandboxed.

Use RFC 8785 JCS and SHA-256 receipts binding repository commit/tree, contract, manifest, runtime, owner protocol, runner, normalizer, scorer, validators, gate, frozen schedule/task set, every attempt/raw/derived trace, final result, recomputation, and cleanup. Apply and independently attest the complete gate before deletion. Then verify cleanup and write the terminal result/cleanup receipt. Rejected candidates, crashes, timeouts, partial trials, and recomputation failures follow the same bounded recovery state machine; failed recomputation preserves encrypted/private evidence for manual adjudication rather than claiming cleanup.

## Pre-task boundary

[`agent-work-journal-v3-infrastructure-manifest.json`](./agent-work-journal-v3-infrastructure-manifest.json) is the immutable pre-task candidate. Until U1–U5 pass independent acceptance, it must retain empty task and prompt arrays and `concreteTasksSelected: false`. U5 writes a separate immutable infrastructure-acceptance receipt. U6 writes a separate immutable frozen-task-set receipt; neither mutates the pre-task manifest.

## Terminal infrastructure outcome

U1 froze the V3 contract and U2 added safe service-computed material file observations without adding a fifth tool. U3/U4 synthetic infrastructure passed unit tests but failed independent acceptance: the real four-process smoke could not prove provider-bound capsule-only continuation, and independent reviews rejected the quarantine independence, sandbox/attempt provenance, and raw-to-derived scorer chain. All candidate U3/U4 code was discarded rather than weakening the contract.

No selector was launched, no held-out task or prompt was created, and no product trial ran. V3 therefore fails closed at infrastructure acceptance with product performance not adjudicated. Synthetic worktrees, sessions, stores, and traces were deleted. Safe terminal evidence is recorded in [`agent-work-journal-v3-results.json`](./agent-work-journal-v3-results.json). Both predecessors remain active and cutover remains unauthorized.

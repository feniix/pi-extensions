---
title: Agent Work Journal V3 Evaluation
status: active
plan_type: implementation
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
created: 2026-07-13
source: owner-approved V3 LFG contract
---

# Agent Work Journal V3 Evaluation

## Goal Capsule

Build a third-generation evaluation that can validly test Agent Journal as automatically maintained trustworthy status. First make material file dependencies usable through the existing `journal_record` tool, then prove a real two-process Pi runner and a byte-complete quarantine validator with synthetic tasks. Only after independent infrastructure acceptance may a fresh selector create candidates. Candidates become immutable one-shot held-out tasks only after complete quarantine validation. Run exactly 18 valid traces, independently recompute the frozen all-of gate, delete private evidence, and stop before predecessor cutover.

## Product Contract

- Product thesis: automatically maintained trustworthy status with correctness parity, bounded exploration cost, less owner maintenance, and perfect handling of planted material stale/conflict cases.
- Keep exactly four tools: `journal_record`, `journal_inspect`, `journal_checkpoint`, and `journal_session`.
- V1/V2 plans, contracts, manifests, and results are immutable historical evidence.
- `pi-code-reasoning` and `pi-sequential-thinking` remain active.
- No raw prompts, model messages, reasoning, tool payloads, credentials, fixture source, grader source, mutations, or absolute private paths may be committed.
- Every behavior change follows strict observable RED→GREEN TDD.
- No held-out task is exposed before independent U1–U5 acceptance.
- No product, task, rubric, grader, threshold, or runner tuning occurs after the frozen task set is exposed.
- A passing V3 gate authorizes only a separate owner cutover decision.

## Architecture and Decisions

### Candidate versus frozen

The anti-tuning embargo begins before candidate generation. Precommit an order and generate at most three candidates per category; the first structurally valid candidate must freeze. A candidate is private and may be rejected only before any model trial for missing bytes/digests, invalid or non-deterministic fixtures/mutations, broken graders, category mismatch, prior-task reuse, or unsupported runner requirements, with an ordered safe rejection receipt. A candidate becomes frozen only after two independently implemented reconstructions, deterministic mutation/hash checks, positive/negative grader checks, digest verification, and receipt agreement. The three candidates freeze atomically under one task-set digest bound to the U5 infrastructure receipt. Frozen tasks are immutable and non-replaceable.

### Material file observation

Extend `journal_record` entries with optional `observe_files: [{ path, material }]`. The caller supplies no hash, timestamp, workspace ID, or originating ID. `JournalService` computes a safe file dependency using the entry ID. Existing explicit typed dependencies remain supported, but public `kind: file` inputs are always safely reopened and recomputed; caller provenance can never be treated as observed. Sensitive paths are denied before reading, bounded in-memory bytes are scanned before hashing, and rejection writes nothing or echoes no candidate path/content/hash. File contents never persist.

### Enforceable budget

Freeze equal model (`openai-codex/gpt-5.6-sol`), high reasoning, 12 assistant turns/40 tool calls/1,800 seconds per task phase, 2 turns/8 calls/600 seconds for the owner simulator, and 4,000-byte baseline-status/journal-capsule bounds. Exhaustion is terminal FAIL. Token usage is reported post hoc and is not a gate unless the runner can stop before violation.

### Safe evidence

Private bundles and raw traces live under an owner-controlled mode-0700 trial root. Mutators/graders run without shell concatenation in a no-network sandbox with sanitized environment, no ambient credentials, read-only inputs, one writable trial root, resource limits, and process-tree termination. Safe RFC-8785-JCS/SHA-256 receipts contain opaque IDs, digests, counts, typed outcomes, medians, and cleanup state only. Apply and independently attest the gate before private deletion; write the terminal cleanup receipt afterward.

## Requirements

- **R1:** Exactly four public tools remain registered.
- **R2:** `observe_files` computes dependencies inside `JournalService` and rejects escapes, symlinks, special/oversized files, and secret-bearing outputs.
- **R3:** Autonomous checkpoints preserve observed dependencies and resume withholds stale/missing material support.
- **R4:** The real runner uses detached worktrees and distinct phase processes with actual Pi session/store continuity.
- **R5:** Baseline receives same-model phase-A-generated seven-field status; journal receives only the runtime capsule after transcript clearing.
- **R6:** Scores, reads, maintenance, restatement, pause order, and material safety derive from observable evidence, never constants.
- **R7:** Bundle schema requires exact bytes/content digests for prompts, rubric, fixture, graders, executable mutation, expected hashes, boundaries, cases, and budgets.
- **R8:** Quarantine reconstructs/mutates twice and exercises graders against known pass/fail implementations.
- **R9:** Task set contains one novel task per frozen category and has no V1/V2 digest reuse.
- **R10:** Preregister an interleaved schedule and all run IDs, then run exactly three repetitions per condition per task: exactly 18 globally unique traces. A provider request starts an attempt; post-request failure is terminal with no retry, while one mechanically proven pre-provider retry is allowed.
- **R11:** Gate requires correctness, read parity (`journal <= baseline + 1`), maintenance improvement in 2/3 scenarios, no-restatement parity, perfect material safety, and evidence integrity.
- **R12:** Failure records honestly and stops; pass records cutover eligibility only.

## Implementation Units

### U1 — Freeze V3 contract and infrastructure boundary

Files:
- `docs/plans/2026-07-13-001-feat-agent-work-journal-v3-evaluation-plan.md`
- `docs/evaluations/agent-work-journal-v3.md`
- `docs/evaluations/agent-work-journal-v3-infrastructure-manifest.json`

Create candidate/frozen semantics, enforceable budgets, taxonomy, safe evidence, gate, and immutable pre-task manifest with empty task IDs/prompts. Independently review coherence, feasibility, security, evaluation integrity, and adversarial post-hoc risk.

Verification: `specdocs_validate`; manifest regression tests; V1/V2 SHA-256 guard.

### U2 — Add safe material file observation

Files:
- `packages/pi-agent-journal/extensions/domain.ts`
- `packages/pi-agent-journal/extensions/journal-service.ts`
- `packages/pi-agent-journal/extensions/tools.ts`
- corresponding tests and README

RED first for schema, computed metadata, path/symlink/special/size rejection, explicit-dependency compatibility, batch atomicity, secret boundaries, checkpoint propagation, stale withholding, and append-only resolution. Implement minimal GREEN without adding a tool or persisting file contents.

Verification: focused tool/service/runtime tests, full package suite, typecheck, Biome.

### U3 — Build real Pi runner and synthetic preflight

Files:
- repository-only `packages/pi-agent-journal/evaluation/` sources
- evaluation harness/trace/scorer sources
- focused tests and package-boundary test

RED first for ambient/global Pi usage, transcript leakage, favorable constant facts, missing/extra events, budget omission/exhaustion, process failure, raw loss, sandbox escape, and provenance mismatch. Then add the minimal real Pi process adapter, private sessions/stores, phase-specific prompts, baseline owner simulator, provider-bound transcript-cleared journal resume, complete native JSONL, objective graders, enforceable budget receipts, derived classifiers, material/store proofs, provenance, and failure-safe cleanup. Use unrelated synthetic tasks only.

Verification: real-Pi synthetic smoke across both conditions; no hard-coded favorable outcomes; package dry-run excludes evaluation sources/raw files.

### U4 — Implement byte-complete bundle quarantine

RED first for every omitted byte/digest, prose mutation, non-determinism, precondition drift, grader false acceptance/rejection, semantic predecessor reuse, sandbox escape, and validator disagreement. Then create schema plus two independent validator implementations for exact bundle components and canonical digests. Reconstruct/mutate independently, verify hashes, exercise known pass/fail implementations, detect V1 semantic-category and V2 digest reuse, and compare safe receipts.

Verification: adversarial validator matrix and deterministic integration test.

### U5 — Independently accept infrastructure

Run synthetic end-to-end preflight, all package verification, leak review, and five independent document/code lenses. The manifest remains pre-task with empty IDs/prompts. Write a separate immutable infrastructure-acceptance receipt binding the commit/tree and all executable/configuration digests. Commit, push, open the infrastructure PR, and require green CI before any selector process is launched. No held-out selection occurs until every blocker is resolved.

### U6 — Select, quarantine, freeze, and evaluate

Only after the green U5 infrastructure commit/CI checkpoint, use a fresh independent selector under the precommitted generation order. Validate candidates privately; rejected candidates leave no model trial and produce safe receipts. Write a separate frozen-task-set receipt, preregister the 18-run interleaved schedule/IDs, and run every launch fail-closed. Independently recompute and apply/attest the gate while raw evidence remains. Then verify private cleanup, write `docs/evaluations/agent-work-journal-v3-results.json` plus executable regression and cleanup receipt, and stop before cutover.

## Verification Contract

| Gate | Required evidence |
|---|---|
| Frozen-history guard | V1/V2 file SHA-256 values equal the branch-start receipt |
| Material observation | Focused RED/GREEN tests plus real stale/missing resume chain |
| Four-tool boundary | Portable and MCP list-tools tests report exactly four names |
| Real runner | Synthetic real-Pi baseline/journal two-phase receipt |
| Quarantine | Duplicate reconstruction/mutation hashes and positive/negative grader receipts |
| Privacy | Recursive scan of committed results and package tarball |
| Package tests | `npx vitest run packages/pi-agent-journal/__tests__` |
| Coverage | Repository thresholds pass |
| Type/lint | package TypeScript and Biome pass |
| Package | MCP build and npm dry-run exclude evaluation/private artifacts |
| Specs | `specdocs_validate` passes |
| Product | 18 valid traces and all frozen V3 clauses pass |

## Risks

- Model-authored observation may be underused; synthetic preflight must prove discoverability before selection, without task-specific tuning.
- Clearing transcript while preserving branch binding is subtle; prove actual capsule-only model context.
- Native Pi events may omit needed facts; fail closed instead of synthesizing favorable values.
- Candidate rejection can become cherry-picking; permit only enumerated structural failures before any model trial and retain safe rejection counts.
- Private evidence can leak through diagnostics, paths, package exports, or test fixtures; recursively scan all outputs.

## Definition of Done

- U1–U5 pass before task exposure.
- Every behavior change has recorded RED then GREEN evidence.
- Three candidates pass quarantine and freeze atomically.
- Exactly 18 valid traces are independently recomputed.
- V3 records an honest PASS or FAIL with no private leakage.
- Private evidence is deleted only after recomputation.
- V1/V2 evidence and predecessor packages are unchanged.
- Simplify, review, browser applicability, incremental commits, PR, and CI stages complete.
- No predecessor cutover occurs.

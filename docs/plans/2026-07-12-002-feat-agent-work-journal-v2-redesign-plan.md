---
title: "Agent Work Journal V2 - Automated Trustworthy Status Redesign"
type: feat
date: 2026-07-12
topic: agent-work-journal-v2
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
supersedes_evaluation: docs/evaluations/agent-work-journal-v1.md
deepened: 2026-07-12
---

# Agent Work Journal V2 - Automated Trustworthy Status Redesign

## Goal Capsule

- **Objective:** Redesign Agent Work Journal around automatically maintaining trustworthy continuation state, rather than claiming to outperform an equally informative hand-maintained status artifact.
- **Why now:** The frozen V1 evaluation resumed correctly in all three scenarios but reduced repeated reads in only one; two baselines already had zero repeated reads.
- **Primary product thesis:** Match the task quality and exploration efficiency of a strong concise status artifact while requiring less owner maintenance and handling material stale/conflicting state more reliably.
- **Release gate:** Non-inferior task correctness and repository-read behavior, fewer owner maintenance interventions in at least two of three scenarios, and correct handling of every material stale/conflict case.
- **Stop conditions:** Do not alter or rerun the frozen V1 gate, remove predecessors, weaken privacy boundaries, or claim success from automation that silently produces incorrect status.
- **Current shipping state:** V1 is unshipped; `pi-code-reasoning` and `pi-sequential-thinking` remain active until a predeclared V2 evaluation passes.

---

## Product Contract

### Summary

Agent Work Journal V2 is an automated, inspectable status-maintenance system for Pi coding work. It should produce continuation context comparable to a carefully maintained concise status artifact without requiring the repository owner to author or refresh that artifact manually. Its differentiator is trustworthy maintenance: provenance, freshness checks, append-only conflict resolution, and branch-local lifecycle behavior.

V2 does not promise that structured journal data makes a frontier model inherently reason better than the same model given equivalent facts in prose. It earns replacement status by preserving those facts automatically and safely.

### Evidence Behind the Redesign

The frozen V1 held-out evaluation produced:

- No-restatement resumption: **3/3 scenarios passed**.
- Repeated-read improvement: **1/3 scenarios passed**.
- Task correctness: all 18 trials passed their task rubrics and validations.
- Manual intervention during supplied-artifact trials: zero in both conditions.
- Material-dependency handling: the journal correctly identified stale state and forced revalidation.

This refutes the original assumption that the successor must generally reduce repeated reads versus an equally informative concise status artifact. It supports a narrower and more defensible claim: automated trustworthy status can preserve continuation quality while reducing the owner's status-maintenance burden.

### Key Decisions

- **Automation is the product:** Compare automatic journal maintenance with owner-authored status maintenance, not two prewritten artifacts supplied at resume time.
- **Status parity before convenience:** Reduced owner effort never compensates for worse task correctness, materially more repository exploration, or unsafe stale continuation.
- **Safety is absolute for material state:** Every planted material stale/conflict case must be detected and handled correctly; this metric is not averaged away.
- **Owner maintenance is observable:** Count explicit owner actions needed to create, correct, refresh, or restate continuation state.
- **V1 remains frozen evidence:** Preserve its tasks, traces, and failed outcome. V2 uses newly predeclared scenarios and cannot reinterpret V1 as a pass.
- **No cutover on a partial gate:** All three V2 dimensions must pass before predecessor removal is reconsidered.

### Actors

- **A1. Repository owner:** Starts, pauses, resumes, and redirects Pi work; should not need to maintain a parallel status document during normal operation.
- **A2. Frontier-model agent:** Performs coding work and maintains concise durable operational state through the journal.
- **A3. Evaluation observer:** Applies frozen scoring rules, records interventions and traces, and cannot modify scenarios after seeing results.

### Requirements

**Automated status maintenance**

- R1. Pi must automatically create and refresh continuation state at meaningful lifecycle boundaries without requiring A1 to author a status artifact.
- R2. Automatic state must remain concise, typed, traceable to supporting entries or artifacts, and free of raw chain-of-thought.
- R3. Branch-local work must retain isolated continuation state across navigation, fork, compaction, restart, and close.
- R4. A1 must be able to inspect and correct automatic state, but routine work must not require manual journal operations.
- R5. When automatic capture cannot safely infer durable state, the journal must omit it or surface a bounded conflict rather than inventing certainty.

**Trust and freshness**

- R6. Material file, repository, tool-version, and external dependencies must carry observable freshness evidence.
- R7. Resume must not present materially stale supporting state as current.
- R8. Conflicts and corrections must resolve through append-only state while preserving immutable history.
- R9. Detected credential candidates and unsafe filesystem details must remain excluded from journal-owned persistence and outputs.
- R10. Material stale/conflict cases must remain visible in headless use and survive compaction or restart until resolved.

**Continuation quality**

- R11. Journal-assisted runs must be non-inferior to the manually maintained concise-status baseline on task correctness in every scenario.
- R12. Median repository-read behavior must be no worse than baseline per scenario, using a frozen tolerance declared before task selection.
- R13. Journal-assisted runs must not require owner restatement of previously captured task context more often than baseline.
- R14. Resume context must remain bounded and explicitly labeled as untrusted historical work data.

**Owner maintenance burden**

- R15. Evaluation must count every owner action used to create, update, correct, clarify, or restate continuation state.
- R16. Normal autonomous journal activity does not count as owner maintenance; responding to a legitimate material conflict does count and must be reported separately.
- R17. The journal must require fewer median owner maintenance interventions than baseline in at least two of three scenarios.
- R18. Evaluation must distinguish avoidable maintenance from necessary safety intervention so the product is not rewarded for suppressing warnings.

**Replacement discipline**

- R19. V2 scenarios, scoring, budgets, models, run counts, tolerances, and intervention taxonomy must be frozen before concrete held-out tasks are selected.
- R20. V2 must run each condition repeatedly from equivalent repository states with the same model and reasoning setting.
- R21. V1 tasks and outcomes remain historical evidence and cannot be reused as V2 held-out passes.
- R22. Both predecessors remain active unless the complete V2 gate passes independent review.
- R23. A failed V2 gate returns to delete-or-redesign review; it does not authorize another post-hoc metric or task substitution.

### Key Flows

#### F1. Pause without owner-authored status

1. A2 performs multi-file work and records only durable operational state.
2. Pi reaches a settled, compaction, branch, or shutdown boundary.
3. The journal refreshes a compact referenced checkpoint.
4. A1 pauses without creating or editing a separate status artifact.
5. On resume, A2 receives bounded continuation state and proceeds or surfaces a material conflict.

#### F2. Material dependency changes while paused

1. A checkpoint references a material dependency with observed freshness evidence.
2. The dependency changes before resume.
3. Resume classifies prior supporting state as stale and withholds it from the usable current projection.
4. A2 revalidates the dependency before editing.
5. The journal appends resolution evidence; the historical stale notice remains immutable.

#### F3. Automatic status is incomplete or wrong

1. A1 or A2 detects an incorrect or incomplete automatic projection.
2. The correction is recorded as new append-only state with provenance.
3. The current projection changes without rewriting history.
4. Evaluation counts any required owner correction as maintenance.

#### F4. V2 release evaluation

1. Freeze categories, metrics, tolerance, run count, model, budgets, baseline maintenance protocol, and intervention taxonomy.
2. After implementation is complete, select new held-out tasks.
3. For baseline runs, A1 maintains the frozen concise status through the prescribed protocol.
4. For journal runs, Pi maintains status autonomously; A1 intervenes only when required.
5. Score correctness, repository reads, restatement, owner maintenance, and material safety from preserved traces.
6. Cutover remains blocked unless every gate dimension passes.

### V2 Evaluation Contract

#### Conditions

- **Baseline:** The same model performs the task with no journal. At pause boundaries, a simulated owner follows a frozen protocol to create or refresh the concise status template. Every status edit, clarification, and later restatement counts as owner maintenance.
- **Journal:** The same model performs the same task with Agent Work Journal autonomous behavior enabled. No prewritten journal capsule is supplied independently of the run; the resume capsule must be produced by the preceding trial state.
- Repository state, task prompt, model/version, reasoning setting, context budget, pause point, and resume budget must match.
- Each scenario/condition must run at least three times; medians are computed per scenario.

#### Frozen metrics

- **Task correctness:** A scenario-specific rubric scored from final diff and validation evidence. Journal must meet or exceed baseline median and must not introduce a material correctness failure.
- **Repository reads:** Count normalized file reads plus normalized search/list queries. V2 planning must freeze a non-inferiority tolerance before task selection; default recommendation is journal median no more than baseline median plus one read.
- **Owner maintenance interventions:** Count owner-authored status creation, status refresh, status correction, clarification of already-known context, and restatement at resume. Journal median must be lower in at least two scenarios.
- **Necessary safety interventions:** Count separately. They do not fail the maintenance metric when triggered by a planted material conflict, but unnecessary or missed interventions fail safety.
- **Material stale/conflict correctness:** Every planted material case must be detected before unsafe continuation and resolved append-only. Required pass rate: 100%.
- **No-restatement resumption:** Journal must be no worse than baseline by strict majority per scenario.

#### Gate

V2 passes only when all are true:

1. Task correctness is non-inferior in all three scenarios.
2. Repository-read medians stay within the frozen non-inferiority tolerance in all three scenarios.
3. Owner maintenance intervention medians improve in at least two of three scenarios.
4. Every material stale/conflict case is handled correctly.
5. No-restatement resumption is no worse than baseline.
6. Evidence includes complete repeated-run traces, equal budgets, and an independent review.

### Success Criteria

- S1. A1 can pause and resume representative Pi work without authoring a parallel status artifact in journal runs.
- S2. Journal task correctness is non-inferior to manually maintained concise status in every held-out scenario.
- S3. Journal repository-read medians remain within the predeclared tolerance in every scenario.
- S4. Journal owner-maintenance medians are lower in at least two scenarios.
- S5. All planted material stale/conflict cases are detected and resolved safely.
- S6. Independent review can reproduce every aggregate from preserved traces.
- S7. Predecessor cutover remains impossible unless S2–S6 all pass.

### Non-Goals

- NG1. Proving that structured journal JSON inherently improves frontier-model reasoning over equivalent prose.
- NG2. Optimizing or replacing the frozen V1 tasks after observing their results.
- NG3. Capturing raw prompts, hidden reasoning, complete tool transcripts, or full tool results.
- NG4. Requiring autonomous parity from generic MCP clients.
- NG5. Migrating legacy Sequential Thinking sessions.
- NG6. Removing either predecessor during V2 redesign or implementation before the V2 gate passes.

### Risks and Mitigations

- **RISK1 — Baseline owner simulation is artificial:** Freeze an explicit maintenance protocol and count every action from traces; do not let the evaluator silently improve the baseline.
- **RISK2 — Journal suppresses legitimate warnings to reduce interventions:** Separate necessary safety interventions and require 100% material-case correctness.
- **RISK3 — Non-inferiority tolerance hides regressions:** Freeze a small absolute tolerance before tasks and report raw values alongside pass/fail.
- **RISK4 — Automatic state drifts from actual work:** Preserve provenance, freshness evidence, append-only corrections, and owner inspection.
- **RISK5 — Post-hoc scenario selection:** Select held-out tasks only after V2 behavior and evaluation tooling are independently accepted.

### Open Questions for Planning

- OQ1. Which pause/resume harness can reproducibly simulate owner status maintenance without granting either condition extra semantic context?
- OQ2. Should the repository-read tolerance remain the recommended absolute `+1`, or use a percentage for larger investigations?
- OQ3. Which existing autonomous journal events are sufficient for owner-intervention accounting, and which need explicit evaluation-only instrumentation?
- OQ4. How should necessary safety interventions be encoded so they remain distinguishable from avoidable maintenance without weakening privacy?

---

## Handoff

This artifact is requirements-only. The next planning pass should:

1. Audit the current unshipped V1 implementation against R1–R18 and identify only the deltas needed for the automation thesis.
2. Design the reproducible pause/resume and owner-maintenance harness before selecting held-out tasks.
3. Freeze the V2 read tolerance and intervention taxonomy through executable tests.
4. Keep U7 cutover absent from executable work until a new independent V2 gate passes.


---

## Planning Contract

## Product Contract Preservation

Product Contract unchanged. Preserve R1–R23, F1–F4, S1–S7, NG1–NG6, and the V1 failure evidence exactly as written in `docs/plans/2026-07-12-002-feat-agent-work-journal-v2-redesign-plan.md`; planning only resolves OQ1–OQ4 and adds implementation detail. Update frontmatter in place to `artifact_readiness: implementation-ready`, `execution: code`, and `deepened: 2026-07-12`.

## Planning Context

- The unshipped V1 package already implements the four-tool surface, typed append-only journal, checkpoint/resume, branch-local Pi bindings, autonomous settled/compaction/shutdown flushing, bounded untrusted resume capsules, freshness checks, durable notices, credential exclusion, MCP isolation, and package verification.
- The existing tests already characterize R1–R14 extensively in `packages/pi-agent-journal/__tests__/capture-policy.test.ts`, `pi-runtime.test.ts`, `storage.test.ts`, and `tools.portable.test.ts`. V2 should not rewrite those runtime/storage layers unless a new failing characterization test proves a concrete gap.
- The V1 evaluator in `packages/pi-agent-journal/extensions/domain.ts` and its evidence in `docs/evaluations/agent-work-journal-v1.md` / `agent-work-journal-v1-results.json` remain frozen. V2 gets separate types, trace parsing, scoring, harness, contract, and result artifacts so no post-hoc reinterpretation is possible.
- The primary delta is evaluation fidelity: generate continuation state during phase A, resume it in a fresh phase-B process, distinguish avoidable owner maintenance from necessary safety intervention, and derive every V2 gate result from repeated traces.

## Architecture and Resolved Decisions

1. **Separate V2 evaluation layer:** Add V2-only modules under `packages/pi-agent-journal/extensions/` so the existing TypeScript build/test pipeline compiles them, but do not register or export them from `extensions/index.ts` and do not add tools. The package wildcard may make compiled modules importable, but they are evaluation infrastructure, not an active capability.
2. **Two-phase harness (OQ1):** Each trial uses one isolated detached worktree and private session/store directory. Phase A runs to a frozen pause marker and exits. Phase B starts a new Pi process against the same trial state. Baseline phase B receives only the phase-A owner-simulator status; journal phase B resumes the actual Pi session/store and must receive a capsule generated by phase A, never a prewritten capsule. Conditions share task prompt, repository snapshot, model/version, reasoning level, context limits, pause marker, and phase-B budget.
3. **Absolute read tolerance (OQ2):** Freeze repository-read non-inferiority at `journal median <= baseline median + 1` for every scenario. Count all normalized repository file reads and normalized search/list queries, not only repeats.
4. **Evaluation-only intervention taxonomy (OQ3):** Parse safe derived events from Pi JSONL into V2 traces. Avoidable owner-maintenance kinds are `status_create`, `status_refresh`, `status_correction`, `known_context_clarification`, and `resume_restatement`. These records contain kind, timestamp/order, and opaque scenario/run IDs only—never owner text, prompts, or tool arguments.
5. **Separate safety channel (OQ4):** Necessary safety interventions use a distinct event family (`material_stale_resolution`, `material_conflict_resolution`, `binding_ambiguity_resolution`, `credential_exclusion_resolution`). They never reduce or inflate the avoidable-maintenance count. Planted material cases carry opaque case IDs and must prove detection before unsafe continuation plus append-only resolution; every required case must pass.
6. **Derived V2 scoring:** Each run records a frozen-rubric task score, material correctness failure flag, normalized repository-read events, restatement outcome, avoidable maintenance events, safety events, parity metadata, and unique run ID. The scorer derives medians and majorities; callers cannot supply pass booleans or aggregate counts.
7. **Raw-trace privacy:** Raw Pi JSONL remains ephemeral in private trial directories. Commit only the frozen contract, safe normalized trace facts/run IDs, derived medians, task rubric outcomes, and content-safe diagnostics.
8. **Cutover boundary:** A passing V2 report makes cutover eligible for a new explicit decision/plan only. This plan does not delete, unregister, rename, or edit either predecessor.

## Tasks

1. **U1 — Freeze the executable V2 contract and gate before task selection**
   - Files: `docs/evaluations/agent-work-journal-v2.md`, `packages/pi-agent-journal/extensions/evaluation-v2.ts`, `packages/pi-agent-journal/__tests__/evaluation-v2.test.ts`, `docs/plans/2026-07-12-002-feat-agent-work-journal-v2-redesign-plan.md`
   - Changes: Define the three scenario categories without concrete tasks, minimum three traces per condition, exact model/budget/run parity fields, `+1` read tolerance, task-score non-inferiority, maintenance-improvement threshold (at least two scenarios), no-restatement parity, and 100% material safety. Add V2 trace/scenario/result types and a pure scorer while leaving V1 types/scorer untouched.
   - TDD RED: First add failing tests proving the scorer rejects missing/duplicate run IDs, fewer than three traces, unequal counts/budgets/model/reasoning/pause points, implementation-exposed tasks, precomputed pass booleans/counts, unknown intervention kinds, negative scores/reads, and reused V1 run/task IDs. Add failing threshold tests where each gate dimension independently blocks release, including `baseline + 2` reads, equal maintenance in two scenarios, one missed material case, a journal task-score regression, a material correctness failure, and worse restatement majority.
   - TDD GREEN: Implement only the validation, median/majority derivation, and all-of gate needed to pass those tests. Freeze the exact contract text and `+1` constant before U2/U3 implementation.
   - Traceability: R11–R23; F4; S2–S7.
   - Acceptance: Synthetic passing evidence succeeds only when every V2 dimension passes; every single-dimension negative fixture fails; V1 evaluation tests and V1 result reproduction remain byte-for-byte behaviorally unchanged.

2. **U2 — Normalize safe tool and intervention traces**
   - Files: `packages/pi-agent-journal/extensions/evaluation-trace.ts`, `packages/pi-agent-journal/__tests__/evaluation-trace.test.ts`, `packages/pi-agent-journal/evaluation/README.md`
   - Changes: Convert Pi JSONL event streams and harness-generated owner/safety events into bounded V2 run traces. Normalize worktree-relative file paths and search/list query keys; count repository `read` plus search/list operations; ignore writes, tests, narration, and raw tool results. Emit only safe taxonomy fields and opaque IDs.
   - TDD RED: Add failing tests for duplicate reads counting separately, path aliases normalizing to one repository-relative key, searches/listings counting while edits/tests do not, malformed JSONL and unsupported schema versions failing closed, absolute paths and prompt/tool bytes absent from derived output, credentials/control sequences excluded, unknown owner/safety kinds rejected, avoidable maintenance counted separately from necessary safety, and event ordering preserved.
   - TDD GREEN: Implement a streaming/bounded parser and taxonomy validator with no raw-event persistence. Keep the parser independent of journal storage and the four public tools.
   - Traceability: R9, R12, R15–R18, R20; F2–F4; S3–S6.
   - Acceptance: A fixture containing sensitive prompts/tool inputs yields only normalized counts/opaque facts; raw candidate bytes and absolute trial paths do not appear in returned or serialized evidence.

3. **U3 — Build the reproducible two-phase pause/resume harness**
   - Files: `packages/pi-agent-journal/extensions/evaluation-harness.ts`, `packages/pi-agent-journal/evaluation/run.mjs`, `packages/pi-agent-journal/__tests__/evaluation-harness.test.ts`, `packages/pi-agent-journal/__tests__/fixtures/evaluation/fake-pi.mjs`, `packages/pi-agent-journal/package.json`, `packages/pi-agent-journal/__tests__/package.test.ts`
   - Changes: Add an injectable process/worktree runner and a repository-local CLI wrapper. Create fresh trial directories, execute phase A to a declared pause point, terminate, then execute phase B in a distinct process. Baseline invokes the frozen owner-status protocol at pause and passes that generated artifact to phase B; journal enables the extension in phase A and resumes the actual session/store in phase B without an externally authored capsule. Record every owner-simulator action as an intervention. Add a package script that builds compiled evaluation modules before invoking the non-published runner; ensure `evaluation/` and raw traces are absent from npm pack output.
   - TDD RED: With the fake Pi executable, first prove failure when phase B reuses the phase-A process, conditions use different repo snapshots/prompts/models/budgets/pause markers, baseline status is prewritten instead of phase-A-generated, journal is given a prewritten capsule, session/store continuity is missing, phase A or phase B is incomplete, run IDs collide, or ephemeral traces escape the trial directory. Add a failing package test asserting evaluation sources/raw traces are not packed.
   - TDD GREEN: Implement process isolation, parity checks, artifact handoff, cleanup, safe receipts, and injectable clocks/ID generators. Do not add production runtime instrumentation merely for evaluation.
   - Traceability: R1–R5, R13–R20; F1, F3, F4; S1, S4, S6.
   - Acceptance: A synthetic baseline/journal pair runs as four distinct process invocations from equivalent snapshots; baseline records status maintenance, journal uses its generated session/store, and the runner returns content-safe normalized traces only.

4. **U4 — Prove autonomous runtime and material safety through the harness**
   - Files: `packages/pi-agent-journal/__tests__/pi-runtime.test.ts`, `packages/pi-agent-journal/__tests__/capture-policy.test.ts`, `packages/pi-agent-journal/__tests__/evaluation-harness.test.ts`, `packages/pi-agent-journal/extensions/pi-runtime.ts`, `packages/pi-agent-journal/extensions/journal-service.ts`
   - Changes: Add characterization coverage connecting existing settled/compaction/shutdown flushing, fresh-process resume, durable notices, stale-state withholding, and append-only resolution to the two-phase harness. Modify `pi-runtime.ts` or `journal-service.ts` only if a new RED test reveals a real product gap; otherwise leave production behavior unchanged.
   - TDD RED: Add harness-level failing tests showing phase A needs no `journal_checkpoint` owner call, a fresh phase B receives bounded untrusted continuation state, unresolved material stale/conflict notices survive pause/restart, stale supporting entries are withheld before edits, and resolution appends new state without rewriting the notice/history. Add negative cases for missed detection, detection after unsafe continuation, false safety intervention, and safety events incorrectly counted as avoidable maintenance.
   - TDD GREEN: Reuse existing runtime/service behavior. If necessary, make the smallest lifecycle or ordering correction, preserving the four-tool API, store format, secret boundary, and MCP/Pi separation.
   - Traceability: R1–R10, R14, R16, R18; F1–F3; S1, S5.
   - Acceptance: The synthetic material-change scenario proves detection-before-continuation and append-only resolution across a real phase boundary; all existing 116+ V1/package tests stay green.

5. **U5 — Preflight and independently accept V2 infrastructure before held-out selection**
   - Files: `packages/pi-agent-journal/__tests__/evaluation-v2.test.ts`, `packages/pi-agent-journal/__tests__/evaluation-trace.test.ts`, `packages/pi-agent-journal/__tests__/evaluation-harness.test.ts`, `docs/evaluations/agent-work-journal-v2.md`, `docs/evaluations/agent-work-journal-v2-infrastructure-manifest.json`
   - Changes: Run synthetic end-to-end baseline/journal scenarios through parser, harness, and scorer. Freeze task-selection rules, baseline owner protocol, intervention taxonomy, model/reasoning, budgets, run count, rubrics, pause semantics, and raw-trace retention policy. Obtain independent review of gate integrity and leak resistance.
   - TDD RED: Add an end-to-end fixture that initially fails because one dimension is absent, then fixtures that attempt task exposure, post-hoc tolerance changes, V1 task reuse, missing raw-to-derived provenance, suppressed safety events, or unequal owner protocols.
   - TDD GREEN: Complete only missing validation/receipts; do not select concrete tasks or tune journal behavior against held-out evidence.
   - Traceability: R19–R23; F4; S6–S7.
   - Acceptance: Independent review returns no blockers; contract and synthetic suite are frozen; a manifest proves concrete V2 task IDs/prompts are still absent.

6. **U6 — Select and run new held-out V2 evaluation after U5 acceptance**
   - Files: `docs/evaluations/agent-work-journal-v2.md`, `docs/evaluations/agent-work-journal-v2-results.json`
   - Changes: Select three new tasks matching the frozen categories only after U5. Run at least three baseline and three journal trials per task through the two-phase harness. Preserve safe run IDs, per-run task scores, read events/counts, restatement outcomes, avoidable maintenance, necessary safety diagnostics, parity receipts, medians, and independent correctness review.
   - Verification: Re-run the pure V2 scorer against committed safe results and independently recompute aggregates from ephemeral raw traces before deletion. Never reuse V1 tasks or reinterpret V1 evidence.
   - Traceability: R11–R23; F4; S2–S7.
   - Acceptance: If any dimension fails, record the failure and stop. If all pass, record only that cutover is eligible for a separate explicit decision and future gated plan; do not remove predecessors in this unit.

## Verification Contract

| Gate | Command / evidence | Required result |
|---|---|---|
| V2 scorer RED/GREEN | `npx vitest run packages/pi-agent-journal/__tests__/evaluation-v2.test.ts` | Each new behavior is observed failing first, then all V2 gate tests pass |
| Trace safety | `npx vitest run packages/pi-agent-journal/__tests__/evaluation-trace.test.ts` | Normalization/taxonomy tests pass and sensitive/raw bytes are absent |
| Harness isolation | `npx vitest run packages/pi-agent-journal/__tests__/evaluation-harness.test.ts` | Two fresh phases, condition parity, generated handoff, and cleanup pass |
| Existing package regression | `npx vitest run packages/pi-agent-journal/__tests__` | All V1 and V2 tests pass |
| Package typing | `npx tsc --noEmit --project packages/pi-agent-journal/tsconfig.json` | No TypeScript errors |
| MCP/evaluation build | `npm run build:mcp --workspace packages/pi-agent-journal` | Compiled modules and existing MCP output build successfully |
| Package boundary | `npm pack --dry-run --json --workspace packages/pi-agent-journal` | Existing executable/MCP artifacts present; evaluation runner/raw traces absent |
| Package lint | `npx biome ci packages/pi-agent-journal docs/evaluations/agent-work-journal-v2.md docs/evaluations/agent-work-journal-v2-results.json` | No findings (omit results path before U6 creates it) |
| Coverage | `npx vitest run packages/pi-agent-journal/__tests__ --coverage` | Repository thresholds pass; new evaluator/parser/harness branches are exercised |
| Plan/spec validation | `specdocs_validate` | No repository document validation issues |
| Diff hygiene | `git diff --check` | No whitespace errors |
| Product gate | V2 safe results + independent raw-trace recomputation | All six V2 gate clauses pass; otherwise execution stops before cutover |

## Files to Modify

- `docs/plans/2026-07-12-002-feat-agent-work-journal-v2-redesign-plan.md` - enrich in place, preserve Product Contract, resolve OQ1–OQ4, add U1–U6 and verification/DoD.
- `packages/pi-agent-journal/package.json` - add the build-then-run V2 evaluation script without new runtime dependencies.
- `packages/pi-agent-journal/__tests__/package.test.ts` - prove evaluation runner/raw traces are excluded from the npm tarball.
- `packages/pi-agent-journal/__tests__/pi-runtime.test.ts` - characterize autonomous phase-boundary checkpoint/resume behavior.
- `packages/pi-agent-journal/__tests__/capture-policy.test.ts` - characterize stale withholding and append-only resolution across the harness boundary.
- `packages/pi-agent-journal/extensions/pi-runtime.ts` - only if RED lifecycle/order coverage proves a gap.
- `packages/pi-agent-journal/extensions/journal-service.ts` - only if RED freshness/resolution coverage proves a gap.
- `docs/evaluations/agent-work-journal-v2.md` - frozen V2 contract, then append held-out outcome without changing the contract.

## New Files

- `packages/pi-agent-journal/extensions/evaluation-v2.ts` - V2 trace/scenario schemas and pure release scorer.
- `packages/pi-agent-journal/extensions/evaluation-trace.ts` - bounded JSONL normalization and intervention taxonomy.
- `packages/pi-agent-journal/extensions/evaluation-harness.ts` - injectable two-phase trial orchestrator.
- `packages/pi-agent-journal/evaluation/run.mjs` - repository-only CLI wrapper over compiled harness modules.
- `packages/pi-agent-journal/evaluation/README.md` - frozen operator protocol and raw-trace privacy rules.
- `packages/pi-agent-journal/__tests__/evaluation-v2.test.ts` - V2 contract and independent gate thresholds.
- `packages/pi-agent-journal/__tests__/evaluation-trace.test.ts` - normalization, taxonomy, bounds, and secret/path safety.
- `packages/pi-agent-journal/__tests__/evaluation-harness.test.ts` - process isolation, parity, handoff, and synthetic end-to-end coverage.
- `packages/pi-agent-journal/__tests__/fixtures/evaluation/fake-pi.mjs` - deterministic process fixture; never a held-out task.
- `docs/evaluations/agent-work-journal-v2-infrastructure-manifest.json` - machine-readable U5 freeze candidate with no concrete task IDs or prompts.
- `docs/evaluations/agent-work-journal-v2-results.json` - created only in U6 after task selection and trial execution.

## Dependencies

- U1 is foundational and freezes all scoring semantics before implementation.
- U2 depends on U1 trace types/taxonomy.
- U3 depends on U1 parity requirements and U2 safe trace normalization.
- U4 depends on U3 and should reuse existing runtime/service behavior wherever characterization passes.
- U5 depends on U1–U4 and is the independent acceptance boundary before concrete task selection.
- U6 depends on U5 passing. No cutover work is part of this plan.

## Risks

- The owner simulator may create unrealistically good or poor status; freeze its protocol and model before tasks, and count every action.
- The journal condition may receive semantic hints unavailable to baseline or vice versa; enforce phase/prompt/budget/pause parity and retain receipts.
- Raw Pi JSONL can contain prompts, tool arguments, outputs, paths, or credentials; keep it ephemeral and commit only bounded safe derivations.
- Pi JSONL/event schemas may drift; version the parser and fail closed on unknown required event shapes.
- The existing journal relies on model-authored semantic records plus deterministic lifecycle facts; the two-phase harness must measure that real behavior rather than inject an ideal capsule.
- A `+1` tolerance can mask a small read regression; report raw medians and retain all-scenario non-inferiority as an all-of gate.
- Necessary safety prompts could be mislabeled as maintenance to make results look worse, or suppressed to make them look better; use disjoint enums and require 100% planted-case correctness.
- Publishing compiled evaluation modules through wildcard package exports is a minor surface leak; do not export them from `extensions/index.ts`, do not register tools, and explicitly review tarball contents. If this is unacceptable, planning must approve a separate build target before implementation rather than improvise one.
- The V1 evaluator and evidence are easy to accidentally alter during refactor; tests must reproduce the frozen V1 failure throughout U1–U6.

## Definition of Done

- The source unified plan is implementation-ready and records Product Contract unchanged plus the resolved OQ1–OQ4 decisions.
- U1–U5 were executed in strict TDD order with recorded RED failures before each GREEN implementation.
- V1 scorer, contract, results, package APIs, four tools, storage schema, and predecessor registrations remain unchanged.
- The V2 gate derives task parity, `+1` read non-inferiority, restatement parity, maintenance improvement, and perfect material safety from complete repeated traces.
- The two-phase harness proves generated phase-A continuation state is consumed by a fresh phase-B process with equal condition budgets and no prewritten journal capsule.
- Safe committed evidence contains no raw prompts, reasoning, tool arguments/results, credentials, absolute trial paths, or owner text.
- All verification-contract commands pass through U5 before held-out task selection.
- U6 records an honest pass or failure. Failure stops; pass only enables a future explicit cutover decision.
- Both predecessor packages remain active and untouched by this plan.

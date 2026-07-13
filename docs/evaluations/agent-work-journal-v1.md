# Agent Work Journal V1 Evaluation Contract

## Purpose

Compare Agent Work Journal against frontier-model reasoning plus a concise checked-in status artifact before predecessor cutover.

## Frozen scenario categories

1. Resume a partial multi-file investigation.
2. Resume after a material dependency changes.
3. Resume after a competing alternative is settled.

Concrete task instances are selected only after the Pi runtime implementation is complete. An implementation-time task cannot be reused as a held-out result.

The executable category identifiers are frozen as:

- `partial-multi-file-investigation`
- `material-dependency-change`
- `settled-competing-alternative`

## Conditions

- **Baseline:** native frontier-model reasoning receives the same user request, context budget, repository state, and frozen concise status template.
- **Journal:** the same model receives the same inputs plus the Agent Work Journal resume capsule.
- Use the same model/version and reasoning setting for both conditions.
- Give each condition an 8,000-token supplemental resume-context budget. The baseline status artifact and journal resume capsule are each capped at 4,000 UTF-8 bytes; unused bytes are not replaced with other context.
- Run each task/condition at least three times and compare per-task medians.

## Frozen baseline status template

```text
Objective: <one sentence>
Current status: <one sentence>
Settled decisions: <bullets with entry or artifact references>
Evidence: <bullets with entry or artifact references>
Open questions: <bullets>
Next action: <one action with a reference>
Material dependencies: <bullets with observed values/times>
```

No additional narrative, tool transcript, or hidden task-specific hint may be added to the baseline artifact.

## Metrics

- `resumedWithoutRestatement`: no owner restatement of prior task context is required.
- `reducedRepeatedReads`: median repeated repository reads are lower than baseline. Count a repeated read when the same normalized repository path is read again in one run without an intervening write to that path; directory listings and searches are counted by their normalized query plus root.
- Record stale/conflict correctness, checkpoint bytes, and manual interventions as diagnostics. Preserve each run trace and the per-scenario median calculation in the evaluation report.

## Executable evidence shape

Each frozen scenario record must contain `baselineTraces` and `journalTraces`. Each array contains at least three trace objects with a unique `runId`, a boolean `resumedWithoutRestatement`, and a non-negative integer `repeatedRepositoryReads`. The gate derives the journal resumption majority and both repeated-read medians from these traces; callers cannot supply precomputed pass booleans. Both conditions must have equal trace counts and equal context/status budgets.

## Gate

Exactly three held-out scenarios are required. Resumption must pass at least two scenarios and repeated-read reduction must pass at least two scenarios; the passing scenario sets may differ. Missing traces, unequal budgets, changed baseline templates, exposed task instances, or missing repeated runs fail the gate.

If either metric fails, do not remove the predecessor packages. Return to delete-or-redesign review.

## Held-out V1 result — 2026-07-12

The frozen evaluation was run after independent U1–U5 acceptance at repository revision
`6ce2e35c2a613187e83a0230a0d0226e8b12bc1c`. Each condition used
`openai-codex/gpt-5.6-sol` with high reasoning, the same task prompt and repository state, an 8,000-token
supplemental context budget, and a resume artifact capped at 4,000 UTF-8 bytes. Each task/condition ran three times
in a fresh detached worktree. The complete executable inputs and all 18 run IDs are preserved in
[`agent-work-journal-v1-results.json`](./agent-work-journal-v1-results.json).

| Scenario | Baseline repeated reads | Journal repeated reads | Median B/J | Journal resumed without restatement | Read reduction |
|---|---:|---:|---:|---:|---:|
| Partial multi-file investigation | 0, 0, 0 | 0, 0, 0 | 0 / 0 | 3/3 | No |
| Material dependency change | 1, 1, 2 | 1, 0, 0 | 1 / 0 | 3/3 | Yes |
| Settled competing alternative | 0, 0, 0 | 0, 0, 0 | 0 / 0 | 3/3 | No |

Diagnostics:

- All 18 trials completed without owner restatement or manual intervention and passed their task-specific tests and type checks.
- The material-dependency journal condition correctly treated the previous policy observation as stale and reread the authoritative artifact before editing.
- Resume artifact sizes were baseline/journal: 1,421/2,458 bytes, 1,555/3,635 bytes, and 1,478/2,701 bytes.
- An independent trace review confirmed all tasks were correct and no trial was invalid.

### Gate decision

- No-restatement resumption: **PASS — 3/3 scenarios**.
- Reduced repeated repository reads: **FAIL — 1/3 scenarios**.
- Overall V1 release gate: **FAIL**.

Per the frozen contract, U7 clean cutover is blocked. The predecessor packages remain active. Do not replace the held-out tasks or rerun optimized scenarios against this gate; return to delete-or-redesign review before proposing a new evaluation version.

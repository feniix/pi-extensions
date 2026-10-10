---
title: "pi-exa Integrated Research Cycle"
prd: PRD-010
status: "Design agreed; feasibility verification pending"
owner: "Sebastian Otaegui"
issue: "N/A"
version: "1.1"
---

# PRD: pi-exa Integrated Research Cycle

## Context and scope

The current `exa_research_step`, `exa_research_status`, `exa_research_summary`,
and `exa_research_reset` tools maintain local planning state.
`web_research_exa` independently submits and polls an Exa Agent run.
The assistant must manually bridge them; planner state does not automatically
enrich execution or receive its results.

This proposal connects those tools through package-enforced integration while
leaving judgment and orchestration with the calling assistant.
The operator agreed to the behavior below through a design interview.
This document is a proposed contract, not a description of shipped behavior.

Related documents:

- [Existing planner requirements](PRD-008-pi-exa-research-planning-tools.md)
- [Existing planner architecture](../architecture/plan-pi-exa-research-planning-tools.md)
- [Existing planner decision](../adr/ADR-0016-stateful-exa-research-planning-tools.md)
- [Shared vocabulary](../../CONCEPTS.md)

This proposal revises the earlier in-memory-only, manually bridged design.
It does not authorize implementation or change existing tool defaults.

### Host scope

The first implementation targets Pi only. Existing MCP tools and their behavior
remain supported, but integrated research cycles, durable cycle recovery, and
cycle-budget enforcement are not promised for MCP in this release.
Shared portable implementations must not accidentally enable partial cycle
behavior in MCP. Future MCP support requires a separate design for identity,
operator authorization, isolation, and resume semantics.

## Research cycle

A research cycle associates a research plan with an approved budget,
curated evidence, a compiled execution brief, and execution records.
It is isolated by session and project and can be explicitly resumed.

The intended workflow is:

1. The assistant refines the plan over one or more turns, asking the operator
   about unresolved goals, constraints, scope, and output requirements.
2. Exploratory Exa retrievals capture candidate evidence. The assistant selects
   relevant sources; evidence from other tools is explicitly recorded.
3. The assistant decides when the plan and output contract are ready.
4. An explicit `web_research_exa` call executes the active plan. Package code
   compiles its curated state into the request and records execution updates.
5. A successful Agent run completes the cycle. Results and unresolved gaps are
   reported; the assistant does not autonomously launch another research cycle.

One cycle targets one successful Agent run, not necessarily one submission:
confirmed failures may be retried under the approved best-effort budget.
Another successful research pass requires operator go-ahead for a new cycle.

## Responsibilities

| Package guarantees | Assistant responsibilities |
|---|---|
| Compile active planner state into the execution request | Refine goals and decide readiness |
| Check structured conflicts before submission | Detect semantic conflicts and ask when intent is unclear |
| Capture Exa retrieval candidates during the cycle | Select evidence and record external-tool evidence |
| Record run IDs, execution state, results, and usage | Interpret results and validate criterion coverage |
| Track approved budget and remaining known balance | Obtain spending permission and explain uncertainty |
| Persist curated records and isolate cycles | Explicitly resume or start a cycle |
| Prevent further execution of a completed cycle | Report gaps and seek permission for another cycle |

The package does not contain an autonomous multi-run reasoning loop.
Planning tools must not silently initiate paid retrieval or Agent runs.

## Execution brief and result contract

When a plan is active, `web_research_exa` automatically compiles:

- Research goals and scope.
- Constraints and acceptance criteria.
- Selected sources and relevant evidence notes.
- Unresolved gaps and clearly labeled assumptions.
- The expected structured output contract.

Raw planning chatter and uncurated exploratory results are not included.
An assumption must not be promoted to an established fact.
Returned synthesis is not automatically proof that a criterion is satisfied.
Criterion coverage must remain evidence-backed.

### Compiled execution artifact

The package compiles a versioned artifact with distinct conceptual fields:

| Field | Purpose |
|---|---|
| Cycle identity and plan revision | Attribute execution and prevent stale-plan submission |
| Research brief | Goals, scope, constraints, criteria, gaps, and labeled assumptions |
| Selected evidence | Curated sources, provenance, and relevant notes; not processing rows |
| Optional input records | Explicit structured records to process |
| Optional exclusion records | Explicit records to exclude from processing |
| Output contract | Structured result schema and required evidence/citation expectations |
| Execution controls | Effort and applicable per-run spending settings |
| Optional continuation reference | An explicitly selected previous run, not an inferred retry |

Source evidence must not automatically become input records. An ordinary research
cycle may omit processing and exclusion records entirely. A continuation is still
an Agent submission and follows the cycle's budget and one-success rules.
Continuing a successful completed cycle requires a newly authorized cycle.

`exa_research_summary` previews this artifact without executing research.
Preview and execution use the same compiler and artifact representation, not
independent request-building paths. Execution records retain the exact artifact
submitted and its plan revision.

Execution must use the current revision. A changed plan invalidates a previous
preview; a caller referencing a stale artifact receives an actionable conflict
instead of silently submitting a different brief. A preview is not mandatory:
the assistant can execute the current revision without operator approval of
every brief.

Structured conflicts block execution and return actionable information.
The assistant resolves them by updating the plan or clarifying intent.
Semantic conflict detection relies on assistant judgment, not a new model call
inside the package.

Without an active plan, standalone `web_research_exa` remains available.
Explicit parameters must not silently override conflicting active-plan fields.
Parameters that add compatible information may be incorporated into the artifact;
conflicting values require plan reconciliation before execution. Compilation and
validation happen before any paid submission.
Exact tool parameter names, schema representation, and mappings to Exa's API
require technical design and verification before implementation.

## Evidence capture

Exa exploratory results are candidate evidence, not automatically trusted sources.
Only assistant-selected evidence enters the compiled brief.
An unrelated search must not silently contaminate the active cycle.
How retrieval calls identify their cycle must be defined during interface design.

Other search providers can contribute evidence through explicit planner updates;
their tools are not automatically intercepted by this package.

## Budget and failures

The operator approves a total best-effort budget for the cycle before paid work.
All attributable Exa usage, including exploratory retrieval and failed attempts,
counts toward that budget. Other providers' costs are outside this ledger.

Known costs, unknown costs, and outstanding execution must be distinguished.
Budget tracking is not a hard spending guarantee; actual cost can overshoot.
Cost estimates and API-reported usage must not be represented as interchangeable.

Before every attributable paid Exa call, including exploratory calls and retries:

1. Assess confirmed spend, estimated liabilities for prior calls with unresolved
   costs, outstanding calls, and the estimated cost of the proposed call.
2. Record the assessment and its uncertainty; do not treat unknown costs as zero.
3. Permit autonomous execution only when the combined assessment fits the
   approved budget and unresolved liabilities have a defensible estimate.
4. Otherwise pause for operator approval of an increased budget or an explicit,
   scoped uncertainty/overspend exception. A small positive known balance alone
   does not authorize another run.

Estimates need an identifiable basis and must not double-count costs once actual
usage is reconciled. Concurrent attributable calls must share their pending-cost
assessments so they cannot each assume the same remaining balance.
When no defensible estimate is available, ask before spending rather than invent
precision. Even a permitted call can overshoot its estimate; report that outcome
and obtain renewed permission before further paid work.

Confirmed remote failures may be retried within the approved budget.
A timeout or lost response alone is not confirmation of failure.
If the outcome is unknown, inspect or recover the existing run where supported;
obtain operator approval before a replacement submission.
Retain known run IDs and submission uncertainty across restarts.

### Durable submission safety

Before contacting Exa to submit an Agent run, durably record an execution attempt
with its cycle identity, frozen plan revision, exact compiled artifact, budget
assessment, and submission intent. If that write fails, do not submit.
Persist the remote run ID as soon as it is available.

The package must atomically prevent duplicate or concurrent automatic submissions
for the same cycle, including competing callers or resumed sessions. Only the
explicit replacement exception below may bypass an unresolved-attempt block.
This does not rely on unverified remote idempotency support.

An interrupted attempt that may have reached Exa is `unknown`, even if no run ID
was saved. Restarting must not turn it into a confirmed failure or resubmit it.
Local persistence failure after remote submission has the same uncertainty rule.
A remotely completed run with a local result-processing failure must be recovered,
not replaced as though the research itself failed.

An outstanding or unknown attempt blocks automatic replacement. The previously
agreed operator-approved replacement exception remains possible, but must record
the unresolved attempt, possible duplicate work/charges, and specific permission.
It must not erase the original liability or present the cycle as safely single-run.
Any later-discovered success from the original attempt must be recorded and
surfaced as a duplicate outcome, not used to trigger another run.

Confirmed failures permit a new attempt only after budget reassessment.
Execution uses its frozen revision; edits cannot retroactively change its brief
or results. A revised brief after a confirmed failure may be compiled for retry,
with both revisions retained.

On success, retain the cycle as completed and inspectable. Do not launch another
run to close gaps automatically. Retries must not duplicate completed work.

## Persistence and isolation

Persist curated state in user-local storage outside git:

- Plan, criteria, assumptions, gaps, and selected evidence.
- Compiled brief and structured output contract.
- Execution metadata, known run IDs, curated results, and cost records.
- Cycle status and information needed for explicit recovery.

Do not persist credentials, raw planning chatter, or full exploratory response
archives by default. Returned material needs an explicit curation policy.

Sessions have separate plans and budgets even within the same project.
Restarting does not automatically attach the most recent saved plan.
Resuming a cycle is explicit.
Resuming transfers active ownership explicitly; two sessions must not concurrently
execute the same saved cycle.

### Reset and retention

`exa_research_reset` detaches the active cycle and archives its local research
record; it does not delete its durable ledger, execution attempts, known run IDs,
or unresolved liabilities. It is not remote cancellation and must warn when an
outstanding or unknown run remains.

Archived records remain inspectable and explicitly resumable. Resuming does not
make a completed cycle executable again or clear an unknown attempt.
Starting a new cycle requires explicit spending authorization; reset is not an
authorization event. The assistant must disclose outstanding work from the
detached cycle before requesting authorization for a replacement or related cycle.

Permanent deletion is a separate, explicitly confirmed operation, not part of
reset. Its interface and retention policy are deferred; until specified, this
release must not provide destructive cycle deletion.

## Acceptance scenarios

1. With an active plan, the actual Agent request includes its curated goals,
   criteria, constraints, selected evidence, and structured output contract.
2. Without a plan, existing standalone research requests still work.
3. A detectable structured conflict prevents remote submission.
4. Exa retrieval candidates do not enter the final brief until selected.
5. External evidence can be explicitly recorded without intercepting other tools.
6. Execution updates are visible through status and summaries.
7. Successful execution completes the cycle; a second run is blocked until an
   explicitly authorized new cycle.
8. Confirmed failure allows a budget-governed retry; unknown outcome requires
   operator approval before replacement.
9. The ledger includes exploratory Exa usage and labels unknown costs.
10. Restart preserves curated records without automatically resuming them.
11. Separate sessions do not consume each other's state or budget.
12. Reset archives/detaches without deleting accounting or execution records,
    cancelling remote work, or authorizing another cycle.
13. Preview and execution share one compiled artifact representation; stale
    revision references fail before submission.
14. Input and exclusion records remain distinct from selected source evidence.
15. Failure to persist submission intent prevents remote submission; interrupted
    submissions remain unknown across restarts even without a saved run ID.
16. Concurrent execution requests for one cycle cannot automatically create
    multiple attempts, including across explicit resume.
17. A remotely completed run with a local processing failure is recovered without
    a replacement submission.
18. An insufficient estimated balance or unbounded cost uncertainty pauses paid
    work for approval; actual usage reconciles estimates without double-counting.
19. Operator-approved replacement of an unknown attempt preserves its liability
    and records the duplicate-execution risk.
20. Existing MCP behavior remains unchanged; Pi cycle behavior does not silently
    activate for MCP callers.

Use test-first implementation once the remaining contracts are agreed.
Test the Pi lifecycle and session isolation contracts and regress existing MCP
behavior; cross-host integrated-cycle parity is outside this release.

## Feasibility checks and remaining design work

Before implementation, verify against source and current primary API docs:

- Exa Agent support for row inputs, exclusions, structured outputs, and existing
   source context; do not assume a local source pack maps directly to `input.data`.
- Which tools report actual costs and what accounting remains unknown.
- Remote status recovery, cancellation races, and submission idempotency support.
- How source provenance and citations survive structured result handling.
- How Pi exposes identity, lifecycle, restart, and concurrent tool calls; how
  shared tool wiring preserves the explicitly unchanged MCP behavior.
- Storage schema, atomic attempt/ownership writes, version migration, and explicit
  resume interface implementing the required submission-safety invariants.
- Exact structured conflict rules, compatible-parameter merging, output schema
  ownership, and tool parameters for the compiled artifact.
- Cost-estimation sources, uncertainty approval representation, and reconciliation
  implementing the required pre-call budget assessment.
- Candidate attribution, archive inspection/resume interfaces, and result curation.
- How budget approval is represented without claiming the package can verify
   consent merely because an assistant supplies a numeric budget.

These are deliberately unresolved, not implicit permission to choose an
architecture. Reopen consequential interface decisions with the operator.

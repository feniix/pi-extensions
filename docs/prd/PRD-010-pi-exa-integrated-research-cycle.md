---
title: "pi-exa Integrated Research Cycle"
prd: PRD-010
status: "6.1.0 guided background workflow implemented and qualified offline (scenarios 1–36); publication pending"
owner: "Sebastian Otaegui"
issue: "N/A"
version: "1.3"
target_release: "6.1.0"
---

# PRD: pi-exa Integrated Research Cycle

## Context and scope

The standalone/default-opt-out/MCP `exa_research_step`, `exa_research_status`, `exa_research_summary`,
and `exa_research_reset` tools maintain local planning state.
`web_research_exa` independently submits and polls an Exa Agent run.
The assistant must manually bridge them; planner state does not automatically
enrich execution or receive its results.

This contract connects those tools through package-enforced opt-in Pi integration while
leaving judgment and orchestration with the calling assistant.
The operator agreed to the behavior below through a design interview.
The v1.2 safety foundation is merged and offline-qualified. Local interactive
testing exposed an incomplete user experience: no cycle was started, the
assistant fell back to standalone retrieval, and an Agent call held the
conversation open while polling. This revision defines the guided background
workflow required for **6.1.0**. That version remains unpublished; its preliminary
manifest/changelog bump is stashed. Existing tests do not qualify this new UX.

Related documents:

- [Existing planner requirements](PRD-008-pi-exa-research-planning-tools.md)
- [Existing planner architecture](../architecture/plan-pi-exa-research-planning-tools.md)
- [Existing planner decision](../adr/ADR-0016-stateful-exa-research-planning-tools.md)
- [Shared vocabulary](../../CONCEPTS.md)
- [Feasibility and Jev decision record](../research/pi-exa-integrated-cycle-feasibility.md)
- [Settled Pi-first execution contract](../architecture/plan-pi-exa-integrated-research-cycle.md)

This revision replaces manual normal-path cycle setup and blocking cycle
execution, while preserving the durable safety foundation. It specifies the
target behavior; it does not itself authorize paid testing or publication.

## 6.1.0 user experience

**Request → clarify → preview scope/cost → approve → submit → return research ID
and control → monitor in the background → notify completion → report gaps.**

The user describes a research topic in ordinary language. The assistant manages
the plan and cycle mechanics. The user makes material scope and spending
decisions; the normal path must not require slash commands, IDs copied between
tools, JSON schemas or request hashes.

### Guided planning

- An explicit request for guided research lets the assistant create a local,
  non-spending draft and clarify the objective. It does not authorize retrieval.
- Ask focused questions only where answers materially change the research.
  For a specific initial request, propose a brief with labeled assumptions
  instead of forcing a questionnaire. Do not ask for information already given.
- Clarify the decision/use case, scope, source expectations, output and relevant
  effort/cost trade-offs. The assistant maintains criteria, gaps and a structured
  task contract behind the scenes.
- Preliminary Search/Fetch calls are optional paid exploration, not free
  clarification. Explain and authorize their scope before using them.
- A requested Agent pass must not silently become a Search/Fetch-only report.
  If Agent is disabled or unavailable, disclose that and offer an alternative.
  Enabling cycle support does not silently change tool enablement.
- Guided intent uses explicit cycle routing. Failure to start/resume that cycle
  is actionable, not permission to execute equivalent standalone work.

### Proposal and approval

Before Agent submission, show a readable proposal containing:

- The research question, scope/exclusions, criteria and carried assumptions.
- Expected deliverable and source strategy, including selected context.
- Effort, providers/contact-capable work and any continuation/input records.
- Estimated cost and its basis, lifetime allowance, existing liabilities and
  material uncertainty. State what is not a vendor-enforced limit.

The package binds the proposal to its exact compiled request and revision.
Approval is a real operator action against that proposal through a trusted
host confirmation surface. The assistant may request the confirmation but
cannot manufacture a grant from an approval boolean, copied conversation text,
its own interpretation of “yes,” or a budget argument. The operator need not
read or copy the internal hash. Changed request/scope requires a new proposal
and approval; decline, dismissal, timeout and stale responses grant nothing.

The normal guided path requires this proposal; it cannot skip preview because
the assistant judges the plan ready. Existing advanced commands may remain as
an alternative trusted interface, not a prerequisite for ordinary use.

### Submission and background monitoring

- Freeze and durably claim the approved attempt before one SDK create.
- On acknowledgement, persist and return the **Exa research run ID**, together
  with a local cycle/attempt reference and initial status. Return control without
  waiting for a terminal result or performing the entire polling loop.
- Example: “Research started: `<run-id>`. I’ll notify you when it finishes.
  You can continue chatting.” Promise monitoring only after it is registered.
- If acknowledgement does not arrive within a bounded submission wait, report
  the local attempt reference and uncertainty, not an invented remote ID,
  successful-start message or automatic retry. Persist genuine late IDs/results.
- A package-owned monitor checks only the saved run in the background while
  Pi remains running. It does not require repeated assistant turns, a blocking
  tool call or a model choosing to poll.
- Monitor checks never create/continue/retry/replace research, widen grants or
  fetch additional sources. Remote work can continue incurring charges under
  its original request; monitoring does not establish a new billing cap.
- Use bounded requests and backoff. Temporary failures are monitoring problems,
  not proof of remote failure. Persistent errors pause monitoring with an
  actionable warning, preserving the run and liability.
- Users can ask for status/results without starting another run or creating
  a competing monitor. Multiple approved cycles may be monitored independently.

### Completion and conversation lifecycle

Persist the genuine terminal outcome, classified usage and local processing
result before scheduling completion delivery. Notify the originating session
at a safe turn boundary; do not interrupt an answer being written or inject
private results into a different session/project. A completion can wake an idle
assistant to report findings, sources, evidence limitations, recorded gaps and
usage. The reporting turn must not buy further research.

Completion delivery is keyed to attempt/terminal outcome and deduplicated during
normal operation. Persist a pending notice separately from delivered/acknowledged
state so a crash does not silently lose a result. If the host cannot provide
atomic delivery acknowledgement, do not claim exactly-once notification across
crashes: retain an inspectable pending/uncertain notice and reconcile on resume.
Two late successes must both remain visible without buying a third run.

Interrupting the conversation or the completed submission tool does not cancel
the saved remote run. Stopping monitoring is distinct from remote cancellation.
This revision adds no automatic remote cancellation; any new explicit remote
cancellation UI needs a separate settled contract and must not erase liability.

On shutdown, stop local timers and retain state. On restart, show discoverable
saved running/unknown work and pending results; do not silently attach it.
The user can request resume conversationally, and the assistant can invoke the
explicit resume operation without requiring a copied command. Resume checks
ownership and restarts only eligible monitoring, never submission.
Session switch/tree/fork detaches monitoring and delivery for the old context;
late observations may update their original records but cannot take over the
new context. Surface the pause and resume path. Archive stops monitoring/delivery
for the archived cycle, retains history and warns that remote work may continue.

### Release boundary and design gates

The guided background flow is part of **6.1.0**, not a deferred follow-up release.
Standalone/default-opt-out/MCP calls retain their existing blocking semantics.
The new Pi path must explicitly distinguish submission from result inspection.

Before implementation, verify and settle:

1. A trusted Pi approval surface usable in the normal guided flow, including
   unavailable-UI/headless behavior. Fail closed with an actionable pause where
   confirmation is unavailable; do not fall back to inferred prose consent.
2. Host scheduling and delivery primitives for background monitoring, safe-turn
   assistant wakeups, origin-session targeting and delivery acknowledgement.
3. Public tool schema/action names and compatibility with existing opted-in calls.
4. Submission/GET time bounds, polling cadence/backoff and monitor pause limits.

These are implementation decisions to resolve against Pi/Exa documentation and
offline prototypes, not assumed SDK features. Material deviations from the
agreed flow require operator review.

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
4. The assistant presents the scope/cost proposal and requests trusted operator
   approval. A submission returns its saved research ID and control promptly;
   package-owned background monitoring records execution updates.
5. A successful Agent run completes the cycle and schedules notification.
   Results and unresolved gaps are
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
| Persist curated records, isolate cycles and monitor saved runs | Start/resume explicitly on the user's behalf |
| Return submission acknowledgement and safely deliver completion | Present the proposal and final report conversationally |
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
instead of silently submitting a different brief. The guided 6.1.0 path requires
a readable proposal and exact-request approval before submission.

Structured conflicts block execution and return actionable information.
The assistant resolves them by updating the plan or clarifying intent.
Semantic conflict detection relies on assistant judgment, not a new model call
inside the package.

Without an active plan, standalone `web_research_exa` remains available.
Explicit parameters must not silently override conflicting active-plan fields.
The plan is authoritative. Explicit execution fields must match persisted values;
additions/mismatches require a planner update, not implicit merging or hidden
execution-time mutation. Compilation/validation precede paid submission.
The linked execution contract settles routing, schema ownership, mapping and
revision/conflict behavior.

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

1. Assess recorded spend by evidence class (retrieval estimates, Agent-reported
   cost, or independently verified billing), estimated unresolved liabilities,
   outstanding calls, and the proposed call's estimated cost.
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

Confirmed remote failures may be retried only explicitly with fresh request
permission and a reassessed approved budget; background monitors never retry.
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
Resuming a cycle is explicit, but the assistant can perform that operation
following a user's conversational request.
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

The [offline qualification map](../architecture/pi-exa-cycle-qualification.md)
links scenarios 1–20 to the foundation regression tests and scenarios 21–36 to
the guided submission, monitoring, recovery and production-smoke suites.
Prompt guidance assists the model; it does not autonomously execute
the workflow or establish research adequacy, consent or verified billing.

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

### Guided/background release acceptance (implemented; mapped in the qualification document)

21. “Research Laya versus Jev” starts a local guided draft, asks only material
    clarification questions and requires no manual cycle command or schema.
22. Before any paid exploration or Agent create, the user sees scope/cost and
    can approve or decline through the trusted host surface. Decline, timeout,
    stale approval and assistant-forged approval result in zero submissions.
23. After a proposal edit, the old approval cannot submit the changed request.
24. A delayed mock remote job returns its saved run ID from submission before
    completion; the user can send another message while background GETs run.
25. Completion of that job persists its result and wakes the correct idle
    session for a report without a user prompt, second create or paid follow-up.
26. Completion during an active response is queued until a safe boundary.
    Repeated terminal observations do not produce duplicate normal-path notices.
27. Crash points before/after receipt publication, notice scheduling and delivery
    preserve inspectable outcome/notice state. Delivery ambiguity is explicit;
    no unsupported exactly-once claim is made.
28. Submission timeout with no ID preserves unknown intent; a late ID is saved
    on the original attempt. No automatic resubmission or fabricated success.
29. Transient GET errors back off; exhausted monitoring/auth/not-found errors
    surface a pause without fabricating remote failure or buying replacement.
30. Shutdown/restart retains the ID and pending notices. Explicit conversational
    resume reacquires ownership and monitors the existing run without create.
31. Session switch, fork, archive and competing runtimes cannot deliver into the
    wrong conversation, duplicate active monitors or lose late original facts.
32. Interrupting a chat turn does not remotely cancel submitted work. Archive/
    stop-monitoring warnings distinguish local observation from remote spending.
33. Two independently approved cycles return distinct IDs and retain isolated
    results, grants, liabilities and notifications.
34. Invalid output after remote completion yields processing-failure guidance
    and same-run recovery, never a new research pass.
35. Guided Agent intent cannot silently fall back to standalone Search/Fetch or
    a blocking standalone Agent call when setup/approval/capabilities fail.
36. A real interactive Pi smoke demonstrates the entire guided journey with
    controllable mocked Exa endpoints. Actual paid smoke requires separate
    operator authorization and is never implied by release preparation.

Keep changes regression-first. The qualification map covers Pi lifecycle,
session isolation and existing MCP regressions; cross-host integrated-cycle
parity remains outside this rollout.

## Feasibility outcome and revalidation

Issue #152's linked research/contract settle gating interface decisions.
Operator choices were retained; Jev selected remaining bounded design options
at the operator's request. Jev is not a runtime dependency.
Rollout is Pi-only opt-in; retrieval API costs remain classified as estimates,
not invoices. Initial cycle efforts are fixed efforts plus auto; cycle max/ultra
are deferred without changing standalone/MCP behavior.

The qualification map records current implementation evidence and limits.
When changing these boundaries, revalidate source and current primary API docs:

- Exa Agent support for row inputs, exclusions, structured outputs, and existing
   source context; do not assume a local source pack maps directly to `input.data`.
- Which tools report estimates versus Agent usage/cost and what remains unknown.
- Remote status recovery, cancellation races, and submission idempotency support.
- How source provenance and citations survive structured result handling.
- How Pi exposes identity, lifecycle, restart, and concurrent tool calls; how
  shared tool wiring preserves the explicitly unchanged MCP behavior.
- Storage schema, atomic attempt/ownership writes, version migration, and explicit
  resume interface implementing the required submission-safety invariants.
- Implementation of exact structured equality/conflict rules, task-schema
  validation, and the settled tool parameters for the compiled artifact.
- Cost-estimation sources, uncertainty approval representation, and reconciliation
  implementing the required pre-call budget assessment.
- Candidate attribution, archive inspection/resume interfaces, and result curation.
- Durable grant issuance from operator commands/dialogs, never an
  assistant-supplied numeric budget as proof of consent.

These checks do not reopen settled contracts. Unsupported vendor/account
capabilities use documented fail-closed/uncertainty paths, not invented guarantees.
Reopen consequential changes to the agreed contract with the operator.

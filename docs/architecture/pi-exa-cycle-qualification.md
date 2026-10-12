---
title: "Pi integrated Exa cycle: offline qualification"
prd: PRD-010
issue: 160
status: "6.1.0 guided/background workflow qualified offline (scenarios 1–36 mapped); publication pending"
---

# Qualification boundary

**6.1.0 offline qualification.** PRD-010 v1.3 adds conversational setup/approval,
immediate submission acknowledgement, background monitoring, safe completion
delivery and recovery across interruptions (scenarios 21–36). This document maps
every scenario, 1–36, to regression evidence: the foundation suites below, the
guided suites added by #172–#174, and the #175 smoke that drives the production
extension in a real `pi --mode rpc` process against a controllable mock Exa HTTP
server. All evidence is mocked and offline; no paid Exa, Connect or model call was
made, and publication/release remain separate operator decisions.

**Evidence classes.** Keep these distinct when citing this document:

- *Mocked interactive smoke* (`guided-smoke.rpc.test.ts`): the real extension in a
  real Pi RPC process with the real `exa-js` SDK pointed at a mock HTTP server
  through `EXA_BASE_URL`; the RPC client is the trusted confirmation surface. It
  exercises the host protocol, not terminal rendering.
- *Registered-host regressions* (`guided-submission`, `guided-monitoring`,
  `guided-recovery`, `cycle-extension`): the real extension loaded through its
  entry point with a fake `ExtensionAPI`, the real private filesystem controller
  and a mocked `exa-js` module; restarts are simulated by `session_shutdown` plus a
  fresh runtime over the same store.
- *Host capability experiments* (`guided-prototype.test.ts`,
  `guided-prototype.rpc.test.ts`): the #171 prototype against Pi 1.1.0 SDK sessions
  and a real RPC process; design evidence, not production code.
- *Controller/policy units* (`research-cycles`, `research-artifacts`,
  `research-accounting`, `research-retry`, `agent-lifecycle`, `portable-tools`).

The opt-in Pi workflow is implemented behind `--exa-enable-cycles`, off by
default. Registered tools retain their original enablement and standalone
behavior. MCP retains the portable planner/research contract, not cycle state.
This document maps implementation regressions, not paid production evidence.

The representative test is **“qualifies a complete offline Pi cycle through
curation, final gaps, restart and archival inspection”** in
[`cycle-extension.test.ts`](../../packages/pi-exa/__tests__/cycle-extension.test.ts).
It loads the real Pi extension, drives registered commands/tools, uses actual
private filesystem/controller behavior and mocks only SDK/system boundaries.
It covers:

1. Fresh explicit start, framing, criteria, gaps, assumptions and task schema.
2. Exploration pause without consent, then scoped operator approval.
3. SDK candidate capture without automatic selection; explicit candidate and
   external-source curation; source notes remain separate from input/exclusion rows.
4. Selected-only authoritative preview, no raw bodies/planning chatter, structured
   conflict rejection and a separate exact-request Agent permission pause.
5. One mocked Agent create, valid structured output claiming satisfaction and
   remote completion with `budget_reached`; neither changes recorded coverage.
6. Final report showing recorded gaps, unsupported/damaged criterion claims,
   API-reported exploration plus Agent usage, and no invoice verification.
7. Second submission rejection, shutdown/start discovery without activation,
   explicit resume, one existing-run GET, archival and read-only list inspection.
8. Exactly one search/create/GET and no cancellation or autonomous follow-up.

The result is a package-enforced cycle, not an autonomous assistant loop.
Clarification, adequacy/readiness, explicit evidence selection and evidence-backed
final interpretation remain assistant/operator responsibilities. Tool guidelines
and the packaged planner skill describe that branch. Their availability/content
is tested; no live-model behavioral benchmark is claimed.

## Acceptance-scenario map

Numbers match [PRD-010](../prd/PRD-010-pi-exa-integrated-research-cycle.md#acceptance-scenarios).
Test names below are searchable substrings, not unstable line references.

| # | Regression evidence |
|---|---|
| 1 | Representative; Pi “executes the exact compiled request”; artifacts “previews a versioned structured request with no planning chatter”. |
| 2 | Portable Agent defaults/forwarding; Pi “keeps query optional for active compilation but mandatory for unrelated standalone research”. |
| 3 | Representative; Pi “previews the compiled artifact and reports conflicts”; artifacts “canonicalizes object keys but rejects stale references and conflicting execution fields”. |
| 4 | Representative; Pi “captures attributed SDK candidates, curates them explicitly”; cycles “curates candidates and external sources into selected-only previews”. |
| 5 | Representative; same cycle curation test; evidence “preserves explicit external source metadata when a candidate reuses that source URL”. |
| 6 | Representative final-report equality; Pi “projects Agent progress and final response once each”; lifecycle “observes queued progress and terminal polling separately”. |
| 7 | Representative; Pi “executes the exact compiled request”; retry “stops after any completed attempt”. Generated claims and local-invalid completion remain non-coverage. |
| 8 | Pi “requires explicit Pi retry mode, cycle and fresh exact funding”; “requires the specific operator replacement command”; retry policy regressions. |
| 9 | Representative; Pi “keeps missing cost unknown”; accounting “never treats an unresolved operation as zero”; out-of-order and late receipts. |
| 10 | Representative; cycles “requires explicit resume after restart”; Pi “requires explicit assistant resume after session restart”. |
| 11 | Cycles “enforces runtime ownership and keeps projects isolated”, Git common-directory/worktree identity, competing live resume; Pi lifecycle detachment. |
| 12 | Representative; cycles “retains unknown attempts, ledger, and grants when archived or resumed”; Pi late archive accounting/recovery tests. |
| 13 | Representative; cycles “persists an execution plan and previews the same artifact after explicit resume”; Pi reference-validation matrix; frozen SDK request tests. |
| 14 | Representative; artifacts “keeps selected evidence separate from processing rows”; cycles selected-only curation and non-JSON row rejection. |
| 15 | Pi “does not submit when the frozen Agent intent cannot be published durably”; “retains a missing-ID interruption”; cycles interrupted claimed-attempt restore. |
| 16 | Cycles “serializes competing Agent intents and competing dispatch claims”; exclusive runtime ownership and final generation/success guards. No invented vendor idempotency guarantee. |
| 17 | Pi “requires explicit assistant resume ... existing invalid result with one GET”; cycles “revalidates remotely completed but locally invalid output with the frozen task schema”. |
| 18 | Pi pending exposure/overspend, exact unsupported-request consent and zero receipts; accounting shared pending exposure, once-only reconciliation and conservative decimal rounding. |
| 19 | Pi specific replacement-command/duplicate-success test; cycles exact-bound risk/liability funding and immutable historical proof; lifecycle “preserves both genuine late successes”. |
| 20 | Portable-tools standalone planner/Agent regressions; extension and MCP wiring tests; Pi opt-out registration, metadata-prefix preservation and default descriptions. |

Test suites:

- [Pi registration/lifecycle](../../packages/pi-exa/__tests__/cycle-extension.test.ts)
- [Durable controller/storage](../../packages/pi-exa/__tests__/research-cycles.test.ts)
- [Artifacts](../../packages/pi-exa/__tests__/research-artifacts.test.ts),
  [evidence](../../packages/pi-exa/__tests__/research-evidence.test.ts),
  [accounting](../../packages/pi-exa/__tests__/research-accounting.test.ts),
  [retry](../../packages/pi-exa/__tests__/research-retry.test.ts)
- [SDK lifecycle](../../packages/pi-exa/__tests__/agent-lifecycle.test.ts),
  [portable tools](../../packages/pi-exa/__tests__/portable-tools.test.ts)

## Guided/background acceptance map (6.1.0)

Numbers match PRD-010 scenarios 21–36. Test names are searchable substrings.

| # | Regression evidence |
|---|---|
| 21 | Smoke “runs the whole journey without slash commands, schemas or hashes typed by the user”: the assistant drives `exa_research_status action=start`, `exa_research_step`, `mode=proposal` and `researchMode=submit` from a plain request; user prompts contain no slash command, schema or hash. Submission “creates a non-spending draft, renders a readable proposal”. |
| 22 | Submission “approves through the host dialog and returns the pending run ID” (dialog body carries topic, estimate, 10-minute timeout; dialog-sourced grants persisted) and “grants nothing when the dialog is declined or no trusted surface exists, and rejects forged approval inputs” (`APPROVAL_NOT_GRANTED`, `APPROVAL_UNAVAILABLE`, `EXECUTION_CONFLICT`, zero creates). Smoke “a cancelled dialog in the same journey submits nothing” over the real RPC protocol. Exploratory dialog: submission “discloses and approves optional exploratory retrieval through the dialog before dispatch”. |
| 23 | Submission “refuses a stale proposal after a plan edit before any dialog or create” (`PROPOSAL_STALE`, new proposalId after the edit). Controller `grantDialogApproval` asserts the artifact hash. |
| 24 | Submission normal path returns `runId` while the mocked run is `running` with zero GETs; smoke shows the second user prompt answered while HTTP GETs continue; monitoring “returns control with a registered monitor, observes with bounded GETs”. |
| 25 | Monitoring normal path: terminal GET → persisted outcome → one `exa-research-completion` notice sent with `triggerTurn` + `followUp` → `agent_settled` acknowledgement by the persisted entry → report; smoke shows the real wakeup turn calling `exa_research_status` and reporting after `server.complete`. No user prompt, one create, zero cancels. |
| 26 | Prototype SDK experiment “queues a completion that lands during an active response until the turn settles, and deduplicates repeated terminal observations” (host queue semantics, Pi 1.1.0). Monitoring normal path: explicit recover after completion creates no second notice. |
| 27 | Monitoring “pauses on local storage failure after a successful GET without an unhandled rejection”; recovery “recovers a terminal attempt whose notice scheduling crashed” and “keeps a remote-ID publication crash unknown”; recovery “re-sends an uncertain notice only on explicit resume, labeled as a possible duplicate, instead of claiming exactly-once”. Fault injection is in-process filesystem rename failure. |
| 28 | Submission “keeps an unacknowledged create unknown, saves a genuine late run ID on the original attempt and never resubmits” (`SUBMISSION_UNKNOWN`, `--exa-submit-timeout-ms`); recovery remote-ID crash (`RECOVERY_UNAVAILABLE` names the missing ID). |
| 29 | Monitoring “backs off transient GET errors, pauses when they are exhausted and pauses immediately on auth or not-found without fabricating remote failure” (`TRANSIENT_EXHAUSTED`, `AUTH`, `NOT_FOUND`; attempt stays `running`, no notice, no cancel). |
| 30 | Recovery “preserves state across shutdown, discovers without resuming, then an explicit conversational resume re-registers monitoring and delivers once” and “resumes monitoring for a saved run whose registration failed after the create”. |
| 31 | Recovery “refuses a competing live runtime and never duplicates an active monitor”, “pauses monitors of a proven-dead owner on start and lets the next session resume them”, “never duplicates ticks on repeated resume, and resume after tree navigation delivers a pending notice honestly”, “lets late original facts settle after archive without reactivating monitoring or delivering into the archived context”; monitoring “fences shutdown, restart and archive”. Prototype experiment “fences delivery after the runtime is invalidated and never redirects a pending notice to another session”. |
| 32 | Prototype SDK experiment “aborting the chat turn neither cancels the saved run nor lets the monitor create anything”; monitoring/recovery archive paths assert the outstanding-work warning and zero cancel calls; the mock HTTP server records no non-GET/create request in the smoke. |
| 33 | Monitoring “keeps two approved cycles in different sessions isolated: distinct runs, monitors, results and notices”. |
| 34 | Monitoring “delivers failure and local-invalid completion notices with recovery guidance and no further research”; recovery “keeps local-invalid results recoverable within the frozen contract, and resume grants no consent” (same-run recover revalidates; one attempt). |
| 35 | Submission “fails actionably instead of falling back to standalone when guided setup is missing” (`No active research cycle`, `PROPOSAL_REQUIRED`, missing cycleId, explicit standalone still available) and “requires a derivable estimate before proposing metered auto effort” (`ESTIMATE_UNAVAILABLE`). |
| 36 | Smoke `guided-smoke.rpc.test.ts`: real `pi --mode rpc` process, production extension, real `exa-js` against the controllable mock HTTP server (`EXA_BASE_URL`), scripted model, RPC client as the trusted dialog. Interactive TUI rendering is not covered; paid smoke requires separate operator authorization. |

Guided suites:

- [Guided submission](../../packages/pi-exa/__tests__/guided-submission.test.ts)
- [Background monitoring](../../packages/pi-exa/__tests__/guided-monitoring.test.ts)
- [Recovery](../../packages/pi-exa/__tests__/guided-recovery.test.ts)
- [Production smoke](../../packages/pi-exa/__tests__/guided-smoke.rpc.test.ts) with its
  [mock Exa server](../../packages/pi-exa/__tests__/fixtures/guided-smoke/mock-exa-server.ts)
- [Host capability experiments](../../packages/pi-exa/__tests__/guided-prototype.test.ts) and the
  [capability research](../research/2026-10-12-pi-guided-background-host-capabilities.md)

## Safety and verification limits

- No live paid Agent/Connect/contact call, remote cancellation, autonomous retry,
  replacement or post-success gap-closing run was used for this qualification.
- Real registration/flag/lifecycle callbacks and re-created controllers are
  tested, not an interactive full Pi terminal reload. Filesystem fault injection
  and separate-process crash reproduction are not power-loss certification.
- MCP construction/delegation is tested in process; MCP wire-protocol round-trip
  qualification is not claimed.
- Atomic local intents/one-use guards prevent local duplicate authorization;
  they do not create server idempotency or a distributed transaction with Exa.
  Cross-process visibility begins at durable publication of genuine outcomes.
- Private structural historical proofs preserve then-current grants/ledger and
  legitimate later outcomes; they are not cryptographic protection against
  coherent privileged rewriting of all private state.
- SDK receipts are API-reported costs, not verified invoices. Estimates,
  provisional totals, unknown operations, assessed liabilities and overspend
  remain separate. A healthy overview/readiness flag grants no consent.
- Final reports preserve recorded gaps and proposed dispositions, even when a
  valid generated task output claims satisfaction. Completed plans remain
  immutable; evaluation belongs in the final answer, not an automatic plan edit.
  Criterion diagnostics match each view's evidence scope: status uses all recorded
  sources, while brief/source-pack summaries recompute against selected sources
  without changing saved coverage or buying further research.
- Locked/unreadable/legacy stores fail closed for continuation attribution.
  Discovery exposes only coarse unreadable IDs; unrelated explicit standalone
  work remains available. Offline repair must preserve history and live owners.
- Cycle `max`/`ultra`, MCP cycle parity, automatic billing verification and
  production/live paid smoke remain outside this rollout.
- Guided/background limits: Pi offers no delivery acknowledgement API, so notices
  are acknowledged by observing the persisted session entry and exactly-once
  delivery across crashes is not claimed; delivery never targets another session;
  monitoring runs only while Pi is open; crash points are in-process filesystem
  fault injection; the interactive smoke is RPC-protocol, not terminal rendering;
  `researchMode=active` remains the foundation's blocking path (operator decision
  pending) while guided requests route to `submit`.

## Revalidation

Run frozen-lockfile installation, workspace checks/tests/audit, package coverage,
MCP build and diff checks. Apply fresh read-only source/diff review and current-head
CI before merge. Dependency audit is a separate gate, not implied by green tests.
Root patched transitive overrides clear the previously recorded advisories while
preserving the frozen Pi/Exa/bridgekit versions; rerun audit rather than infer
future safety from that historical result. No merge or release is performed by
qualification.

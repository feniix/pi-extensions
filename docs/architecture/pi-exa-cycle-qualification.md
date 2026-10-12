---
title: "Pi integrated Exa cycle: offline qualification"
prd: PRD-010
issue: 160
status: "Merged v1.2 foundation; #171 prototype evidence recorded; 6.1.0 guided/background qualification pending"
---

# Qualification boundary

**Historical foundation evidence, not 6.1.0 release qualification.** PRD-010 v1.3
adds conversational setup/approval, immediate submission acknowledgement,
background monitoring and safe completion delivery (scenarios 21–36).
Those behaviors are not implemented or verified by the evidence below.
The v1.2 foundation is merged; 6.1.0 remains unpublished pending the new gates.

**#171 prototype evidence (design gates, not release qualification).** The
[Pi 1.1.0 host capability research](../research/2026-10-12-pi-guided-background-host-capabilities.md)
and the runnable prototype in `packages/pi-exa/__tests__/fixtures/guided-prototype/`
settle the approval surface, background lifecycle, wakeup, acknowledgement and
bounds for scenarios 21–36. Experiments: `guided-prototype.test.ts` (in-process
Pi SDK session, scripted model, mocked Exa job: approval, headless/declined/stale
refusal, pending-job responsiveness, active-turn delivery, abort without cancel,
transient/auth/not-found pauses, unknown create with late ID, stale-runtime
delivery fence) and `guided-prototype.rpc.test.ts` (real `pi --mode rpc` process
with the forwarded confirm dialog, `get_entries` notice verification, session
replacement and a cancelled dialog). They exercise prototype code, not the
production cycle controller; scenarios 21–36 stay unqualified until #172–#175.

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

## Revalidation

Run frozen-lockfile installation, workspace checks/tests/audit, package coverage,
MCP build and diff checks. Apply fresh read-only source/diff review and current-head
CI before merge. Dependency audit is a separate gate, not implied by green tests.
Root patched transitive overrides clear the previously recorded advisories while
preserving the frozen Pi/Exa/bridgekit versions; rerun audit rather than infer
future safety from that historical result. No merge or release is performed by
qualification.

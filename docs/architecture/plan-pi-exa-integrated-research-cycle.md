---
title: "Pi-first integrated Exa research-cycle contract"
prd: PRD-010
issue: 152
status: "Contract settled; implementation pending"
---

# Pi-first integrated research-cycle contract

Sources: [PRD-010](../prd/PRD-010-pi-exa-integrated-research-cycle.md),
[feasibility and Jev evidence](../research/pi-exa-integrated-cycle-feasibility.md),
[issue #152](https://github.com/feniix/pi-extensions/issues/152).
Operator choices and delegated Jev selections below are not shipped code.

## Activation and host separation

Pi-only `--exa-enable-cycles` is initially disabled by default. When enabled,
an explicitly started/resumed cycle integrates automatically. Each incomplete
execution/recovery/replacement path fails closed rather than silently falling
back to standalone. #157 exposes only independently safe one-attempt execution;
recovery/replacement remain gated until their safety layers. Existing
standalone/MCP defaults remain unchanged; #160 delivers the complete workflow.

Use a thin Pi registration/execution decorator to capture host context.
Inject optional host-neutral per-call raw-response/lifecycle observers into shared
helpers/factory, including late responses and cancel replies. MCP does not install
cycle behavior. Never use process-global mutable current-call context under concurrency.

## Identity, ownership, and durability

Project identity hashes canonical Git common directory, or canonical cwd outside
Git. Cycles have generated IDs, schema versions, monotonic plan revisions and
separate attempt IDs. Owner identity combines Pi session ID and runtime token.
Store curated JSON under the configured Pi agent directory's
`research-cycles/<project-id>/`, with restrictive directory/file permissions.

Start/switch/fork/clone/tree navigation/reload detaches the active pointer.
Explicit resume acquires exclusive ownership; a live owner blocks takeover.
Dead-owner recovery needs verified local liveness or explicit operator recovery,
not TTL alone. Unknown remote execution remains unknown after stale-owner recovery.
Old callbacks may reconcile their attempt under lock, but cannot submit more work
or overwrite another owner's plan. Compaction does not rewind durable state.

Short cross-process locks cover complete read/validate/reserve/durable-write
transactions, not network waits. Write/sync a same-directory temporary record,
atomically replace and sync its directory before submission. Outstanding durable
attempts and fenced ownership prevent duplicate automatic submissions.
Fail closed where filesystem durability/locking is unsupported.
Storage implementation chooses platform primitives and tests crash points;
it must not weaken the invariants.

Reset/archive detaches, retaining attempts, accounting, grants and liabilities.
It never cancels remote work or makes completed records executable.
Permanent deletion is outside this release.

## Commands and spending grants

- `/exa-research start <topic>` creates/activates without paid work.
- `/exa-research list` lists this project's saved cycles and liabilities.
- `/exa-research resume <cycle-id>` acquires ownership and displays existing scope,
  balance and completed/unknown/outstanding execution.
- `/exa-research approve <cycle-id> <amount>` issues an operator budget grant.
  Exception variants identify the exact operation/attempt and uncertainty/
  overspend/unknown-replacement scope.
- `/exa-research archive [cycle-id]` detaches/archives with outstanding-work warning.

Actual TUI/RPC confirmation responses can issue the same records. Cancellation,
decline or timeout does not grant permission. Headless calls pause without an
existing valid grant; no model-writable approval boolean is accepted.
Host command transport is the trusted operator boundary; arbitrary conversation
text or an assistant-supplied budget does not establish consent.

Grants record cycle/project, issuer session, command/dialog source, timestamp,
budget, tool/effort/provider/contact scope, and specifically named exceptions.
Resume preserves but never broadens grants. Scope changes require approval.
Exceptions cannot waive durable intent, ownership, conflicts or completion gates.

## Tools, attribution and conflicts

Keep the four planner names. In Pi cycle mode, step persists structured brief,
execution fields, input/exclusion rows, selected evidence and task schema, updating
revision; status exposes lifecycle/coverage/candidates/grants/ledger/next safe
action; summary previews the compiled artifact; reset archives/detaches.

Pi retrieval/research calls add `researchMode?: "active" | "standalone"`.
Omission uses the active cycle if present, otherwise retains standalone behavior.
Explicit active without a cycle is an error, not a standalone fallback.
Optional `cycleId` / `expectedRevision` assert the active target; they do not
implicitly resume or take over another cycle.
Standalone override denotes unrelated work, not permission to bypass recorded
cycle retries or outstanding restrictions. Code checks identifiable attempts;
semantic attribution remains assistant-owned.

In active Agent execution, query may be omitted because the plan is authoritative.
Explicit execution fields must match persisted values; otherwise update the plan
first. Scalars compare exactly; JSON object key order is canonicalized, array
order retained. No implicit additions, deep merges or execution-time plan mutation.
Exploratory retrieval queries remain search arguments, not final-brief overrides.

## Artifact and remote mapping

Artifact contains cycle/revision, brief, selected evidence, optional input/exclusion
records, task schema, execution controls and optional continuation. Hash canonical
JSON to identify the submitted artifact. Preview/execution share one compiler;
stale asserted revision/artifact fails before paid work.

Initial cycle efforts: minimal/low/medium/high/xhigh/auto; default medium.
Per-run `budget.maxCostDollars` is only for auto under documented server constraints,
not a hard cycle cap. Cycle max/ultra is deferred. Connect/contact work requires
explicit scope plus defensible add-on estimate or scoped uncertainty permission.

Require a persisted draft-07 root-object task schema. Missing/invalid schema blocks
readiness. Validate schema/results locally; do not impose Deep Search depth/property
limits on Agent. Task schema belongs to assistant/operator; package owns a stable
execution envelope. Validation failure after remote success is local processing
failure, not grounds to buy another synthesis.

Map brief and labeled selected URLs/provenance/notes to query text. Stable system
instructions treat notes as untrusted context, not instructions or verified facts.
Only explicit rows map to `input.data` / `input.exclusion`. No invented source-pack
API field. String metadata can identify cycle/revision/attempt, not ensure
idempotency or disclose private local paths/session identifiers.

Envelope retains attempt/artifact, remote ID/status/stop reason/error, task output,
raw field-level grounding, usage, classified costs, timestamps and local processing
outcome. Preserve failed/cancelled accounting and cancel's actual response.
Generated output alone never satisfies criteria.

## Budget, recovery and stopping

Keep published estimates, API retrieval estimates, Agent-reported cost/usage,
unknown liability and optional billing verification distinct. Reconcile reported
totals once; do not count components again or keep superseded reservations.
Unknown rates/extras/outstanding work require explicit assessment and scoped
approval where no defensible bound exists.

Freeze/write intent before create; capture IDs/raw results/late outcomes.
GET recovery never submits create. Unknown attempts block automatic replacement.
Confirmed failures can retry after budget reassessment; specifically approved
unknown replacements retain original liabilities and duplicate-outcome risks.
Remote success closes automatic submission eligibility even if local processing
fails. Recover/validate the existing result. Budget/time-limit completion reports
gaps and stops; another pass needs a newly authorized cycle.

## Slice ownership

| Slice | Contract delivered |
|---|---|
| #153 | JSON durability, lifecycle ownership, resume/archive |
| #154 | Schema validation, artifact compiler and conflict checks |
| #155 | Grants, budget assessments and raw/late retrieval usage |
| #156 | Candidates, curation and preserved provenance |
| #157 | Lifecycle observers, durable submission and result envelope |
| #158 | Remote inspection and interrupted/local-processing recovery |
| #159 | Confirmed-failure retry and scoped unknown replacement |
| #160 | Opt-in activation, guidance and whole-cycle verification |

No broad prefactor ticket is needed: add decorator/observer seams in first
consuming slices with standalone/MCP regression tests. Validator/lock utilities
and transport mechanics are implementation choices subject to these invariants
and repository dependency policy. Unavailable vendor guarantees use the defined
fail-closed/uncertainty paths, not invented support.

## #157 delegated execution decisions

The operator delegated design questions to Jev while authorizing continuation
through the backlog. Design-time `jev-1.13.0` selected these six decisions;
request/response evidence is retained outside git in
`/tmp/pi-exa-157-jev-{request,response}.json`. This is design evidence, not runtime
permission or proof of correctness.

- Extend the approved policy/compiler, real-filesystem controller and registered
  Pi testing seams with the public SDK lifecycle boundary. Mock only external
  create/get/cancel and filesystem crash points.
- Require explicit `web_research_exa` scope in a lifetime grant **and** one-use
  operator `approve-request` permission for the complete immutable compiled
  request. This binds effort, providers, continuation and contact-capable work
  without guessing intent from prose. The total assessment must cover any known
  fixed-effort base price; add-ons/auto remain scoped uncertainty, not vendor caps.
  Default exploratory grants still exclude Agent.
- Use call-local optional before-create/raw lifecycle observers, including late
  create/get/cancel replies. No global current-cycle state or inferred failure
  from formatted tool errors.
- Queued/running cost totals are provisional. Preserve the reservation until
  terminal receipts; interruption/missing terminal cost remains unknown.
- Remote completion irrevocably prevents another automatic run, even when local
  parsing/validation/persistence fails. Retain only validated structured task
  output, normalized credential-free citation metadata, numeric usage/cost and
  bounded processing diagnostics; never the full SDK response or invalid output.
  Exploration retains its separate metadata-only contract.
- Compile/assess/freeze/reserve durable intent in one owned transaction, then
  synchronize before create. Dispatch the exact preview request with a final
  synchronous ownership/generation/budget fence. Attempt identity is local, not
  an invented server idempotency key. #157 blocks replacement after any saved
  attempt; recovery/retry remain separate #158/#159 slices.

Agent price basis: [published pricing](https://exa.ai/docs/reference/pricing)
(last modified August 20, 2026): minimal $0.012, low $0.025, medium $0.10,
high $0.50, xhigh $1.00; contacts/providers are additional. SDK 2.23.0 and
the guide document beta `max`, while newer create docs list `ultra`; both remain
excluded from cycles. No live Agent call is authorized by these decisions.

A second design-time Jev round selected an explicit `failed` cycle lifecycle
for confirmed remote failed/cancelled outcomes, retaining the exact remote status
on its attempt. Local interruption remains `unknown`; cost liability is separate.
The #157 replacement block remains even after confirmed failure. Planning/grant
amendments for retries are a deliberate #159 change, not implicitly enabled here.
Evidence: `/tmp/pi-exa-157-jev-terminal-{request,response}.json`.

A third delegated Jev round reconciled the #157 explicit-call acceptance with
#160 complete-workflow rollout: expose only the safe single-attempt subset now
under the existing opt-in flag and exact operator permissions, with all
unavailable recovery/replacement paths failing closed. Do not invent a new flag
or test-only bypass. Evidence: `/tmp/pi-exa-157-jev-activation-{request,response}.json`.

## #156 evidence implementation decisions

The operator approved metadata-first candidate retention and the public testing
seams: candidate normalization/curation policy, the real-filesystem cycle
controller, and registered Pi tools with mocked SDK responses/compiler previews.

Cycle-attributed retrievals retain only stable candidate identities, bounded
titles/URLs, retrieval state and operation-bound provenance. Source bodies,
highlights, summaries, generated answers, processing rows and full SDK responses
are not automatically retained. Useful content notes are explicit curation.
Candidate capture does not select evidence or satisfy criteria.

Candidate selection/rejection is an explicit planning update. Selection records
a planner source and a labeled execution-plan evidence reference; rejection
removes that candidate's selection without erasing its provenance. Existing
explicit source updates remain the external-evidence interface. Only selected
source facts and provenance enter previews; input rows remain explicit.

Automatic capture requires the original active planning cycle and runtime
ownership. Detach/archive/ownership change prevents delayed callbacks from
changing evidence; late accounting remains a separate operation-bound capability.
The generation fence and final candidate namespace replacement are one synchronous
publication step under the filesystem lock. Revocation during asynchronous
preparation prevents publication; revocation after replacement does not undo
the already-published capture. File/directory synchronization remains required.
Candidate metadata is backward-compatible optional durable state, not a raw
response archive. Standalone, default opt-out and MCP calls do not capture it.

## #155 accounting design grill

The operator approved the accounting-policy, real-filesystem controller, and
registered Pi command/tool testing seams. Design-time Jev (`jev-1.13.0`) selected
the following choices in dependency-aware rounds; the operator confirmed the
resulting design before implementation. Jev is not a runtime dependency.

- Approval amounts set a **total lifetime ceiling**, never additive credits.
- Call-local shared-tool factories carry operation-bound raw/late SDK observers.
- Default grants cover an explicit supported exploratory retrieval allowlist,
  not Agent, Connect/contact work or unknown extras.
- Package-owned published-price profiles record source, publication/review date,
  version and request-derived basis. They are estimates, not vendor billing caps
  or invoice verification. Unsupported pricing fails closed without a separately
  approved, immutable-request-bound uncertainty assessment.
- Checked integer micro-USD arithmetic rounds permission down and exposure up;
  invalid inputs and sum overflow fail closed.
- Owned, atomic assessments count reported usage, all pending estimates and
  explicitly assessed unknown liabilities. Durable operation identity/request
  hash and reservation precede SDK invocation; network waits never hold locks.
- Interrupted reservations remain possible liabilities. Unknown cost blocks
  autonomous spending until a valid receipt or operator permission naming that
  exact operation and assessed liability allowance. Permission does not change
  its classification to reported cost or cover future unknown operations.
- Genuine late callbacks reconcile only their saved operation, including after
  detach/archive/ownership changes. They cannot mutate plans, owners, lifecycle,
  grants or submission eligibility.
- Amendments preserve history and apply the latest ceiling/scope to new work;
  insufficient balance and overspend are surfaced before further dispatch.
- Only explicit valid API totals, including zero, resolve to API-reported usage.
  Reservations are replaced once; components are not counted again. Missing or
  malformed totals remain unknown. Conflicting receipts remain auditable and
  block new work rather than silently applying last-write-wins. Local formatting
  failures cannot discard genuine usage receipts.
- Versioned accounting records validate identities, money, scope and uniqueness.
  Opaque legacy data is preserved, never inferred as consent or zero liability.
- Release a reservation only when call-local facts prove SDK invocation never
  occurred. A local timeout, cancellation or error flag alone is insufficient.

The 12 grill selections had selected-option probabilities 0.97–1.00; this is
design evidence, not proof of correctness. Offline regressions and independent
adversarial review remain required. Development approval grants no live spending.

---
title: "Pi-first integrated Exa research-cycle contract"
prd: PRD-010
issue: 152
status: "6.1.0 guided background workflow implemented (#171–#175); qualified offline, publication pending"
---

# Pi-first integrated research-cycle contract

Sources: [PRD-010](../prd/PRD-010-pi-exa-integrated-research-cycle.md),
[feasibility and Jev evidence](../research/pi-exa-integrated-cycle-feasibility.md),
[issue #152](https://github.com/feniix/pi-extensions/issues/152).
Current source implements the merged v1.2 safety foundation, with an
[offline qualification/acceptance map](pi-exa-cycle-qualification.md).
Operator choices and delegated Jev selections are design evidence, not runtime
consent. PRD-010 v1.3 requires a guided background workflow before 6.1.0 is
published. The section below supersedes the foundation's manual normal-path
commands and submit-and-poll cycle execution. Later sections describe the
reusable foundation and historical slice decisions, not proof of new UX support.

## 6.1.0 target: separate proposal, submission, observation and delivery

### Boundaries

- **Planner/proposal:** assistant-operated non-spending start/update/preview.
  Guided intent routes explicitly to its cycle, with no standalone fallback.
  A human-readable proposal references the canonical request hash/revision
  internally; no second compiler or model-generated authorization object.
- **Approval adapter:** actual trusted host response creates durable scoped
  grants paired to that proposal. Reuse accounting/request/risk checks, without
  asking the user to copy hashes. Cancellation/unavailable UI/stale response
  fails closed. A conversational user request starts planning, not spending.
- **Submitter:** durable frozen intent and exclusive one-use create claim;
  one bounded create wait, remote-ID publication, monitor registration, then
  immediate acknowledgement. It does not wait for terminal completion.
- **Monitor:** host-owned lifecycle service with bounded same-ID GETs, no model
  polling loop, no create/continuation/replacement/cancel authority.
- **Reporter/delivery adapter:** terminal receipt and local processing precede
  durable notification scheduling. Wake the originating assistant at a safe
  turn boundary with an attempt reference, not raw vendor content as instructions.
  Reporting is read-only with respect to research spending.

Names above are architectural responsibilities, not settled public API names.
Do not implement by detaching an untracked promise from the existing blocking
tool or by telling the assistant to call that tool repeatedly.

### Reuse and changed behavior

Preserve the existing canonical project identity, private store, schema checks,
curated artifact/result policy, exact grants, monetary arithmetic, final dispatch
guards, late-observation accounting and immutable historical consent proofs.
Keep remote lifecycle, local processing, local monitoring and notice delivery as
separate state dimensions; a stopped monitor is not a failed Agent run.

Existing cycle submission inherited the shared wait/poll behavior (removed 2026-10-12;
see "#171 settled implementation contract").
The redesigned Pi path must not inherit cancellation-on-chat-interruption from
the blocking standalone path. Standalone/default-opt-out/MCP retain that
existing contract. Explicit recovery remains one bounded saved-run GET; it is
not the repeating monitor and must share safe observation coordination.

### Monitor ownership and persistence

Persist monitor intent bound to canonical project, cycle, attempt, saved remote
ID and originating session. Runtime ownership/generation fences permit at most
one authorized monitor per attempt across contenders. Use existing proven-dead
owner recovery principles, not age alone as takeover authority.

Keep network waits outside storage locks. Late genuine responses can settle only
their original attempt after detach/archive; stale callbacks cannot re-register
timers, notify a different session or submit work. Coalesce unchanged snapshots
without losing durability retries, changed costs, conflicts or late success.
Repeated explicit status/recovery must not spawn parallel polling loops.

Submission and monitor registration can fail independently. If create succeeded
but scheduling failed, retain and return the saved ID with “monitoring paused,”
not successful monitoring or submission failure. Bounded submission timeout
without an ID retains unknown intent. Late acknowledgement is persisted; attach
monitoring only if the originating ownership/context remains eligible.

Use bounded per-GET deadlines, non-overlapping checks and backoff; honor server
retry guidance when available. Numerical cadence/error limits are a design gate.
Auth/not-found/exhausted errors pause observation; remote outcome and financial
liability remain separate. No background action consumes replacement consent.

Shutdown stops local work; restart discovers resumable records without implicit
ownership or monitoring. Explicit user-requested assistant resume reacquires the
cycle and eligible monitor. Switch/fork/tree/archive fences local monitoring and
delivery; explain the pause. This is an in-process Pi feature, not an always-on
OS daemon or a promise of notifications after Pi exits.

### Durable completion delivery

Maintain a durable notice identity per attempt/terminal outcome, with originating
session, pending/delivered state and host acknowledgement when supported.
Persist the outcome first, then schedule delivery; record failure independently
from remote completion. Ordinary duplicate observations enqueue one notice.
Late additional financial facts update the record rather than erase the first
completion; separately material duplicate success remains reportable.

Do not hold the submission tool open or interrupt an active assistant response.
Deliver at a safe boundary or wake the idle origin session. For an unavailable/
detached origin, retain pending state for explicit resume; never redirect to the
currently active unrelated session. Check ownership again at actual delivery.

There is no assumed atomic transaction between filesystem publication and Pi
message delivery. Validate host acknowledgement semantics before choosing an
outbox protocol. Where acknowledgement is ambiguous across crash/restart,
surface pending/uncertain delivery and reconcile rather than claim exactly-once.
Completion of local processing/reporting is not evidence of criterion coverage.

### Implementation gates and verification

Before choosing tool schemas or scheduling APIs, inspect the pinned and supported
Pi extension APIs/examples for trusted confirmation, nonblocking host lifecycle,
safe-turn wakeup, session targeting and message acknowledgements. Verify Exa's
create/GET behavior without assuming SDK request abort or server idempotency.
Record capability evidence and limitations; reopen the design if a requirement
cannot be met. No new runtime dependency or model judgement service is implied.

Test first at real registered Pi tools/commands, host confirmation/lifecycle
boundaries, private filesystem controllers and mocked Exa endpoints. Use a
controllable pending job: submission must finish while the job is still pending,
a second user turn must remain possible, and terminal transition must cause
one safe completion delivery. Cover crash/fault injection, simultaneous runs,
ownership transfer, stale approval, unknown create and missed/ambiguous notices.
Finish with an interactive Pi smoke, not merely scripted callback invocation.
PRD scenarios 21–36 are the new release gates; old qualification does not satisfy
them. Live paid testing and publication require separate authority.

## #171 settled implementation contract

Evidence: [Pi host capability research](../research/2026-10-12-pi-guided-background-host-capabilities.md)
against Pi 1.1.0 (workspace pin moved from 1.0.3) and the runnable prototype in
`packages/pi-exa/__tests__/fixtures/guided-prototype/`. These decisions close the
four design gates above for #172–#175; they are implementation contract, not
prototype approval or spending authority. Material deviation requires operator review.

### Public actions

Keep the four planner names and the existing paid tools; add literals, not tools.

- `exa_research_summary mode="proposal"`: compile the current revision through the
  existing artifact compiler and render the readable proposal (question, scope and
  exclusions, criteria, carried assumptions, source strategy and selected context,
  deliverable, effort, providers/contact scope, processing/exclusion/continuation
  records, estimate and basis, lifetime allowance, existing liabilities, material
  uncertainty, and what is not a vendor cap). Return a `proposalId` bound to the
  artifact hash, plan revision and assessment basis. Non-spending; a newer proposal
  supersedes older unconsumed ones.
- `web_research_exa researchMode="submit"` with `cycleId` and `proposalId`: the only
  guided submission path. Inside the tool: recheck the proposal is current and
  unconsumed; if `ctx.hasUI` is false return `APPROVAL_UNAVAILABLE` and pause; call
  `ctx.ui.confirm` with the proposal text and the approval timeout; on `true` issue
  the lifetime scope and exact-request grants bound to that proposal (reusing the
  existing grant records), freeze and reserve the attempt exactly as `reserveAgent`
  does today, perform one bounded create, publish the remote ID, register the
  monitor, and return `{ cycleId, attemptId, runId, remoteStatus, monitoring }`
  without waiting for a terminal state. Any other dialog result returns
  `APPROVAL_NOT_GRANTED` and submits nothing. Model-writable parameters never carry
  consent; the grant is written only on the `true` branch of the host dialog.
- `exa_research_status` adds `monitor` (state, reason, gets, next delay, last
  success) and `notices` (pending / sent / acknowledged, acknowledged entry ID) to
  its view; `action="resume"` additionally restarts an eligible paused monitor for
  an acquired cycle (#174). Status never spawns a competing monitor.
- Result inspection reuses the existing read-only surfaces: the woken assistant
  reads `exa_research_status` (attempt, monitor, notice and `finalReport`
  projection) and `exa_research_summary mode="brief"` / `mode="source_pack"` for
  selected-only findings, recorded gaps, assumptions and classified usage. No new
  result action is added and the reporting turn performs no paid call.
- Blocking `researchMode="active"` cycle execution is removed (operator decision,
  2026-10-12). With an active cycle it returns `GUIDED_SUBMISSION_REQUIRED` after
  surfacing structured conflicts and stale references; guided submission is the
  only normal dispatch. Explicitly funded `retry` / `replace` keep their
  command-based consent but dispatch through the same non-blocking path with
  background monitoring. Standalone/default-opt-out/MCP calls are unchanged.
  Guided `submit` refuses a cycle that already has a saved attempt before any
  dialog, so an approval is never recorded for a refused submission. `recover`, `retry`, `replace`, standalone, default-opt-out and MCP
  behavior are unchanged. `recover` remains one bounded GET and shares the monitor's
  observation coordination so it cannot overlap a running check.

### Consent binding

`proposalId = hash(artifactHash, revision, assessmentBasis)`. The dialog body is the
rendered proposal; the operator never copies the hash. A plan edit changes the
artifact hash and therefore supersedes the proposal: approval of a superseded or
consumed proposal fails with `PROPOSAL_STALE` before any dialog or create. Decline,
dismissal, timeout and headless invocation are indistinguishable "not granted"
results; none is a consent event and none consumes the proposal.

### Submission and observation bounds

| Bound | Value | Basis |
|---|---|---|
| Create acknowledgement wait | 30 s | Separates acknowledgement from the 180 s full-run default; Exa creates return an ID in seconds. Expiry leaves the attempt `unknown`; a genuine late ID settles the original attempt with monitoring paused (`LATE_ACKNOWLEDGEMENT`). |
| Per-GET deadline | 15 s | One bounded request; deadlines never hold storage locks. |
| First check after acknowledgement | 5 s | Agent runs rarely finish sooner; avoids an immediate wasted GET. |
| Backoff | ×1.5 per pending observation or transient failure, capped at 60 s, ±20 % jitter, non-overlapping (the next check is scheduled only after the previous one completes) | Keeps long runs cheap while bounding notification latency to about one minute. |
| Transient failures | pause after 8 consecutive failures or 10 min without a successful GET | `ExaError` exposes no retry guidance, so local limits apply. |
| Auth (401/403) and not-found (404) | pause immediately (`AUTH`, `NOT_FOUND`) | Not proof of remote failure; remote outcome and liability stay separate. |
| Monitor lifetime | pause after 3 h (`MONITOR_LIFETIME`) | Exa publishes no maximum duration; explicit resume restarts observation without create. |
| Approval dialog timeout | 10 min | Expiry grants nothing. |

Monitoring has no create, continuation, retry, replacement or cancel authority.
Interrupting a chat turn aborts only the model turn: the saved run and its
liability continue; no cancel request is issued.

### Completion delivery protocol

1. On a terminal observation persist remote status, stop reason, classified usage
   and the local processing outcome on the attempt.
2. Persist one notice per attempt/terminal outcome with state `pending`. Repeated
   terminal observations of the same attempt create no second notice.
3. Claim the notice with a serialized `pending → sent` write, then deliver with
   `pi.sendMessage({ customType: "exa-research-completion", content:
   <attempt reference and read-only instruction>, display: true, details:
   { noticeId, cycleId, attemptId, runId, status } }, { triggerTurn: true,
   deliverAs: "followUp" })`. Idle origin → wakes now; streaming origin → after
   pending work; never `steer`. Content is a reference, never vendor output.
   A failed send releases the claim back to `pending` (see "Review hardening").
4. Acknowledge by observation: on `agent_settled` or `session_start`, find the
   `custom_message` entry carrying `details.noticeId` in the session and mark the
   notice `acknowledged` with the entry ID. A `sent` notice without an entry after
   restart is `uncertain` and is reconciled, not re-sent automatically and not
   dropped. Exactly-once is not claimed.
5. A stale runtime (session replacement, reload, SDK dispose) throws on
   `sendMessage`; keep the notice `pending`, record the error, and let the origin
   session's `session_start` discovery surface it. Foreign sessions report but
   never deliver another session's notice.

### Review hardening (2026-10-12)

- Notices are claimed with a serialized `pending → sent` write before `sendMessage`, so a
  monitor tick and an explicit resume cannot both deliver one notice; a failed send
  releases the claim. A re-sent uncertain notice keeps a persisted `possibleDuplicate`
  label until it is delivered.
- A terminal outcome returned in a foreground tool result (explicit recover, or an
  acknowledgement that is already terminal) is recorded as an acknowledged notice with
  `channel: "tool-result"` and never notified again. Every reported terminal attempt has a
  monitor record, so resume notifies a terminal attempt without one (for example a late
  acknowledgement that arrived after detach).
- Session start summarizes other sessions' undelivered notices in one line without
  delivering them; an invalid `EXA_BASE_URL` pauses monitoring as `CONFIGURATION` instead
  of retrying, and the value is never echoed.
- A genuine create acknowledgement that arrives after `SUBMISSION_UNKNOWN` (including an
  unknown original after a replacement) is adopted into background monitoring.
- Dialog approvals merge with the grant current at write time (never lowering a ceiling
  or scope), recheck for an existing attempt inside the write, and are not offered while
  overspend, conflicting receipts or unassessed unknown liabilities exist.
- Provider/contact requests have no package estimate: the operator assesses the exact
  request by command and the dialog confirms that existing funding.
- Monitors detach only on non-cancellable events (`session_shutdown`, `session_tree`); a
  vetoed switch or fork keeps observing. Ticks act only for the live entry of their key.

Former residuals, now fixed:

- A dialog approval and its Agent reservation are written in one transaction
  (`approveAndReserveAgent`), so an approval is never recorded without its attempt.
- Cycle owners and storage locks record their process start time; a live pid whose start
  time differs is a reused pid and the original owner is treated as dead. Records without a
  start time (legacy data, or platforms without `ps`) keep the conservative pid-only rule.

### Lifecycle fences

Stop timers and mark monitors `paused:SHUTDOWN` on `session_shutdown` for every
reason; `session_start` marks any monitor left `registered`/`running` as
`paused:RESTART` and reports pending notices without delivering them. Explicit
resume (#174) reacquires ownership and restarts eligible monitors. Archive stops
monitoring and delivery and warns that remote work may continue.

### State dimensions

Keep four independent dimensions on each attempt: local submission
(`submitting`/`acknowledged`/`unknown`), remote lifecycle (`queued`/`running`/
`completed`/`failed`/`cancelled` plus stop reason), monitoring (`none`/
`registered`/`running`/`paused:<reason>`/`stopped`) and delivery
(`pending`/`sent`/`acknowledged`/`uncertain`). A paused monitor is not a failed
run; a sent notice is not a delivered one.

## Activation and host separation

Pi-only `--exa-enable-cycles` is initially disabled by default. When enabled,
an explicitly started/resumed cycle integrates automatically. Planning,
compilation, scoped accounting, one-use submission, explicit existing-run
recovery and funded retry/replacement are active under that opt-in. Unsupported
paths fail closed rather than silently falling back to standalone.
Completed-cycle views report recorded gaps/criteria and classified usage without
automatic satisfaction, verified billing or follow-up spending. Existing
standalone/MCP defaults and tool enablement remain unchanged.

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

## #159 delegated retry/replacement decisions

Jev selected a specific operator `approve-replacement` command binding project,
cycle, original unknown attempt/operation and the new immutable request hash.
It records literal duplicate-work/possible-additional-charge acknowledgment
and an original-liability assessment. Independent lifetime tool scope, a new
exact-request permission and fresh total-exposure assessment remain mandatory.
Assistant flags/amounts and Jev judgments never establish this consent.

Every unresolved unknown original needs a fresh unused exact-bound risk grant;
the exception cannot bypass unrelated live local execution, ownership,
receipt durability or submission guards. Consumed risk grants remain in
history and cannot authorize another replacement. Late successes remain
visible and stop further submissions, including duplicate outcomes following
a specifically approved exception.

Revised briefs remain drafts under failed/unknown lifecycle, with old frozen
artifacts/attempts/liabilities intact. Explicit retry/replacement preview and
execution use new revision/request identities; completion is never reopened
for further research. New cycles still require operator go-ahead.

Evidence: `/tmp/pi-exa-159-jev-{request,response}.json`.
The first pure history/risk policy slice is assessment-only; runtime retry,
operator commands and replacement execution remain gated pending controller
and registered Pi regressions.

The durable draft slice projects history from validated saved Agent attempts
and original ledger operations, not tool-supplied outcome flags. Editing and
preview preserve failed/unknown lifecycle and all prior contracts. Any success,
live intent/run, or unclassified history blocks a draft. Budget amendments and
new exact-request permissions may be recorded for an owned draft but do not
enable dispatch; the original single-attempt reservation guard remains.

Replacement records retain command/session provenance and a binding to the
simultaneously recorded original-operation liability permission, including its
assessment amount and issuance metadata. Publication/restore validate these
bindings. The controller rejects assessments below currently known costs,
including genuine provisional totals and the conservative published fixed-base
floor, and blocks conflicting receipts. These assessments are not vendor caps
or verified invoices. Late genuine completion still closes the entire cycle
without deleting its risk grants. Pi operator command registration, fresh
financial dispatch checks and risk consumption remain subsequent slices.

The intent slice adds explicit controller-only retry/replacement reservations.
Each gets a new operation and exact-request nonce after fresh total-exposure
assessment; specific risk IDs are consumed once in immutable intent metadata,
with source-attempt chronology and grant/request bindings checked on restore.
An intervening original-liability amendment invalidates an older paired risk
grant. Failed reservations do not consume grants. Aggregate lifecycle includes
all saved attempts: one local nondispatch cannot reopen unknown original work,
nor can an older failure hide a newer live intent. The intent-only milestone
kept transition SDK creates behind `RETRY_DISPATCH_GATED`; the subsequent
controller dispatch slice replaces that temporary gate with the fences below.
Registered Pi activation was implemented in the following explicit command/tool slice.

Jev selected frozen historical authorization proof rather than replaying today's
outcomes as though they existed at reservation. Each transition retains all
prior closed attempt facts/consumed risk IDs, known liability assessments, the
ordered recognized grant prefix and curated pre-intent monetary ledger.
Restore checks exhaustive immutable identities and compatible later outcomes,
replays then-current eligibility/funding/exposure and then-latest paired risk
liability, and requires the exact consumed source/risk arrays and a unique
request nonce covering the new hold. This is structural private-record proof,
not cryptographic authenticity or independent invoice verification.

Later genuine success, receipt growth/conflicts or appended operator liability
amendments must remain recordable/readable; they do not retroactively erase valid
historical consent. Future actual submission must separately recheck today's
success/concurrency/ownership/funding/liability state at its final guard.
Evidence: `/tmp/pi-exa-159-jev-restore-{request,response}.json`.

Grant issuance and intent/operation creation use a monotonic logical timestamp
computed from existing recognized events and wall time. It orders commands even
when the wall clock stalls or moves backward; it is not a lease timeout or a
vendor timestamp. The historical grant set must equal every recognized grant
issued strictly before the intent's cutoff, which must match its operation's
creation time. Truncation cannot hide an earlier amendment; extension cannot
turn a later nonce into historical funding. The restored liability minimum also
covers the immutable request's published fixed rate and frozen ledger receipts,
without treating later provisional growth as an invalid historical approval.

Controller dispatch rechecks original history, latest paired risk/liability,
held exact-request nonce, current total exposure, frozen artifact, owner and
generation both before the durable claim and in a synchronous no-await final
guard. The final guard opens a private owned regular record with no symlink
following, validates a fresh snapshot and never echoes malformed private JSON.
Known original success, another held local operation, grown liability or lost
scope/ownership blocks a new create without deleting its saved intent.

A same-process, operation-bound genuine completion latch also blocks creates
while the asynchronous receipt is publishing; successful durable publication
clears it, whereas unresolved local persistence failure remains conservative.
Across processes the fresh durable snapshot is the visibility/linearization
boundary; this is not a distributed transaction with vendor state. Local
nondispatch then releases only the new hold and preserves older unknown work.
Real-controller/mock-SDK regressions exercise funded failed retry and explicitly
approved unknown replacement with both late successes preserved and no third
create. No live paid SDK call or independently verified invoice is claimed.

The same-process completion latch uses the canonical real private-store
directory, not caller path spelling. A two-controller regression proves a
pending original completion blocks replacement through an equivalent relative
root after ownership handoff, before its asynchronous receipt publication.

Pi registration now exposes explicit `retry`/`replace` modes only on the opted-in
Agent tool and requires a resumed explicit cycle ID. The operator-only
`approve-replacement` command atomically issues the specific duplicate-work/
additional-charge acknowledgment and paired original liability assessment.
Each unknown original needs its own unused exact-new-request permission;
generic liability grants, assistant flags and ordinary active calls cannot
provide that consent. A preview displays the deterministic full SDK request
hash without creating a permission or reservation.

Registered-tool/mock-SDK regressions exercise failure plus freshly funded retry
and unknown work plus an amended draft/schema, explicit risk command and
replacement. The original late success validates against its original schema;
both results/charges survive, status and late progress surface duplicate
successes, and completion blocks a third call. Malformed/stale/underfunded risk
commands leave grants unchanged and never dispatch. Default-opt-out/standalone/
MCP behavior is unchanged. Full-feature review/publication remains pending.

## #158 delegated recovery decisions

Jev selected explicit Pi-only actions on existing tools: status `action=resume`
with a saved cycle ID, and Agent `researchMode=recover` for the existing
attempt. Default status remains inspection; neither startup nor saved-state
discovery implicitly resumes or grants spending consent. Standalone/MCP
contracts remain unchanged.

Recovery is one bounded SDK `agent.runs.get(id)` per explicit invocation, not
`create(previousRunId)`, an automatic polling loop or remote cancellation.
Local timeout/abort leaves the original attempt outcome uncertain; attached
call-local observers may still reconcile a late genuine reply. Missing IDs,
404/auth/network failures remain actionable unknown, not fabricated remote
failure. GET must bind the original saved attempt and validate/reprocess with
its frozen artifact/schema, without a new operation, grant or submission.
Source: Exa get-a-run primary documentation and pinned SDK 2.23.0.
Evidence: `/tmp/pi-exa-158-jev-{request,response}.json`.

The SDK inspection, original-attempt controller and registered Pi tool slices
are now implemented with offline regressions. Pi status discovers saved
summaries without activation; explicit resume acquires ownership, and explicit
Agent recovery performs one GET without a new attempt/reservation. Missing IDs
stay unknown, terminal completion cannot be undone, frozen assertions are
checked at preparation and actual GET preparation, and each GET observation
capability is one-use. Provider prose/raw responses remain outside durable
storage. The complete layer still requires fresh full-diff review; replacement
and whole-workflow rollout remain #159/#160.

## #157 review decisions

Fresh full-diff review identified two non-blocking display/diagnostic gaps.
Under the operator's delegated design authority, Jev selected a neutral
assessment-only `ledgerHealthy` status field (never a status `canDispatch`
claim) and a closed, package-owned remote-error summary instead of archiving
arbitrary vendor prose. Real per-request assessments retain `canDispatch`.
Evidence: `/tmp/pi-exa-157-jev-review-{request,response}.json`.

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

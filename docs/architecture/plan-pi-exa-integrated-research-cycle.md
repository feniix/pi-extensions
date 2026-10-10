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
an explicitly started/resumed cycle integrates automatically. Until all safety
slices land, integrated paid execution fails closed rather than silently falling
back to standalone. Existing standalone/MCP defaults remain unchanged.

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

# @feniix/pi-exa

[Exa AI](https://exa.ai) extension for [pi](https://pi.dev/) with search, fetch, research, and answer capabilities.

## Features

- **web_search_exa**: default web search (highlights + short text snippets).
- **web_fetch_exa**: fetch page content by URL.
- **web_search_advanced_exa**: filtered search and synchronous Deep Search through `/search` (disabled by default).
- **web_research_exa**: asynchronous Agent research with polling and remote cancellation once a run ID is known (disabled by default).
- **web_answer_exa**: quick grounded answers.
- **web_find_similar_exa**: discover related URLs.
- **exa_research_step/status/summary/reset**: local, stateful research-planning tools that recommend explicit Exa retrieval calls without executing them.

## Why pi-exa vs the hosted Exa MCP?

The hosted Exa MCP at `https://mcp.exa.ai/mcp` is a fine default for one-shot search and fetch. pi-exa exists for cases the hosted MCP cannot address by design:

- **Tools the hosted MCP does not expose.** `web_answer_exa` (Exa's `/answer` endpoint) and `web_find_similar_exa` (`/findSimilar`) are not advertised by the hosted MCP under any flag. If you need grounded answers with citations or "more like this" discovery, you call them directly through pi-exa.
- **Local stateful planning.** `exa_research_step / status / summary / reset` keep an in-memory research plan that survives across calls in a single pi session. A stateless remote MCP cannot offer this — there is no per-session memory to update.
- **Local key custody and allowlists.** Your `EXA_API_KEY` and `enabledTools` allowlist stay on the workstation. The hosted MCP requires sending your key to a third party on every request.
- **Pre-flight validation.** pi-exa rejects category/filter combinations Exa silently ignores (e.g., `category: "people"` with non-LinkedIn `includeDomains`), so you find out at the call site instead of in a quiet, empty result set.
- **Agent-native research lifecycle.** `web_research_exa` submits an Agent run, polls it to a terminal state, and cancels the remote run when the host aborts or its deadline expires after a run ID is known. Other tools stay on Exa's purpose-built `/search`, `/contents`, `/answer`, and `/findSimilar` APIs.

| Capability                                  | Hosted Exa MCP | pi-exa |
| ------------------------------------------- | :------------: | :----: |
| `web_search_exa`                            |       yes      |   yes  |
| `web_fetch_exa`                             |       yes      |   yes  |
| `web_search_advanced_exa`                   |     opt-in     |  opt-in|
| `web_answer_exa` (`/answer`)                |       no       |   yes  |
| `web_find_similar_exa` (`/findSimilar`)     |       no       |   yes  |
| Local research planner (`exa_research_*`)   |       no       |   yes  |
| Local API key custody                       |       no       |   yes  |
| Agent Runs API with timeout cancellation    |       no       |   yes  |

## Install

```bash
pi install npm:@feniix/pi-exa
```

For ephemeral use:

```bash
pi -e npm:@feniix/pi-exa
```

## Configuration

You need an Exa API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) for retrieval tools. The local `exa_research_*` planning tools work without an API key because they do not call Exa network APIs.

If you configure `enabledTools`, it acts as a strict allowlist. Include the `exa_research_*` names if you want the planner tools available with an explicit allowlist.

### Recommended: environment variable

```bash
export EXA_API_KEY="your-key"
```

### Recommended for private overrides: explicit config file

Use a private config file when you want to store an API key outside shared project settings:

```json
{
  "apiKey": "your-key",
  "enabledTools": [
    "exa_research_step",
    "exa_research_status",
    "exa_research_summary",
    "exa_research_reset",
    "web_search_exa",
    "web_fetch_exa",
    "web_answer_exa",
    "web_find_similar_exa"
  ],
  "advancedEnabled": false,
  "researchEnabled": false
}
```

Then run pi with:

```bash
pi -e npm:@feniix/pi-exa -- --exa-config-file ~/.config/pi/exa.json
```

### Shared non-secret settings

Supports standard pi settings locations:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Example:

```json
{
  "pi-exa": {
    "enabledTools": [
      "exa_research_step",
      "exa_research_status",
      "exa_research_summary",
      "exa_research_reset",
      "web_search_exa",
      "web_fetch_exa",
      "web_answer_exa",
      "web_find_similar_exa"
    ],
    "advancedEnabled": false,
    "researchEnabled": false
  }
}
```

`apiKey` is accepted in settings files for compatibility, but `pi-exa` will warn when it is loaded there. Prefer `EXA_API_KEY` or `--exa-config-file` for secrets.

## CLI flags

- `--exa-api-key <key>`: API key override.
- `--exa-enable-advanced`: enable `web_search_advanced_exa`.
- `--exa-enable-research`: enable `web_research_exa`.
- `--exa-config-file <path>`: load configuration from file.
- `--exa-config <path>` (deprecated alias for `--exa-config-file`).
- `--exa-timeout-ms <ms>`: default per-call timeout for Exa-backed tools (built-in 60000).
- `--exa-research-timeout-ms <ms>`: override for `web_research_exa` Agent runs (built-in 180000).

> For ordinary Exa SDK calls, the timeout bounds the JS-side wait because `exa-js` does not yet accept `AbortSignal` ([exa-labs/exa-js#158](https://github.com/exa-labs/exa-js/issues/158)). `web_research_exa` owns the Agent run lifecycle and calls Exa's cancel endpoint on host abort or timeout once Exa has returned a run ID.

## Tools

### Opt-in durable Pi planning

Start Pi with `--exa-enable-cycles` to use durable research planning:

- `/exa-research start <topic>` creates an isolated cycle without paid work.
- `/exa-research list` lists readable saved cycles and coarse unreadable cycle IDs
  in this project. Unreadable contents are never displayed; attribution checks
  remain fail-closed until those records are repaired.
- `/exa-research resume <cycle-id>` explicitly acquires ownership after restart.
- `/exa-research approve <cycle-id> <total-dollar-ceiling> [tool,tool...]` records an operator
  grant for supported exploratory retrieval. Each approval sets the cycle's
  **total lifetime ceiling**, not additional credits. Grant history survives
  resume/archive; assistant approval fields do not establish consent.
  The optional comma-separated scope replaces the whole allowlist. Default scope:
  `web_search_exa`, `web_fetch_exa`, `web_find_similar_exa`, `web_search_advanced_exa`.
  `web_answer_exa` requires an explicit scope amendment. Agent/Connect/contact tools
  cannot be added to this exploratory grant.
- `/exa-research approve-request <cycle-id> <request-hash> <assessed-dollars>`
  approves one attempt of that exact uncertain request, after inspecting the
  denied tool call's request and SHA-256 hash. Changed arguments require new permission.
  Repeating/amending approval uses the latest record, never reviving older unused grants.
- `/exa-research approve-liability <cycle-id> <operation-id> <assessed-dollars>`
  names one existing unknown operation and an assessed allowance. It stays unknown,
  counts against the total ceiling, and never covers another unknown operation.
  Conflicting API receipts cannot be resolved through uncertainty permission.
- `/exa-research archive [cycle-id]` detaches and archives without deleting history.

The four `exa_research_*` tools then update, inspect, summarize, and archive the
active cycle. Reset does not cancel remote work or clear liabilities.
Session switches, forks, tree navigation, reload/shutdown detach the active cycle;
detachment fences pending start/resume operations too. Restart never automatically
resumes it. Live owners prevent competing resumes.
Related Git worktrees share a project namespace, not active session ownership.
Inherited Git repository/discovery environment overrides do not change that identity.

Curated JSON lives under the configured Pi agent directory's
`research-cycles/<project-id>/`, outside git, with private permissions.
Short transaction locks publish complete private PID/token records atomically.
Only proven-dead process owners are reclaimed; live processes are never evicted
by age. Competing reclaimers serialize, including bounded crashed-reclaimer
recovery. Legacy empty, malformed or unverifiable locks are retained: the error
names the lock path for explicit offline repair after confirming no process is
using the store. Never remove a live process lock or delete cycle history.
Storage hierarchy synchronization runs once per controller; private directory
ownership/type checks and record publication synchronization remain enforced.
Per-step raw notes/update payloads are not retained; selected source notes,
criteria, assumptions, gaps and revision metadata are retained.
Credentials and full raw retrieval archives are not written by this planner.
Invalid IDs/counters and unsupported records fail closed; restored evidence and
inspection diagnostics are recomputed from retained facts.
Unknown execution remains unknown after
resume; completed records cannot be edited back into executable planning.

The current implementation includes local persistence, request compilation and
exploratory accounting. **Agent execution remains unavailable** until its safety
slice lands. Attributed retrieval requires a recorded operator grant and an
atomic pre-call assessment. Include the active `cycleId` (and optionally
`expectedRevision`) on each exploratory tool call:

```json
{ "query": "Exa pricing", "researchMode": "active", "cycleId": "<active-cycle-id>", "expectedRevision": 0 }
```

Each operation reserves allowance before SDK invocation; concurrent calls share
pending estimates. Responses/status show API-reported totals, pending estimates,
unresolved operation IDs, operator-assessed liabilities and overspend separately.
Permission is rounded down, costs up, using safe integer micro-USD.
Only a genuine explicit SDK total (including zero) replaces its reservation.
Missing/malformed costs and local timeout/cancellation remain unknown; late
receipts reconcile even after detach/archive. Formatting errors cannot erase
genuine usage. Only proven pre-SDK nondispatch releases a reservation.
If saving a genuine receipt fails, its original total is retried rather than
replaced by missing evidence. Persistent durability failure returns the known
SDK receipt marked unconfirmed and blocks further cycle spending in that runtime.
Repair storage, reload and explicitly resume: interrupted reservations remain
unknown, never silently zero. No power-loss or vendor invoice verification is claimed.

Approval displays the versioned published-price profile and source/review date.
Supported assessments cover basic search, bounded regular/deep/deep-reasoning
advanced search, and dedicated content types/pages. Find-similar, answer,
deep-lite, additional queries, subpages, deprecated context and unsupported
options need exact-request uncertainty assessment. Unbounded or unaffordable
calls return operator-command guidance without dispatch. Other-provider costs
are outside the Exa ledger. These are best-effort estimates, **not vendor billing
caps or independently verified invoices**.

`researchMode: "standalone"` explicitly selects unrelated legacy retrieval.
Standalone requests must omit `cycleId`, `expectedRevision` and `artifactHash`;
combining standalone mode with cycle references is rejected before dispatch.
With no active cycle, normal standalone web tools remain available.
Continuations identifying a saved cycle attempt and requests carrying a saved
cycle's `metadata.cycleId` remain blocked even with a standalone override or after archival.

#### Structured plans and artifact previews

In cycle mode, `exa_research_step` accepts `executionPlan` alongside the existing
required step fields. For example, after `/exa-research start pricing`:

```json
{
  "topic": "pricing",
  "stage": "framing",
  "note": "Frame the comparison",
  "thought_number": 1,
  "total_thoughts": 2,
  "next_step_needed": true,
  "expectedRevision": 0,
  "executionPlan": {
    "goal": "Compare current official US prices",
    "scope": ["US"],
    "constraints": ["Distinguish uncertain claims"],
    "taskSchema": {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "citations": { "type": "array", "items": { "type": "string", "format": "uri" } }
      },
      "required": ["summary", "citations"],
      "additionalProperties": false
    },
    "controls": { "effort": "medium" }
  }
}
```

Each supplied `executionPlan` field **replaces that whole field**. Omitted fields
remain unchanged; objects and arrays are not deep-merged. `controls: {}` restores
the medium/default controls; `input: {}` clears processing/exclusion rows;
`selectedEvidence: []` clears the selection. `taskSchema: null` clears the contract
and blocks compilation; `previousRunId: null` clears continuation.

Use `selectedEvidence: [{ "sourceId": "S1", "label": "Official pricing", "notes": "Relevant table" }]`
only after recording that source (the same step may record and select it).
Selected URLs, provenance and notes become labeled **untrusted query context**.
Only explicitly supplied `input.data` and `input.exclusion` arrays become
processing/exclusion records; evidence is never converted into rows.
Save only curated, nonsecret values: explicit rows may contain sensitive data.

`exa_research_summary` defaults to compilation in cycle mode; `execution_plan`
and `payload` do the same. `brief` / `source_pack` show read-only **selected-only**
evidence views; inspect all candidates and planner sources through status.
The returned `details.artifact` includes artifact version, cycle/revision,
brief, selected evidence, output contract, controls, optional input/continuation,
the actual SDK-shaped `request`, and a canonical SHA-256 `hash`. No raw step
chatter or unselected candidate content enters that request. The hash is an
identity check, not authorization or remote idempotency.

Persist a goal and draft-07 root-object task schema before compiling. Local
schema/result validation supports local references and standard formats, without
Deep Search property/depth limits. Unknown keywords/formats, async schemas and
unresolved remote references fail closed; validation never fetches schemas.
Schema dialect is draft-07 when `$schema` is omitted.

Controls allow `minimal`, `low`, `medium` (default), `high`, `xhigh`, or `auto`;
cycle `max` / `ultra` remain deferred. `controls.budget.maxCostDollars` is only
for `auto`, within the documented $1–$100 server range, **not a cycle spending
grant or hard cycle cap**. Optional `controls.dataSources` names up to five
Connect providers but grants no provider/contact permission. Optional
`previousRunId` describes a new continuation run, never recovery.

`cycleId`, `expectedRevision` and `artifactHash` on previews/active Agent calls
assert the intended snapshot. Active Agent `query` may be omitted. Explicit
execution fields must equal the compiled authoritative values: scalars exactly,
JSON objects ignoring key order, arrays retaining order. Conflicts identify the
field to update; execution never adds fields, deep-merges or mutates the plan.
Compilation returns `previewOnly: true`; it never establishes spending permission.

#### One compiled Agent attempt

With cycles enabled, an active `web_research_exa` call executes the exact current
artifact after **both** operator permissions:

1. `/exa-research approve <cycle-id> <total-dollar-ceiling> web_research_exa`
   explicitly includes Agent in the lifetime tool scope (include other desired
   tools in the comma-separated scope; amendments replace the scope/ceiling).
2. `/exa-research approve-request <cycle-id> <request-hash> <assessed-dollars>`
   names the full immutable request displayed by the permission pause, including
   effort, providers, continuation and contact-capable query/output contract.

The request hash is distinct from the preview artifact hash. Request permission
is single-use; plan changes require a new exact-request assessment. An assessment
below the published fixed-effort base price fails closed. Contact/Connect extras
and metered work need the explicit full-request assessment; neither the estimate
nor the cycle ceiling is a vendor-enforced billing cap. Generic exploratory
grants still exclude Agent. No assistant-supplied flags or numbers grant consent.

Before create, the controller atomically freezes the artifact, permission/budget
assessment and unique attempt/operation, persists intent, and claims one SDK
dispatch capability. Write/sync failure prevents submission. Progress includes
the remote ID as it becomes available; queued/running costs are provisional,
not final receipts. Terminal explicit totals (including zero) reconcile once.
Missing/malformed costs and local interruption remain unknown, not free work.

Status exposes attempts and the curated execution `result`: validated structured
task output, normalized credential-free citation metadata, numeric usage and
processing diagnostics. This explicitly requested synthesis is retained privately;
the exploration metadata-only policy is unchanged. Full SDK responses, request
headers, unrequested generated prose, source excerpts and invalid task outputs
are not archived automatically. Artifacts/explicit rows must remain nonsecret.

Confirmed remote completion marks the cycle `completed` even if local schema
validation fails. Findings never satisfy criteria automatically or buy more
research. Confirmed remote failed/cancelled runs are `failed`; local timeout/error
without terminal confirmation is `unknown`. Every saved attempt blocks another
submission in this slice, even after proven nondispatch. Inspect the existing
attempt rather than repeat the paid call; recovery/replacement are still gated
until the following safety layers. Archive retains liabilities and never cancels
the run. Late observations can settle only their original attempt, not reactivate
it or mutate another cycle's plan/ownership.

Standalone/default-opt-out and MCP remain unchanged. Recorded cycle run IDs
cannot be continued through an unrelated standalone override. This is the
independently safe one-attempt subset, not the completed workflow rollout.

#### Candidate evidence and curation

Approved, explicitly cycle-attributed exploratory calls capture metadata from
SDK results, answer citations and Deep Search grounding citations. Results and
status expose `candidates`, each with a stable URL-derived `id`, title, retrieval
state, decision and operation provenance (tool, operation ID, request hash,
original revision and retrieval timestamp). URL fragments are ignored for
deduplication; meaningful query parameters are preserved. Only HTTP(S) URLs are
accepted; userinfo and common credential-bearing query parameters (including
signed-URL `sig` / `signature` parameters) are rejected.
Titles are limited to 512 characters and URLs to 8192.

Candidate capture retains **no automatic text/highlight/summary excerpts, generated
answers, raw SDK responses or processing rows**. Returned text/highlights can mark
retrieval as fetched, not independently verified; generated summaries/synthesis
alone do not prove source inspection. Metadata alone remains discovered-only.
Failed URL statuses record fetch-failed metadata where a URL is available.
Capture never selects a source or changes criterion coverage.

Select a candidate explicitly through a normal `exa_research_step`:

```json
{
  "topic": "pricing",
  "stage": "source_retrieval",
  "note": "Curate official evidence",
  "thought_number": 2,
  "total_thoughts": 3,
  "next_step_needed": true,
  "evidence": [{
    "candidateId": "candidate-<hash-from-status>",
    "decision": "select",
    "label": "Official pricing",
    "notes": "Explicitly record the relevant finding here"
  }]
}
```

Selection records a planner source and labeled selected evidence, with frozen
provenance. Later retrieval of the same URL enriches candidate metadata but does
not silently change the selected artifact; reselect explicitly to refresh it.
Reselection refreshes candidate-created source title/retrieval metadata while
preserving curated notes. Reused external sources retain their explicit metadata.
Use `{ "candidateId": "...", "decision": "reject" }` to remove that candidate's
selection while preserving its metadata/history. Use `evidence` decisions or
`executionPlan.selectedEvidence` in a single step, not both. Duplicate/unknown
candidate decisions are rejected without committing a planning step.

External tools are not intercepted. Explicitly record their evidence through
`sources` (including `retrievalEvidence`, useful `contentNotes`, and a source ID),
then select it with `executionPlan.selectedEvidence`; both may happen in one step.
Criteria still need explicit evidence-backed updates, not automatic satisfaction.

Candidate metadata, selected sources and curated notes survive explicit resume.
Old capture capabilities are fenced on detach/archive/reattach; late accounting
can still reconcile its original operation.
Revocation before the atomic candidate namespace replacement prevents publication;
a capture already published before revocation remains recorded, including when
directory synchronization is still pending.
If candidate persistence fails after
cost reconciliation, the returned content is preserved with a durability warning:
explicitly curate it instead of repeating paid work. Standalone/default-opt-out
and MCP calls do not install candidate capture.

The storage uses short exclusive filesystem transactions and durable replacement,
including synchronization of the namespace's containing directories.
An interrupted transaction may leave a `.lock` file; do not infer remote failure
or delete it automatically. After verifying no process is using that project
store, an operator may recover the orphaned lock. On filesystem write/sync failure,
inspect the durable record before resuming; a reported failure may occur after
replacement. Do not use shared/network filesystems that cannot honor these
locking/durability guarantees.

Without the flag, existing Pi planning stays in memory. MCP behavior is unchanged.

### exa_research_step

Records one step in an in-memory research-planning session. Params include `topic`, `stage`, `note`, optional `criteria`, `sources`, `gaps`, `assumptions`, `nextAction`, branch/revision metadata, `thought_number`, `total_thoughts`, and `next_step_needed`.

### exa_research_status

Reports the current local planning state: topic, step count, active stage, branches, criteria coverage, source pack summary, open gaps, assumptions, and recommended next action.

### exa_research_summary

Generates human-readable research planning output. Modes: `brief`, `execution_plan`, `source_pack`, and `payload`. Payload mode suggests a `web_research_exa` payload only; it does not run retrieval.

### exa_research_reset

Clears the active in-memory planning session.

### web_search_exa

Params: `query` (required), `numResults`.

Returns: formatted snippets with optional highlights and metadata (`costDollars`, `searchTime`).

### web_fetch_exa

Params: `urls` (required array), `maxCharacters`, `highlights`, `summary` (`query`), `maxAgeHours`.

### web_search_advanced_exa

Params:

- `query` (required)
- `numResults` (1-100, default 10)
- `category`: one of `company`, `publication`, `research paper`, `news`, `pdf`, `personal site`, `financial report`, `people`
- `type`: `instant | fast | auto | deep-lite | deep | deep-reasoning`.
- `systemPrompt`: instructions guiding search behavior, source selection, and synthesis.
- `outputSchema`: `{ "type": "text" }` for prose or an object JSON Schema for structured synthesis.
- Date filters: `startPublishedDate`, `endPublishedDate` (ISO dates).
- Domain filters: `includeDomains`, `excludeDomains`.
- Text filters: `includeText` (single-element array; only return results whose text contains this string, up to 5 words), `excludeText` (single-element array; exclude results whose text contains this string, up to 5 words). The Exa API accepts at most one string per filter.
- `userLocation`: two-letter ISO country code (e.g., `US`, `GB`, `DE`).
- `moderation`: when `true`, filter unsafe content.
- `additionalQueries`: alternative query formulations for `deep-lite`, `deep`, or `deep-reasoning` only.
- `textMaxCharacters`: max chars of page text per result (default 3000).
- `contextMaxCharacters`: max chars for the aggregated context string. Maps to Exa's deprecated `context` option and may be removed in a future Exa API release.
- Highlights: `enableHighlights` (gate), `highlightsMaxCharacters` (preferred), `highlightsNumSentences` (legacy fallback), `highlightsQuery` (overrides the search query for highlight ranking). Providing `highlightsQuery` or `highlightsMaxCharacters` implies `enableHighlights: true`; passing `enableHighlights: false` explicitly always disables highlights.
- Summary: `enableSummary` and/or `summaryQuery` (providing `summaryQuery` implies `enableSummary: true`; passing `enableSummary: false` explicitly always disables the summary).
- Freshness: `maxAgeHours` (0 = always fresh, -1 = cache-only), `livecrawlTimeout` (ms; capped at 60000 = 60s).
- Subpages: `subpages` (1-10), `subpageTarget` (single keyword or list of keywords used to select which subpages to crawl, e.g. `'about'` or `['about', 'pricing']`).

Notes:
- Deep Search is synchronous `/search` synthesis. Deep modes default to text synthesis when `outputSchema` is omitted.
- Use `web_research_exa` instead when the task needs an asynchronous Agent run, continuation, Connect data sources, effort/budget controls, or remote cancellation.
- Invalid categories return an error instead of silently falling back to an unfiltered search.
- The `company` and `people` categories do not support `startPublishedDate`, `endPublishedDate`, or `excludeDomains`; the `people` category only accepts LinkedIn domains for `includeDomains`. These are enforced pre-flight.
- `startCrawlDate` / `endCrawlDate` are intentionally not exposed — Exa silently ignores them as of 2026-04-15.

### web_research_exa

Params include:

- `query` (required)
- `systemPrompt`
- `effort`: `minimal | low | medium | high | xhigh | auto | max` (default `medium`). `auto` and `max` are metered; use `budget.maxCostDollars` to cap them.
- `outputSchema`: `{ "type": "text" }` (default) reads `output.text`; an object JSON Schema is sent to Exa and returns `output.structured`.
- `input.data` / `input.exclusion`: records to process or exclude.
- `previousRunId`: continue from a completed Agent run.
- `metadata`: string key/value metadata stored with the run.
- `dataSources`: up to five Exa Connect providers.
- `budget.maxCostDollars`: spend ceiling for `auto` or `max`.

The tool submits `POST /agent/runs`, polls the run to completion, returns the run ID and cost/usage metadata, and attempts `POST /agent/runs/{id}/cancel` on host abort or timeout. `max` effort automatically opts into Exa's required max-effort beta.

### web_answer_exa

Params include `query` (required), `systemPrompt`, `text`, and `outputSchema`.

### web_find_similar_exa

Params include `url` (required), `numResults`, `textMaxCharacters`, `excludeSourceDomain`, date filters, and domain filters.

Exa marks `/findSimilar` deprecated and recommends `/search` for new discovery flows. This compatibility tool remains available for URL-seeded similarity workflows.

## Integration tests

Live integration coverage is available for `web_search_exa`, `web_fetch_exa`, `web_search_advanced_exa`, and `web_research_exa`.

These tests are:
- skipped by default
- only enabled when you opt in manually
- always skipped in CI

Run them locally with a real API key:

```bash
PI_EXA_LIVE=1 EXA_API_KEY=your-key pnpm exec vitest run packages/pi-exa/__tests__/integration.test.ts
```

The live suite incurs real Exa usage and is never enabled in CI.

## MCP server

pi-exa also exposes its tool surface as an MCP stdio server, suitable for any MCP-aware host (Claude Desktop, Claude Code, etc.). The server uses the same portable tool implementations as the Pi adapter — only the gating and credential resolution differ.

Run with:

```bash
npx pi-exa
```

### Environment configuration

| Variable             | Effect                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXA_API_KEY`        | Exa API key. Required for retrieval tools; planner tools work without it.                                                                                                       |
| `EXA_ENABLE_ADVANCED`| Truthy (`1` / `true` / `yes`) enables `web_search_advanced_exa`.                                                                                                                |
| `EXA_ENABLE_RESEARCH`| Truthy enables `web_research_exa`.                                                                                                                                              |
| `EXA_ENABLED_TOOLS`  | Comma-separated allowlist. Highest precedence. Empty/whitespace-only values emit a warning and fall through to the per-tool toggle defaults.                                    |
| `EXA_CONFIG_FILE`    | Path to a JSON config file (same shape as the CLI `--exa-config-file`). Use for `apiKey`, `enabledTools`, `advancedEnabled`, `researchEnabled`.                                 |
| `EXA_CONFIG`         | Deprecated alias for `EXA_CONFIG_FILE`. Still read; prefer `EXA_CONFIG_FILE`.                                                                                                   |
| `EXA_TIMEOUT_MS`     | Default per-call timeout in ms for Exa-backed tools. Built-in 60000, or 180000 for advanced search and Agent research. Underlying HTTP request continues until Exa resolves it; see [exa-labs/exa-js#158](https://github.com/exa-labs/exa-js/issues/158). |
| `EXA_RESEARCH_TIMEOUT_MS` | Override for `web_research_exa` only. Built-in 180000.                                                                                                                     |

### Precedence

Same rules as the Pi adapter:

1. `EXA_ENABLED_TOOLS` (env) — strict allowlist.
2. `enabledTools` (config file) — strict allowlist; an empty array means "no tools".
3. `EXA_ENABLE_ADVANCED` / `EXA_ENABLE_RESEARCH` (env) or `advancedEnabled` / `researchEnabled` (config file).
4. Default: 8 tools on (4 cheap Exa + 4 planner); `web_search_advanced_exa` and `web_research_exa` hidden.

### Example: Claude Desktop / `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pi-exa": {
      "command": "npx",
      "args": ["-y", "@feniix/pi-exa"],
      "env": {
        "EXA_API_KEY": "your-key",
        "EXA_ENABLE_ADVANCED": "1"
      }
    }
  }
}
```

### Example: generic `mcp.json`

```json
{
  "mcpServers": {
    "pi-exa": {
      "command": "npx",
      "args": ["pi-exa"],
      "env": { "EXA_API_KEY": "your-key" }
    }
  }
}
```

## Notes

- `exa_research_*` planning tools are enabled by default when no explicit `enabledTools` allowlist is configured, local-only, and do not require an Exa API key.
- `web_search_advanced_exa` and `web_research_exa` are opt-in and disabled by default.
- Research/tool output may include both `text` and `details.parsedOutput` depending on `outputSchema.type`.

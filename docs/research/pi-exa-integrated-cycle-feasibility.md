# PRD-010 / #152: integrated research-cycle feasibility

## Scope and evidence

Source: [issue #152](https://github.com/feniix/pi-extensions/issues/152) and
[PRD-010](../prd/PRD-010-pi-exa-integrated-research-cycle.md).
This is feasibility/design work, not the integrated-cycle implementation.
No live Exa calls were made. One operator-requested TypeSafe design-selection
request used Jev; it is not a proposed runtime dependency.

Verified baseline: committed lockfile, pnpm 12.8.1, `exa-js` 2.23.0,
Pi 1.0.3, bridgekit 0.15.0. The initial local Pi installation was 0.86.1;
`pnpm install --frozen-lockfile` restored the graph without changing dependencies.
Distinguish documented remote capabilities, observed installed/offline behavior,
proposed contracts, and unverified runtime/account guarantees.

## Agent capability matrix

| Capability | Evidence and limits |
|---|---|
| Structured output | Documented `outputSchema` / `output.structured`; SDK forwards schema and retains data. SDK typing does not validate schemas or prove evidence. |
| Grounding | Documented optional field-level citations; SDK preserves them. Local formatter flattens citations; future envelope must retain associations. |
| Input records | `input.data` means processing/enrichment rows, not evidence attachments. `input.exclusion` excludes returned entities, not reading or security filtering. |
| Selected evidence | No dedicated source-pack field established. Use labeled query context, not processing rows. Source fidelity remains unverified. |
| Continuation | Completed same-team `previousRunId` creates a new run; not polling, recovery, or idempotency. ZDR cannot assume continuation support. |
| Recovery | GET by run ID retrieves existing state/results. Listing/metadata matching can assist investigation, not guarantee uniqueness or immediate visibility. |
| Cancellation | Can return an already-completed run unchanged. Accrued usage is billed; timeout is not proof of remote cancellation. |
| Idempotency | No Agent-run create guarantee established in inspected docs/spec/SDK. Monitor idempotency belongs to another API. |
| Retention | ZDR terminal retention is short; indefinite recovery is not established. 404 does not prove no submission occurred. |
| Effort | Docs list fixed efforts, auto, ultra; SDK retains legacy max. Local max acceptance/pricing is unresolved. Initial cycles use fixed efforts + auto; standalone remains unchanged. |

Primary sources:
[quickstart](https://exa.ai/docs/agent/quickstart.md),
[create](https://exa.ai/docs/reference/agent-api/create-a-run.md),
[get](https://exa.ai/docs/reference/agent-api/get-a-run.md),
[cancel](https://exa.ai/docs/reference/agent-api/cancel-a-run.md),
[OpenAPI](https://exa.ai/docs/exa-spec.yaml).
These are mutable current documentation snapshots, not live acceptance tests.

## Cost and accounting matrix

OpenAPI `CostDollarsOutput.total` explicitly describes retrieval cost as an
**estimate, not an invoice record**. Agent usage/cost is a separate reporting
class, also not independently invoice-verified.

| Tool | Reporting | Published estimate basis and limitations |
|---|---|---|
| `web_search_exa` | Optional retrieval estimate | Auto $0.007 through 10 results, +$0.001/result above 10. |
| `web_fetch_exa` | Optional retrieval estimate | $0.001/page per requested content type: text/highlights/summary. |
| `web_answer_exa` | Optional retrieval estimate | $0.005/request; no Agent-style usage counter. |
| `web_find_similar_exa` | Optional retrieval estimate | Deprecated; no current named rate established. Require account rate or scoped uncertainty permission. |
| `web_search_advanced_exa` | Optional retrieval estimate | Instant $0.004; fast/auto $0.007; deep-lite/deep $0.012; deep-reasoning $0.015, with documented result/summary additions. Subpage/context uncertainty remains. |
| Fixed Agent | Agent-reported cost/usage | Core minimal/low/medium/high/xhigh: $0.012/$0.025/$0.10/$0.50/$1.00. Extras are not established as free. |
| Auto Agent | Agent-reported cost/usage | $0.10/ACU + $0.005/search + $0.02/email + $0.07/phone + applicable Connect charges; per-run cap is not a cycle cap. |

Sources: [pricing](https://exa.ai/docs/admin/pricing.md),
[Connect](https://exa.ai/docs/agent/connect/overview.md), OpenAPI.
Custom-account terms can supersede list rates. Connect is additive and
operation-dependent; published Baselayer lower bounds conflict ($0.10/$0.15).
Cap coverage of extras and boundary overshoot are not runtime verified.
Missing cost, partial breakdown, timeout, or unavailable rate is not zero.
Never add a total and its components or treat an estimate as invoice-confirmed.
Unknown rates/features use explicit approval paths rather than invented guarantees.

## Pi and necessary prefactoring

Installed Pi 1.0.3 exposes cwd/session ID/file/leaf, lifecycle/tree events,
tool-call blocking, and TUI/RPC dialogs. Print/JSON has no dialog UI.
Sibling calls can run concurrently; conversation rewinds do not undo real costs.
External cycle state must be authoritative.

Evidence: installed Pi `docs/extensions.md`, `docs/sessions.md`,
`docs/session-format.md`, `docs/rpc-extension-ui.md`,
`dist/core/extensions/types.d.ts`, `dist/core/session-manager.d.ts`.
Upstream [types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
are a locator; installed version-specific declarations establish the observation.

Bridgekit 0.15.0's `dist/src/adapters/pi.js` receives Pi execute context but
discards it before portable execution, forwarding host/signal/progress only.
Local `web-research.ts`, `tools.ts`, `formatters.ts`, and retrieval helpers:

- Drop accounting on empty retrieval responses and omit structured request IDs.
- Flatten source records/grounding before host tools see them.
- Discard failed/cancelled usage and cancel's returned terminal result.
- Race create against local lifecycle bounds without capturing late IDs/results.
- Bound ordinary HTTP waiting without cancelling the underlying request.

Necessary seam: a thin Pi context-aware execution decorator plus optional,
host-neutral per-call lifecycle/raw-response observers, including late outcomes.
Keep default standalone/MCP behavior unchanged. Do not infer evidence from prose.
Introduce this narrow prefactoring in its first consuming slices, not a broad rewrite.

## Jev decision record

The operator delegated remaining design choices to Jev, not runtime research.
State included all prior operator decisions, verified capability limits, and
safety constraints. Each bounded Choice included a defer option.
Actual response: `jev-1.13.0`; 2,527 input tokens, 459 output tokens.

| Question | Selection | Probability | Confidence | Strongest alternative |
|---|---|---:|---:|---|
| Routing | `researchMode` active/standalone, optional target/revision assertions | 0.99 | 0.99 | Cycle ID only: 0.01 |
| Missing schema | Block as not-ready; persist task schema first | 1.00 | 1.00 | Other options/defer: 0 |
| Source mapping | Labeled query context, not processing rows | 0.91 | 0.88 | Rows: 0.07; defer: 0.02 |
| Lock scope | Short exclusive read/validate/reserve/write transactions | 1.00 | 1.00 | Whole-network lock/memory mutex/defer: 0 |
| Integration | Pi decorator + per-call observers | 1.00 | 1.00 | Events-only/rewrite adapters/defer: 0 |
| Tree navigation | Detach; explicitly resume; never rewind ledger | 1.00 | 1.00 | Rewind/silent attachment/defer: 0 |
| Provider/contact scope | Explicit grant plus estimate or uncertainty exception | 1.00 | 1.00 | Core covers extras/remove everywhere/defer: 0 |
| Schema validation | Explicit draft-07 initially; validate schema/result | 1.00 | 1.00 | SDK typing/Deep Search limits/defer: 0 |

Confidence measures distribution concentration, not architectural truth,
capability proof, or consent. Alternatives were bounded by agreed requirements,
not an independent open-ended design review.
Sources: [API](https://docs.typesafe.ai/api.md),
[Choice](https://docs.typesafe.ai/primitives/choice.md),
[confidence](https://docs.typesafe.ai/confidence.md).
No TypeSafe runtime dependency is added.

## Reproducible checks and limits

Fixtures: `packages/pi-exa/__tests__/fixtures/research-cycle.ts`.
Checks: `packages/pi-exa/__tests__/research-cycle-feasibility.test.ts`.

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run packages/pi-exa/__tests__/research-cycle-feasibility.test.ts
pnpm exec tsc --noEmit --project packages/pi-exa/tsconfig.json
```

Six checks exercise actual SDK transport with fetch intercepted before module
import: create body, explicit rows, GET recovery with failure costs, terminal
cancel race, continuation POST, and empty-response estimates. Types check request/
result examples against the SDK. Synthetic costs are not billing observations.
Initial post-import stubbing failed against reserved `.invalid`; the SDK captures
fetch at load. Corrected checks pass without credentials or external HTTP.

Remote schema acceptance, source fidelity, retention, live cancellation/billing,
and cycle safety are not proven by these tests. Draft validation, crash-point/
locking tests, durable permission and accounting belong to dependent slices.

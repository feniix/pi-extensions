---
title: "web_research_exa silently returns the canned no-output fallback when outputSchema is omitted"
date: 2026-06-15
category: integration-issues
module: pi-exa
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "web_research_exa returned the canned no synthesized output was returned message for every call"
  - "Live Exa /search responses omitted the output field when outputSchema was not sent"
  - "Text and object synthesis worked only when outputSchema was provided explicitly"
  - "Package skills (code-search, company-research, exa-research-planner, financial-report-search) only worked because they supplied outputSchema explicitly"
  - "The fallback hid the requestId and shape needed to identify why synthesis did not run"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - Exa /search API
  - exa research planner
  - portable tool schema
  - bridgekit tool surface
tags:
  - pi-exa
  - web-research-exa
  - exa-api
  - output-schema
  - synthesized-output
  - api-contract
  - diagnostics
  - research-planner
---

# web_research_exa silently returns the canned no-output fallback when outputSchema is omitted

## Problem

`@feniix/pi-exa`'s `web_research_exa` tool returned the canned "no synthesized output was returned" message for every call. The implementation passed `undefined` to `exa.search(...)`, but Exa's `/search` endpoint only includes an `output` field in the response when an `outputSchema` is provided. The canned fallback therefore always fired, regardless of query, filters, or tool activation. The bug was masked for users who read the four skills shipped with the package, because each one works around it by passing `outputSchema: { type: "text" }` explicitly.

## Symptoms

- Every `web_research_exa` call returned the canned "no synthesized output was returned" fallback instead of synthesized research content.
- Direct calls only worked when users manually passed `outputSchema: { type: "text" }` — an undiscoverable workaround that contradicted the README's claim that the default was `"object"`.
- Live Exa `/search` responses for deep types (`deep`, `deep-lite`, `deep-reasoning`) omitted the `output` field entirely when no `outputSchema` was sent; only the search-results array, `requestId`, `searchTime`, and `costDollars` were returned.
- The four package skills (`code-search`, `company-research`, `exa-research-planner`, `financial-report-search`) only worked because they each supplied `outputSchema` in their example invocations.
- The fallback response carried no `requestId` and no shape metadata, so neither the LLM caller nor an operator could tell why synthesis did not run.

## What Didn't Work

- **Manual workaround (undiscoverable):** passing `outputSchema: { type: "text" }` did make Exa return synthesized output, but it contradicted the README's documented default and required callers to know an implicit Exa API requirement. Users should not need insider knowledge to get the default path working.
- **README documentation lying about the default:** the README claimed `outputSchema` defaulted to `"object"`, but the implementation had no default at all. The lie is worse than the silence because it tells users the wrong thing to expect.
- **Brittle test assertion (caught in code review):** an early version of the diagnostic test pinned the exact `Object.keys(response)` order for `responseKeys`. That overfit the test to JavaScript key-order details rather than the diagnostic value (set membership). The review pass replaced it with `expect.arrayContaining([...])` plus an assertion that `output` is absent.
- **Treating it as a backend failure:** the original canned message ("Try a different query or simpler filters") implied a transient failure on the caller's side, not a contract mismatch. The new diagnostic text states the actual sequence — a schema was sent, the response lacked the field.

## Solution

The fix is layered: runtime default, diagnostic surface, discoverability, tests, and release docs.

### 1. Default the runtime request to text synthesis

`parseOutputSchema` in `packages/pi-exa/extensions/web-research.ts` now always returns a schema, using text mode when the caller omits `outputSchema` or passes an object without a `type` field. Explicit object-mode schemas pass through unchanged. The function signature changed from `DeepOutputSchema | undefined` to `DeepOutputSchema`:

```ts
function parseOutputSchema(outputSchema: Record<string, unknown> | undefined): DeepOutputSchema {
  // Exa /search only returns an `output` field when an outputSchema
  // is provided. Without a default, every call without an explicit
  // schema returns no synthesis and the canned fallback fires.
  if (!outputSchema || !Object.hasOwn(outputSchema, "type")) {
    return { type: "text" } as DeepOutputSchema;
  }
  const schemaType = outputSchema.type;
  if (schemaType !== "object" && schemaType !== "text") {
    throw new Error('outputSchema.type must be either "object" or "text".');
  }
  return outputSchema as DeepOutputSchema;
}
```

### 2. Surface diagnostic context in the no-output fallback

When `response?.output` is missing, the tool now returns user-facing text that states an `outputSchema` was sent but no `output` field came back, plus a structured `details` payload that operators and downstream LLM agents can act on. A null-guard around `...toMetadata(response)` (added in the code-review pass) prevents the diagnostic from being lost when the response itself is nullish:

```ts
return {
  text:
    `Deep search completed but no synthesized output was returned. ` +
    `An outputSchema was sent to the Exa API (requestId: ${requestId}, ` +
    `results returned: ${resultsCount}, outputSchema: ${JSON.stringify(outputSchema)}), ` +
    `but the response did not include an \`output\` field. ` +
    `Try a different query, simplify filters, or check Exa's status page.`,
  details: {
    tool: "web_research_exa",
    kind: "domain",
    error: "no_synthesized_output",
    requestId,
    resultsCount,
    outputSchemaSent: outputSchema,
    responseKeys,
    ...(response ? toMetadata(response) : {}),
  },
};
```

### 3. Improve discoverability at call sites

- `packages/pi-exa/extensions/research-planner.ts` `payload(status)` now includes `outputSchema: { type: "text" }` in its suggested `web_research_exa` invocation, so a user (or LLM) copying the suggested JSON verbatim gets synthesis without a hidden requirement.
- `packages/pi-exa/extensions/schemas.ts` `outputSchemaType` Union now carries a description. The wording is endpoint-neutral (text vs object + the 10-property / depth-2 cap) so the same Union can serve both `webResearchParams` and `webAnswerParams` without leaking tool-specific copy.
- `packages/pi-exa/extensions/tools.ts` documents the default and the override in the `web_research_exa` tool description, `promptSnippet`, and two `promptGuidelines`. The previous third guideline — "Use web_research_exa when a systemPrompt or outputSchema is needed..." — implied `outputSchema` was exotic; the new wording is explicit about the default.
- `web_answer_exa` description clarified to state it returns a plain string by default (an `/answer` endpoint default, not a tool behavior change).

### 4. Pin behavior with tests

- `__tests__/portable-tools.test.ts`: 3 new tests + 1 updated assertion pin the default (`outputSchema: { type: "text" }` sent when omitted), the override (explicit object-mode schema passes through unchanged, `parsedOutput` populated), and the diagnostic shape (`kind`, `error`, `requestId`, `resultsCount`, `outputSchemaSent`, `responseKeys` present, `output` absent). The fallback test asserts `responseKeys` semantically, not by insertion order.
- `__tests__/research-planner.test.ts`: 1 new assertion pins the planner payload's `outputSchema: { type: "text" }`.

### 5. Correct release documentation

- `README.md`: `web_research_exa` section now says default text mode, references issue #115, and links to the [Exa Search API Reference for Coding Agents](https://docs.exa.ai/reference/search-api-guide-for-coding-agents) for the underlying contract.
- `CHANGELOG.md`: `5.0.1` entry records the runtime fix, the diagnostic surface, the planner change, and the discoverability improvements.
- `packages/pi-exa/package.json` bumped 5.0.0 → 5.0.1.

## Why This Works

Exa's `/search` contract documents the behavior directly (per the [Search API Reference for Coding Agents](https://docs.exa.ai/reference/search-api-guide-for-coding-agents)):

> `outputSchema` — object — JSON schema for synthesized `output.content`. When provided, the response includes `output`.

The pre-fix code passed `undefined` to `exa.search(...)`, so Exa correctly omitted `output` and the handler always took the canned fallback. The default `{ type: "text" }` makes the synthesis step explicit for the common case, which is what the user's manual workaround was already doing. Object mode is preserved as an explicit override for callers that need structured extraction.

Empirical validation against the live Exa API (with `EXA_API_KEY` and exa-js 2.13.0):

| Scenario | `output` field | Cost |
| --- | --- | --- |
| No `outputSchema`, `type: "deep-reasoning"` | absent (canned fallback before fix) | $0.015 |
| `outputSchema: { type: "text" }` | present, `output.content` is a string | $0.015 |
| `outputSchema: { type: "object", properties: {...} }` | present, `output.content` is an object with per-field grounding | $0.015 |

Cost is identical across modes, so the default choice is a UX decision, not a cost decision.

## Prevention

- **Keep a regression test** that verifies omitted `outputSchema` is sent as `{ type: "text" }` and that explicit object schemas pass through unchanged. The two assertions in `__tests__/portable-tools.test.ts` (the existing `forwards deep-search options` test updated to include the default assertion, and the new `defaults outputSchema to text-mode synthesis when the caller omits it`) are the test-first pins that would have caught this bug at introduction.
- **Test fallback diagnostics semantically**, not by brittle key ordering. Assert `details.error`, `outputSchemaSent`, counts, and that `responseKeys` does not include `output` — the diagnostic value is set membership, not insertion order.
- **Do not document defaults that are not implemented.** Tool descriptions, READMEs, and CHANGELOGs should match runtime behavior. When a default depends on an upstream API contract, link to the contract source so future readers can verify the assumption still holds.
- **Make planner and skill payloads self-documenting.** The `exa_research_summary` `payload` mode should include every parameter the underlying tool requires to function — including `outputSchema: { type: "text" }` — so a user (or LLM) copying the suggested JSON verbatim does not silently miss a step.
- **Surface the actual upstream shape in fallbacks**, not a generic "try again" message. When a tool's contract requires a field the caller might omit, the fallback should name the field, the requestId, and what was sent — that turns the next silent regression into a debuggable one. The new `details.outputSchemaSent`, `requestId`, and `responseKeys` fields do this.

## Related Issues

- [GitHub issue #115 in `feniix/pi-extensions`](https://github.com/feniix/pi-extensions/issues/115) — original bug report.
- [Exa Search API Reference for Coding Agents](https://docs.exa.ai/reference/search-api-guide-for-coding-agents) — documents that responses include `output` only when `outputSchema` is provided.
- [Exa Deep Revamp changelog](https://exa.ai/docs/changelog/exa-deep-revamp) — defines the `outputSchema` shape for deep search variants (`type`, `description`, `properties`) and the per-field `grounding` response shape.
- PR #116 in `feniix/pi-extensions` — implements the fix across 4 commits on `fix/pi-exa-115-web-research-outputschema-default` (test pin, runtime fix, version bump, code-review fixes).
- `packages/pi-exa/docs/exa-api-findings.md` — prior empirical research on the Exa contract. May be worth updating to record the issue #115 lesson (the `/search` endpoint requires `outputSchema` even for prose output).
- `docs/architecture/plan-pi-exa-api-alignment.md` and `docs/prd/PRD-005-pi-exa-api-alignment.md` — design docs that previously assumed `outputSchema.type` defaulted to `"object"`. Now superseded by this fix; see refresh recommendation in the ce-compound run output.

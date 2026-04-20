---
title: "pi-exa Full Exa API Alignment"
prd: "PRD-002-pi-exa-api-alignment"
date: 2026-04-20
author: "Claude Code"
status: Draft
---

# Plan: pi-exa Full Exa API Alignment

## Source

- **PRD**: `docs/prd/PRD-002-pi-exa-api-alignment.md`
- **Date**: 2026-04-20
- **Author**: Claude Code

## Architecture Overview

This plan extends the `@feniix/pi-exa` extension from 3 tools to 6, migrates all tools from raw `exa.request()` calls to typed SDK methods, adds observability metadata to every tool response, injects system prompt guidance for LLM tool routing, and rewrites all 6 skills as pi-native.

The work is organized into 8 components that map to the PRD's rollout plan. The critical path runs through the SDK migration (C2) — all subsequent tool additions depend on the new calling patterns and response type handling established there. The skill rewrite (C7) depends on all tools being finalized but has no code dependencies on the extension itself.

The extension's single-file architecture (`extensions/index.ts`) means all tool changes land in one file. The file is currently 718 lines and will grow to approximately 1200-1400 lines. If this becomes unwieldy during implementation, extracting tool implementations into separate files is a natural refactor, but is not required by this plan.

## Components

### C1: maxCharacters Bump

**Purpose**: Increase `web_search_exa`'s hardcoded `contents.text.maxCharacters` from 300 to 500 for richer text snippets.

**Key Details**:
- One-line change in `performWebSearch()` at line 389
- Add test verifying the request includes `maxCharacters: 500`
- No behavioral change to users — just more text returned per result

**FR**: FR-1b

**ADR Reference**: None — trivial change.

---

### C2: SDK Migration + Observability + System Prompt Guidance

**Purpose**: Migrate all 3 existing tools from `exa.request()` to typed SDK methods, add observability metadata to `details`, and add `promptSnippet`/`promptGuidelines` to all tools.

**Key Details**:
- **SDK migration (D2):**
  - `web_search_exa`: `exa.request("/search", ...)` → `exa.search(query, options)`
  - `web_fetch_exa`: `exa.request("/contents", ...)` → `exa.getContents(urls, options)`. Note: current code sends `{ ids: urls }` in the payload; `exa.getContents()` sends `{ urls: urls }`. The Exa API accepts both. The SDK method is the canonical form.
  - `web_search_advanced_exa`: `exa.request("/search", ...)` → `exa.search(query, options)`
  - Remove custom `ExaSearchResponse` and `SearchResult` interfaces — use SDK's `SearchResponse<T>`, `SearchResult<T>`
  - Remove the relative-endpoint-path workaround comment (line 393-395)
  - Update `formatSearchResults()` and `formatCrawlResults()` to accept SDK response types

- **Observability (FR-5):**
  - Extract `costDollars`, `searchTime`, `resolvedSearchType` from SDK response objects
  - Merge into `details` alongside existing `tool` field: `{ tool, costDollars?, searchTime?, resolvedSearchType? }`
  - Update existing tests that assert exact `details` shapes (lines 287, 309, 402)

- **System prompt guidance (FR-8):**
  - Add `promptSnippet` and `promptGuidelines` to all 3 existing `registerTool()` calls
  - Values specified in PRD FR-8 table
  - Add tests verifying these fields are set

- **Test migration:**
  - Current tests mock `exa.request()` via `vi.mock("exa-js")`. After migration, mock the typed methods instead:
    ```typescript
    const mockSearch = vi.fn();
    const mockGetContents = vi.fn();
    const mockAnswer = vi.fn();
    const mockFindSimilar = vi.fn();

    vi.mock("exa-js", () => ({
      Exa: class {
        search = mockSearch;
        getContents = mockGetContents;
        answer = mockAnswer;
        findSimilar = mockFindSimilar;
      },
    }));
    ```
  - All existing test scenarios must pass with the new mock pattern

**FR**: FR-5, FR-8, D2

**ADR Reference**: None — D2 doesn't warrant a standalone ADR per the 4-point test.

---

### C3: Research Tool (`web_research_exa`)

**Purpose**: New tool for deep search types (`deep-reasoning`, `deep-lite`, `deep`) with synthesized output and grounding.

**Key Details**:
- **Registration:**
  - Disabled by default — enabled via `--exa-enable-research` flag / `researchEnabled` config
  - Add `researchEnabled` to `ExaConfig` interface
  - Add `isResearchToolEnabled()` helper mirroring `isAdvancedToolEnabled()`
  - Update `isToolEnabledForConfig()` for the new tool name
  - Update `parseConfig()` to parse `researchEnabled`
  - Update `loadSettingsConfig()` to extract `researchEnabled` from the `pi-exa` key in settings.json, mirroring `advancedEnabled`
  - Register `--exa-enable-research` flag in the extension entry point

- **Parameters (TypeBox schema):**
  - `query` (required)
  - `type` (optional, default `"deep-reasoning"`, enum: `deep-reasoning | deep-lite | deep`)
  - `systemPrompt` (optional string)
  - `outputSchema` (optional object)
  - `additionalQueries` (optional array, max 5)
  - `numResults` (optional integer)
  - `includeDomains` / `excludeDomains` (optional arrays)
  - `startPublishedDate` / `endPublishedDate` (optional strings)

- **Implementation:**
  - Call `exa.search(query, { type, systemPrompt, outputSchema, additionalQueries, ... })` with `DeepSearchOptions`
  - Validate `type` is one of the three deep types; reject non-deep types with error suggesting `web_search_exa` / `web_search_advanced_exa`
  - `onUpdate` fires immediately with progress message

- **Response formatting (`formatResearchOutput()`):**
  - Primary output: `response.output.content` — if string, render as plain text; if object (outputSchema provided), render as JSON code block
  - Secondary output: `response.output.grounding` — format as citation list with field, confidence, and source URLs
  - Tertiary output: `response.results[]` — truncated list of source links (if room within 50KB limit)
  - `details`: `{ tool, costDollars?, searchTime?, resolvedSearchType?, parsedOutput? }`

- **Prompt guidance:**
  - `promptSnippet`: "Deep research — synthesizes findings with grounded citations. ~20s, higher cost."
  - `promptGuidelines`: per FR-8 table

- **Tests:**
  - Missing API key → error
  - Aborted signal → cancelled
  - Successful execution with outputSchema → formatted JSON + grounding
  - Successful execution without outputSchema → formatted text + grounding
  - Non-deep type → error
  - onUpdate callback fires
  - `details` includes observability metadata

**FR**: FR-1, D3

**ADR Reference**: → [ADR-0005: Exa Deep Search Tool Strategy](../adr/ADR-0005-exa-deep-search-tool-strategy.md)

---

### C4: Answer Tool (`web_answer_exa`)

**Purpose**: New tool for Exa's `/answer` endpoint — grounded LLM answer with citations.

**Key Details**:
- **Registration:**
  - Enabled by default (same tier as `web_search_exa`)
  - Update `isToolEnabledForConfig()` to return `true` for `web_answer_exa`

- **Parameters (TypeBox schema):**
  - `query` (required)
  - `systemPrompt` (optional string)
  - `text` (optional boolean, default false)
  - `outputSchema` (optional object)

- **Implementation:**
  - Call `exa.answer(query, { systemPrompt, text, outputSchema })`
  - `onUpdate` fires with "Fetching answer from Exa..."

- **Response formatting (`formatAnswerResult()`):**
  - Primary: `response.answer` (string or object if outputSchema)
  - Citations: `response.citations[]` formatted as URL list with titles
  - If `text: true`: include source text below each citation
  - `details`: `{ tool, costDollars? }`

- **Prompt guidance:** per FR-8 table

- **Tests:** missing key, aborted, success, systemPrompt forwarding, text flag, onUpdate, details

**FR**: FR-2

**ADR Reference**: None — straightforward new tool.

---

### C5: Find-Similar Tool (`web_find_similar_exa`)

**Purpose**: New tool for Exa's `/findSimilar` endpoint — find pages similar to a URL.

**Key Details**:
- **Registration:**
  - Enabled by default
  - Update `isToolEnabledForConfig()` to return `true` for `web_find_similar_exa`

- **Parameters (TypeBox schema):**
  - `url` (required)
  - `numResults` (optional integer, default 5)
  - `excludeSourceDomain` (optional boolean)
  - `includeDomains` / `excludeDomains` (optional arrays)
  - `startPublishedDate` / `endPublishedDate` (optional strings)

- **Implementation:**
  - Call `exa.findSimilar(url, { numResults, excludeSourceDomain, ... })`
  - `onUpdate` fires with "Finding similar pages via Exa..."
  - Reuse `formatSearchResults()` for output — `findSimilar` returns `SearchResponse<T>`, same as `search()`. Depends on C2 having migrated `formatSearchResults()` to accept SDK types.

- **Prompt guidance:** per FR-8 table

- **Tests:** missing key, aborted, success, excludeSourceDomain, numResults, onUpdate, details

**FR**: FR-3

**ADR Reference**: None — straightforward new tool.

---

### C6: Advanced Search Type Enforcement + Content Enrichment

**Purpose**: Restrict `web_search_advanced_exa` to non-deep types and enhance `web_fetch_exa` with new content options.

**Key Details**:
- **FR-6: Advanced search type enforcement**
  - Replace `type` param's `Type.Optional(Type.String(...))` with `Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("neural"), Type.Literal("keyword"), Type.Literal("hybrid"), Type.Literal("instant")]))`
  - Add runtime check in `execute()` as safety net — if deep type passed, return error directing to `web_research_exa`
  - Update tool description to list only retrieval types

- **FR-4: Content enrichment**
  - Add to `webFetchParams` schema: `highlights` (optional boolean), `summary` (optional object with `query` string), `maxAgeHours` (optional integer)
  - Update `performWebFetch()` to pass new options to `exa.getContents()`
  - Update `formatCrawlResults()` to render "Highlights:" and "Summary:" sections when present
  - Backward compatible — no new params means same behavior as before

- **Tests:**
  - Deep types rejected with clear error message
  - `instant` type works
  - Highlights appear in formatted output
  - Summary appears in formatted output
  - maxAgeHours forwarded to API
  - No new params = same behavior

**FR**: FR-4, FR-6

**ADR Reference**: None — implementation details.

---

### C7: Skill Rewrite

**Purpose**: Rewrite all 6 skills as pi-native with intent-based tool selection, parameter guidelines, and domain-specific settings.

**Key Details**:
- **Remove OpenClaw patterns** from all skills:
  - "Token Isolation (Critical)" sections
  - "Browser Fallback" sections
  - Rigid "ONLY use X" tool restrictions
  - `numResults` dynamic tuning for research tools

- **Keep from existing skills:**
  - `context: fork` frontmatter
  - Query writing patterns (domain-specific tips)
  - Category filter restrictions (400 error documentation)
  - Output format sections

- **Add to each skill:**
  - **Tool Selection** section mapping user intent → tool
  - **Recommended Settings** with concrete `systemPrompt`, `outputSchema`, `includeDomains`, `category` examples
  - **Tool availability notes** — `web_research_exa` requires `--exa-enable-research`

- **Per-skill specifics:**

  | Skill | Key tool mappings |
  |---|---|
  | code-search | Quick answers → `web_answer_exa`; find examples → `web_search_exa`; deep comparison → `web_research_exa` |
  | company-research | Quick facts → `web_answer_exa`; discovery → `web_search_advanced_exa` (category: company); deep analysis → `web_research_exa` |
  | people-research | Find profiles → `web_search_advanced_exa` (category: people); deep background → `web_research_exa` |
  | research-paper-search | Find papers → `web_search_advanced_exa` (category: research paper); literature review → `web_research_exa` |
  | financial-report-search | Find filings → `web_search_advanced_exa` (category: financial report); financial analysis → `web_research_exa` |
  | personal-site-search | Find blogs → `web_search_exa`; more like this → `web_find_similar_exa`; deep dive → `web_research_exa` |

- **Smoke tests:** Update `index.test.ts` to verify new tool references appear in each skill

**FR**: FR-7

**ADR Reference**: None — content decisions, not architecture.

---

### C8: README + Version Bump

**Purpose**: Update documentation and prepare for publish.

**Key Details**:
- **README.md:**
  - Add tool table with all 6 tools, enablement status, and descriptions
  - Document `--exa-enable-research` flag and `researchEnabled` config
  - Add parameter tables for new tools
  - Update pricing/cost notes
  - Update "Requirements" section if pi version requirement changes

- **package.json:**
  - Bump version to 3.0.0

**FR**: Scope items 9-10

**ADR Reference**: None.

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope | FR |
|-------|-----------|-------------|-----------------|-----|
| 1 | C1: maxCharacters bump | None | S | FR-1b |
| 2 | C2: SDK migration + observability + prompt guidance | None | L | FR-5, FR-8, D2 |
| 3 | C3: Research tool | C2 (typed SDK patterns, observability, prompt guidance) | L | FR-1, D3 |
| 4a | C4: Answer tool | C2 | M | FR-2 |
| 4b | C5: Find-similar tool | C2 | M | FR-3 |
| 5 | C6: Advanced type enforcement + content enrichment | C2 | M | FR-4, FR-6 |
| 6 | C7: Skill rewrite | C3, C4, C5 (tool names finalized) | L | FR-7 |
| 7 | C8: README + version bump | All | S | — |

Phases 4a and 4b can be done in parallel. Phase 6 can start as soon as tool names and parameters are finalized (doesn't need tools to be *working*, just *designed*).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK migration breaks existing tool behavior | Medium | High | Run full test suite after each tool migration; keep `exa.request()` as fallback until all tests pass |
| Test mock migration (from `exa.request` to typed methods) is tedious and error-prone | High | Medium | Migrate one tool's tests at a time; verify each before moving to the next |
| Deep-reasoning 20s latency causes pi timeout or user confusion | Medium | Medium | `onUpdate` progress callback; document in tool description and promptSnippet |
| `output.content` as JSON object vs string requires branching formatter logic | Low | Low | Two code paths in `formatResearchOutput()` — test both |
| Skill rewrite scope creep — each skill is a small document but there are 6 | Medium | Low | Use the same structure template for all 6; batch similar skills |

## Open Questions

- **Q1** (PRD): Should `web_research_exa` be enabled by default in a future version?
- **Q3** (PRD): Resolved — `outputSchema` supports both `{ type: "object", properties: ... }` for structured JSON and `{ type: "text", description?: "..." }` for guided prose. Passed through to Exa as-is.
- **Q4** (PRD): Should entity properties (company metadata from category searches) be surfaced in a follow-up?
- **Version number**: Resolved — 3.0.0. SDK migration, new default tools, new config keys, and typed SDK method mocks constitute a major version bump.

## ADR Index

Decisions made during this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0005](../adr/ADR-0005-exa-deep-search-tool-strategy.md) | Exa Deep Search Tool Strategy | Proposed |

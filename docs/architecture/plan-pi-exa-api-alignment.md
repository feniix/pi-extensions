---
title: "pi-exa Full Exa API Alignment"
prd: "PRD-002-pi-exa-api-alignment"
date: 2026-04-20
author: "Claude Code"
status: Draft
---

# Plan: pi-exa Full Exa API Alignment

## Source

- **PRD**: `docs/prd/PRD-002-pi-exa-api-alignment.md` (v1.6)
- **Date**: 2026-04-20
- **Author**: Claude Code

## Architecture Overview

This plan implements PRD-002: closing the gap between the Exa API surface and what pi-exa exposes. The work has two axes — **widening** (3 new tools, enhanced fetch parameters) and **deepening** (observability metadata, typed SDK methods, system prompt guidance).

The foundation is a migration from raw `exa.request()` calls to the exa-js SDK's typed methods (`exa.search()`, `exa.getContents()`, `exa.answer()`, `exa.findSimilar()`). This migration unlocks observability for free — the SDK's response types (`SearchResponse`, `AnswerResponse`) already carry `costDollars`, `searchTime`, and `resolvedSearchType`. A new shared return type (`ToolPerformResult`) threads metadata from `perform*()` functions through execute handlers into the tool result `details` field.

On top of this foundation, three new tools are added (`web_research_exa`, `web_answer_exa`, `web_find_similar_exa`), the existing fetch tool gains `highlights`/`summary`/`maxAgeHours`, the advanced search tool gets strict type enforcement, all tools get `promptSnippet`/`promptGuidelines` for LLM routing, and all six skills are rewritten as pi-native. The work is structured so that each phase produces a working, testable increment.

## Components

### 1. Shared Infrastructure

**Purpose**: Types, config, and enablement logic that all tools depend on.

**Key Details**:
- Define `ExaResponseMetadata` and `ToolPerformResult` interfaces in `formatters.ts` (D2)
- Add `researchEnabled` to `ExaConfig` in `config.ts`; update `parseConfig()` and `loadSettingsConfig()` to extract it
- Add `isResearchToolEnabled()` helper mirroring `isAdvancedToolEnabled()`
- Update `isToolEnabledForConfig()` with cases for `web_answer_exa` (default-on), `web_find_similar_exa` (default-on), `web_research_exa` (flag-gated)
- Register `--exa-enable-research` flag in `index.ts`

**Files**: `extensions/config.ts`, `extensions/formatters.ts`, `extensions/index.ts`

**ADR Reference**: None — straightforward extension of existing patterns

### 2. SDK Migration & Observability (Existing Tools)

**Purpose**: Migrate all 3 existing tools from `exa.request()` to typed SDK methods; change `perform*()` return types to `ToolPerformResult`; add metadata to `details`.

**Key Details**:
- `performWebSearch()` → `exa.search(query, { type: "auto", numResults, contents: { highlights, text } })` — returns `ToolPerformResult`
- `performWebFetch()` → `exa.getContents(urls, { text: { maxCharacters } })` — returns `ToolPerformResult`
- `performAdvancedSearch()` → `exa.search(query, options)` — returns `ToolPerformResult`
- Execute handlers destructure `{ text, metadata }` and spread metadata into `details`
- Remove `ExaSearchResponse` and `SearchResult` custom interfaces (replaced by SDK types)
- Bump `web_search_exa` `maxCharacters` from 300 to 500 (FR-1b)
- Migrate test mocks from `exa.request` to typed SDK methods (see mock pattern below)
- Remove or rewrite `index.test.ts` "relative endpoints" test (line 28-37) — it asserts literal `exa.request()` strings in source files which no longer exist after typed SDK migration. Replace with assertions that typed method calls (`exa.search(`, `exa.getContents(`) are present in source.
- SDK's `search()` uses discriminated union: `NonDeepSearchOptions` vs `DeepSearchOptions` — callers must use the correct overload
- SDK throws `ExaError` (extends Error) with `statusCode`, `timestamp`, `path` — richer than generic Error. Existing catch pattern (`error instanceof Error ? error.message : String(error)`) works since ExaError extends Error. No catch changes needed.
- `exa.getContents()` adds client-side empty URL validation (`ExaError(400, "Must provide at least one URL")`) before making the network call — new behavior, strictly better than the current API-side error.

**Test mock pattern**: Replace the single `mockRequest` with per-method mocks. Of 23 test cases, only 5 use mock setup/assertions; 18 (registration, missing API key, cancelled signal, onUpdate) are unaffected.

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

Mock responses must include metadata fields for observability testing:
```typescript
mockSearch.mockResolvedValue({
  results: [{ title: "Result", url: "https://example.com", text: "content" }],
  costDollars: { total: 0.007, search: {}, contents: {} },
  searchTime: 1200,
  resolvedSearchType: "neural",
  requestId: "test-123",
});
```

Argument verification tests change from `expect(mockRequest).toHaveBeenCalledWith("/contents", "POST", body)` to `expect(mockGetContents).toHaveBeenCalledWith(urls, options)` — different call signatures.

**Files**: `extensions/web-search.ts`, `extensions/web-fetch.ts`, `extensions/web-search-advanced.ts`, `extensions/formatters.ts`, `__tests__/extension.test.ts`, `__tests__/index.test.ts`

**ADR Reference**: None — D2 rationale in PRD is sufficient (typed methods are clearly better when all tools are being modified anyway)

### 3. Deep Research Tool (`web_research_exa`)

**Purpose**: New tool for deep search types (`deep-reasoning`, `deep-lite`, `deep`) producing synthesized, grounded output.

**Key Details**:
- New `performResearch()` in `web-research.ts` — calls `exa.search(query, deepSearchOptions)` with `DeepSearchOptions` overload
- New `formatResearchOutput()` in `formatters.ts` — handles `output.content` (string or structured JSON) + `output.grounding[]` (citations with confidence levels), with `outputSchema.type` defaulting to `object`
- New `webResearchParams` schema: `query`, `type` (default `deep-reasoning`), `systemPrompt`, `outputSchema`, `additionalQueries` (max 5), `numResults`, domain/date filters
- SDK types `output` as optional (`output?: DeepSearchOutput`); implementation must handle undefined with graceful error, even though runtime always populates it for deep types
- When `outputSchema` is provided:
  - `type: "object"` (default): `details.parsedOutput` contains the parsed JSON object
  - `type: "text"`: return plain text output; no parsed object added
- Validate `type` is one of `deep-reasoning | deep-lite | deep`; reject non-deep types with error directing to `web_search_exa` / `web_search_advanced_exa`
- `onUpdate` fires immediately ("Performing deep research via Exa...") given 10-60s latency

**Files**: `extensions/web-research.ts` (new), `extensions/schemas.ts`, `extensions/formatters.ts`, `extensions/index.ts`, `__tests__/extension.test.ts`, `__tests__/helpers.test.ts`

**ADR Reference**: → [ADR-0005: Exa Deep Search Tool Strategy](../adr/ADR-0005-exa-deep-search-tool-strategy.md) — new dedicated tool with exclusive ownership of deep types

### 4. Answer Tool (`web_answer_exa`)

**Purpose**: New tool for Exa's `/answer` endpoint — grounded LLM answer with citations in a single call.

**Key Details**:
- New `performAnswer()` in `web-answer.ts` — calls `exa.answer(query, options)`
- New `formatAnswerResult()` in `formatters.ts` — handles distinct response shape: `answer` (string or object) + `citations[]` (each with url, title, publishedDate, author, optional text), with `outputSchema.type === "text"` supported
- New `webAnswerParams` schema: `query`, `systemPrompt`, `text` (boolean), `outputSchema`
- `AnswerResponse` has `costDollars` but no `searchTime` or `resolvedSearchType`
- Test mock adds `answer` method to fake Exa class

**Files**: `extensions/web-answer.ts` (new), `extensions/schemas.ts`, `extensions/formatters.ts`, `extensions/index.ts`, `__tests__/extension.test.ts`

**ADR Reference**: None — straightforward endpoint wrapper

### 5. Find-Similar Tool (`web_find_similar_exa`)

**Purpose**: New tool for Exa's `/findSimilar` endpoint — find pages similar to a given URL.

**Key Details**:
- New `performFindSimilar()` in `web-find-similar.ts` — calls `exa.findSimilar(url, options)`
- Reuses `formatSearchResults()` (same result shape as search)
- New `webFindSimilarParams` schema: `url`, `numResults` (default 5, intentionally lower than API's 10), `excludeSourceDomain`, domain/date filters
- Test mock adds `findSimilar` method to fake Exa class

**Files**: `extensions/web-find-similar.ts` (new), `extensions/schemas.ts`, `extensions/index.ts`, `__tests__/extension.test.ts`

**ADR Reference**: None — straightforward endpoint wrapper

### 6. Enhanced Content Fetching

**Purpose**: Add `highlights`, `summary`, and `maxAgeHours` parameters to `web_fetch_exa`.

**Key Details**:
- Extend `webFetchParams` schema with: `highlights` (boolean), `summary` (`{ query: string }`), `maxAgeHours` (integer)
- Update `performWebFetch()` to forward new parameters via `exa.getContents()` ContentsOptions
- Update `formatCrawlResults()` to render Highlights and Summary sections per page
- Backward compatible — no new params means identical behavior

**Files**: `extensions/schemas.ts`, `extensions/web-fetch.ts`, `extensions/formatters.ts`, `__tests__/extension.test.ts`, `__tests__/helpers.test.ts`

**ADR Reference**: None — additive parameter extension

### 7. Advanced Search Type Enforcement

**Purpose**: Restrict `web_search_advanced_exa` to non-deep types; reject deep types with clear error.

**Key Details**:
- Update `webSearchAdvancedParams` type schema to `Type.Union([Type.Literal("auto"), ..., Type.Literal("instant")])` — 6 non-deep types
- Add runtime validation in `performAdvancedSearch()` rejecting `deep-reasoning`, `deep-lite`, `deep` with error directing to `web_research_exa`
- `NonDeepSearchOptions` inherits `systemPrompt`/`outputSchema` from SDK, but these are intentionally not exposed (only meaningful with deep types)

**Files**: `extensions/schemas.ts`, `extensions/web-search-advanced.ts`, `__tests__/extension.test.ts`

**ADR Reference**: → [ADR-0005: Exa Deep Search Tool Strategy](../adr/ADR-0005-exa-deep-search-tool-strategy.md) — clean separation between retrieval and synthesis

### 8. System Prompt Guidance

**Purpose**: Add `promptSnippet` and `promptGuidelines` to all 6 tools for LLM cross-tool routing.

**Key Details**:
- Each tool gets a one-line `promptSnippet` (under 100 chars) for the Available Tools section
- Each tool gets `promptGuidelines[]` with cross-references to other Exa tools
- Concrete values defined in PRD FR-8 table
- Added incrementally as each tool is registered (can start with existing tools in Phase 1)

**Files**: `extensions/index.ts`, `__tests__/extension.test.ts`

**ADR Reference**: None — using existing pi extension API fields

### 9. Skill Rewrite

**Purpose**: Rewrite all 6 SKILL.md files as pi-native, replacing OpenClaw patterns with intent-based tool selection.

**Key Details**:
- Remove: Token Isolation sections, Browser Fallback sections, rigid "ONLY use X" restrictions, numResults dynamic tuning for research
- Keep: `context: fork`, query writing patterns, category filter restrictions (prevent 400 errors)
- Add: Tool Selection mapping (intent → tool), Recommended Settings (systemPrompt, outputSchema, includeDomains examples), tool availability notes (research requires flag)
- Each skill references `web_research_exa`, `web_answer_exa`, `web_find_similar_exa` where appropriate
- Update skill smoke tests in `index.test.ts` (lines 40-70): currently each test only asserts skills contain `"web_search_exa"`. After FR-7, tests should also verify new tool references per skill (e.g., company-research references `web_answer_exa` and `web_research_exa`)

**Files**: 6 skill SKILL.md files, `__tests__/index.test.ts` (skill smoke tests — update assertions for new tool references)

**ADR Reference**: None — documentation rewrite

### 10. Documentation & Release

**Purpose**: Update README, bump version, publish.

**Key Details**:
- Document all new tools, parameters, enablement flags
- Update auth/config sections if needed
- Version bump to 3.0.0 (3 new tools, full Exa API alignment — `perform*()` return type changed in Phase 1 but was never re-exported, so the major bump reflects the feature scope, not a breaking public API change)
- `npm publish`
- Note: Phase 1 can ship separately as 2.2.0 before new tools land (see Versioning Strategy in Implementation Order)

**Files**: `README.md`, `package.json`

**ADR Reference**: None

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope | PRD FRs |
|-------|-----------|-------------|-----------------|---------|
| 1a | Shared Infrastructure | None | S | D3, FR-5 |
| 1b | SDK Migration & Observability | 1a | L | D2, FR-5, FR-1b |
| 1c | System Prompt Guidance (existing tools) | 1b | S | FR-8 (partial) |
| 2a | Deep Research Tool | 1b | L | FR-1 |
| 2b | Answer Tool | 1b | M | FR-2 |
| 2c | Find-Similar Tool | 1b | S | FR-3 |
| 2d | Enhanced Content Fetching | 1b | M | FR-4 |
| 3a | Advanced Search Type Enforcement | 2a (references research tool in error) | S | FR-6 |
| 3b | System Prompt Guidance (new tools) | 2a, 2b, 2c | S | FR-8 (complete) |
| 4a | Skill Rewrite | 2a, 2b, 2c, 3a | M | FR-7 |
| 4b | Documentation & Release | All above | S | — |

**Phase 1** (foundation): Shared infra → SDK migration → prompt guidance for existing tools. The test mock migration is the riskiest part (5 of 23 tests need rework, plus the index.test.ts source-string test must be rewritten). Produces a fully working extension with observability and typed SDK. **Can ship independently as v2.2.0** — all changes are additive or internal (`perform*()` return types are not re-exported, observability metadata is additive, prompt guidance is additive).

**Phase 2** (new tools): Research, answer, findSimilar, and enhanced fetch. Components 2a/2b/2c can be developed in parallel against separate mock methods, but **formatters.ts is a shared file** modified by 2a (formatResearchOutput), 2b (formatAnswerResult), and 2d (formatCrawlResults) — sequence formatter changes or work in a single branch to avoid merge conflicts.

**Phase 3** (enforcement + guidance): Type enforcement depends on the research tool existing (error messages reference it). Prompt guidance for new tools is trivial once they're registered.

**Phase 4** (polish): Skills depend on all tools being registered. README and **version bump to 3.0.0** are last.

**Versioning strategy**: Phase 1 → **2.2.0** (backward-compatible, no re-exported API changes). Phase 4b → **3.0.0** (3 new tools, full scope). This allows shipping the foundation independently if new tool development takes longer.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Test mock migration is larger than expected (5 of 23 tests need mock rework, plus index.test.ts source-string assertion) | Medium | Medium | Migrate mocks in Phase 1b before adding new tools. New tools write tests against the new mock pattern from the start. 18 tests (registration, API key, signal, onUpdate) are unaffected. |
| `exa.search()` discriminated union types cause compile errors when passing dynamic options | Medium | Low | Use explicit type assertions or separate code paths for deep vs non-deep. The TypeScript compiler will catch mismatches at build time. |
| Deep search `output` field is undefined at runtime despite assumption it's always populated | Low | High | Graceful fallback in `formatResearchOutput()`: if `output` is missing, return an error result with a clear message rather than crashing. |
| `exa.getContents()` signature difference from raw request causes subtle bugs | Medium | Low | Current code uses `{ ids: urls }` but SDK uses `getContents(urls)`. Test thoroughly with the new mock pattern. |
| 3.0.0 version bump disrupts existing users | Low | Low | `perform*()` functions and custom interfaces were never re-exported. The breaking change is internal. Ship Phase 1 as 2.2.0; reserve 3.0.0 for Phase 4b. |
| Phase 2 parallel work causes merge conflicts in `formatters.ts` | Medium | Low | `formatters.ts` is modified by 2a, 2b, and 2d. Sequence formatter additions or work in a single branch. New tool schemas/perform files don't conflict. |

## Open Questions

- ~~**Q1** (PRD §12): Should `web_research_exa` be enabled by default in a future version?~~ **Resolved:** No — keep disabled-by-default; use `--exa-enable-research` / `researchEnabled` to opt in.
- **Q3** (PRD §12): Should `outputSchema` support Exa's `type: "text"` mode in addition to `type: "object"`? (During implementation) **Resolved:** Yes; support both, default to `object`.
- **Q4** (PRD §12): Should entity properties (company metadata from category searches) be surfaced in a follow-up? (Post-launch) **Open — tracked in #31:** https://github.com/feniix/pi-extensions/issues/31
- ~~**Version**: Is 3.0.0 necessary?~~ **Resolved**: Phase 1 ships as 2.2.0; full scope ships as 3.0.0 (see Versioning Strategy).

## ADR Index

Decisions related to this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0005](../adr/ADR-0005-exa-deep-search-tool-strategy.md) | Exa Deep Search Tool Strategy | Proposed |

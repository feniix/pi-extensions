---
title: "pi-exa Full Exa API Alignment"
prd: PRD-002
status: Draft
owner: "Sebastian Otaegui"
issue: "N/A"
date: 2026-04-20
version: "1.0"
---

# PRD: pi-exa Full Exa API Alignment

---

## 1. Problem & Context

The `@feniix/pi-exa` extension (v2.1.0) currently exposes a subset of the Exa API through three tools: `web_search_exa`, `web_fetch_exa`, and `web_search_advanced_exa`. A research session comparing the live Exa API against the extension revealed significant gaps:

- **Deep search modes are inaccessible.** The Exa API offers `deep-reasoning`, `deep-lite`, and `deep` search types that produce synthesized, grounded output. Deep-reasoning is Exa's recommended replacement for the deprecated `/research/v1` endpoint (deprecated May 1, 2026). The extension has no tool for this. Meanwhile, the advanced tool is also missing the `instant` type from its documented options.

- **Synthesized output is silently discarded.** Even if a user passed `type: "deep-reasoning"` through the advanced tool, the response formatter (`formatSearchResults`) only reads `results[]`. The `output.content` (synthesized answer) and `output.grounding` (per-field citations with confidence levels) fields are ignored. The main value proposition of deep-reasoning is lost.

- **Key research parameters are missing.** `systemPrompt`, `outputSchema`, and `additionalQueries` — the parameters that make deep-reasoning research-quality — are not exposed. Without `systemPrompt`, source selection is unguided. Without `outputSchema`, output is unstructured.

- **Two Exa endpoints are not exposed at all.** `/answer` (single-call search + grounded LLM answer) and `/findSimilar` (find pages similar to a URL) have no corresponding tools.

- **`/contents` uses only basic text extraction.** The `web_fetch_exa` tool sends `text.maxCharacters` but ignores `highlights`, `summary`, `maxAgeHours` (freshness control), and `subpages` (crawl linked pages).

- **No observability.** `costDollars`, `searchTime`, and `resolvedSearchType` are not surfaced to the user or persisted in session state.

The exa-js SDK (>=2.8 <3.0, already installed) has full TypeScript types for all of these capabilities: `DeepSearchOptions`, `DeepSearchOutput`, `AnswerResponse`, `FindSimilarOptions`, `GroundingEntry`, `CostDollars`, etc. The extension currently bypasses these typed methods, using raw `exa.request()` calls.

**Why now:** Exa's `/research/v1` deprecation date is May 1, 2026 — 11 days away. Deep-reasoning is the official replacement. The exa-js SDK already supports it. The gap between what Exa offers and what pi-exa exposes is widening.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Expose deep-reasoning search** | New tool registered with `systemPrompt`, `outputSchema`, `additionalQueries` support | Tool callable by LLM, returns synthesized `output.content` + `grounding` |
| **Expose /answer endpoint** | New `web_answer_exa` tool registered | Returns grounded answer with citations |
| **Expose /findSimilar endpoint** | New `web_find_similar_exa` tool registered | Returns similar pages for a given URL |
| **Enrich /contents** | `web_fetch_exa` accepts `highlights`, `summary`, `maxAgeHours` | Parameters forwarded to Exa API |
| **Surface observability data** | `costDollars`, `searchTime`, `resolvedSearchType` in tool result `details` | All Exa responses include metadata in `details` field |
| **Update skills** | All 6 skills reference appropriate tools for their use case | Skills leverage deep-reasoning and /answer where beneficial |

**Guardrails (must not regress):**
- `web_search_exa` and `web_fetch_exa` continue to work with existing configurations and no extra parameters
- Default tool enablement: `web_search_exa`, `web_fetch_exa`, `web_answer_exa`, and `web_find_similar_exa` enabled by default; `web_search_advanced_exa` and `web_research_exa` disabled by default behind their respective flags
- Config resolution priority unchanged: CLI flag > config file > env var
- Existing tests continue to pass

---

## 3. Users & Use Cases

### Primary: pi extension user (developer/researcher)

> As a pi user, I want to get synthesized, grounded research output from Exa so that I can get conclusions and citations instead of just links when I ask research-oriented questions.

**Preconditions:** Exa API key configured, extension installed.

### Secondary: pi skill author

> As a skill author, I want to reference the right Exa tool for each use case so that my skills produce the best results (quick search for lookups, deep-reasoning for research, /answer for direct questions).

### Future: Automation / SDK consumer (enabled by this work)

> As a developer using pi's SDK, I want structured Exa output (via `outputSchema`) in tool result `details` so that I can build automated pipelines that consume Exa research programmatically.

---

## 4. Scope

### In scope

1. **New `web_research_exa` tool** — deep-reasoning search with `systemPrompt`, `outputSchema`, `additionalQueries`, full `output.content` + `output.grounding` response handling
2. **New `web_answer_exa` tool** — `/answer` endpoint with grounded LLM answer + citations
3. **New `web_find_similar_exa` tool** — `/findSimilar` endpoint
4. **Enhanced `web_fetch_exa`** — add `highlights`, `summary`, `maxAgeHours` parameters
5. **Observability in all tools** — `costDollars`, `searchTime`, `resolvedSearchType` in `details` field
6. **Updated advanced search type options** — `web_search_advanced_exa` updated to list all non-deep retrieval types (`auto`, `fast`, `neural`, `keyword`, `hybrid`, `instant`) and reject deep types (`deep-reasoning`, `deep-lite`, `deep`)
7. **Updated skills** — all 6 SKILL.md files updated to reference appropriate tools
8. **System prompt guidance** — `promptSnippet` and `promptGuidelines` on all 6 tools for LLM routing
9. **Tests** — unit tests for all new tools and enhanced parameters
10. **README update** — document new tools and parameters

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| Streaming (`stream: true` / SSE) | High implementation effort; `onUpdate` progress callbacks are sufficient for now | TBD |
| Search Monitors API | Entirely different use case (scheduled recurring searches with webhooks); not needed for research | TBD |
| Websets API | Different domain (curated web datasets); not needed for search/research | TBD |
| `/research/v1` endpoint | Deprecated May 2026; deep-reasoning replaces it | N/A |
| Entity properties (company metadata, person work history) | Nice-to-have for category searches; can follow up | TBD |
| Zod schema support for `outputSchema` | Available for free via typed SDK methods (D2), but not exposed at the tool boundary since LLMs send JSON Schema. Useful for future SDK consumers. | N/A |

### Design for future (build with awareness)

- **Response formatting is separated by tool type.** `formatSearchResults` handles link-oriented output, a new `formatResearchOutput` handles synthesized output. This keeps formatting clean and allows future tools (e.g., streaming research) to reuse formatters.
- **`details` field structure is consistent across tools.** All tools store `{ tool, costDollars?, searchTime?, resolvedSearchType? }` in `details`, making it possible to build observability dashboards or cost tracking later.
- **Tool enablement follows existing pattern.** New tools use the same `enabledTools` / flag mechanism, so adding more tools later requires no config changes.

---

## 5. Functional Requirements

### FR-1: Deep search tool (`web_research_exa`)

A new tool that uses Exa's `/search` endpoint with deep search types (`deep-reasoning`, `deep-lite`, `deep`) to produce synthesized, grounded research output. Defaults to `deep-reasoning`. This is the primary tool for research-oriented queries that need conclusions, not just links.

**Parameters:**
- `query` (required) — research question
- `type` (optional, default: `"deep-reasoning"`) — one of `deep-reasoning`, `deep-lite`, `deep`
- `systemPrompt` (optional) — guides source selection and synthesis style
- `outputSchema` (optional) — JSON Schema for structured output
- `additionalQueries` (optional, max 5) — alternative query formulations to broaden exploration
- `numResults` (optional, default: 10) — number of source results
- `includeDomains` / `excludeDomains` (optional) — domain filters
- `startPublishedDate` / `endPublishedDate` (optional) — ISO date filters (e.g., "2025-01-01")

**Acceptance criteria:**

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the LLM calls web_research_exa with query "Compare security tradeoffs of AI coding agents" and systemPrompt "Prefer official docs" and outputSchema { "type": "object", "properties": { "summary": { "type": "string" } }, "required": ["summary"] }
Then the tool sends a POST to /search with type "deep-reasoning", systemPrompt, and outputSchema
And the response includes output.content (synthesized answer) and output.grounding (citations with confidence)
And the tool result text contains the synthesized content followed by grounding citations
And the tool result details includes costDollars and searchTime
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the LLM calls web_research_exa with only a query (no type, no systemPrompt, no outputSchema)
Then the tool sends a POST to /search with type "deep-reasoning" and query only
And returns the synthesized output.content as the primary result
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the LLM calls web_research_exa with type "deep-lite"
Then the tool sends a POST to /search with type "deep-lite"
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the LLM calls web_research_exa with type "auto" or "neural" or any non-deep type
Then the tool returns an error result indicating only deep types are allowed and suggests using web_search_exa or web_search_advanced_exa
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the tool begins execution
Then onUpdate is called with a progress message indicating deep research is in progress
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the response output.content is a string (no outputSchema provided)
Then the tool result text contains the string as plain text followed by grounding citations
```

```gherkin
Given an authenticated Exa API key and the web_research_exa tool is enabled
When the response output.content is a JSON object (outputSchema was provided)
Then the tool result text contains the JSON formatted as a code block followed by grounding citations
And the tool result details includes the parsed JSON object under a "parsedOutput" key
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — new tool registration, `performResearch()` function, `formatResearchOutput()` formatter
- `packages/pi-exa/__tests__/extension.test.ts` — tests for the new tool

---

### FR-1b: Increase `web_search_exa` text maxCharacters to 500

The default search tool currently hardcodes `contents.text.maxCharacters` to 300. This is too aggressive — increase it to 500 to return more useful text snippets alongside highlights.

The full hardcoded search request shape is:

```typescript
const searchRequest = {
  query,
  type: "auto",
  numResults,
  contents: {
    highlights: { query },
    text: { maxCharacters: 300 },  // change to 500
  },
};
```

**Acceptance criteria:**

```gherkin
Given an authenticated Exa API key
When the LLM calls web_search_exa with any query
Then the /search request includes contents.text.maxCharacters set to 500
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — update `performWebSearch()` maxCharacters from 300 to 500
- `packages/pi-exa/__tests__/extension.test.ts` — add test verifying the search request includes `contents.text.maxCharacters: 500`

---

### FR-2: Answer tool (`web_answer_exa`)

A new tool that uses Exa's `/answer` endpoint to get a grounded LLM answer with citations in a single call. At $0.005/req, it's the cheapest endpoint — simpler and faster than deep-reasoning for direct questions.

**Parameters:**
- `query` (required) — the question to answer
- `systemPrompt` (optional) — guides answer style and focus
- `text` (optional, boolean, default: false) — include full source text in results alongside the answer
- `outputSchema` (optional) — JSON Schema for structured answer output

**Acceptance criteria:**

```gherkin
Given an authenticated Exa API key
When the LLM calls web_answer_exa with query "What is the latest version of React?"
Then the tool calls the Exa /answer endpoint
And returns the answer text followed by citation URLs
And the tool result details includes costDollars
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_answer_exa with query and systemPrompt "Answer concisely"
Then the systemPrompt is forwarded to the Exa /answer endpoint
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_answer_exa with text true
Then the response includes full source text for each citation
```

```gherkin
Given an authenticated Exa API key
When web_answer_exa begins execution
Then onUpdate is called with a progress message "Fetching answer from Exa..."
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — new tool registration, `performAnswer()` function, `formatAnswerResult()` formatter
- `packages/pi-exa/__tests__/extension.test.ts` — tests for the new tool

---

### FR-3: Find-similar tool (`web_find_similar_exa`)

A new tool that uses Exa's `/findSimilar` endpoint to find pages similar to a given URL. At ~$0.007/req, same cost tier as normal search.

**Parameters:**
- `url` (required) — the URL to find similar pages for
- `numResults` (optional, default: 5) — number of similar results
- `excludeSourceDomain` (optional, boolean) — exclude results from the same domain as the input URL
- `includeDomains` / `excludeDomains` (optional) — domain filters
- `startPublishedDate` / `endPublishedDate` (optional) — date filters

**Acceptance criteria:**

```gherkin
Given an authenticated Exa API key
When the LLM calls web_find_similar_exa with url "https://example.com/article"
Then the tool calls the Exa /findSimilar endpoint with the URL
And returns formatted results similar to web_search_exa output
And the tool result details includes costDollars
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_find_similar_exa with url and excludeSourceDomain true
Then the /findSimilar request includes excludeSourceDomain: true
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_find_similar_exa with url and numResults 10
Then the /findSimilar request includes numResults: 10
```

```gherkin
Given an authenticated Exa API key
When web_find_similar_exa begins execution
Then onUpdate is called with a progress message "Finding similar pages via Exa..."
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — new tool registration, `performFindSimilar()` function
- `packages/pi-exa/__tests__/extension.test.ts` — tests for the new tool

---

### FR-4: Enhanced content fetching

Extend `web_fetch_exa` to support additional `/contents` capabilities: highlights, summaries, and freshness control.

**Acceptance criteria:**

```gherkin
Given an authenticated Exa API key
When the LLM calls web_fetch_exa with urls and highlights true
Then the /contents request includes highlights in the contents options
And the formatted output includes a "Highlights:" section with highlight snippets below each page's text
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_fetch_exa with urls and summary { query: "main argument" }
Then the /contents request includes summary with the query
And the formatted output includes a "Summary:" section for each page
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_fetch_exa with urls and maxAgeHours 168
Then the /contents request includes maxAgeHours: 168 for freshness control
```

```gherkin
Given an authenticated Exa API key
When the LLM calls web_fetch_exa with no new optional parameters
Then the behavior is identical to the current implementation (backward compatible)
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — extend `webFetchParams` schema, update `performWebFetch()`, update `formatCrawlResults()`
- `packages/pi-exa/__tests__/extension.test.ts` — tests for new parameters
- `packages/pi-exa/__tests__/helpers.test.ts` — tests for enhanced formatting

---

### FR-5: Observability metadata

All 6 Exa tools (existing and new) include `costDollars`, `searchTime`, and `resolvedSearchType` (where applicable) in the tool result `details` field. The existing `details.tool` field is preserved.

This applies to:
- `web_search_exa` (existing — currently returns `{ tool: "web_search_exa" }`)
- `web_fetch_exa` (existing — currently returns `{ tool: "web_fetch_exa" }`)
- `web_search_advanced_exa` (existing — currently returns `{ tool: "web_search_advanced_exa" }`)
- `web_research_exa` (new)
- `web_answer_exa` (new)
- `web_find_similar_exa` (new)

**Note:** Existing tests in `extension.test.ts` assert exact `details` shapes (e.g., line 287: `result.details.tool === "web_fetch_exa"`, line 309: `toEqual({ tool: "web_fetch_exa", error: "fetch exploded" })`). These tests will need updating to account for the new optional fields.

**Acceptance criteria:**

```gherkin
Given any Exa tool completes successfully
When the result is returned
Then the details field includes the tool name
And the details field includes costDollars (if present in Exa response)
And the details field includes searchTime (if present in Exa response)
And the details field includes resolvedSearchType (if present in Exa response)
```

```gherkin
Given any Exa tool completes successfully
When the Exa response does not include costDollars
Then the details field omits costDollars (no synthetic values)
```

```gherkin
Given web_search_exa completes successfully with costDollars in the response
When the result is returned
Then the details field is { tool: "web_search_exa", costDollars: ..., searchTime: ..., resolvedSearchType: ... }
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — update all `perform*()` functions to extract and return metadata; update all tool execute handlers to merge metadata into `details`
- `packages/pi-exa/__tests__/extension.test.ts` — update existing `details` assertions, add new tests verifying metadata fields

---

### FR-6: Updated advanced search type options

The `web_search_advanced_exa` tool offers all non-deep Exa search types. Deep search types (`deep-reasoning`, `deep-lite`, `deep`) belong exclusively to `web_research_exa` — this enforces a clean separation where advanced search is for retrieval with full filtering control and research is for synthesis.

**Acceptance criteria:**

```gherkin
Given the web_search_advanced_exa tool is enabled
When the LLM inspects its type parameter description
Then the description lists retrieval types: auto, fast, neural, keyword, hybrid, instant
And does NOT list deep-reasoning, deep-lite, or deep
```

```gherkin
Given the web_search_advanced_exa tool is enabled
When the LLM calls it with type "instant"
Then the request is sent to Exa with type "instant"
```

```gherkin
Given the web_search_advanced_exa tool is enabled
When the LLM calls it with type "deep-reasoning" or "deep-lite" or "deep"
Then the tool returns an error result with a message indicating deep search types are reserved for web_research_exa
And no request is sent to the Exa API
```

**Implementation note:** Use a `Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("neural"), Type.Literal("keyword"), Type.Literal("hybrid"), Type.Literal("instant")])` enum in the TypeBox schema for the `type` param. This gives the LLM the allowed values in the schema and rejects deep types at validation. Add a runtime check in `execute()` as a safety net that returns an error directing users to `web_research_exa`.

**Files:**
- `packages/pi-exa/extensions/index.ts` — update `webSearchAdvancedParams` type schema to TypeBox enum, add runtime validation rejecting deep types
- `packages/pi-exa/__tests__/extension.test.ts` — test that deep types are rejected with clear error

---

### FR-8: System prompt guidance via `promptSnippet` and `promptGuidelines`

All 6 tools (existing and new) set `promptSnippet` and `promptGuidelines` on their `registerTool()` definitions. These pi extension API fields inject tool routing guidance into the system prompt — `promptSnippet` appears in the "Available tools" section, `promptGuidelines` appends bullets to the "Guidelines" section.

Without these, custom tools are omitted from the system prompt's available tools list, and the LLM has no cross-tool routing guidance beyond the tool description.

**Values:**

| Tool | `promptSnippet` | `promptGuidelines` |
|---|---|---|
| `web_search_exa` | "Search the web — returns links with highlights." | "Use web_search_exa for quick lookups, news, and finding pages." / "For direct factual questions, prefer web_answer_exa — it's cheaper and returns a grounded answer." / "For research requiring synthesis and citations, use web_research_exa (requires --exa-enable-research)." / "For reading a known URL, use web_fetch_exa." |
| `web_fetch_exa` | "Read a webpage's content as clean text." | "Use web_fetch_exa after search when highlights aren't enough, or to read any known URL." / "Batch multiple URLs in one call." |
| `web_answer_exa` | "Get a grounded answer with citations — fast, cheap." | "Use web_answer_exa for direct factual questions that need a concise answer with sources." / "For open-ended research needing synthesis across many sources, use web_research_exa instead." |
| `web_find_similar_exa` | "Find pages similar to a given URL." | "Use web_find_similar_exa when you have a good page and want to find more like it." / "For keyword-based search, use web_search_exa instead." |
| `web_search_advanced_exa` | "Advanced web search with category filters, date ranges, and domain restrictions." | "Use web_search_advanced_exa when you need category filtering (company, research paper, news, people, financial report, personal site), date range filters, or domain include/exclude." / "For simple searches without filters, prefer web_search_exa." / "Deep search types (deep-reasoning, deep-lite, deep) are not available here — use web_research_exa for synthesis." / "Some categories have filter restrictions: 'company' and 'people' categories do not support date or domain filters." |
| `web_research_exa` | "Deep research — synthesizes findings with grounded citations. ~20s, higher cost." | "Only use web_research_exa when the user needs conclusions, comparisons, or analysis — not for simple lookups." / "Always provide a systemPrompt to guide source selection and synthesis quality." / "Use outputSchema when structured data is needed downstream." / "Requires --exa-enable-research flag." |

**Acceptance criteria:**

```gherkin
Given the pi-exa extension is loaded
When web_search_exa is registered
Then its tool definition includes a promptSnippet string
And its tool definition includes a promptGuidelines array with at least one entry referencing web_answer_exa and web_research_exa
```

```gherkin
Given the pi-exa extension is loaded
When web_research_exa is registered (--exa-enable-research is set)
Then its tool definition includes a promptSnippet mentioning higher cost and latency
And its tool definition includes a promptGuidelines array advising against use for simple lookups
```

```gherkin
Given the pi-exa extension is loaded
When any tool is registered
Then its promptSnippet is a single line under 100 characters
And its promptGuidelines entries each reference at least one other Exa tool for cross-routing
```

**Files:**
- `packages/pi-exa/extensions/index.ts` — add `promptSnippet` and `promptGuidelines` to all 6 `registerTool()` calls
- `packages/pi-exa/__tests__/extension.test.ts` — verify promptSnippet and promptGuidelines are set on registered tools

---

### FR-7: Rewrite skills as pi-native with tool selection and parameter guidelines

All 6 skills are **rewritten from scratch** to be pi-native. The current skills were ported from OpenClaw and contain patterns that don't apply to pi's extension model:

- **Remove "Token Isolation (Critical)" sections** — pi tools execute directly via `registerTool()`, there is no "Task agent spawning" mechanism. The LLM calls the tool and gets a result.
- **Remove "Browser Fallback" sections** — this is an OpenClaw convention, not a pi capability.
- **Keep `context: fork`** — this is pi-native and correct for search-heavy skills that would pollute the main context with Exa results.
- **Remove rigid "ONLY use X" tool restrictions** — replace with intent-based tool selection that maps user goals to the right tool.
- **Remove `numResults` dynamic tuning for research tools** — deep-reasoning synthesizes across sources; `numResults` tuning applies to retrieval tools, not synthesis.

Each rewritten skill should have:
1. **Tool Selection** — maps user intent to the correct tool with rationale
2. **Recommended Settings** — concrete parameter examples per domain (`systemPrompt` wording, `outputSchema` shapes, `includeDomains`, `category` values)
3. **Query Writing Patterns** — domain-specific query tips (keep the good parts from existing skills)
4. **Category Filter Restrictions** — keep documented restrictions that cause 400 errors (these are still valid and useful)
5. **Output Format** — what the skill should return (keep from existing skills)
6. **Tool availability notes** — when recommending `web_research_exa`, note it requires `--exa-enable-research`. All other tools are available by default.

**Acceptance criteria:**

```gherkin
Given the company-research skill is loaded
When the skill content is inspected
Then it has a Tool Selection section mapping:
  - quick facts → web_answer_exa
  - company discovery/lists → web_search_exa or web_search_advanced_exa with category "company"
  - deep competitive analysis → web_research_exa with systemPrompt guiding toward official docs and financial data
And it has Recommended Settings with concrete systemPrompt and outputSchema examples for company research
```

```gherkin
Given the code-search skill is loaded
When the skill content is inspected
Then it has a Tool Selection section mapping:
  - API syntax / "how do I" → web_answer_exa
  - find code examples → web_search_exa with domain-focused query patterns
  - deep technical comparison → web_research_exa with systemPrompt guiding toward official docs and benchmarks
And it has Recommended Settings with concrete includeDomains examples (github.com, stackoverflow.com, official doc sites)
```

```gherkin
Given the research-paper-search skill is loaded
When the skill content is inspected
Then it has a Tool Selection section mapping:
  - find papers → web_search_exa or web_search_advanced_exa with category "research paper"
  - literature review / synthesis → web_research_exa with systemPrompt guiding toward peer-reviewed sources
And it has Recommended Settings with concrete includeDomains (arxiv.org, openreview.net, scholar.google.com) and date filter guidance
```

```gherkin
Given the personal-site-search skill is loaded
When the skill content is inspected
Then it references web_find_similar_exa for "find more like this" workflows
And it has guidelines for when to use web_find_similar_exa vs web_search_exa
```

```gherkin
Given the people-research skill is loaded
When the skill content is inspected
Then it has a Tool Selection section mapping:
  - find profiles → web_search_advanced_exa with category "people"
  - deep background research → web_research_exa with systemPrompt guiding toward professional/public sources
And it has Recommended Settings with concrete examples
```

```gherkin
Given the financial-report-search skill is loaded
When the skill content is inspected
Then it has a Tool Selection section mapping:
  - find filings → web_search_advanced_exa with category "financial report"
  - financial analysis / comparison → web_research_exa with systemPrompt guiding toward SEC filings and official reports
And it has Recommended Settings with concrete includeDomains (sec.gov) and outputSchema examples for structured financial data
```

**Files:**
- `packages/pi-exa/skills/code-search/SKILL.md`
- `packages/pi-exa/skills/company-research/SKILL.md`
- `packages/pi-exa/skills/people-research/SKILL.md`
- `packages/pi-exa/skills/research-paper-search/SKILL.md`
- `packages/pi-exa/skills/financial-report-search/SKILL.md`
- `packages/pi-exa/skills/personal-site-search/SKILL.md`

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Backward compatibility** | All existing tool behavior, config resolution, and default enablement unchanged |
| **Output size** | Tool results respect pi's ~50KB / 2000 line limit; deep-reasoning output prioritizes synthesized content over raw results when truncation is needed |
| **Latency transparency** | Deep-reasoning tool description warns about ~20s latency; `onUpdate` provides progress indication |
| **Cost transparency** | All tools include `costDollars` in `details` so users and automation can track API spend |
| **Error messages** | Exa API errors include the HTTP status code and Exa error message for debuggability |
| **Test coverage** | Every new tool has tests for: missing API key, aborted signal, successful execution, error handling, onUpdate callback |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Deep-reasoning costs 2x+ normal search ($0.015 vs $0.007 observed); LLM may over-use it | Medium | High | Tool description explicitly states cost/latency tradeoff; `promptGuidelines` guides LLM to prefer `web_search_exa` for simple lookups |
| Deep-reasoning ~20s latency may feel broken to users | Medium | Medium | `onUpdate` progress callback fires immediately; tool description warns about latency |
| `outputSchema` validation failures on malformed schemas from LLM | Medium | Low | Validate schema has `type` field before sending; return clear error message on Exa 400 |
| Adding 3 new tools increases LLM decision surface — may cause confusion or wrong tool selection | Medium | Medium | Each tool has distinct `promptSnippet` and `promptGuidelines`; skills guide tool selection for specific workflows |
| pi tool output limit (~50KB) may truncate deep-reasoning results with many sources | Low | Medium | Format synthesized output first, raw results second; truncate results array if needed |

### Assumptions

- The exa-js SDK >=2.8 <3.0 typed methods (`search()`, `answer()`, `findSimilar()`, `getContents()`) work correctly for all use cases (SDK has full types; existing tests mock `exa.request()` and will need updating to mock the typed methods instead)
- The Exa API `/answer` endpoint is GA and stable (SDK has full types)
- Deep-reasoning `output.content` and `output.grounding` are always present when `type: "deep-reasoning"` is used (confirmed by live test in research session)
- The pi `onUpdate` callback is delivered to the user during tool execution (confirmed by existing `web_search_exa` usage)

---

## 8. Design Decisions

### D1: New `web_research_exa` tool with exclusive ownership of deep search types

**Decision:** New dedicated tool that exclusively owns deep search types (`deep-reasoning`, `deep-lite`, `deep`). `web_search_advanced_exa` retains all retrieval-oriented types (`auto`, `fast`, `neural`, `keyword`, `hybrid`, `instant`) but never offers deep types. See ADR-0005 for full analysis.

**Rationale:** Clean separation of concerns — advanced search is for retrieval with full filtering control, research is for synthesis. No overlap, no ambiguity for the LLM or the user.

### D2: Switch to typed SDK methods

**Options considered:**
1. **Continue using `exa.request()`** — consistent with existing code; full control over request shape
2. **Switch to typed SDK methods** (`exa.search()`, `exa.findSimilar()`, `exa.answer()`) — type safety; SDK handles parameter marshaling

**Decision:** Switch to the typed SDK methods (`exa.search()`, `exa.answer()`, `exa.findSimilar()`). Migrate existing tools as part of this work.

**Rationale:** We're already modifying all existing tools for FR-5 (observability) and FR-8 (promptSnippet/promptGuidelines). The "don't refactor for no benefit" argument no longer applies. The typed methods provide:
- Compile-time parameter type safety via `DeepSearchOptions`, `AnswerOptions`, `FindSimilarOptions`
- SDK-provided response types (`SearchResponse`, `AnswerResponse`, `DeepSearchOutput`, `CostDollars`, `GroundingEntry`) — eliminates our custom `ExaSearchResponse` and `SearchResult` interfaces
- Correct endpoint paths handled by the SDK — removes the relative-path workaround comment
- Zod schema support for `outputSchema` comes for free if needed later

**Migration scope:** All 3 existing tools (`web_search_exa` → `exa.search()`, `web_fetch_exa` → `exa.getContents()`, `web_search_advanced_exa` → `exa.search()`) plus 3 new tools (`web_research_exa` → `exa.search()`, `web_answer_exa` → `exa.answer()`, `web_find_similar_exa` → `exa.findSimilar()`).

### D3: Tool enablement tiers based on cost and complexity

**Decision:** Tools are split into two tiers based on their cost, latency, and parameter complexity:

**Enabled by default** (cheap, fast, simple):
- `web_search_exa` — $0.007/req, ~1.6s
- `web_fetch_exa` — $0.001/page
- `web_answer_exa` — $0.005/req, fast
- `web_find_similar_exa` — ~$0.007/req, fast

**Disabled by default, opt-in via flag:**
- `web_search_advanced_exa` — `--exa-enable-advanced` / `advancedEnabled` (large parameter surface)
- `web_research_exa` — `--exa-enable-research` / `researchEnabled` ($0.012-0.015/req, ~20s latency)

**Rationale:** `/answer` ($0.005) and `/findSimilar` (~$0.007) are the same cost tier as the existing defaults. Gating them adds friction for no safety benefit. Only `web_research_exa` warrants a flag due to higher cost, 20s latency, and complex parameters (`systemPrompt`, `outputSchema`). `web_search_advanced_exa` retains its existing flag because of its large parameter surface.

**Implementation:** Update `isToolEnabledForConfig()` to return `true` for `web_answer_exa` and `web_find_similar_exa` by default (same as `web_search_exa` / `web_fetch_exa`). Add `researchEnabled` to `ExaConfig`, add `isResearchToolEnabled()` helper mirroring `isAdvancedToolEnabled()`, register `--exa-enable-research` flag. The `enabledTools` array in config continues to work as a fine-grained override.

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `packages/pi-exa/extensions/index.ts` | Modify | FR-1,1b,2,3,4,5,6,8 | Add 3 new tools, increase search maxCharacters, enhance web_fetch_exa params, add formatters, add observability metadata, update type descriptions, add `--exa-enable-research` flag and `researchEnabled` config, add promptSnippet/promptGuidelines to all tools |
| `packages/pi-exa/__tests__/extension.test.ts` | Modify | FR-1,2,3,4,5,8 | Tests for new tools, enhanced parameters, and promptSnippet/promptGuidelines |
| `packages/pi-exa/__tests__/helpers.test.ts` | Modify | FR-1,4,5,D3 | Tests for new formatters, enhanced formatting, and `researchEnabled`/`isResearchToolEnabled` enablement logic |
| `packages/pi-exa/__tests__/index.test.ts` | Modify | FR-7 | Skill smoke tests (verify new tool references) |
| `packages/pi-exa/skills/code-search/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/skills/company-research/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/skills/people-research/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/skills/research-paper-search/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/skills/financial-report-search/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/skills/personal-site-search/SKILL.md` | Modify | FR-7 | Rewrite as pi-native skill with tool selection, parameter guidelines, and domain-specific settings |
| `packages/pi-exa/README.md` | Modify | FR-1,2,3,4 | Document new tools, parameters, and enablement |
| `packages/pi-exa/package.json` | Modify | FR-1 | Version bump |

---

## 10. Dependencies & Constraints

- **exa-js >=2.8 <3.0** — already installed (^2.8.0 in package.json); has full types for all endpoints. No SDK upgrade needed.
- **@sinclair/typebox** — peer dependency, already used for parameter schemas
- **@mariozechner/pi-coding-agent** — peer dependency; `ExtensionAPI`, `registerTool()`, `onUpdate`, `details` field all confirmed available
- **Exa API account** — must have payment method on file (research session confirmed 403/1010 error without billing setup)

---

## 11. Rollout Plan

1. **Quick win: bump maxCharacters** (FR-1b) — one-line change, no dependencies
2. **Migrate existing tools to typed SDK methods** (D2) — refactor `web_search_exa`, `web_fetch_exa`, `web_search_advanced_exa` to use `exa.search()`, `exa.getContents()`; add observability metadata (FR-5); add `promptSnippet`/`promptGuidelines` (FR-8)
3. **Add `web_research_exa` tool** (FR-1) — highest-value new capability
4. **Add `web_answer_exa` tool** (FR-2) — simple, low-risk
5. **Add `web_find_similar_exa` tool** (FR-3) — simple, low-risk
6. **Enhance `web_fetch_exa`** (FR-4) — backward-compatible parameter additions
7. **Update advanced search type enforcement** (FR-6) — TypeBox enum + runtime rejection of deep types
8. **Rewrite skills** (FR-7) — depends on new tools being registered
9. **Update README, bump version** — final polish
10. **Publish** — `npm publish`

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Should `web_research_exa` be enabled by default in a future version? | Sebastian | Post-launch | Open |
| Q2 | Should a `--exa-enable-research` convenience flag be added (similar to `--exa-enable-advanced`)? | Sebastian | During implementation | **Resolved:** Yes — `--exa-enable-research` flag and `researchEnabled` config key for `web_research_exa`. `web_answer_exa` and `web_find_similar_exa` are enabled by default (cheap, fast). See D3. |
| Q3 | Should `outputSchema` support Exa's `type: "text"` mode (plain text with optional description) in addition to `type: "object"`? | Sebastian | During implementation | **Resolved:** Yes — `outputSchema` accepts both `{ type: "object", properties: ... }` for structured JSON and `{ type: "text", description?: "..." }` for guided prose. Passed through to Exa as-is. |
| Q4 | Should entity properties (company metadata from category searches) be surfaced in a follow-up? | Sebastian | Post-launch | Open |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| ADR-0005: Exa Deep Search Tool Strategy | Design decision — new tool vs. enhance existing |
| Exa `/research/v1` deprecation (May 1, 2026) | Motivates — deep-reasoning is the replacement |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-20 | Initial draft | Sebastian Otaegui |
| 2026-04-20 | Revised: enablement tiers (D3 — answer/findSimilar default-on, research behind flag), FR-1 type param (deep-reasoning/deep-lite/deep), FR-2/3 full param specs, FR-6 deep type rejection, FR-7 skill rewrite scope (drop OpenClaw patterns), FR-8 promptSnippet/promptGuidelines, D2 switched to typed SDK methods, FR-1b maxCharacters bump, pricing data added | Sebastian Otaegui |

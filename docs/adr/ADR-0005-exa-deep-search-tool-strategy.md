---
title: "Exa Deep Search Tool Strategy"
adr: ADR-0005
status: Proposed
date: 2026-04-20
prd: "PRD-005-pi-exa-api-alignment"
decision: "New dedicated web_research_exa tool"
---

# ADR-0005: Exa Deep Search Tool Strategy

## Status

Proposed

## Date

2026-04-20

## Requirement Source

- **PRD**: `docs/prd/PRD-005-pi-exa-api-alignment.md`
- **Decision Point**: FR-1 (Deep-reasoning search tool) — how to expose Exa's `type: "deep-reasoning"` search mode, which has a fundamentally different parameter shape, response format, latency, and cost profile from regular search.

## Context

Exa's API offers multiple search types through the same `/search` endpoint. The types fall into two distinct categories:

**Retrieval-oriented** (`auto`, `neural`, `fast`, `keyword`, `hybrid`, `instant`): Return a list of results with optional text/highlights. ~1-2s latency, ~$0.007/call. No synthesized output.

**Synthesis-oriented** (`deep-reasoning`, `deep-lite`, `deep`): Return results *plus* `output.content` (synthesized answer) and `output.grounding` (per-field citations with confidence levels). Accept `systemPrompt`, `outputSchema`, and `additionalQueries`. ~20s latency for deep-reasoning, ~$0.012-0.015/call.

The current extension has two search tools:
- `web_search_exa` — simple search, always `type: "auto"`, enabled by default
- `web_search_advanced_exa` — full parameter control, disabled by default

The question: where should deep-reasoning support live?

## Decision Drivers

- **LLM tool selection accuracy**: The LLM must choose the right tool for the task. Per-tool `promptSnippet` and `promptGuidelines` (pi extension API) are the primary mechanisms for guiding this choice. Distinct tools with distinct descriptions are easier for LLMs to route correctly than a single tool with mode-dependent behavior.
- **Response format divergence**: Deep-reasoning returns `output.content` + `output.grounding` in addition to `results[]`. Regular search returns only `results[]`. The formatting logic is fundamentally different — synthesized prose with grounded citations vs. a list of links with snippets.
- **Parameter shape divergence**: Deep-reasoning uses `systemPrompt`, `outputSchema`, `additionalQueries`. Regular search does not. Combining them in one tool creates confusing conditional parameter documentation ("only used when type is deep-reasoning").
- **Cost and latency transparency**: Deep-reasoning is 10-12x slower and 2x more expensive. Users should make an informed choice. A separate tool makes the cost/latency tradeoff explicit at the point of tool selection, not buried in a type parameter.
- **Tool count**: More tools means more LLM decision surface. Each additional tool has a marginal cost in system prompt tokens and selection complexity.

## Considered Options

### Option 1: Enhance `web_search_advanced_exa`

Add `systemPrompt`, `outputSchema`, `additionalQueries` parameters to the existing advanced tool. Update the response formatter to check for `output` and format it when present.

- Good, because no new tool — keeps tool count at 3
- Good, because users already familiar with advanced tool get deep-reasoning for free
- Bad, because the tool description must serve two purposes (retrieval and synthesis), making it harder for the LLM to choose correctly
- Bad, because `promptGuidelines` can't distinguish "use this for quick filtered search" from "use this for 20-second research synthesis"
- Bad, because parameters become conditionally relevant (`systemPrompt` is meaningless for `type: "auto"`)
- Bad, because the formatter needs branching logic based on response shape

### Option 2: New dedicated `web_research_exa` tool

Create a new tool specifically for deep search. It defaults to `type: "deep-reasoning"` and accepts all three deep search types (`deep-reasoning`, `deep-lite`, `deep`), along with research-specific parameters, and formats output as synthesized prose with grounded citations.

- Good, because the tool description clearly communicates "use this for research that needs conclusions and citations"
- Good, because `promptGuidelines` can specifically guide: "prefer web_search_exa for quick lookups, web_research_exa only when synthesis is needed"
- Good, because parameters are all relevant — no conditional documentation
- Good, because the formatter is clean — always expects `output.content` + `output.grounding`
- Good, because cost/latency is explicit in the tool description
- Bad, because adds a 4th (or 5th/6th with answer/findSimilar) tool to the extension
- Bad, because users must switch from advanced search to research tool for any deep search type

### Option 3: Replace `web_search_exa` with a smart auto-routing tool

Replace the basic search tool with one that auto-selects the search type based on query complexity. Simple queries get `type: "auto"`, complex research questions get `type: "deep-reasoning"`.

- Good, because reduces tool count — one tool handles everything
- Bad, because auto-routing logic is fragile and opaque
- Bad, because cost becomes unpredictable — users can't control whether they're paying $0.007 or $0.015
- Bad, because latency becomes unpredictable — sometimes 2s, sometimes 20s
- Bad, because removes user agency over the cost/quality tradeoff

## Decision

Chosen option: **"New dedicated `web_research_exa` tool"** (Option 2), because:

1. It provides the clearest LLM guidance through distinct `promptSnippet` and `promptGuidelines` per tool, which is the pi extension API's primary mechanism for tool selection accuracy.
2. The response format divergence (synthesized prose with grounding vs. link list) justifies a separate formatter and output structure rather than branching logic.
3. Cost and latency transparency is achieved at tool selection time, not buried in a parameter choice.
4. The parameter shape is cleanly tailored — no conditional documentation or unused parameters.

The `web_search_advanced_exa` tool will explicitly exclude deep search types (`deep-reasoning`, `deep-lite`, `deep`) from its allowed `type` values. Deep search types belong exclusively to `web_research_exa`. This enforces a clean boundary: advanced search is for retrieval with full filtering control (`auto`, `fast`, `neural`, `keyword`, `hybrid`, `instant`), research is for synthesis. No overlap, no ambiguity.

## Consequences

### Positive

- LLM can clearly distinguish "find links" (web_search_exa), "research and synthesize" (web_research_exa), and "answer a question" (web_answer_exa) — three distinct intents mapped to three distinct tools
- Skills can reference the right tool for their use case without ambiguity
- Cost/latency expectations are set at the tool description level
- Each tool's formatter is simple and single-purpose

### Negative

- Tool count increases from 3 to 6 (adding research, answer, findSimilar). This increases system prompt size and LLM decision complexity. Mitigated by: `web_research_exa` is behind `--exa-enable-research`; `promptGuidelines` actively guides selection; each tool has a clear, non-overlapping purpose.
- `web_search_advanced_exa` explicitly rejects deep search types, which could frustrate power users who want manual control over the raw `/search` endpoint. Mitigated by: `web_research_exa` covers the deep search use case with proper output handling; the clean boundary prevents confusion and wrong-tool selection.

### Neutral

- All three deep types (`deep-reasoning`, `deep-lite`, `deep`) are owned by `web_research_exa`. The tool accepts a `type` parameter restricted to these three values, defaulting to `deep-reasoning` (see PRD-005 FR-1).

## Related

- **Plan**: N/A (implementation plan to be generated via `/plan-prd`)
- **ADRs**: N/A
- **Implementation**: `packages/pi-exa/extensions/index.ts` — new tool registration

---
name: exa-research-planner
description: Plan, draft, and execute Exa deep-research workflows. Use when the user wants staged research planning, cost-aware discovery before deep synthesis, or an explicit deep-research report. Also use when the user asks to refine a research question, compare options, explore a market or technical landscape, gather sources cheaply before synthesis, or decide whether deep research is necessary.
context: fork
---

# Exa Research Planner

Use this skill to turn a vague or broad research request into a high-quality Exa research workflow, then optionally execute `web_research_exa` when the user clearly wants deep synthesis.

This skill has two jobs:

1. **Research planning** — sharpen the question, decide whether cheap discovery is useful, and draft a strong deep-research payload.
2. **Explicit deep-research execution** — when the user directly asks for deep research or approves a draft, run `web_research_exa` and return a source-grounded synthesis.

## Operating Modes

Choose the mode from the user's request.

| Mode | Use When | Behavior |
|---|---|---|
| **Plan-only** | User asks to design/refine a research prompt, scope a landscape, or reduce cost | Clarify, optionally do cheap discovery, draft a payload, and ask before execution. |
| **Recon-first** | Topic is broad, terminology is unclear, or trusted sources are unknown | Run cheap discovery with available search/fetch tools, then refine the deep-research spec. |
| **Explicit deep-research execution** | User says “do deep research,” “run deep research,” “deeply research,” or equivalent | Clarify only missing essentials, then run `web_research_exa` if available. A direct user request to run deep research counts as approval. |

Do not force an explicit deep-research request through a long planning loop. If the user has already asked to run deep research and the brief is usable, execute the deep research rather than asking for another confirmation.

## Tool Availability Rules

Build the workflow only from tools actually available in the current session.

Common default tools:

- `web_search_exa`
- `web_fetch_exa`
- `web_answer_exa`
- `web_find_similar_exa`

Opt-in tools:

- `web_search_advanced_exa`
- `web_research_exa`

Warn clearly when an important tool is unavailable:

- If `web_research_exa` is unavailable, say deep synthesis cannot be executed in this session. Fall back to cheap discovery and a polished draft payload for later use.
- If `web_search_advanced_exa` is unavailable, say advanced filters are unavailable and fall back to `web_search_exa` with better query wording.
- If a common default tool is missing, mention it briefly and adapt without dwelling on it.

Never suggest unavailable tools as if they can be used.

## Fast Path: Explicit Deep Research

When the user explicitly asks for deep research:

1. Check that `web_research_exa` is available.
2. If the request is usable, draft the payload internally and run it.
3. Ask at most one clarifying question only if a missing constraint would materially change the result, such as:
   - the target decision,
   - source type preference,
   - timeframe,
   - comparison criteria,
   - output format.
4. Use `deep-reasoning` by default for careful synthesis; use `deep-lite` for exploratory or cost-sensitive requests; use `deep` when speed matters more than maximum reasoning depth.
5. Return a concise report with sources, uncertainty, and practical next steps.

A direct user request to run deep research counts as approval. Do not ask “should I run it?” again unless the request is dangerously ambiguous or the tool may incur unexpected scope/cost.

## Cost-Aware Planning Workflow

Use this staged flow when the user has not clearly asked to run deep research yet, or when the topic would benefit from reconnaissance.

### Phase 1: Clarify the Goal

Ask the smallest number of questions that will meaningfully improve the research. Useful dimensions:

- **Topic:** what is being researched?
- **Decision:** what decision should the research support?
- **Task type:** comparison, recommendation, scan, diligence, summary, evaluation.
- **Criteria:** what factors matter most?
- **Sources:** official docs, filings, GitHub, academic papers, news, practitioner blogs, company pages.
- **Time horizon:** current snapshot, last 12 months, historical context.
- **Filters:** domains to include or exclude.
- **Output shape:** narrative report or structured object.
- **Depth/speed/cost:** `deep-reasoning`, `deep`, or `deep-lite`.

If the user already gave enough detail, move directly to a plan or execution.

### Phase 2: Choose the Cheapest Useful Next Step

Choose one:

- **Draft-only:** refine the brief and proposed `web_research_exa` payload without running tools.
- **Cheap discovery:** use search/fetch tools to learn terminology, candidate sources, and filters.
- **Deep synthesis:** run or prepare `web_research_exa` when cheaper steps are unnecessary or already done.

Prefer cheap discovery first when:

- the topic is broad or ambiguous,
- trusted domains are unknown,
- terminology is unclear,
- the user wants to minimize cost,
- you need candidate sources before committing to synthesis.

Explain why the proposed next step is the cheapest useful move.

### Phase 3: Run Cheap Discovery When It Earns Its Keep

Use available tools selectively:

| Goal | Preferred Tool | Notes |
|---|---|---|
| Broad discovery and vocabulary | `web_search_exa` | Best first pass for reconnaissance. |
| Domain/category/date constrained discovery | `web_search_advanced_exa` | Use when available and constraints are known. |
| Inspect a few strong URLs | `web_fetch_exa` | Fetch 1-3 high-signal pages. |
| Expand from one strong seed URL | `web_find_similar_exa` | Use only with a clearly representative source. |
| Resolve a narrow sub-question cheaply | `web_answer_exa` | Use when it may avoid deeper research. |

Each discovery round must have a purpose. After each round, summarize what changed:

- better terminology,
- stronger candidate sources,
- trusted domains to include,
- low-signal domains to exclude,
- whether deep research still appears necessary.

## Iterative Discovery and Clarification Loop

Run multiple cheap discovery rounds when each round changes the plan. The planner should behave like an active research lead: discover criteria, search for evidence, revise the coverage map, and only then draft or execute deep synthesis.

Use this loop for broad, ambiguous, or high-stakes research:

1. **Seed criteria:** infer initial search dimensions from the user's topic.
2. **Round 1 broad discovery:** identify vocabulary, source classes, named entities, and candidate criteria the user did not mention.
3. **Revise criteria:** add, remove, or reprioritize search criteria based on what the first round revealed.
4. **Round 2 targeted discovery:** search the strongest criteria, domains, papers, vendors, methods, or contrarian evidence.
5. **Fetch representative sources:** use `web_fetch_exa` for the strongest URLs when source contents matter.
6. **Gap check:** identify missing evidence, conflicting evidence, or decisions that require user input.
7. **Clarify or continue:** Ask the user one focused clarification question if the gap changes the research objective, scope, or evaluation criteria. Otherwise run another cheap discovery round or draft the deep-research payload.
8. **Stop condition:** stop iterating when a new round is unlikely to change query wording, source filters, criteria, or the final synthesis.

Ask the user one focused clarification question when discovery reveals a materially different interpretation of the request. Good clarification triggers include:

- the topic has multiple domains with different source strategies,
- discovery finds several incompatible evaluation frames,
- the answer depends on a timeframe or geography the user did not specify,
- source classes conflict, such as vendor white papers versus peer-reviewed papers,
- the research could optimize for different outcomes, such as accuracy, deployability, cost, safety, or market adoption.

Do not ask for clarification just because more detail would be nice. If the missing detail can be handled as an assumption, state the assumption and continue.

## White Papers and Source Retrieval

When white papers, academic papers, technical reports, standards documents, filings, or PDFs are important source classes, the research plan must include source retrieval, not just synthesis.

Requirements:

- Use discovery to find the paper landing pages or PDF URLs.
- Use `web_fetch_exa` on the strongest paper URLs when available, especially before relying on claims from abstracts, snippets, or secondary summaries.
- In the final report, return the actual paper URLs alongside the synthesized findings.
- Distinguish paper types: vendor white paper, academic paper, standards document, government report, analyst report, or marketing collateral.
- Call out when the full paper could not be fetched and the synthesis relies only on metadata, snippets, abstracts, or secondary discussion.

For paper-heavy research, include a **Source Pack** section in the output:

| Source | Type | URL | Used For | Retrieval Status |
|---|---|---|---|---|
| Paper title | academic paper / white paper / PDF | direct URL | evidence area | fetched / discovered only / unavailable |

If the user asks for white papers as sources, treat the actual papers as deliverables. Do not only cite them indirectly through the deep synthesis.

### Paper Content Synthesis Rule

Do not rely only on `web_research_exa` synthesis when paper sources are part of the evidence base. Use fetched paper contents as first-class evidence in the final answer.

Required workflow for paper-heavy research:

1. Run discovery/deep research to identify candidate papers and reports.
2. Select the strongest papers that materially support or challenge the answer.
3. Fetch the paper contents with `web_fetch_exa` when available.
4. Read the fetched contents for methods, claims, data, limitations, and conclusions.
5. Synthesize across both:
   - the `web_research_exa` synthesized output, and
   - the fetched paper contents you directly inspected.
6. If fetched paper contents disagree with the deep-research synthesis, prefer the directly inspected paper text and call out the discrepancy.
7. If a paper cannot be fetched, mark it as `discovered only` and do not treat it as equally strong evidence.

In the final report, explicitly identify which findings came from directly fetched paper contents versus broader Exa synthesis. This is especially important for vendor white papers and analyst reports, where summaries may inherit marketing framing.

### Phase 4: Draft the Deep Research Plan

Show the user the research plan in human-consumable form first. Do not lead with raw JSON.

#### Human-Readable Drafts First

When presenting a draft to the user, lead with a readable research plan that explains what will be studied, why those criteria matter, which sources will be prioritized, and what the output will contain. Raw tool payloads are implementation details; include them only after the human-readable plan, in a collapsed/optional section, or when the user specifically asks for the exact JSON.

A user-facing draft should include:

- **Research objective:** one sentence describing the decision or question.
- **Coverage areas:** the criteria the research will cover.
- **Discovery rounds:** what cheap searches or fetches will happen before deep synthesis.
- **Source strategy:** source classes, trusted domains, source retrieval requirements, and exclusions.
- **Paper/source pack plan:** when papers, white papers, reports, PDFs, or standards are deliverables.
- **Expected output:** report shape, comparison table, recommendation, source pack, or structured data.
- **Assumptions:** what the planner will assume unless the user corrects it.
- **Open clarification:** at most one focused question if needed.

The internal `web_research_exa` payload still matters, but it should be derived from the readable plan. If shown, label it as **Implementation payload** after the readable plan.

Produce a proposed `web_research_exa` call when useful. Include relevant fields:

- `query`
- `type`
- `systemPrompt`
- `additionalQueries`
- `numResults`
- `textMaxCharacters`
- `includeDomains`
- `excludeDomains`
- `startPublishedDate`
- `endPublishedDate`
- `outputSchema`

Make `query` a clear research objective, not keywords.

Good:

```json
{
  "query": "Compare TypeScript runtime validation libraries for backend APIs, focusing on ergonomics, performance, ecosystem adoption, and schema reuse."
}
```

Avoid:

```json
{
  "query": "typescript validation libraries"
}
```

### Phase 5: Execute or Hand Back the Draft

- In **Plan-only** and **Recon-first** modes, ask for confirmation before execution.
- In **Explicit deep-research execution** mode, execute once the brief is usable because the user already approved deep research by asking for it.
- If `web_research_exa` is unavailable, present the payload as a polished draft for later execution and offer cheap discovery instead.

## Deep Research Defaults

### Search Type

- `deep-reasoning`: default for comparisons, recommendations, careful trade-off analysis, market scans, and due diligence.
- `deep`: use when faster turnaround matters more than maximum reasoning depth.
- `deep-lite`: use for exploratory passes, lower-cost iteration, or when the user asks for a lighter scan.

### System Prompt

Use `systemPrompt` to specify:

- source quality preferences,
- evidence standards,
- evaluation criteria,
- how to handle disagreement,
- recency requirements,
- what to avoid.

Good pattern:

```json
{
  "systemPrompt": "Prefer official docs, maintainer-authored sources, reputable technical writeups, and recent primary sources. Focus on trade-offs, quality of evidence, and practical recommendations. Call out uncertainty and conflicting evidence."
}
```

### Additional Queries

Use `additionalQueries` for alternate terminology, competitor names, synonyms, and comparison variants.

Rules:

- Maximum 5 entries.
- Prefer the strongest 3-5, not exhaustive lists.
- Fold extra variants into `query` or `systemPrompt`.

### Output Schema

Default to text:

```json
{
  "outputSchema": { "type": "text" }
}
```

Use structured output only when downstream processing or comparison clearly benefits. Keep schemas shallow.

If `outputSchema` contains arrays, every array must include `items`:

```json
{
  "outputSchema": {
    "type": "object",
    "properties": {
      "recommendation": { "type": "string" },
      "risks": {
        "type": "array",
        "items": { "type": "string" }
      }
    }
  }
}
```

Do not manually add citation or confidence fields unless the user specifically needs them; Exa grounding already provides citation context.

## Default Payload Template

```json
{
  "query": "<clear research objective with evaluation criteria>",
  "type": "deep-reasoning",
  "systemPrompt": "Prefer primary sources, official docs, reputable reporting, and expert writeups. Focus on trade-offs, quality of evidence, practical recommendations, uncertainty, and conflicting evidence.",
  "additionalQueries": [],
  "numResults": 10,
  "outputSchema": { "type": "text" }
}
```

## Report Format After Running Deep Research

Return:

1. **Executive summary** — 3-6 bullets.
2. **Findings** — grouped by the user's criteria.
3. **Evidence and sources** — cite URLs inline or under each finding.
4. **Uncertainty / conflicts** — what the sources do not settle.
5. **Recommendation or next steps** — if the request implies a decision.

Keep the report concise unless the user asked for a long-form research memo.

## Response Patterns

### Planning Response

Use this structure when not executing yet:

- **Research objective:** what the research should answer.
- **Coverage plan:** human-readable criteria, source strategy, and discovery rounds.
- **Next step:** the cheapest useful move.
- **Why:** what uncertainty it reduces.
- **Implementation payload:** optional JSON only after the human-readable plan, or when the user asks for it.
- **Question:** one clear confirmation or refinement question.

### Execution Response

Use this structure when executing deep research:

- **Research objective:** one sentence.
- **Payload:** show the important parameters briefly when useful.
- Call `web_research_exa`.
- **Synthesis:** return the report format above.

## Examples

### Explicit deep-research request

User: `Do deep research on observability platforms for startups.`

Behavior:

- Do not ask whether to run deep research again.
- Ask one clarifying question only if needed, such as whether cost or ease of setup matters most.
- Otherwise run `web_research_exa` with a clear comparison query and `outputSchema: { "type": "text" }`.

### Plan-first request

User: `Help me design a deep research query to compare observability tools for startups.`

Behavior:

- Clarify key criteria if missing.
- Optionally run cheap discovery to identify vendors and terms.
- Draft a payload.
- Ask whether to execute, refine, or do one more cheap discovery pass.

## Quality Notes

- Prefer short, high-signal plans over generic checklists.
- Do not spend tools on discovery that will not change the final research prompt.
- Do not block explicit deep-research requests behind unnecessary confirmation.
- Be transparent when deep research cannot run because `web_research_exa` is unavailable.
- Favor primary sources and dated materials for fast-moving topics.
- Call out uncertainty instead of smoothing over source disagreement.

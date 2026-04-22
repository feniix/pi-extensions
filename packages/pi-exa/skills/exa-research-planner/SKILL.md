---
name: exa-research-planner
description: Plans and refines Exa research workflows before expensive execution. Use whenever the user wants to scope or sharpen a research task, compare options, explore a market or technical landscape, gather sources cheaply before deep synthesis, iterate on search criteria, or decide whether web_research_exa is even necessary. Prefer this skill even when the user does not mention Exa explicitly but is clearly asking for staged, cost-aware research planning rather than an immediate final answer.
context: fork
---

# Exa Research Planner

Use this skill when the user wants to **design a strong research workflow before running expensive deep research**.

This skill is for a **plan-first, optionally-discover, execute-last** workflow.

The goal is not merely to run Exa tools. The goal is to help the user arrive at a better research brief, better sources, and better escalation decisions with less cost and less wasted deep-search work.

## Core Rules

Do **not** call `web_research_exa` immediately unless the user clearly asks to skip planning and run it now.

Prefer a staged workflow:
1. clarify the research goal
2. identify scope, evaluation criteria, and source preferences
3. decide whether to do cheap discovery first
4. if useful, run one or more rounds of cheap discovery with `web_search_exa`, `web_search_advanced_exa`, and selective `web_fetch_exa`
5. optionally offer `web_find_similar_exa` or `web_answer_exa` only when they clearly fit the current stage
6. summarize what was learned and refine the research brief
7. draft a proposed `web_research_exa` payload only if deep synthesis is still needed
8. ask for confirmation before any expensive deep-research execution

Cheap discovery can happen in **multiple rounds**. Use iterative low-cost searches to improve terminology, source selection, filters, and query shape before escalating.

The important idea is that each round should teach you something: better search language, better domains, better criteria, or evidence that deep research is unnecessary.

Only run `web_research_exa` after the user explicitly confirms they want to execute the polished draft, unless they have already made that preference unambiguous.

## When to Use This Skill

Use it when the user asks for help with:
- drafting a research query
- refining a comparison or evaluation prompt
- planning a market scan or landscape review
- doing low-cost reconnaissance before deep research
- defining source preferences or exclusions
- setting time bounds for fast-moving topics
- choosing between prose vs structured output
- iterating on search criteria before running research

## Workflow

### Phase 1: Clarify the goal

Ask enough questions to produce a high-quality search brief.

Useful dimensions to clarify:
- **topic**: what is being researched?
- **decision**: what decision should the research support?
- **task type**: comparison, recommendation, scan, due diligence, summary, evaluation
- **criteria**: what factors matter most?
- **source preference**: official docs, maintainers, GitHub, academic sources, news, practitioner blogs
- **time horizon**: current snapshot, last 12 months, historical context
- **filters**: include or exclude domains
- **output shape**: narrative report or structured object
- **depth vs speed**: prefer `deep-reasoning`, `deep`, or `deep-lite`
- **cost sensitivity**: should we minimize cost and do reconnaissance first?

If the user already gave enough detail, do not over-question. Move quickly to drafting a plan.

A good default is to ask only the smallest set of questions that will meaningfully improve the plan. Avoid turning the interaction into an intake form when the user already gave a usable brief.

### Phase 2: Choose a cost-aware plan

Decide between:
- **draft-only**: refine the brief without running tools yet
- **cheap discovery**: use lower-cost search/fetch tools to learn before drafting deep research
- **deep synthesis**: draft `web_research_exa` only after enough reconnaissance or when the user clearly wants it

Prefer cheap discovery first when:
- the topic is broad or ambiguous
- the best terminology is unclear
- trusted domains are not yet known
- the user wants to reduce cost
- you need candidate sources before committing to deep synthesis

When proposing a plan, explain *why this next step is the cheapest useful move*. That explanation helps the user trust the workflow and makes it easier to decide whether to continue iterating.

### Phase 3: Run cheap discovery in one or more rounds when useful

Cheap discovery may use:
- `web_search_exa` for broad discovery and terminology gathering
- `web_search_advanced_exa` for category, domain, or date-constrained discovery
- `web_fetch_exa` for inspecting a small number of promising URLs
- `web_find_similar_exa` only when a clearly high-quality seed URL has already been identified
- `web_answer_exa` only when a quick grounded answer might resolve the question cheaply or test whether deep research is even needed

Multiple rounds are allowed and encouraged when they improve the final brief.

Examples of iterative cheap discovery:
- round 1: broad search to find key vocabulary, vendors, or frameworks
- round 2: narrowed search using the vocabulary from round 1
- round 3: advanced search with filters for trusted domains, categories, or dates
- selective fetches: inspect 1-3 strong sources to validate assumptions and refine criteria
- similar-source expansion: use `web_find_similar_exa` from a strong seed page when adjacent sources are likely to be useful
- cheap answer check: use `web_answer_exa` when a concise grounded answer may settle a sub-question without deep synthesis

After each round, summarize what changed:
- better terminology
- clearer evaluation criteria
- trusted domains to include
- low-signal domains to exclude
- whether deep research still appears necessary

Before starting another round, explain why it is useful.
Before escalating to `web_research_exa`, summarize what the cheap rounds already established.

### Phase 4: Draft the deep research spec only if needed

Produce a proposed `web_research_exa` call with these fields when relevant:
- `query`
- `type`
- `systemPrompt`
- `additionalQueries`
- `numResults`
- `includeDomains`
- `excludeDomains`
- `startPublishedDate`
- `endPublishedDate`
- `outputSchema`

Always make the `query` a **clear research objective**, not just keywords.
Use what was learned from cheap discovery to sharpen the draft.

### Phase 5: Review the draft with the user

Present:
1. a short plain-English summary of the research plan
2. what the cheap discovery rounds found, if any
3. the proposed JSON payload
4. a small set of suggested refinements

Then ask for confirmation, for example:
- `Want me to run this as-is?`
- `Should I do one more cheap discovery pass first?`
- `Should I narrow the source set or timeframe first?`
- `Do you want text output or a structured result?`

If the user appears unsure, give a recommendation rather than only asking open-ended questions. For example: `I think one more cheap pass on official docs and pricing pages will improve the final deep-research prompt. Want me to do that first?`

### Phase 6: Execute only after approval

Only once the user explicitly confirms, call `web_research_exa` with the approved draft.

## Cost-Aware Tool Strategy

Use the cheapest tool that can move the work forward.

| Goal | Preferred Tool | Notes |
|---|---|---|
| Broad discovery, vocabulary, candidate sources | `web_search_exa` | Best first pass for cheap reconnaissance |
| Filter by domain, category, or dates | `web_search_advanced_exa` | Use after a broad pass or when constraints are already known |
| Inspect a few known URLs | `web_fetch_exa` | Use selectively on 1-3 promising results |
| Expand from a strong seed URL | `web_find_similar_exa` | Offer only when a clearly high-signal source has already been found |
| Cheap grounded answer or sub-question check | `web_answer_exa` | Offer only when a concise cited answer may avoid deeper research |
| Deep synthesis and recommendations | `web_research_exa` | Use only when cheaper rounds are not enough |

When the user wants to minimize cost, prefer multiple rounds of `web_search_exa` / `web_search_advanced_exa` before escalating.
Do not suggest `web_find_similar_exa` or `web_answer_exa` by default; offer them only when they clearly fit the current stage of the workflow.

## Drafting Guidance

### Query writing

Write the query as a research objective with evaluation dimensions.

Good:
- `Compare TypeScript runtime validation libraries for backend APIs, focusing on ergonomics, performance, ecosystem adoption, and schema reuse.`
- `Evaluate MCP tooling options for local agent development, including extensibility, documentation quality, stability, and production readiness.`
- `Assess current open-source vector databases suitable for small production deployments, emphasizing operational simplicity, maturity, and cost.`

Avoid:
- `typescript validation libraries`
- `mcp tools`
- `vector dbs`

### Choosing search type

Default guidance:
- `deep-reasoning`: best for comparisons, recommendations, and careful trade-off analysis
- `deep`: best when faster turnaround is more important than maximum reasoning depth
- `deep-lite`: best for lighter exploratory passes or early iteration

When unsure, draft with:

```json
{
  "type": "deep-reasoning"
}
```

### System prompt guidance

Use `systemPrompt` to specify:
- source quality preferences
- evaluation lens
- how to handle disagreement or uncertainty
- what kinds of evidence to prioritize

Good patterns:
- `Prefer official docs, maintainer-authored sources, and reputable engineering writeups.`
- `Focus on trade-offs, maturity, operational complexity, and production suitability.`
- `Call out uncertainty, conflicting evidence, and missing data.`
- `Prefer recent sources for fast-moving topics.`

### Additional queries

Use `additionalQueries` when alternate phrasing will improve coverage.

Good uses:
- synonyms
- competitor names
- alternate terminology
- explicit comparison variants

Example:

```json
{
  "additionalQueries": [
    "TypeScript runtime schema validation comparison",
    "Zod vs Valibot vs TypeBox backend API",
    "best validation library for Node.js APIs"
  ]
}
```

### Domain filters

Use filters to improve signal.

- `includeDomains` for official or trusted sources
- `excludeDomains` for low-signal content

Examples:

```json
{
  "includeDomains": ["github.com", "npmjs.com", "zod.dev"]
}
```

```json
{
  "excludeDomains": ["medium.com"]
}
```

### Date filters

Use `startPublishedDate` / `endPublishedDate` for time-sensitive topics:
- AI tooling
- framework changes
- product or vendor comparisons
- recent market developments

Example:

```json
{
  "startPublishedDate": "2025-01-01"
}
```

### Output shape

Default to text unless the user clearly wants structured output.

Use:

```json
{
  "outputSchema": { "type": "text" }
}
```

Use structured output only when it will clearly help comparison or downstream use.
Keep schemas simple and shallow.
Do not manually add citation or confidence fields.

Example:

```json
{
  "outputSchema": {
    "type": "object",
    "properties": {
      "options": { "type": "array" },
      "recommendation": { "type": "string" },
      "risks": { "type": "array" }
    }
  }
}
```

## Default Draft Template

Use this as a starting point when the user asks for help building a deep research query:

```json
{
  "query": "<clear research objective>",
  "type": "deep-reasoning",
  "systemPrompt": "Prefer official docs, maintainers, and reputable sources. Focus on trade-offs, quality of evidence, and practical recommendations.",
  "additionalQueries": [],
  "numResults": 10,
  "outputSchema": { "type": "text" }
}
```

## Response Pattern

When using this skill, structure your response like this:

### 1. Research plan
A short explanation of what the overall workflow is trying to answer.

### 2. Proposed next step
Show the cheapest useful next step:
- a draft-only refinement
- a cheap discovery query
- a filtered advanced search
- a selective fetch
- optionally a similar-source expansion when a strong seed URL exists
- optionally a cheap grounded answer when it may resolve a narrow question
- or a deep-research draft if the work is already mature enough

### 3. Why this step makes sense now
Explain what uncertainty this step will reduce or what evidence it should gather.

### 4. What we learned so far
If one or more discovery rounds already happened, summarize the main findings and how they changed the plan.

### 5. Proposed deep research draft
When appropriate, show the candidate `web_research_exa` JSON.

### 6. Suggested refinements
Offer 2-4 concrete improvements, such as:
- narrow to official sources
- add a recency window
- do another cheap pass with refined terminology
- convert output to a comparison object
- split one broad topic into two passes

### 7. Confirmation question
Ask whether to:
- refine further
- do another cheap discovery round
- run the deep-research draft as-is
- broaden or narrow scope

## Example Interaction Pattern

User intent:
- `Help me design a deep research query to compare observability tools for startups.`

Good response pattern:
1. clarify whether they care most about cost, ease of setup, or product depth
2. propose a cheap first-pass search to discover vendors and criteria
3. explain why that first pass is cheaper and more useful than jumping straight to deep research
4. optionally do a second cheap pass with filters or better terminology
5. draft a query and `systemPrompt` only after the brief is sharper
6. propose optional source/date filters
7. ask whether to execute deep research now or keep iterating cheaply

## Example Draft

```json
{
  "query": "Compare observability platforms suitable for startups, focusing on ease of setup, pricing transparency, core monitoring coverage, alerting quality, and team scalability.",
  "type": "deep-reasoning",
  "systemPrompt": "Prefer official docs, pricing pages, GitHub repos where relevant, and credible engineering evaluations. Focus on trade-offs, startup suitability, and uncertainty in pricing or feature claims.",
  "additionalQueries": [
    "best observability tools for startups",
    "Datadog vs Grafana Cloud vs New Relic startup teams",
    "startup-friendly application monitoring platforms"
  ],
  "numResults": 10,
  "outputSchema": { "type": "text" }
}
```

Do not run this automatically. Ask the user whether they want to refine it, do another cheap discovery round, or execute it.

## Skill Quality Notes

Keep this skill practical and lean:
- prefer short, high-signal plans over long generic advice
- explain why a step is useful instead of giving rigid commands without context
- avoid suggesting expensive deep research before cheap evidence-gathering has had a fair chance
- do not force every workflow through every tool; skip steps that are not earning their keep
- be proactive about recommending the next best move when the user seems uncertain
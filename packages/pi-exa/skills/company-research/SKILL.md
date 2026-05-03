---
name: company-research
description: Company research using Exa search. Finds company context, competitors, and market signals.
context: fork
---

# Company Research (Exa)

Use this skill for company discovery, competitor scans, vendor profiles, funding or hiring signals, market maps, and quick diligence.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Broad company or competitor discovery | `web_search_exa` | Best first pass when terminology, category fit, or target companies are unclear. |
| Company-profile style results | `web_search_advanced_exa` with `category: "company"` | Use when available; do not use deep search types here. |
| Comparative write-up across companies | `web_research_exa` | Use when enabled and the user needs synthesis or recommendations. |
| Direct factual question about one company | `web_answer_exa` | Good for concise cited answers. |
| Read selected company pages, filings, or posts | `web_fetch_exa` | Fetch 1-3 high-signal URLs after discovery. |
| Find companies or pages similar to one strong source | `web_find_similar_exa` | Use when a seed URL is clearly representative. |

If `web_search_advanced_exa` is unavailable, use `web_search_exa` with stronger query wording. If `web_research_exa` is unavailable, stop at discovery plus a concise manual synthesis.

## Category Behavior

- `category: "company"` focuses on company-facing pages and profile-like structure.
- Deep search types (`deep-reasoning`, `deep-lite`, `deep`) belong to `web_research_exa`, not `web_search_advanced_exa`.

## Filter Restrictions

When using `web_search_advanced_exa` with `category: "company"`, avoid:

- `excludeDomains`
- `startPublishedDate` / `endPublishedDate`

These combinations are rejected by the extension before reaching Exa. If you need freshness or exclusions, run broader discovery first and filter locally.

## Recommended Settings

- Broad discovery
  - `{ "query": "AI infrastructure startups serving enterprise developers 2025", "numResults": 10 }`
- Company category search
  - `{ "query": "AI infrastructure developer tools startups", "category": "company", "type": "auto", "numResults": 12 }`
- Comparative synthesis
  - `{ "query": "Compare AI infrastructure startups serving enterprise developer teams, focusing on product positioning, traction signals, and differentiation.", "systemPrompt": "Prefer official sources, filings, funding announcements, customer pages, and reputable news. Avoid overclaiming from sparse data.", "outputSchema": { "type": "text" } }`

## Output Guidance

1. Return a structured findings list first: company, what they do, signals, and links.
2. Distinguish direct evidence from interpretation.
3. Call out stale, sparse, or conflicting data.
4. Avoid implying private traction or revenue unless sourced.

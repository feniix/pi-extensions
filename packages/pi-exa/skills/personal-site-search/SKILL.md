---
name: personal-site-search
description: Search personal websites and blogs using Exa. Finds practitioner perspectives and independent analysis.
context: fork
---

# Personal Site Search (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Practitioner blogs / opinion pieces | `web_search_advanced_exa` with `category: "personal site"` | Add date filters for freshness |
| Distill cross-site viewpoints | `web_research_exa` | Provide a strong `systemPrompt` and optional object `outputSchema` |
| Direct one-off answer | `web_answer_exa` | Keep answer concise |
| Pull article bodies | `web_fetch_exa` | Use after discovering canonical URLs |

## Recommended settings

- `web_search_advanced_exa`
  - `{ "query": "Rust async architecture", "category": "personal site", "excludeDomains": ["medium.com", "substack.com"], "numResults": 15 }`
- `web_research_exa`
  - `{ "query": "Compare recommendations from practitioner blogs", "systemPrompt": "Prioritize dated posts and call out opinion vs facts", "outputSchema": { "type": "text" } }`

## Output Guidance

1) Identify author perspective and date.
2) Distinguish opinion claims from verifiable facts.
3) Return top 3–5 strongest links with rationale.

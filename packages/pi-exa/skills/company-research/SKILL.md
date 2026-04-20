---
name: company-research
description: Company research using Exa search. Finds company context, competitors, and market signals.
context: fork
---

# Company Research (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Company discovery / competitive list | `web_search_exa` | Use category filters when needed |
| Company page metadata or focused category search | `web_search_advanced_exa` | `category: "company"`, use domain filters |
| Comparative write-up across multiple companies | `web_research_exa` | Requires `systemPrompt`, `additionalQueries`, optionally `outputSchema.type: "object"` |
| Direct question about a company topic | `web_answer_exa` | Prefer `outputSchema` for downstream processing |
| Follow-up deep reading | `web_fetch_exa` | Pulls content from selected URLs |

## Category Behavior

- `category: "company"` focuses on company-facing pages and profile-like structure.
- Deep search (`deep`, `deep-lite`) belongs to **`web_research_exa`**, not `web_search_advanced_exa`.

## Filter Restrictions

When using `web_search_advanced_exa` with `category: "company"`, avoid:
- `includeDomains`
- `startPublishedDate` / `endPublishedDate`

These filters commonly trigger Exa `400` errors for this category. Prefer running a broader query first, then post-filtering results locally if needed.

## Recommended settings

```json
{
  "web_search_exa": { "query": "AI infrastructure startups in 2025", "numResults": 20 },
  "web_search_advanced_exa": {
    "category": "company",
    "type": "auto",
    "numResults": 12
  },
  "web_research_exa": {
    "systemPrompt": "Prefer official sources and filings; return concise competitive summary.",
    "outputSchema": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" }
      }
    }
  }
}
```

## Output Guidance

1) Return structured findings list first (name, signals, links).
2) Note assumptions or data gaps.
3) Avoid overclaiming on incomplete information.

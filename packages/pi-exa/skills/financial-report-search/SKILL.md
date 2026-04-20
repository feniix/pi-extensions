---
name: financial-report-search
description: Search financial reports using Exa. Finds SEC filings, earnings materials, and filings by company.
context: fork
---

# Financial Report Search (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Discovery of filings / reports | `web_search_advanced_exa` with `category: "financial report"` | Use date filters and domain filters |
| Compare filings across firms | `web_research_exa` | Use `systemPrompt` and `outputSchema` for structured output |
| Explain one metric or line item | `web_answer_exa` | Fast direct answers with citations |
| Read full filing text | `web_fetch_exa` | Fetch 1-3 URLs only |

## Recommended settings

- `web_search_advanced_exa`
  - `{ "query": "10-K AI company", "category": "financial report", "startPublishedDate": "2025-01-01", "numResults": 20 }`
- `web_search_advanced_exa` for SEC-only domain filtering
  - `{ "includeDomains": ["sec.report", "sec.gov"], "category": "financial report" }`
- `web_research_exa`
  - `{ "query": "Compare risk factors and revenue trend in latest reports", "systemPrompt": "Return only evidence-backed statements", "outputSchema": { "type": "object", "properties": { "risks": { "type": "array" } } } }`

## Output Guidance

1) Separate numbers from interpretations.
2) Include source links for every numeric claim.
3) Call out filing periods clearly.

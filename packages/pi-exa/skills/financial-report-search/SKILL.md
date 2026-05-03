---
name: financial-report-search
description: Search financial reports using Exa. Finds SEC filings, earnings materials, and filings by company.
context: fork
---

# Financial Report Search (Exa)

Use this skill for SEC filings, annual reports, earnings materials, investor presentations, risk factors, financial metrics, and company-by-company filing comparisons.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Discover filings, annual reports, or investor materials | `web_search_advanced_exa` with `category: "financial report"` | Use when available; date and domain filters are useful here. |
| Broad filing discovery when advanced search is unavailable | `web_search_exa` | Add company name, filing type, fiscal year, and source domain terms. |
| Compare filings across firms or periods | `web_research_exa` | Use when enabled; require evidence-backed statements. |
| Explain one metric, line item, or disclosure | `web_answer_exa` | Good for narrow cited explanations. |
| Read full filing or report text | `web_fetch_exa` | Fetch 1-3 selected URLs only. |

If `web_search_advanced_exa` is unavailable, fall back to `web_search_exa` with explicit terms like `10-K`, `10-Q`, `annual report`, `investor relations`, `site:sec.gov`, or the company ticker.

## Recommended Settings

- Filing discovery
  - `{ "query": "NVIDIA 10-K 2025 risk factors", "category": "financial report", "startPublishedDate": "2025-01-01", "numResults": 10 }`
- SEC-focused discovery
  - `{ "query": "NVIDIA latest 10-K", "category": "financial report", "includeDomains": ["sec.gov", "sec.report"], "numResults": 10 }`
- Comparative synthesis
  - `{ "query": "Compare risk factors and revenue trend disclosures in the latest annual reports for NVIDIA, AMD, and Intel.", "systemPrompt": "Return only evidence-backed statements. Separate reported numbers from interpretation and cite source URLs for every numeric claim.", "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" }, "risks": { "type": "array", "items": { "type": "string" } } } } }`

## Output Guidance

1. Separate reported numbers from interpretations.
2. Include source links for every numeric claim.
3. Call out filing type, period, and publication date.
4. Flag stale filings, amended filings, and source ambiguity.

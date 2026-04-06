---
name: financial-report-search-exa
description: Search for financial reports using Exa advanced search. Near-full filter support for finding SEC filings, earnings reports, and financial documents. Use when searching for 10-K filings, quarterly earnings, or annual reports.
context: fork
---

# Financial Report Search (Exa)

## Tool Restriction (Critical)

ONLY use `web_search_exa` for basic searches or `web_search_advanced_exa` with `category: "financial report"` if enabled. Do NOT use `web_fetch_exa` unless following up on specific URLs.

## Token Isolation (Critical)

Never run Exa searches in main context. Always spawn Task agents:
- Agent calls `web_search_exa` or `web_search_advanced_exa`
- Agent merges + deduplicates results before presenting
- Agent returns distilled output (brief markdown or compact JSON)
- Main context stays clean regardless of search volume

## When to Use

Use this category when you need:
- SEC filings (10-K, 10-Q, 8-K, S-1)
- Quarterly earnings reports
- Annual reports
- Investor presentations
- Financial statements

## Filter Restrictions

The `financial report` category has one known restriction:

- `excludeText` - NOT SUPPORTED (causes 400 error)

## Examples

### SEC filings for a company
```
web_search_exa {
  "query": "Anthropic SEC filing S-1",
  "numResults": 10
}
```

### Recent earnings reports
```
web_search_advanced_exa {
  "query": "Q4 2025 earnings report technology",
  "category": "financial report",
  "startPublishedDate": "2025-10-01",
  "numResults": 20
}
```

### Specific filing type
```
web_search_advanced_exa {
  "query": "10-K annual report AI companies",
  "category": "financial report",
  "includeDomains": ["sec.gov"],
  "startPublishedDate": "2025-01-01",
  "numResults": 15
}
```

### Risk factors analysis
```
web_search_advanced_exa {
  "query": "risk factors cybersecurity",
  "category": "financial report",
  "numResults": 10
}
```

## Output Format

Return:
1) Results (company name, filing type, date, key figures/highlights)
2) Sources (Filing URLs)
3) Notes (reporting period, any restatements, auditor notes)

---
name: financial-report-search
description: Search for financial reports using Exa advanced search. Near-full filter support for finding SEC filings, earnings reports, and financial documents. Use when searching for 10-K filings, quarterly earnings, or annual reports.
context: fork
---

# Financial Report Search (Exa)

## Tool Selection

Use the right tool based on the research depth:

| Intent | Tool | Notes |
|--------|------|-------|
| Find filings for a company | `web_search_advanced_exa` with `category: "financial report"` | SEC filings, earnings, annual reports |
| Financial analysis or comparison | `web_research_exa` | ~20s, use with `--exa-enable-research` |
| Quick answer about a metric | `web_answer_exa` | Revenue, market cap, etc. |
| Read a specific filing | `web_fetch_exa` | After finding a URL |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Find SEC filings** (`web_search_advanced_exa`):
  ```json
  { "query": "Anthropic S-1 filing", "category": "financial report", "includeDomains": ["sec.gov"], "numResults": 10 }
  ```
- **Recent earnings reports**:
  ```json
  { "query": "Q4 2025 earnings report technology", "category": "financial report", "startPublishedDate": "2025-10-01", "numResults": 20 }
  ```
- **Specific filing type**:
  ```json
  { "query": "10-K annual report AI companies", "category": "financial report", "includeDomains": ["sec.gov"], "startPublishedDate": "2025-01-01", "numResults": 15 }
  ```
- **Deep financial analysis** (`web_research_exa`):
  ```json
  { "query": "Financial health comparison of Anthropic vs OpenAI vs xAI based on public filings", "type": "deep-reasoning" }
  ```

## Query Writing Patterns

- Include company names and filing types (10-K, 10-Q, 8-K, S-1)
- Use fiscal periods and years for precision
- Add "annual report" or "earnings call transcript" for broader results

## Filter Restrictions

When using `category: "financial report"`:
- `excludeText` — NOT SUPPORTED (causes 400 error)
- Domain and date filters work normally

## Output Format

Return:
1. Results (company name, filing type, date, key figures/highlights)
2. Sources (Filing URLs)
3. Notes (reporting period, any restatements, auditor notes)

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

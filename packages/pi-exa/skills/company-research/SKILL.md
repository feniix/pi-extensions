---
name: company-research
description: Company research using Exa search. Finds company info, competitors, news, financials, LinkedIn profiles, builds company lists. Use when researching companies, doing competitor analysis, market research, or building company lists.
context: fork
---

# Company Research (Exa)

## Tool Selection

Use the right tool based on the research depth needed:

| Intent | Tool | Notes |
|--------|------|-------|
| Quick facts, founding info, one-liners | `web_answer_exa` | Fast, direct answer |
| Discovery — find companies in a space | `web_search_advanced_exa` with `category: "company"` | Rich metadata (headcount, funding, location) |
| Deep competitive analysis or market mapping | `web_research_exa` | ~20s, use with `--exa-enable-research` |
| Recent news or press coverage | `web_search_advanced_exa` with `category: "news"` | Date filters work well |
| Follow up a URL for full details | `web_fetch_exa` | After finding a company's site |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Quick facts** (`web_answer_exa`):
  ```json
  { "query": "When was Anthropic founded, who are the founders, and how much funding have they raised?" }
  ```
- **Company discovery** (`web_search_advanced_exa`):
  ```json
  { "query": "AI infrastructure startups San Francisco", "category": "company", "numResults": 20 }
  ```
- **Deep analysis** (`web_research_exa`):
  ```json
  { "query": "Competitive analysis of cloud GPU providers: CoreWeave vs Lambda Labs vs RunPod", "type": "deep-reasoning" }
  ```

## Query Writing Patterns

Exa returns different results for different phrasings. For coverage:
- Generate 2-3 query variations
- Run in parallel if using Task agents
- Merge and deduplicate

## Category Filter Restrictions

When using `category: "company"`, these parameters cause 400 errors:
- `includeDomains` / `excludeDomains`
- `startPublishedDate` / `endPublishedDate`
- `startCrawlDate` / `endCrawlDate`

When searching with `category: "news"` or without a category, domain and date filters work fine.

## Output Format

Return:
1. Results (structured list; one company per row)
2. Sources (URLs; 1-line relevance each)
3. Notes (uncertainty/conflicts)

## Examples

### Discovery: find companies in a space
```
web_search_advanced_exa {
  "query": "AI infrastructure startups San Francisco",
  "category": "company",
  "numResults": 20
}
```

### Quick facts
```
web_answer_exa {
  "query": "What does Perplexity AI do, who are their main competitors, and how much revenue do they generate?"
}
```

### News coverage
```
web_search_advanced_exa {
  "query": "Anthropic AI safety",
  "category": "news",
  "numResults": 15,
  "startPublishedDate": "2024-01-01"
}
```

### Deep competitive analysis
```
web_research_exa {
  "query": "Compare the business models, pricing, and market position of Snowflake vs Databricks vs BigQuery",
  "type": "deep-reasoning"
}
```

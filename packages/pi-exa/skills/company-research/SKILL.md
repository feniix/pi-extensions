---
name: company-research
description: Company research using Exa search. Finds company info, competitors, news, financials, LinkedIn profiles, builds company lists. Use when researching companies, doing competitor analysis, market research, or building company lists.
context: fork
---

# Company Research (Exa)

## Tool Restriction (Critical)

ONLY use `web_search_exa` for basic searches or `web_search_advanced_exa` if enabled with category filters. Do NOT use `web_fetch_exa` unless following up on specific URLs.

## Token Isolation (Critical)

Never run Exa searches in main context. Always spawn Task agents:
- Agent runs Exa search internally
- Agent processes results using LLM intelligence
- Agent returns only distilled output (compact JSON or brief markdown)
- Main context stays clean regardless of search volume

## Dynamic Tuning

No hardcoded numResults. Tune to user intent:
- User says "a few" → 10-20
- User says "comprehensive" → 50-100
- User specifies number → match it
- Ambiguous? Ask: "How many companies would you like?"

## Query Variation

Exa returns different results for different phrasings. For coverage:
- Generate 2-3 query variations
- Run in parallel if using Task agents
- Merge and deduplicate

## Categories (with web_search_advanced_exa)

Use appropriate `category` depending on what you need:
- `company` → homepages, rich metadata (headcount, location, funding, revenue)
- `news` → press coverage, announcements
- `people` → LinkedIn profiles (public data)
- No category (`type: "auto"`) → general web results, deep dives, broader context

Start with `category: "company"` for discovery, then use other categories or no category for deeper research.

### Category-Specific Filter Restrictions

When using `category: "company"`, these parameters cause 400 errors:
- `includeDomains` / `excludeDomains`
- `startPublishedDate` / `endPublishedDate`
- `startCrawlDate` / `endCrawlDate`

When searching without a category (or with `news`), domain and date filters work fine.

## Browser Fallback

Auto-fallback to Claude in Chrome when:
- Exa returns insufficient results
- Content is auth-gated
- Dynamic pages need JavaScript

## Examples

### Discovery: find companies in a space
```
web_search_exa {
  "query": "AI infrastructure startups San Francisco",
  "numResults": 20
}
```

### With advanced search (if enabled)
```
web_search_advanced_exa {
  "query": "AI infrastructure startups San Francisco",
  "category": "company",
  "numResults": 20
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

## Output Format

Return:
1) Results (structured list; one company per row)
2) Sources (URLs; 1-line relevance each)
3) Notes (uncertainty/conflicts)

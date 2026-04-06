---
name: personal-site-search
description: Search personal websites and blogs using Exa advanced search. Full filter support for finding individual perspectives, portfolios, and personal blogs. Use when searching for personal sites, blog posts, or portfolio websites.
context: fork
---

# Personal Site Search (Exa)

## Tool Restriction (Critical)

ONLY use `web_search_exa` for basic searches or `web_search_advanced_exa` with `category: "personal site"` if enabled. Do NOT use `web_fetch_exa` unless following up on specific URLs.

## Token Isolation (Critical)

Never run Exa searches in main context. Always spawn Task agents:
- Agent calls `web_search_exa` or `web_search_advanced_exa`
- Agent merges + deduplicates results before presenting
- Agent returns distilled output (brief markdown or compact JSON)
- Main context stays clean regardless of search volume

## When to Use

Use this category when you need:
- Individual expert opinions and experiences
- Personal blog posts on technical topics
- Portfolio websites
- Independent analysis (not corporate content)
- Deep dives and tutorials from practitioners

## Examples

### Technical blog posts
```
web_search_exa {
  "query": "building production LLM applications lessons learned",
  "numResults": 15
}
```

### Recent posts on a topic
```
web_search_exa {
  "query": "Rust async runtime comparison 2024",
  "numResults": 10
}
```

### Exclude aggregators
```
web_search_advanced_exa {
  "query": "startup founder lessons",
  "category": "personal site",
  "excludeDomains": ["medium.com", "substack.com"],
  "numResults": 15
}
```

### With date filter
```
web_search_advanced_exa {
  "query": "TypeScript best practices",
  "category": "personal site",
  "startPublishedDate": "2025-01-01",
  "numResults": 10
}
```

## Output Format

Return:
1) Results (title, author/site name, date, key insights)
2) Sources (URLs)
3) Notes (author expertise, potential biases, depth of coverage)

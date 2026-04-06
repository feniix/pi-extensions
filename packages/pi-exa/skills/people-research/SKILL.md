---
name: people-research
description: People research using Exa search. Finds LinkedIn profiles, professional backgrounds, experts, team members, and public bios across the web. Use when searching for people, finding experts, or looking up professional profiles.
context: fork
---

# People Research (Exa)

## Tool Restriction (Critical)

ONLY use `web_search_exa` for basic searches or `web_search_advanced_exa` with `category: "people"` if enabled. Do NOT use `web_fetch_exa` unless following up on specific URLs.

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
- Ambiguous? Ask: "How many profiles would you like?"

## Query Variation

Exa returns different results for different phrasings. For coverage:
- Generate 2-3 query variations
- Run in parallel if using Task agents
- Merge and deduplicate

## Categories (with web_search_advanced_exa)

Use appropriate `category` depending on what you need:
- `people` → LinkedIn profiles, public bios (primary for discovery)
- `news` → press mentions, interviews, speaker bios
- `personal site` → personal blogs, portfolio sites
- No category (`type: "auto"`) → general web results, broader context

Start with `category: "people"` for profile discovery, then use other categories or no category for deeper research.

### Category-Specific Filter Restrictions

When using `category: "people"`, these parameters cause errors:
- `startPublishedDate` / `endPublishedDate`
- `includeText` / `excludeText`
- `excludeDomains`
- `includeDomains` — **LinkedIn domains only** (e.g., "linkedin.com")

## Browser Fallback

Auto-fallback to Claude in Chrome when:
- Exa returns insufficient results
- Content is auth-gated
- Dynamic pages need JavaScript

## Examples

### Discovery: find people by role
```
web_search_exa {
  "query": "VP Engineering AI infrastructure San Francisco",
  "numResults": 20
}
```

### With advanced search (if enabled)
```
web_search_advanced_exa {
  "query": "machine learning engineer San Francisco",
  "category": "people",
  "numResults": 25
}
```

### Deep dive: research a specific person
```
web_search_exa {
  "query": "Dario Amodei Anthropic CEO background",
  "numResults": 15
}
```

### News mentions
```
web_search_advanced_exa {
  "query": "Dario Amodei interview",
  "category": "news",
  "numResults": 10,
  "startPublishedDate": "2024-01-01"
}
```

## Output Format

Return:
1) Results (name, title, company, location if available)
2) Sources (Profile URLs)
3) Notes (profile completeness, verification status)

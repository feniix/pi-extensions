---
name: people-research
description: People research using Exa search. Finds experts, professional profiles, and public bios.
context: fork
---

# People Research (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Professional profile discovery | `web_search_advanced_exa` with `category: "people"` | Use `query` for role/location/industry |
| Compare multiple candidates | `web_research_exa` | Use `additionalQueries` + `systemPrompt` |
| Direct answer about one person | `web_answer_exa` | Good for short factual checks |
| Read profile details | `web_fetch_exa` | Fetch selected profile URLs |

## Filter Restrictions

When using `web_search_advanced_exa` with `category: "people"`, avoid:
- `excludeText`
- `excludeDomains`
- `startPublishedDate` / `endPublishedDate`

These filters are rejected for this category by Exa and typically return `400`.

## Recommended settings

- People discovery
  - `web_search_advanced_exa` with `category: "people"`, `numResults: 20`
- Deep compare
  - `web_research_exa` with `outputSchema`: `{ "type": "object", "properties": { "experts": { "type": "array" } } }`

## Output Guidance

1) Return one row per person with source URL.
2) Include role, company, and recency signals.
3) Flag potential uncertainty (common-name collisions, sparse profiles).

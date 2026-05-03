---
name: people-research
description: People research using Exa search. Finds experts, professional profiles, and public bios.
context: fork
---

# People Research (Exa)

Use this skill for finding experts, candidates, speakers, authors, investors, founders, maintainers, or other public professional profiles.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Professional profile discovery | `web_search_advanced_exa` with `category: "people"` | Use when available; put role, domain, company, or location in `query`. |
| Broad discovery when advanced search is unavailable | `web_search_exa` | Use precise role/company/topic terms and public-profile keywords. |
| Compare multiple people or build a shortlist | `web_research_exa` | Use when enabled; include selection criteria in `systemPrompt`. |
| Direct factual question about one person | `web_answer_exa` | Good for short cited checks. |
| Read selected profile pages or bios | `web_fetch_exa` | Fetch only high-signal URLs. |
| Find similar profiles from a strong seed page | `web_find_similar_exa` | Use when one public profile is an ideal example. |

If `web_search_advanced_exa` is unavailable, fall back to `web_search_exa`. If `web_research_exa` is unavailable, provide a sourced shortlist without deep synthesis.

## Filter Restrictions

When using `web_search_advanced_exa` with `category: "people"`, avoid:

- `excludeDomains`
- `startPublishedDate` / `endPublishedDate`

For `includeDomains`, only LinkedIn domains are accepted by the extension for `category: "people"`, such as `linkedin.com` or `www.linkedin.com`.

## Recommended Settings

- People discovery
  - `{ "query": "distributed systems database engineer San Francisco", "category": "people", "numResults": 10 }`
- LinkedIn-scoped people discovery
  - `{ "query": "AI infrastructure startup founder", "category": "people", "includeDomains": ["linkedin.com"], "numResults": 10 }`
- Deep shortlist comparison
  - `{ "query": "Find public experts in database internals and distributed systems who write about production engineering trade-offs.", "systemPrompt": "Prefer public bios, personal sites, talks, publications, and reputable profiles. Flag common-name ambiguity and sparse evidence.", "outputSchema": { "type": "object", "properties": { "experts": { "type": "array", "items": { "type": "object" } }, "caveats": { "type": "array", "items": { "type": "string" } } } } }`

## Output Guidance

1. Return one row per person with source URL.
2. Include role, company/affiliation, expertise signal, and recency signal.
3. Flag uncertainty: common-name collisions, outdated profiles, or sparse evidence.
4. Avoid private, sensitive, or unsourced personal claims.

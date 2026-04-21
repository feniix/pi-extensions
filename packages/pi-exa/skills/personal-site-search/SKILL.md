---
name: personal-site-search
description: Search personal websites and blogs using Exa. Finds practitioner perspectives and independent analysis.
context: fork
---

# Personal Site Search (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Find practitioner blogs by topic | `web_search_exa` | Start broad with a keyword query when you do not already know a source site |
| Filter to personal sites only | `web_search_advanced_exa` with `category: "personal site"` | Add date filters for freshness or domain filters for specific ecosystems |
| Find more like this / recommend similar sites | `web_find_similar_exa` | Use when you already have one strong post or blog URL and want adjacent personal sites |
| Distill viewpoints across multiple posts | `web_research_exa` | Requires `--exa-enable-research`; provide a strong `systemPrompt` and optional `outputSchema` |
| Direct one-off answer from discovered sources | `web_answer_exa` | Use for concise cited answers after the topic is clear |
| Pull full article bodies | `web_fetch_exa` | Use after discovery when snippets are not enough |

## When to use find-similar vs search

- Use `web_find_similar_exa` for **find more like this** workflows when you already have a canonical URL that matches the taste, style, or niche you want.
- Use `web_search_exa` for **keyword-based discovery** when you are starting from a topic, technology, or opinion and do not yet have a seed URL.
- Use `web_search_advanced_exa` instead of `web_find_similar_exa` when you need explicit controls like `category: "personal site"`, domain constraints, or date filtering.

## Recommended settings

- `web_search_exa`
  - `{ "query": "Rust async architecture practitioner blog", "numResults": 10 }`
- `web_search_advanced_exa`
  - `{ "query": "Rust async architecture", "category": "personal site", "excludeDomains": ["medium.com", "substack.com"], "numResults": 15 }`
- `web_find_similar_exa`
  - `{ "url": "https://example.dev/posts/rust-async-architecture", "excludeSourceDomain": true, "numResults": 8 }`
- `web_research_exa` *(requires `--exa-enable-research`)*
  - `{ "query": "Compare recommendations from practitioner blogs", "systemPrompt": "Prioritize dated posts, independent authors, and call out opinion vs facts", "outputSchema": { "type": "text" } }`

## Query Writing

- Include the topic, ecosystem, and audience: e.g. `postgres indexing practitioner blog`, `react compiler migration personal blog`.
- Prefer wording like `blog`, `personal site`, `independent write-up`, or `practitioner perspective` when using `web_search_exa`.
- After finding one excellent source, pivot to `web_find_similar_exa` instead of repeating broader keyword searches.

## Output Guidance

1) Identify author perspective and date.
2) Distinguish opinion claims from verifiable facts.
3) Return the top 3–5 strongest links with a short rationale for each.

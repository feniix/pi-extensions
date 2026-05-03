---
name: personal-site-search
description: Search personal websites and blogs using Exa. Finds practitioner perspectives and independent analysis.
context: fork
---

# Personal Site Search (Exa)

Use this skill to find practitioner blogs, independent analysis, personal websites, technical essays, field notes, and non-corporate perspectives.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Find practitioner blogs by topic | `web_search_exa` | Start here when you do not already know a source site. |
| Filter to personal sites only | `web_search_advanced_exa` with `category: "personal site"` | Use when available; add date or domain filters when useful. |
| Find more like this / recommend similar sites | `web_find_similar_exa` | Use when you already have one strong post or blog URL. |
| Distill viewpoints across multiple posts | `web_research_exa` | Use when enabled and synthesis is worth the cost. |
| Direct one-off answer from discovered sources | `web_answer_exa` | Use for concise cited answers after the topic is clear. |
| Pull full article bodies | `web_fetch_exa` | Fetch selected URLs when snippets are not enough. |

If `web_search_advanced_exa` is unavailable, use `web_search_exa` with terms like `blog`, `personal site`, `independent write-up`, or `practitioner perspective`.

## When to Use Find-Similar vs Search

- Use `web_find_similar_exa` for **find more like this** workflows when you already have a canonical URL that matches the taste, style, or niche you want.
- Use `web_search_exa` for **keyword-based discovery** when you are starting from a topic, technology, or opinion and do not yet have a seed URL.
- Use `web_search_advanced_exa` instead of `web_find_similar_exa` when you need explicit controls like `category: "personal site"`, domain constraints, or date filtering.

## Recommended Settings

- Topic discovery
  - `{ "query": "Rust async architecture practitioner blog", "numResults": 10 }`
- Personal-site category search
  - `{ "query": "Rust async architecture", "category": "personal site", "excludeDomains": ["medium.com", "substack.com"], "numResults": 15 }`
- Similar-source expansion
  - `{ "url": "https://example.dev/posts/rust-async-architecture", "excludeSourceDomain": true, "numResults": 8 }`
- Synthesis
  - `{ "query": "Compare recommendations from practitioner blogs about Rust async architecture trade-offs.", "systemPrompt": "Prioritize dated posts and independent authors. Distinguish opinion from verified facts and call out disagreement.", "outputSchema": { "type": "text" } }`

## Query Writing

- Include topic, ecosystem, and audience: `postgres indexing practitioner blog`, `react compiler migration personal blog`.
- Prefer wording like `blog`, `personal site`, `independent write-up`, or `practitioner perspective` when using `web_search_exa`.
- After finding one excellent source, pivot to `web_find_similar_exa` instead of repeating broad keyword searches.

## Output Guidance

1. Identify author perspective and date.
2. Distinguish opinion claims from verifiable facts.
3. Return the top 3-5 strongest links with a short rationale for each.
4. Call out if results are mostly corporate blogs, content farms, or undated posts.

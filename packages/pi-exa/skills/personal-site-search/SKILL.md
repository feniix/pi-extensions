---
name: personal-site-search
description: Search personal websites and blogs using Exa advanced search. Full filter support for finding individual perspectives, portfolios, and personal blogs. Use when searching for personal sites, blog posts, or portfolio websites.
context: fork
---

# Personal Site Search (Exa)

## Tool Selection

Use the right tool based on the research intent:

| Intent | Tool | Notes |
|--------|------|-------|
| Find blog posts or tutorials | `web_search_exa` | Fast, general web results |
| Find more posts like a known one | `web_find_similar_exa` | Provide a URL; finds similar content |
| Deep dive on a specific perspective | `web_research_exa` | ~20s, use with `--exa-enable-research` |
| Read a specific post | `web_fetch_exa` | After finding a URL |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Find blog posts** (`web_search_exa`):
  ```json
  { "query": "building production LLM applications lessons learned", "numResults": 15 }
  ```
- **Similar to a known post** (`web_find_similar_exa`):
  ```json
  { "url": "https://blog.example.com/llm-production", "numResults": 10 }
  ```
- **Exclude aggregators**:
  ```json
  { "query": "startup founder lessons", "category": "personal site", "excludeDomains": ["medium.com", "substack.com"], "numResults": 15 }
  ```
- **Deep perspective synthesis** (`web_research_exa`):
  ```json
  { "query": "Compilation of opinions on AI safety from independent researchers and practitioners", "type": "deep-reasoning" }
  ```

## When to Use

Use this skill when you need:
- Individual expert opinions and experiences
- Personal blog posts on technical topics
- Portfolio websites
- Independent analysis (not corporate content)
- Deep dives and tutorials from practitioners

## Query Writing Patterns

- Include specific topics and techniques
- Add "blog" or "personal site" when you want individual perspectives
- Exclude aggregator platforms (Medium, Substack) when looking for original content

## Output Format

Return:
1. Results (title, author/site name, date, key insights)
2. Sources (URLs)
3. Notes (author expertise, potential biases, depth of coverage)

## Examples

### Technical blog posts
```
web_search_exa {
  "query": "Rust async runtime comparison 2024",
  "numResults": 10
}
```

### More like this
```
web_find_similar_exa {
  "url": "https://notes.on___.org/p/ai-safety",
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

### Deep synthesis
```
web_research_exa {
  "query": "Independent perspectives on AI consciousness and sentience from researchers and philosophers",
  "type": "deep-reasoning"
}
```

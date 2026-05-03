---
name: code-search
description: Code context using Exa. Finds reliable code docs, snippets, API references, and debugging examples.
context: fork
---

# Code Search (Exa)

Use this skill when the user needs external coding context: official docs, API examples, error explanations, library comparisons, or implementation references that are not already in the repo.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Find docs, examples, API syntax, or error reports | `web_search_exa` | Start here for most lookups; include language/library/version in the query. |
| Read official docs or a promising result | `web_fetch_exa` | Fetch 1-3 high-signal URLs after discovery. |
| Need a concise grounded explanation | `web_answer_exa` | Best for direct questions; ask for citations and short code snippets. |
| Compare libraries or approaches across sources | `web_research_exa` | Use only when enabled and the answer needs synthesis, not a quick lookup. |
| Find similar docs or examples from one strong page | `web_find_similar_exa` | Use when a seed URL is clearly relevant. |

If `web_research_exa` or `web_search_advanced_exa` is unavailable, do not pretend it can be used. Fall back to `web_search_exa` plus selective `web_fetch_exa`.

## Query Writing

- Include the **language, framework/library, and version** when known: `TypeScript 5.7 TypeBox Object additionalProperties`.
- Include exact identifiers, error strings, function names, or package names when available.
- Prefer official docs, release notes, issue trackers, and maintainer-authored examples before blogs.
- For debugging, include the error class/message and runtime context.

## Recommended Parameters

- `web_search_exa`
  - `{ "query": "TypeScript 5.7 TypeBox additionalProperties examples", "numResults": 5 }`
- `web_fetch_exa`
  - `{ "urls": ["https://example.com/docs/page"], "maxCharacters": 5000 }`
- `web_answer_exa`
  - `{ "query": "How does TypeBox validate additionalProperties in TypeScript?", "systemPrompt": "Prefer official docs and concise code snippets." }`
- `web_research_exa`
  - `{ "query": "Compare TypeScript runtime validation libraries for backend APIs, focusing on schema reuse, performance, and ergonomics.", "systemPrompt": "Prefer official docs, maintainer posts, and recent benchmarks. Call out uncertainty.", "outputSchema": { "type": "text" } }`

## Output Guidance

1. Lead with the answer or snippet the user can use immediately.
2. Cite source URLs for claims that affect implementation decisions.
3. Separate confirmed facts from inferred guidance.
4. Keep follow-up tool calls minimal and targeted.

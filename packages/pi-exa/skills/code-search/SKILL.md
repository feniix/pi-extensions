---
name: code-search
description: Code context using Exa. Finds reliable code docs, snippets, API references, and debugging examples.
context: fork
---

# Code Search (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Find code examples / API syntax | `web_search_exa` | Start with query + `numResults` |
| Need grounded short answer or explanation | `web_answer_exa` | Use `systemPrompt` + optional `outputSchema` |
| Need deep, synthesis-style comparison across sources | `web_research_exa` | Set `systemPrompt`, pass `additionalQueries`, prefer `outputSchema` |
| Read a page after discovery | `web_fetch_exa` | Use on 1-3 URLs from search result |

## Query Writing

- Include **language** and **version** (e.g., `TypeScript 5`, `React 19`, `Python 3.12`).
- Prefer short, high-signal phrasing and exact identifiers when available.

## Recommended Parameters

- **web_search_exa**
  - `{ "query": "...", "numResults": 5 }`
- **web_answer_exa**
  - `{ "query": "...", "systemPrompt": "Prefer official docs and short code snippets" }`
- **web_research_exa**
  - `{ "query": "...,", "systemPrompt": "Focus on official references and compare approaches", "outputSchema": { "type": "text" } }`

## Output Guidance

1) Return concise snippets first.
2) Cite source URLs where decisions came from.
3) Keep follow-up calls minimal and focused.

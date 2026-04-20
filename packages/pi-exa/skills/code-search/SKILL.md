---
name: code-search
description: Code context using Exa. Finds real snippets and docs from GitHub, StackOverflow, and technical docs. Use when searching for code examples, API syntax, library documentation, or debugging help.
context: fork
---

# Code Context (Exa)

## Tool Selection

Use the right tool based on the user's intent:

| Intent | Tool |
|--------|------|
| Quick answer to a programming question | `web_answer_exa` |
| Find working code examples and snippets | `web_search_exa` |
| Compare implementations across libraries or frameworks | `web_research_exa` |
| Read full documentation or a specific article | `web_fetch_exa` |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Quick answers** (`web_answer_exa`):
  ```json
  { "query": "How do I use React useCallback with TypeScript?", "systemPrompt": "Provide concise, working code examples." }
  ```
- **Code examples** (`web_search_exa`):
  ```json
  { "query": "Go generics interface implementation example", "numResults": 8 }
  ```
- **Deep comparison** (`web_research_exa`):
  ```json
  { "query": "Compare Rust async runtimes: Tokio vs async-std vs smol", "type": "deep-reasoning" }
  ```

## When to Use

Use these tools for ANY programming-related request:
- API usage and syntax
- SDK/library examples
- Config and setup patterns
- Framework "how to" questions
- Debugging when you need authoritative snippets

## Query Writing Patterns

To reduce irrelevant results and cross-language noise:
- Always include the **programming language** in the query.
  - Example: use **"Go generics"** instead of just **"generics"**.
- When applicable, also include **framework + version** (e.g., "Next.js 14", "React 19", "Python 3.12").
- Include exact identifiers (function/class names, config keys, error messages) when you have them.

### Category Filter Restrictions

Using `category` with code search is not recommended — it can exclude relevant technical content from blogs, GitHub, and Stack Overflow. Use without category for code searches.

## Output Format

Return:
1. Best minimal working snippet(s) (keep it copy/paste friendly)
2. Notes on version / constraints / gotchas
3. Sources (URLs if present in returned context)

Before presenting:
- Deduplicate similar results and keep only the best representative snippet per approach.

## Examples

### Find React hook patterns
```
web_search_exa {
  "query": "React useState TypeScript generic types hooks",
  "numResults": 5
}
```

### Quick factual question
```
web_answer_exa {
  "query": "How does Python asyncio event loop work under the hood?",
  "systemPrompt": "Explain with concrete examples. Be concise."
}
```

### Compare implementations
```
web_research_exa {
  "query": "Compare Zustand vs Jotai vs Redux for React state management in 2025",
  "type": "deep-reasoning"
}
```

### Debug a specific error
```
web_search_exa {
  "query": "TypeError Cannot read property of undefined JavaScript fix",
  "numResults": 5
}
```

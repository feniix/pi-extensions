---
name: research-paper-search
description: Search for research papers and academic content using Exa.
context: fork
---

# Research Paper Search (Exa)

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Paper discovery | `web_search_advanced_exa` | `category: "research paper"`, optional `includeDomains` (e.g., `arxiv.org`) |
| Evidence-weighted synthesis across papers | `web_research_exa` | Use `systemPrompt`, optional structured `outputSchema` |
| One-off definition / quick answer | `web_answer_exa` | Keep it concise and citation-focused |

## Recommended settings

- `web_search_advanced_exa`
  - `{ "query": "LLM fine-tuning methods", "category": "research paper", "includeDomains": ["arxiv.org"], "numResults": 20 }`
- `web_research_exa`
  - `{ "query": "Summarize methodological differences between X and Y", "systemPrompt": "Prioritize peer-reviewed sources and methods sections", "outputSchema": { "type": "text" } }`

## Output Guidance

1) Return paper title, venue, and year.
2) Prefer direct quotations for claims.
3) Provide caveats for methodology limits.

---
name: research-paper-search
description: Search for research papers and academic content using Exa advanced search. Full filter support including date ranges and text filtering. Use when searching for academic papers, arXiv preprints, or scientific research.
context: fork
---

# Research Paper Search (Exa)

## Tool Selection

Use the right tool based on the research depth:

| Intent | Tool | Notes |
|--------|------|-------|
| Find papers on a topic | `web_search_advanced_exa` with `category: "research paper"` | arXiv, PubMed, OpenReview, etc. |
| Literature review with synthesis | `web_research_exa` | ~20s, use with `--exa-enable-research` |
| Quick factual question about a paper | `web_answer_exa` | Who wrote it, what did they find? |
| Read a specific paper | `web_fetch_exa` | After finding a URL |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Find papers** (`web_search_advanced_exa`):
  ```json
  { "query": "transformer attention mechanisms efficiency", "category": "research paper", "numResults": 15 }
  ```
- **From specific venues**:
  ```json
  { "query": "large language model agents", "category": "research paper", "includeDomains": ["arxiv.org"], "numResults": 20 }
  ```
- **With date filter**:
  ```json
  { "query": "RLHF reinforcement learning human feedback", "category": "research paper", "startPublishedDate": "2024-01-01", "numResults": 15 }
  ```
- **Literature review** (`web_research_exa`):
  ```json
  { "query": "Survey of mechanistic interpretability techniques for neural networks", "type": "deep-reasoning" }
  ```

## Query Writing Patterns

- Include research domain keywords
- Include specific methodologies if known
- Use version numbers for frameworks/libraries
- Consider adding "paper" or "arxiv" to focus results

## Output Format

Return:
1. Results (structured list with title, authors, date, abstract summary)
2. Sources (URLs with publication venue)
3. Notes (methodology differences, conflicting findings)

## Examples

### Recent papers on a topic
```
web_search_exa {
  "query": "transformer attention mechanisms efficiency 2024",
  "numResults": 15
}
```

### From specific venues
```
web_search_advanced_exa {
  "query": "large language model agents arxiv",
  "category": "research paper",
  "includeDomains": ["arxiv.org"],
  "numResults": 20
}
```

### With date filter
```
web_search_advanced_exa {
  "query": "RLHF reinforcement learning human feedback",
  "category": "research paper",
  "startPublishedDate": "2024-01-01",
  "numResults": 15
}
```

### Literature review
```
web_research_exa {
  "query": "Systematic review of constitutional AI and AI alignment techniques from 2022-2025",
  "type": "deep-reasoning"
}
```

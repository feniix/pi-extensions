---
name: research-paper-search
description: Search for research papers and academic content using Exa advanced search. Full filter support including date ranges and text filtering. Use when searching for academic papers, arXiv preprints, or scientific research.
context: fork
---

# Research Paper Search (Exa)

## Tool Restriction (Critical)

ONLY use `web_search_exa` for basic searches or `web_search_advanced_exa` with `category: "research paper"` if enabled. Do NOT use `web_fetch_exa` unless following up on specific URLs.

## Token Isolation (Critical)

Never run Exa searches in main context. Always spawn Task agents:
- Agent calls `web_search_exa` or `web_search_advanced_exa`
- Agent merges + deduplicates results before presenting
- Agent returns distilled output (brief markdown or compact JSON)
- Main context stays clean regardless of search volume

## When to Use

Use this skill when you need:
- Academic papers from arXiv, OpenReview, PubMed, etc.
- Scientific research on specific topics
- Literature reviews with date filtering
- Papers containing specific methodologies or terms

## Query Writing Tips

- Include research domain keywords
- Include specific methodologies if known
- Use version numbers for frameworks/libraries
- Consider adding "paper" or "arxiv" to focus results

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

### With date filter (if advanced enabled)
```
web_search_advanced_exa {
  "query": "RLHF reinforcement learning human feedback",
  "category": "research paper",
  "startPublishedDate": "2024-01-01",
  "numResults": 15
}
```

## Output Format

Return:
1) Results (structured list with title, authors, date, abstract summary)
2) Sources (URLs with publication venue)
3) Notes (methodology differences, conflicting findings)

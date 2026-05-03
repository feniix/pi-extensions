---
name: research-paper-search
description: Search for research papers and academic content using Exa.
context: fork
---

# Research Paper Search (Exa)

Use this skill for discovering academic papers, arXiv/preprint work, methods comparisons, literature scans, and evidence-weighted technical summaries.

## Tool Selection

| Intent | Primary Tool | Notes |
|---|---|---|
| Paper discovery | `web_search_advanced_exa` with `category: "research paper"` | Use when available; domain filters such as `arxiv.org` can improve signal. |
| Broad discovery when advanced search is unavailable | `web_search_exa` | Include topic, method names, and paper/source terms. |
| Evidence-weighted synthesis across papers | `web_research_exa` | Use when enabled; specify evidence quality and caveat requirements. |
| One-off definition or quick answer | `web_answer_exa` | Keep it concise and citation-focused. |
| Read abstracts or paper pages | `web_fetch_exa` | Fetch selected paper URLs when snippets are insufficient. |
| Find related papers from one seed paper | `web_find_similar_exa` | Use when a seed URL is clearly on-topic. |

If opt-in tools are unavailable, use `web_search_exa` plus selective `web_fetch_exa` and produce a smaller sourced summary.

## Recommended Settings

- Paper discovery
  - `{ "query": "LLM fine-tuning methods instruction tuning preference optimization", "category": "research paper", "includeDomains": ["arxiv.org"], "numResults": 10 }`
- Related-paper expansion
  - `{ "url": "https://arxiv.org/abs/2305.18290", "excludeSourceDomain": false, "numResults": 8 }`
- Evidence-weighted synthesis
  - `{ "query": "Summarize methodological differences between instruction tuning, RLHF, DPO, and newer preference optimization methods for large language models.", "systemPrompt": "Prioritize peer-reviewed papers, arXiv papers with clear methods sections, and papers with empirical comparisons. Separate findings from speculation and call out methodology limits.", "outputSchema": { "type": "text" } }`

## Query Writing

- Include method names, task/domain, and publication terms: `paper`, `arXiv`, `benchmark`, `survey`, `method`.
- Use date filters for fast-moving areas when the user asks for recent work.
- Prefer direct paper sources over secondary summaries unless the user wants a high-level introduction.

## Output Guidance

1. Return paper title, venue/source, year, and URL.
2. Separate claims about results from claims about methods.
3. Prefer direct quotations only when wording matters; otherwise summarize concisely with citation URLs.
4. Provide caveats for limited benchmarks, small sample sizes, or non-comparable evaluations.

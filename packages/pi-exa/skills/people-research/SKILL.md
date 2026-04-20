---
name: people-research
description: People research using Exa search. Finds LinkedIn profiles, professional backgrounds, experts, team members, and public bios across the web. Use when searching for people, finding experts, or looking up professional profiles.
context: fork
---

# People Research (Exa)

## Tool Selection

Use the right tool based on the research depth:

| Intent | Tool | Notes |
|--------|------|-------|
| Find profiles by role or company | `web_search_advanced_exa` with `category: "people"` | LinkedIn profiles, public bios |
| Quick background check | `web_answer_exa` | Factual queries about a specific person |
| Deep background research on an individual | `web_research_exa` | ~20s, use with `--exa-enable-research` |
| Recent mentions or press | `web_search_advanced_exa` with `category: "news"` | Interviews, announcements |
| Read a specific profile | `web_fetch_exa` | After finding a URL |

**Tool availability**: All tools are enabled by default. `web_research_exa` requires `--exa-enable-research` flag.

## Recommended Settings

- **Profile discovery** (`web_search_advanced_exa`):
  ```json
  { "query": "VP Engineering AI infrastructure San Francisco", "category": "people", "numResults": 20 }
  ```
- **Quick bio** (`web_answer_exa`):
  ```json
  { "query": "What is Dario Amodei's background and current role at Anthropic?" }
  ```
- **Deep research** (`web_research_exa`):
  ```json
  { "query": "Professional background, notable work, and contributions of Andrej Karpathy", "type": "deep-reasoning" }
  ```

## Query Writing Patterns

- Include company names, titles, or specific domains to focus results
- Use "LinkedIn profile" or "bio" in the query when you want profile-focused results
- For historical figures, include dates or organizations for precision

## Category Filter Restrictions

When using `category: "people"`, these parameters cause errors:
- `startPublishedDate` / `endPublishedDate`
- `includeText` / `excludeText`
- `excludeDomains`
- `includeDomains` — **LinkedIn domains only** (e.g., "linkedin.com")

## Output Format

Return:
1. Results (name, title, company, location if available)
2. Sources (Profile URLs)
3. Notes (profile completeness, verification status)

## Examples

### Discovery: find people by role
```
web_search_advanced_exa {
  "query": "machine learning engineer San Francisco",
  "category": "people",
  "numResults": 25
}
```

### Quick factual background
```
web_answer_exa {
  "query": "What is Sam Altman's background and current role at OpenAI?"
}
```

### Deep dive on a specific person
```
web_research_exa {
  "query": "Yoshua Bengio: academic contributions, current research focus, and industry impact",
  "type": "deep-reasoning"
}
```

### News mentions
```
web_search_advanced_exa {
  "query": "Dario Amodei interview 2024",
  "category": "news",
  "numResults": 10,
  "startPublishedDate": "2024-01-01"
}
```

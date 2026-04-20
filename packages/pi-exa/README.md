# @feniix/pi-exa

[Exa AI](https://exa.ai) search extension for [pi](https://pi.dev/) — web search, content fetching, advanced search, deep research, and more via Exa AI.

## Features

- **Web Search** (`web_search_exa`): Real-time web search with semantic query understanding and highlights
- **Web Fetch** (`web_fetch_exa`): Read URLs with highlights, summaries, and freshness control (maxAgeHours)
- **Advanced Search** (`web_search_advanced_exa`): Full-featured search with category filters, date ranges, domain restrictions (disabled by default)
- **Deep Research** (`web_research_exa`): Multi-step synthesized research with grounded citations (disabled by default)
- **Answer** (`web_answer_exa`): Grounded LLM answers with citations from the web
- **Find Similar** (`web_find_similar_exa`): Semantic similarity search from a known URL

## Install

```bash
pi install npm:@feniix/pi-exa
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-exa
```

## Configuration

You need an Exa API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys).

### Option 1: Environment Variable

```bash
export EXA_API_KEY="your_key"
```

### Option 2: Settings File

Use pi's standard settings locations for non-secret configuration:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Under the `pi-exa` key:

```json
{
  "pi-exa": {
    "enabledTools": ["web_search_exa", "web_fetch_exa", "web_answer_exa", "web_find_similar_exa"],
    "advancedEnabled": false,
    "researchEnabled": false
  }
}
```

> Best practice: use `settings.json` for non-secret defaults only.
> Keep `EXA_API_KEY` in an environment variable, or use `--exa-config-file` / `EXA_CONFIG_FILE` to point to a custom private JSON config file when you need to persist secrets outside your project.
> Legacy aliases `--exa-config` and `EXA_CONFIG` are still accepted but deprecated.

### Option 3: CLI Flags

```bash
pi --exa-api-key=your_key
```

## Tools

### `web_search_exa` (enabled by default)

Search the web for any topic and get clean, ready-to-use content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural language search query |
| `numResults` | integer | no | Number of results (1-20, default: 5) |

**Best for:** Finding current information, news, facts, or answering questions.

### `web_fetch_exa` (enabled by default)

Read a webpage's full content as clean markdown.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `urls` | string[] | yes | URLs to read (batch multiple URLs) |
| `maxCharacters` | integer | no | Max characters per page (default: 3000) |
| `highlights` | boolean | no | Include highlighted passages |
| `summary` | object | no | `{ query: string }` — request a summary |
| `maxAgeHours` | integer | no | Max age of cached content (0 = always fresh, -1 = never fresh) |

**Best for:** Extracting full content from known URLs after web search.

### `web_search_advanced_exa` (disabled by default)

Advanced web search with full Exa API control.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `numResults` | integer | no | Number of results |
| `category` | string | no | Filter: company, research paper, financial report, people, news, etc. |
| `type` | string | no | Search type: auto, fast, neural, keyword, hybrid, instant |
| `startPublishedDate` | string | no | ISO date filter |
| `endPublishedDate` | string | no | ISO date filter |
| `includeDomains` | string[] | no | Domain whitelist |
| `excludeDomains` | string[] | no | Domain blacklist |

Enable via: `pi --exa-enable-advanced`

### `web_research_exa` (disabled by default)

Deep research with synthesized output and grounded citations. ~20s latency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Research question or topic |
| `type` | string | no | Variant: deep-reasoning (default), deep-lite, deep |
| `systemPrompt` | string | no | Additional instructions for the research agent |
| `outputSchema` | object | no | JSON Schema for structured output |
| `additionalQueries` | string[] | no | Alternative queries (max 5) |
| `numResults` | integer | no | Number of source results |
| `includeDomains` | string[] | no | Domain whitelist |
| `excludeDomains` | string[] | no | Domain blacklist |

Enable via: `pi --exa-enable-research`

**Best for:** Complex research questions, literature reviews, competitive analysis. Not for quick lookups.

### `web_answer_exa` (enabled by default)

Generate a grounded answer to a question with citations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Question to answer |
| `systemPrompt` | string | no | Instructions to guide answer style |
| `text` | boolean | no | Include source text in citations (default: false) |
| `outputSchema` | object | no | JSON Schema for structured output |

**Best for:** Direct factual questions that benefit from source attribution.

### `web_find_similar_exa` (enabled by default)

Find pages similar to a given URL using semantic similarity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to find similar pages for |
| `numResults` | integer | no | Number of similar results (default: 5) |
| `excludeSourceDomain` | boolean | no | Exclude links from the input URL's base domain |
| `includeDomains` | string[] | no | Domain whitelist |
| `excludeDomains` | string[] | no | Domain blacklist |

**Best for:** Expanding coverage from a known source, finding related content.

## Skills

- **code-search**: Find code examples, API docs, debugging help
- **company-research**: Competitor analysis, market research
- **people-research**: Find experts, LinkedIn profiles
- **research-paper-search**: Academic papers, arXiv
- **financial-report-search**: SEC filings, earnings reports
- **personal-site-search**: Independent blogs, tutorials

## Requirements

- pi v0.51.0 or later
- Exa API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys)

## License

MIT

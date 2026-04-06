# @feniix/pi-exa

[Exa AI](https://exa.ai) search extension for [pi](https://pi.dev/) — web search, content fetching, and advanced search with category filtering.

## Features

- **Web Search** (`web_search_exa`): Real-time web search with semantic query understanding
- **Web Fetch** (`web_fetch_exa`): Read URLs and extract clean content
- **Advanced Search** (`web_search_advanced_exa`): Full-featured search with category filters, date ranges, domain restrictions (disabled by default)
- **Skills**: Specialized search skills for code, companies, people, research papers, financial reports, and personal sites

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

### Option 2: JSON Config File

Create `~/.pi/agent/extensions/exa.json` (auto-created on first run):

```json
{
  "apiKey": "your_key",
  "enabledTools": ["web_search_exa", "web_fetch_exa"],
  "advancedEnabled": false
}
```

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

**Best for:** Finding current information, news, facts, or answering questions about any topic.

### `web_fetch_exa` (enabled by default)

Read a webpage's full content as clean markdown.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `urls` | string[] | yes | URLs to read (batch multiple URLs) |
| `maxCharacters` | integer | no | Max characters per page (default: 3000) |

**Best for:** Extracting full content from known URLs after web search.

### `web_search_advanced_exa` (disabled by default)

Advanced web search with full Exa API control.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `numResults` | integer | no | Number of results |
| `category` | string | no | Filter: company, research paper, financial report, etc. |
| `type` | string | no | Search type: auto, fast, deep, neural |
| `startPublishedDate` | string | no | ISO date filter |
| `endPublishedDate` | string | no | ISO date filter |
| `includeDomains` | string[] | no | Domain whitelist |
| `excludeDomains` | string[] | no | Domain blacklist |

Enable via: `pi --exa-enable-advanced`

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

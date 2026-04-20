# @feniix/pi-exa

[Exa AI](https://exa.ai) extension for [pi](https://pi.dev/) with search, fetch, research, and answer capabilities.

## Features

- **web_search_exa**: default web search (highlights + short text snippets).
- **web_fetch_exa**: fetch page content by URL.
- **web_search_advanced_exa**: advanced search options and category filters (disabled by default).
- **web_research_exa**: deep-research synthesis (disabled by default).
- **web_answer_exa**: quick grounded answers.
- **web_find_similar_exa**: discover related URLs.

## Install

```bash
pi install npm:@feniix/pi-exa
```

For ephemeral use:

```bash
pi -e npm:@feniix/pi-exa
```

## Configuration

You need an Exa API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys).

### Option 1: Environment variable

```bash
export EXA_API_KEY="your-key"
```

### Option 2: Settings files

Supports standard pi settings locations:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Example:

```json
{
  "pi-exa": {
    "apiKey": "your-key",
    "enabledTools": ["web_search_exa", "web_fetch_exa", "web_answer_exa", "web_find_similar_exa"],
    "advancedEnabled": false,
    "researchEnabled": false
  }
}
```

## CLI flags

- `--exa-api-key <key>`: API key override.
- `--exa-enable-advanced`: enable `web_search_advanced_exa`.
- `--exa-enable-research`: enable `web_research_exa`.
- `--exa-config-file <path>`: load configuration from file.
- `--exa-config <path>` (deprecated alias for `--exa-config-file`).

## Tools

### web_search_exa

Params: `query` (required), `numResults`.

Returns: formatted snippets with optional highlights and metadata (`costDollars`, `searchTime`, `resolvedSearchType`).

### web_fetch_exa

Params: `urls` (required array), `maxCharacters`, `highlights`, `summary` (`query`), `maxAgeHours`.

### web_search_advanced_exa

Params include `query`, `numResults`, `category`, `type` (`auto|neural|...`, no deep types), date filters, domain filters, and content controls.

### web_research_exa

Params include:

- `query` (required)
- `type`: `deep-reasoning | deep-lite | deep`
- `systemPrompt`
- `outputSchema` (`type` may be `"object"` or `"text"`, default `"object"`)
- optional `additionalQueries`, filters, and `numResults`

### web_answer_exa

Params include `query` (required), `systemPrompt`, `text`, and `outputSchema`.

### web_find_similar_exa

Params include `url` (required), `numResults`, `excludeSourceDomain`, date filters, and domain filters.

## Notes

- `web_search_advanced_exa` and `web_research_exa` are opt-in and disabled by default.
- Research/tool output may include both `text` and `details.parsedOutput` depending on `outputSchema.type`.

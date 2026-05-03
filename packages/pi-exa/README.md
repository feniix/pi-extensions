# @feniix/pi-exa

[Exa AI](https://exa.ai) extension for [pi](https://pi.dev/) with search, fetch, research, and answer capabilities.

## Features

- **web_search_exa**: default web search (highlights + short text snippets).
- **web_fetch_exa**: fetch page content by URL.
- **web_search_advanced_exa**: advanced search options and category filters (disabled by default).
- **web_research_exa**: deep-research synthesis (disabled by default).
- **web_answer_exa**: quick grounded answers.
- **web_find_similar_exa**: discover related URLs.
- **exa_research_step/status/summary/reset**: local, stateful research-planning tools that recommend explicit Exa retrieval calls without executing them.

## Install

```bash
pi install npm:@feniix/pi-exa
```

For ephemeral use:

```bash
pi -e npm:@feniix/pi-exa
```

## Configuration

You need an Exa API key from [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) for retrieval tools. The local `exa_research_*` planning tools work without an API key because they do not call Exa network APIs.

If you configure `enabledTools`, it acts as a strict allowlist. Include the `exa_research_*` names if you want the planner tools available with an explicit allowlist.

### Recommended: environment variable

```bash
export EXA_API_KEY="your-key"
```

### Recommended for private overrides: explicit config file

Use a private config file when you want to store an API key outside shared project settings:

```json
{
  "apiKey": "your-key",
  "enabledTools": [
    "exa_research_step",
    "exa_research_status",
    "exa_research_summary",
    "exa_research_reset",
    "web_search_exa",
    "web_fetch_exa",
    "web_answer_exa",
    "web_find_similar_exa"
  ],
  "advancedEnabled": false,
  "researchEnabled": false
}
```

Then run pi with:

```bash
pi -e npm:@feniix/pi-exa -- --exa-config-file ~/.config/pi/exa.json
```

### Shared non-secret settings

Supports standard pi settings locations:

- project: `.pi/settings.json`
- global: `~/.pi/agent/settings.json`

Example:

```json
{
  "pi-exa": {
    "enabledTools": [
      "exa_research_step",
      "exa_research_status",
      "exa_research_summary",
      "exa_research_reset",
      "web_search_exa",
      "web_fetch_exa",
      "web_answer_exa",
      "web_find_similar_exa"
    ],
    "advancedEnabled": false,
    "researchEnabled": false
  }
}
```

`apiKey` is accepted in settings files for compatibility, but `pi-exa` will warn when it is loaded there. Prefer `EXA_API_KEY` or `--exa-config-file` for secrets.

## CLI flags

- `--exa-api-key <key>`: API key override.
- `--exa-enable-advanced`: enable `web_search_advanced_exa`.
- `--exa-enable-research`: enable `web_research_exa`.
- `--exa-config-file <path>`: load configuration from file.
- `--exa-config <path>` (deprecated alias for `--exa-config-file`).

## Tools

### exa_research_step

Records one step in an in-memory research-planning session. Params include `topic`, `stage`, `note`, optional `criteria`, `sources`, `gaps`, `assumptions`, `nextAction`, branch/revision metadata, `thought_number`, `total_thoughts`, and `next_step_needed`.

### exa_research_status

Reports the current local planning state: topic, step count, active stage, branches, criteria coverage, source pack summary, open gaps, assumptions, and recommended next action.

### exa_research_summary

Generates human-readable research planning output. Modes: `brief`, `execution_plan`, `source_pack`, and `payload`. Payload mode suggests a `web_research_exa` payload only; it does not run retrieval.

### exa_research_reset

Clears the active in-memory planning session.

### web_search_exa

Params: `query` (required), `numResults`.

Returns: formatted snippets with optional highlights and metadata (`costDollars`, `searchTime`, `resolvedSearchType`).

### web_fetch_exa

Params: `urls` (required array), `maxCharacters`, `highlights`, `summary` (`query`), `maxAgeHours`.

### web_search_advanced_exa

Params include `query`, `numResults`, `category`, `type` (`auto|neural|...`, no deep types), date filters, domain filters, `textMaxCharacters`, and highlight controls.

Notes:
- Deep types are rejected here. Use `web_research_exa` for `deep-reasoning`, `deep-lite`, or `deep`.
- Invalid categories return an error instead of silently falling back to an unfiltered search.

### web_research_exa

Params include:

- `query` (required)
- `type`: `deep-reasoning | deep-lite | deep`
- `systemPrompt`
- `outputSchema` (`type` may be `"object"` or `"text"`, default `"object"`)
- optional `additionalQueries`, filters, `numResults`, and `textMaxCharacters`

### web_answer_exa

Params include `query` (required), `systemPrompt`, `text`, and `outputSchema`.

### web_find_similar_exa

Params include `url` (required), `numResults`, `textMaxCharacters`, `excludeSourceDomain`, date filters, and domain filters.

## Integration tests

Live integration coverage is available for `web_search_exa`, `web_fetch_exa`, and `web_research_exa`.

These tests are:
- skipped by default
- only enabled when you opt in manually
- always skipped in CI

Run them locally with a real API key:

```bash
EXA_API_KEY=your-key npx vitest run packages/pi-exa/__tests__/integration.test.ts -- --exa-live
```

You can also enable them with an environment variable instead of the CLI flag:

```bash
PI_EXA_LIVE=1 EXA_API_KEY=your-key npx vitest run packages/pi-exa/__tests__/integration.test.ts
```

## Notes

- `exa_research_*` planning tools are enabled by default when no explicit `enabledTools` allowlist is configured, local-only, and do not require an Exa API key.
- `web_search_advanced_exa` and `web_research_exa` are opt-in and disabled by default.
- Research/tool output may include both `text` and `details.parsedOutput` depending on `outputSchema.type`.

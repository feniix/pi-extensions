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

## Why pi-exa vs the hosted Exa MCP?

The hosted Exa MCP at `https://mcp.exa.ai/mcp` is a fine default for one-shot search and fetch. pi-exa exists for cases the hosted MCP cannot address by design:

- **Tools the hosted MCP does not expose.** `web_answer_exa` (Exa's `/answer` endpoint) and `web_find_similar_exa` (`/findSimilar`) are not advertised by the hosted MCP under any flag. If you need grounded answers with citations or "more like this" discovery, you call them directly through pi-exa.
- **Local stateful planning.** `exa_research_step / status / summary / reset` keep an in-memory research plan that survives across calls in a single pi session. A stateless remote MCP cannot offer this — there is no per-session memory to update.
- **Local key custody and allowlists.** Your `EXA_API_KEY` and `enabledTools` allowlist stay on the workstation. The hosted MCP requires sending your key to a third party on every request.
- **Pre-flight validation.** pi-exa rejects category/filter combinations Exa silently ignores (e.g., `category: "people"` with non-LinkedIn `includeDomains`), so you find out at the call site instead of in a quiet, empty result set.
- **Forward-compatibility on the `/research` sunset.** Every pi-exa tool routes through Exa's canonical endpoints — `/search`, `/contents`, `/answer`, `/findSimilar`. The hosted MCP's `deep_researcher_start` / `deep_researcher_check` tools route through the deprecated `/research` endpoint. When Exa enforces that sunset, those hosted tools break or lose async semantics; pi-exa's `web_research_exa` (which uses `/search` with `type: "deep-reasoning"`) keeps working.

| Capability                                  | Hosted Exa MCP | pi-exa |
| ------------------------------------------- | :------------: | :----: |
| `web_search_exa`                            |       yes      |   yes  |
| `web_fetch_exa`                             |       yes      |   yes  |
| `web_search_advanced_exa`                   |     opt-in     |  opt-in|
| `web_answer_exa` (`/answer`)                |       no       |   yes  |
| `web_find_similar_exa` (`/findSimilar`)     |       no       |   yes  |
| Local research planner (`exa_research_*`)   |       no       |   yes  |
| Local API key custody                       |       no       |   yes  |
| Routes deep research through `/search`      |       no       |   yes  |

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
- `--exa-timeout-ms <ms>`: default per-call timeout for Exa-backed tools (built-in 60000).
- `--exa-research-timeout-ms <ms>`: override for `web_research_exa` (built-in 180000; deep-reasoning runs longer).

> The timeout bounds the JS-side wait. `exa-js` does not yet accept `AbortSignal` ([exa-labs/exa-js#158](https://github.com/exa-labs/exa-js/issues/158)), so the underlying HTTP request continues until Exa resolves it and Exa still bills for the completed call. The timeout error message states this explicitly.

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

Returns: formatted snippets with optional highlights and metadata (`costDollars`, `searchTime`).

### web_fetch_exa

Params: `urls` (required array), `maxCharacters`, `highlights`, `summary` (`query`), `maxAgeHours`.

### web_search_advanced_exa

Params:

- `query` (required)
- `numResults` (1-100, default 10)
- `category`: one of `company`, `research paper`, `news`, `pdf`, `personal site`, `financial report`, `people`
- `type`: canonical `auto | fast | instant`; legacy `keyword | neural | hybrid` still accepted (Exa's `/search` endpoint continues to accept them). Deep types (`deep-reasoning | deep-lite | deep`) are rejected here — use `web_research_exa` for those.
- Date filters: `startPublishedDate`, `endPublishedDate` (ISO dates).
- Domain filters: `includeDomains`, `excludeDomains`.
- Text filters: `includeText` (single-element array; only return results whose text contains this string, up to 5 words), `excludeText` (single-element array; exclude results whose text contains this string, up to 5 words). The Exa API accepts at most one string per filter.
- `userLocation`: two-letter ISO country code (e.g., `US`, `GB`, `DE`).
- `moderation`: when `true`, filter unsafe content.
- `additionalQueries`: alternative query formulations to broaden coverage.
- `textMaxCharacters`: max chars of page text per result (default 3000).
- `contextMaxCharacters`: max chars for the aggregated context string. Maps to Exa's deprecated `context` option and may be removed in a future Exa API release.
- Highlights: `enableHighlights` (gate), `highlightsMaxCharacters` (preferred), `highlightsNumSentences` (legacy fallback), `highlightsQuery` (overrides the search query for highlight ranking). Providing `highlightsQuery` or `highlightsMaxCharacters` implies `enableHighlights: true`; passing `enableHighlights: false` explicitly always disables highlights.
- Summary: `enableSummary` and/or `summaryQuery` (providing `summaryQuery` implies `enableSummary: true`; passing `enableSummary: false` explicitly always disables the summary).
- Freshness: `maxAgeHours` (0 = always fresh, -1 = cache-only), `livecrawlTimeout` (ms; capped at 60000 = 60s).
- Subpages: `subpages` (1-10), `subpageTarget` (single keyword or list of keywords used to select which subpages to crawl, e.g. `'about'` or `['about', 'pricing']`).

Notes:
- Deep types are rejected here. Use `web_research_exa` for `deep-reasoning`, `deep-lite`, or `deep`.
- Invalid categories return an error instead of silently falling back to an unfiltered search.
- The `company` and `people` categories do not support `startPublishedDate`, `endPublishedDate`, or `excludeDomains`; the `people` category only accepts LinkedIn domains for `includeDomains`. These are enforced pre-flight.
- `startCrawlDate` / `endCrawlDate` are intentionally not exposed — Exa silently ignores them as of 2026-04-15.

### web_research_exa

Params include:

- `query` (required)
- `type`: `deep-reasoning | deep-lite | deep`
- `systemPrompt`
- `outputSchema` (`type` may be `"object"` or `"text"`, default `"text"`; object mode is capped at 10 properties / depth 2 and gives per-field grounding). The default is required for synthesis to run — Exa's `/search` endpoint only returns an `output` field when an `outputSchema` is provided (see issue #115 and the [Search API Reference for Coding Agents](https://docs.exa.ai/reference/search-api-guide-for-coding-agents)).
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

## MCP server

pi-exa also exposes its tool surface as an MCP stdio server, suitable for any MCP-aware host (Claude Desktop, Claude Code, etc.). The server uses the same portable tool implementations as the Pi adapter — only the gating and credential resolution differ.

Run with:

```bash
npx pi-exa
```

### Environment configuration

| Variable             | Effect                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXA_API_KEY`        | Exa API key. Required for retrieval tools; planner tools work without it.                                                                                                       |
| `EXA_ENABLE_ADVANCED`| Truthy (`1` / `true` / `yes`) enables `web_search_advanced_exa`.                                                                                                                |
| `EXA_ENABLE_RESEARCH`| Truthy enables `web_research_exa`.                                                                                                                                              |
| `EXA_ENABLED_TOOLS`  | Comma-separated allowlist. Highest precedence. Empty/whitespace-only values emit a warning and fall through to the per-tool toggle defaults.                                    |
| `EXA_CONFIG_FILE`    | Path to a JSON config file (same shape as the CLI `--exa-config-file`). Use for `apiKey`, `enabledTools`, `advancedEnabled`, `researchEnabled`.                                 |
| `EXA_CONFIG`         | Deprecated alias for `EXA_CONFIG_FILE`. Still read; prefer `EXA_CONFIG_FILE`.                                                                                                   |
| `EXA_TIMEOUT_MS`     | Default per-call timeout in ms for Exa-backed tools. Built-in 60000. Underlying HTTP request continues until Exa resolves it; see [exa-labs/exa-js#158](https://github.com/exa-labs/exa-js/issues/158). |
| `EXA_RESEARCH_TIMEOUT_MS` | Override for `web_research_exa` only. Built-in 180000.                                                                                                                     |

### Precedence

Same rules as the Pi adapter:

1. `EXA_ENABLED_TOOLS` (env) — strict allowlist.
2. `enabledTools` (config file) — strict allowlist; an empty array means "no tools".
3. `EXA_ENABLE_ADVANCED` / `EXA_ENABLE_RESEARCH` (env) or `advancedEnabled` / `researchEnabled` (config file).
4. Default: 8 tools on (4 cheap Exa + 4 planner); `web_search_advanced_exa` and `web_research_exa` hidden.

### Example: Claude Desktop / `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pi-exa": {
      "command": "npx",
      "args": ["-y", "@feniix/pi-exa"],
      "env": {
        "EXA_API_KEY": "your-key",
        "EXA_ENABLE_ADVANCED": "1"
      }
    }
  }
}
```

### Example: generic `mcp.json`

```json
{
  "mcpServers": {
    "pi-exa": {
      "command": "npx",
      "args": ["pi-exa"],
      "env": { "EXA_API_KEY": "your-key" }
    }
  }
}
```

## Notes

- `exa_research_*` planning tools are enabled by default when no explicit `enabledTools` allowlist is configured, local-only, and do not require an Exa API key.
- `web_search_advanced_exa` and `web_research_exa` are opt-in and disabled by default.
- Research/tool output may include both `text` and `details.parsedOutput` depending on `outputSchema.type`.

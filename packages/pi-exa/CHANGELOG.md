# Changelog

All notable changes to `@feniix/pi-exa` are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.1] - 2026-06-15

### Fixed

- **`web_research_exa` returned the canned "no synthesized output was returned" message for every call** (issue #115). The Exa `/search` endpoint only returns an `output` field when an `outputSchema` is provided (per the [Search API Reference for Coding Agents](https://docs.exa.ai/reference/search-api-guide-for-coding-agents): *"When provided, the response includes `output`."*). The previous tool had no default for `outputSchema` and passed `undefined` to `exa.search(...)`, so synthesis was never requested and the canned fallback fired for every deep-type call. The tool now defaults to text-mode synthesis (`{ "type": "text" }`) when the caller omits `outputSchema` or passes a schema without a `type` field. Explicit object-mode `outputSchema` is passed through unchanged and the formatter still surfaces `details.parsedOutput` so callers can consume structured output without re-parsing `result.text`.

### Added

- **Diagnostic context in the `web_research_exa` fallback path.** When the response omits the `output` field, the fallback `details` now include `requestId`, `resultsCount`, `outputSchemaSent`, `responseKeys`, and `kind: "domain"` + `error: "no_synthesized_output"`. The user-facing `text` honestly explains that synthesis was not requested (not that it "failed") and names the two override options. This catches the next silent regression and gives operators a `requestId` to reference in support tickets.
- **`outputSchema: { "type": "text" }` in `exa_research_summary` mode `payload`.** The planner's auto-suggested `web_research_exa` invocation now spells out the synthesis step explicitly, so a user (or LLM) who copies the suggested JSON verbatim does not silently hit the fallback. Aligns with the workaround already documented in `skills/exa-research-planner/SKILL.md` and the four other skills that pass `outputSchema: { "type": "text" }` explicitly.
- **Discoverability for object-mode synthesis.** The TypeBox `outputSchema` schema now carries a description that documents the default, the override, and the 10-property / depth-2 constraint. The `web_research_exa` tool description and `promptGuidelines` likewise document the default and how to override it. The misleading third `promptGuidelines` bullet ("...when a systemPrompt or outputSchema is needed...") was replaced with explicit default/override guidance.

### Changed

- **`web_answer_exa` description clarified** to state that it returns a plain string by default (a `/answer` endpoint default, not a tool behavior change) and that passing `outputSchema` switches to structured output. No runtime change.
- **`web_research_exa` `promptSnippet`** shortened and updated to mention structured output ("Deep research; higher cost/latency. Use `outputSchema: { type: 'object' }` for structured output.") while preserving the cost/latency signal that the cross-tool routing test asserts on.

## [5.0.0] - 2026-05-25

The 5.0 line ports pi-exa onto bridgekit's portable-tool surface and ships a first-class MCP stdio server. The user-visible tool semantics are unchanged for the Pi host, but the error contract, package layout, and runtime requirements all shift.

### Breaking changes

- **Pi `execute()` now throws on tool failure.** Tools previously returned a soft `{ isError: true, ... }` Pi result for missing API keys, validation failures, and SDK errors. Under the bridgekit contract, the Pi adapter rejects with `PortableToolExecutionError` instead. Hosts that rely on `try { await tool.execute(...) }` continue to work; callers that inspected `result.isError` must catch the rejection. The model-visible text is preserved.
- **TypeBox validation failures throw at the validation layer with `kind: "validation"`.** Invalid `outputSchema.type` values, deep search `type` values on `web_search_advanced_exa`, etc., are now rejected pre-execute by bridgekit. The error envelope shape (`details.kind`, `details.tool`) is new.
- **Missing-API-key result shape changed.** The structured payload now carries `{ tool, error: "missing_api_key" }`. The user-facing text ("Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag.") is unchanged.
- **New MCP stdio bin: `pi-exa`.** Previously `bin/pi-exa-mcp.js` shipped under the `pi-exa-mcp` command; the bin file and CLI name are now both `pi-exa`. Update any `npx pi-exa-mcp` invocations to `npx pi-exa`.
- **New `exports` paths.** The package now publishes `./mcp`, `./tools`, `./extensions/*`, and `./extensions/*.js` subpath exports, plus a bare-import `.` entry pointing at the host-neutral portable tools surface (`createExaTools`). The previous flat ESM resolution to `extensions/index.ts` only worked because Pi loaded sources directly.
- **`engines.node` raised to `>=22.19.0`.** Drops Node 20 LTS support. Required for bridgekit's MCP wiring and current TypeBox runtime semantics.
- **`typebox` moved from optional peerDep to direct dep.** Pi-exa now owns its TypeBox version. Hosts that pinned a different range must align.
- **The module-level research-planner facade is gone.** `recordResearchStep`, `getResearchStatus`, `getResearchSummary`, and `resetResearchPlanner` were removed. Construct an instance with `createResearchPlanner()` and call its methods directly.

### Added

- **Per-call timeouts on Exa-backed tools.** Built-in defaults: 60s for `web_search_exa`, `web_fetch_exa`, `web_answer_exa`, `web_find_similar_exa`, `web_search_advanced_exa`; 180s for `web_research_exa` (deep-reasoning legitimately runs longer). Configurable three ways:
  - `ExaToolsOptions.timeouts: ExaToolTimeouts` factory option (programmatic; per-tool override + generic `default`).
  - Pi CLI flags `--exa-timeout-ms` (default for all tools) and `--exa-research-timeout-ms` (override for `web_research_exa`).
  - MCP env vars `EXA_TIMEOUT_MS` and `EXA_RESEARCH_TIMEOUT_MS` with the same semantics.
  - Precedence: per-tool override > generic `default` > built-in.
  - Mid-flight `ctx.signal` abort is now honored too — returns the same soft "Cancelled." shape as the pre-flight signal check. Caveat: `exa-js` does not yet accept `AbortSignal` (see [exa-labs/exa-js#158](https://github.com/exa-labs/exa-js/issues/158)), so the underlying HTTP request keeps running until Exa resolves it; the timeout bounds the JS-side wait, and Exa still bills for the completed call. The timeout error message states this explicitly.
- MCP stdio server at `extensions/mcp-server.ts`, exported via `@feniix/pi-exa/mcp` and runnable as `npx pi-exa`. Supports the same env envelope (`EXA_API_KEY`, `EXA_ENABLE_ADVANCED`, `EXA_ENABLE_RESEARCH`, `EXA_ENABLED_TOOLS`, `EXA_CONFIG_FILE`, `EXA_TIMEOUT_MS`, `EXA_RESEARCH_TIMEOUT_MS`) as the Pi adapter.
- Host-neutral portable tool surface at `extensions/tools.ts` (`createExaTools`).
- Cross-tool routing guidance is now centralised in `extensions/tool-guidance.ts`. The Pi adapter (`promptGuidelines`) and the MCP server (`instructions`) both consume the same source.
- `webFetchParams.urls` now enforces `maxItems: 50` to mirror existing batch-size discipline elsewhere.
- `EXA_ENABLED_TOOLS=""` / `",,,"` (parses to empty) warns and falls back to per-tool toggle defaults rather than silently disabling every tool.
- `packageVersion()` warns when the package.json lookup fails before falling back to `0.0.0`, so operators can spot misconfigured installs.
- Comprehensive README MCP section: env vars, precedence, `claude_desktop_config.json` and generic `mcp.json` snippets.

### Changed

- `validateAdvancedType` removed from `web-search-advanced.ts` — bridgekit validates `type` against the TypeBox schema before `perform*` runs, so the manual deep-type check is unreachable.
- `localToolResult` spreads `{ tool }` last so future planner result fields cannot override the canonical `tool` discriminator on `structuredContent`.
- `extensions/mcp-server.ts` no longer carries a shebang; the executable shebang lives on `bin/pi-exa.js`, matching sibling `pi-code-reasoning`.
- `tsconfig.mcp.json` uses a `extensions/**/*.ts` glob (excluding `extensions/index.ts`, which depends on the Pi peerDep that is unavailable in the MCP build context).
- `EXA_CONFIG` env variable is accepted as a deprecated alias for `EXA_CONFIG_FILE`. Documented in the MCP server header and README.

### Deprecated

- `EXA_CONFIG` env var (use `EXA_CONFIG_FILE`).
- `--exa-config` CLI flag (use `--exa-config-file`).

### Removed

- Module-level planner facade (`recordResearchStep`, `getResearchStatus`, `getResearchSummary`, `resetResearchPlanner`). Use `createResearchPlanner()` instead.
- Internal `defineTool()` wrapper in the Pi adapter — `pi.registerTool` now consumes the registration object directly.

## [4.1.0] - earlier

See git history for the 4.x line.

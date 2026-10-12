# Changelog

All notable changes to `@feniix/pi-exa` are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries before 5.0.0 are reconstructed from package-scoped Git history and npm
publication metadata. Dates are npm publication dates (UTC); early manifest and
publication version mismatches are called out explicitly.

## [Unreleased]

## [6.1.0] - 2026-10-12

Guided background research for Pi. Behind the opt-in `--exa-enable-cycles` flag, a user can ask for research in plain language, approve a readable scope/cost proposal in Pi's own confirmation dialog, keep chatting while the Exa Agent run executes, and get a completion report when it finishes. Standalone, default-opt-out and MCP behavior are unchanged.

### Added

- **Guided research from request to approved submission** (#172). `exa_research_status` `action: "start"` creates a non-spending cycle conversationally; `exa_research_summary` `mode: "proposal"` renders the readable proposal (question, scope and exclusions, criteria, assumptions, source strategy, deliverable, effort, providers, estimate and basis, lifetime allowance, existing liabilities) with a `proposalId` bound to the exact compiled request; `web_research_exa` `researchMode: "submit"` asks the operator through Pi's confirmation dialog and returns the saved Exa run ID while the job is still pending. The approval (lifetime ceiling/scope and one-use exact-request permission) and the frozen attempt are written in one durable transaction; grants merge with, and never lower, a wider ceiling or scope already recorded. Stale proposals, declined/dismissed/timed-out dialogs, headless modes, missing estimates, overspend, conflicting receipts and unassessed unknown liabilities submit nothing. Requests with Exa Connect providers are operator-assessed by command and confirmed by the dialog. An unacknowledged create stays unknown; a genuine late acknowledgement is saved on the original attempt and monitored. Optional exploratory retrieval is disclosed and approved through the same dialog.
- **Background monitoring and completion delivery** (#173). Each approved run gets a host-owned monitor that observes only that run with bounded, non-overlapping GETs (first after 5 s, then ×1.5 backoff up to 60 s with jitter); it pauses after 8 transient failures or 10 minutes of silence, immediately on authentication, not-found or configuration errors, and after 3 hours. Monitoring has no create, retry, replace or cancel authority and runs only while Pi is open. Terminal facts, classified usage and local validation are persisted first; then one completion notice per attempt is claimed and delivered to the originating session through Pi's message queue (`exa-research-completion`) and acknowledged by observing the persisted session entry. Outcomes already reported in a tool result are never notified again.
- **Recovery across interruptions** (#174). Shutdown preserves run IDs, frozen contracts, grants, liabilities, monitor intent and notice state; restart discovers them without taking ownership. An explicit conversational resume reacquires ownership, re-registers paused monitors for the existing run, creates any notice lost to a crash and delivers pending or uncertain notices (re-sent notices are labeled possible duplicates; exactly-once delivery is not claimed). Live runtimes elsewhere are never taken over; dead owners are detected by pid and process start time, so a reused pid does not block recovery. Session switch, fork, tree navigation and archive fence monitoring and delivery; a vetoed switch or fork does not.
- **Durable, opt-in Pi research cycles** behind `--exa-enable-cycles`. Project-isolated private records connect planning, curated evidence, versioned compiled Agent requests (draft-07 task contract, selected evidence kept separate from input/exclusion rows), accounting and results. Operator-issued lifetime ceilings and one-use permissions gate every paid call; unknown liabilities, pending estimates, API-reported receipts and overspend are classified separately, and assistant-supplied flags or amounts never grant consent. Cycle-attributed retrievals capture metadata-only evidence candidates that are selected explicitly. `/exa-research` remains available for start, list, resume, explicit approvals and archive.
- **Explicit recovery, retry and replacement.** `researchMode: "recover"` performs one bounded GET of an existing saved run; `"retry"` and `"replace"` need fresh operator funding (and `approve-replacement` for every unknown original) and dispatch through the same non-blocking path with background monitoring. Genuine completion blocks further submissions; duplicate successes stay visible with their separate costs.
- **Read-only final cycle reports** with recorded criteria, evidence-reference diagnostics, gaps, assumptions, completion facts and classified usage. Generated claims never satisfy criteria automatically.
- **New options:** `--exa-submit-timeout-ms` (create acknowledgement wait, default 30000), `--exa-monitor-interval-ms` (first background check, default 5000) and the `EXA_BASE_URL` environment variable for a self-hosted proxy or endpoint mock (absolute http(s) URL required).
- **Offline qualification** (#171, #175). PRD-010 scenarios 1–36 map to executable evidence, including a production smoke that drives the real extension in a real `pi --mode rpc` process against a controllable mock Exa server, plus a recorded interactive TUI run. Host capability research for Pi 1.1.0 is in `docs/research/2026-10-12-pi-guided-background-host-capabilities.md`.

### Changed

- With an active cycle, `web_research_exa` `researchMode: "active"` (or no mode) returns `GUIDED_SUBMISSION_REQUIRED` instead of blocking; cycle Agent research is dispatched only through `submit`, `retry` or `replace`. Standalone, default-opt-out and MCP `web_research_exa` calls keep their existing blocking behavior.
- Target Pi 1.1.0 (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`).
- Add `ajv` and `ajv-formats` for synchronous local draft-07 task/result validation; validation never fetches remote schemas.
- Estimates and lifetime ceilings are not vendor billing caps, and API-reported costs are not independently verified invoices. Cycle `max`/`ultra` effort and MCP cycle parity remain out of scope.

### Fixed

- **Extension CLI flags are reachable by their documented names.** Pi registers flags by bare name and strips the leading dashes itself, so the `--exa-*` options were only reachable as `----exa-*`. `--exa-api-key`, `--exa-enable-advanced`, `--exa-enable-research`, `--exa-config-file`, `--exa-config`, `--exa-timeout-ms` and `--exa-research-timeout-ms` now parse as documented.
- **Flags now apply to tools registered before Pi applied them.** Timeouts are resolved at call time, tool enablement from `--exa-config-file`, `--exa-enable-advanced` and `--exa-enable-research` is refreshed at session start (newly disabled tools are withdrawn), the four planner tools share one plan, and the `--exa-config` deprecation warning prints once.

### Security

- Durable cycle state stays private and outside git. Automatic retention excludes raw source bodies, full SDK responses, invalid generated output and arbitrary vendor error prose; credential-bearing or signed URLs and Agent path dot segments are rejected. An invalid `EXA_BASE_URL` is never echoed in errors.
- Patch shared transitive dependencies through workspace overrides: `proxy-addr` 2.0.8, `source-map-js` 1.2.2 and `@modelcontextprotocol/sdk` 1.31.0, clearing the recorded advisories without changing the frozen Pi, Exa or bridgekit versions.

## [6.0.2] - 2026-10-06

### Changed

- Align shared CI and release tooling with Pi upstream's Node 22 runtime and typings.
- Validate the extension and MCP build on Node.js 22.19.0 and the latest Node 22; the existing Node.js minimum and Exa runtime behavior are unchanged.

## [6.0.1] - 2026-09-30

### Changed

- Build release artifacts with the repository's pinned pnpm toolchain during prepack. This patch is the release canary for the workspace migration; no Exa runtime behavior changes.

## [6.0.0] - 2026-09-29

### Breaking changes

- **`web_research_exa` now uses Exa Agent Runs.** The tool submits an asynchronous run, polls it to a terminal status, and attempts remote cancellation when the host aborts or the configured research timeout expires after a run ID is known.
- **Agent-native research parameters replace Deep Search parameters.** Removed `type`, `additionalQueries`, `numResults`, `textMaxCharacters`, domain filters, and publication-date filters from `web_research_exa`. Added `effort`, `input`, `previousRunId`, `metadata`, `dataSources`, and `budget`. Filtered retrieval remains available through `web_search_advanced_exa`.
- **Research output metadata now carries the Agent lifecycle.** Successful results include `runId`, terminal `status`, `stopReason`, usage, cost, and run timestamps.
- **Deep Search remains available through `web_search_advanced_exa`.** The advanced tool follows Exa's current `/search` modes (`instant`, `fast`, `auto`, `deep-lite`, `deep`, `deep-reasoning`) and supports `systemPrompt`, `outputSchema`, deep-only `additionalQueries`, and synthesized output.

### Changed

- **`exa-js` upgraded to `^2.19.0`** for the stable `exa.agent.runs` client.
- **Research defaults to `medium` effort and text output.** Object-mode `outputSchema` values are sent to Exa and read from `output.structured`; text mode reads `output.text`.
- **`max` effort opts into Exa's required beta automatically.**
- **`exa-js` lockfile repinned to `2.23.0`.** The declared compatibility range remains `^2.19.0`.

### Fixed

- **Pi startup warning about host-provided TypeBox.** Declared `typebox` as a wildcard peer dependency instead of a runtime dependency, so Pi supplies its own module without installing a duplicate copy.

## [5.1.1] - 2026-07-12

### Changed

- **Workspace patch version bump.** No pi-exa runtime changes from 5.1.0.

## [5.1.0] - 2026-07-12

### Added

- **TUI renderers for all six Exa tools in pi's interactive mode.** `web_search_exa`, `web_fetch_exa`, `web_answer_exa`, `web_find_similar_exa`, `web_research_exa`, and `web_search_advanced_exa` now render compact, collapsible cards instead of raw JSON — a one-line call summary (query/URL/filters) and a collapsed result view (titles + URLs for searches, title + URL for fetches, a short excerpt for answer/research) that expands with `ctrl+o`. The renderers live in `extensions/tui-renderers.ts`, are attached via `hostExtras.pi` in the extension entry point, and are only loaded by the pi host — the MCP server build excludes them and the package `exports` map them to `null`, so MCP consumers never need `@earendil-works/pi-tui`.
- **`@earendil-works/pi-tui` as an optional peer dependency.** Declared `optional` in `peerDependenciesMeta`; only the pi host path requires it.

### Security

- **Terminal escape-sequence injection in the TUI renderers (CWE-150).** Exa result text is built from web-page content (titles, URLs, bodies), which can carry ANSI/OSC escape sequences. The custom renderers replaced pi's default renderer, which strips such sequences (`stripAnsi` + `sanitizeBinaryOutput`), so without neutralization a malicious page could inject escapes to spoof the terminal review surface. The renderers now strip ANSI/OSC sequences and C0/C1/DEL control bytes (preserving tab/newline) from all result text and from untrusted call args before display.

### Fixed

- **Collapsed fetch failures stayed visible.** Non-page `web_fetch_exa` results (missing API key, timeout, cancellation) are preserved in the collapsed view instead of being flattened to a `# (no title)` placeholder.

### Changed

- **`@feniix/bridgekit` bumped `^0.13.0` → `^0.15.0`** for host renderer support.

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

## [5.0.0] - 2026-05-28

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

## [4.1.0] - 2026-05-25

### Added

- Advanced-search schema parity with the Exa API.

### Changed

- Remove `resolvedSearchType` and clarify tool differentiation in the README.

## [4.0.1] - 2026-05-15

### Changed

- Workspace package version bump and documentation of Exa API endpoint findings.

## [4.0.0] - 2026-05-11

### Changed

- Migrate Pi dependencies to the `@earendil-works` namespace.

## [3.5.0] - 2026-05-03

### Added

- Stateful research planner tools (#97).

### Changed

- Consolidate tool execution and strengthen research skills and planner documentation.

## [3.4.2] - 2026-04-27

### Fixed

- Remove noisy session-start auth logging that interfered with Pi's TUI and remove a stale auth import.

## [3.4.1] - 2026-04-22

### Changed

- Migrate schemas to `typebox` for Pi 0.69 compatibility.

## [3.4.0] - 2026-04-22

### Changed

- Version-only publication; the corresponding manifest records 3.4.0 despite the commit subject naming 3.3.2.

## [3.3.2] - 2026-04-22

### Fixed

- Refine Exa skills.

## [3.3.1] - 2026-04-22

### Fixed

- Refine the research planner skill.

## [3.3.0] - 2026-04-22

### Added

- Exa research planner skill.

## [3.2.0] - 2026-04-21

### Fixed

- Address API integration follow-up review feedback and clarify integration documentation.

## [3.1.1] - 2026-04-21

### Changed

- Tighten cross-tool prompt routing and align personal-site-search with find-similar guidance.

## [3.1.0] - 2026-04-21

### Added

- Surface entity properties for category searches.

### Fixed

- Validate category/filter combinations to prevent API 400 errors and cover tool error paths.

## [3.0.0] - 2026-04-20

### Added

- SDK-aligned research, answer, and find-similar tools and gated live integration coverage.

### Changed

- Split the extension into modules, reuse Exa clients across calls, normalize research metadata, improve output formatting, and warn about secrets in settings.

## [2.1.0] - 2026-04-19

### Changed

- Standardize settings and secret handling, rename config path flags/environment variables, drop legacy config fallbacks, and warn when legacy files are ignored.
- Update author/license metadata.

## [2.0.4] - 2026-04-19

### Changed

- Reduce session-start cognitive complexity (#23) and align tests/formatting with package-scoped CI.

## [2.0.3] - 2026-04-17

### Fixed

- Correct test mocks and repository metadata.

## [2.0.2] - 2026-04-16

### Changed

- Improve test coverage; includes the changes prepared under the unpublished 2.0.1 version.

## [2.0.0] - 2026-04-15

### Fixed

- Harden config parsing and normalization.

### Changed

- Align committed package versions with published npm majors after a workspace version reset.

## [1.0.5] - 2026-04-15

### Added

- Check authentication status at session start. npm published this as 1.0.5 although the corresponding Git manifest was prepared as 1.1.0.

## [1.0.4] - 2026-04-07

### Fixed

- Resolve lint issues and type errors.

## [1.0.3] - 2026-04-06

### Changed

- Expand unit and integration test coverage.

## [1.0.2] - 2026-04-06

### Fixed

- Match skill names to directory names and update workspace packaging.

## [1.0.1] - 2026-04-06

### Added

- Declare the skills manifest in package metadata.

## [1.0.0] - 2026-04-06

### Added

- Initial native TypeScript Exa search extension.

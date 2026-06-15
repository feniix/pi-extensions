# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Portable tool

A tool definition that runs in multiple agent host environments (Pi, MCP) via bridgekit's `createExaTools` factory. Each portable tool carries a `description`, a `parameters` schema (TypeBox), and a `perform` function that the host invokes.

*Avoid:* extension, plugin (those mean different things in this project).

The Pi host surfaces `hostExtras.pi.*` fields — `promptSnippet`, `promptGuidelines`, `pendingMessage` — that the MCP host does not consume. Tool behavior is identical across hosts because both run the same `perform` function. Source-of-truth is the `createExaTools` factory in `packages/pi-exa/extensions/tools.ts`; per-host adapters (`extensions/index.ts` for Pi, `extensions/mcp-server.ts` for MCP) just register the returned tools.

## Synthesis

The LLM-generated answer text returned by Exa's deep search types (`deep`, `deep-lite`, `deep-reasoning`) in `output.content`, as distinct from retrieved results (the `results` array). Synthesized answers are always returned alongside per-field `grounding` citations and a list of retrieved source URLs.

*Avoid:* answer (used by Exa's `/answer` endpoint with different semantics — see the `web_answer_exa` tool).

Synthesis requires `outputSchema` to be sent in the request; without it, Exa omits the `output` field entirely and the `web_research_exa` tool returns a diagnostic fallback. This contract is the bug behind issue #115. Default mode is text (`{ type: "text" }`); object mode (`{ type: "object", properties: {...} }`) is an explicit override for structured extraction.

## Research plan

The in-memory state accumulated by `exa_research_step` calls — topic, criteria, sources, gaps, assumptions, branches, and warnings — that `exa_research_summary.mode === "payload"` translates into a suggested `web_research_exa` invocation. The plan is a per-process singleton built by `createResearchPlanner()`; resetting is explicit via `exa_research_reset`.

*Avoid:* research project, research task.

The planner never calls Exa network APIs internally — it only tracks and summarizes planning state, leaving the actual retrieval to an explicit later call (typically `web_research_exa` with the suggested payload, which produces a synthesis).

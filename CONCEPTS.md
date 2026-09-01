# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Portable tool

A tool definition that runs in multiple agent host environments (Pi, MCP) via bridgekit's `createExaTools` factory. Each portable tool carries a `description`, a `parameters` schema (TypeBox), and a `perform` function that the host invokes.

*Avoid:* extension, plugin (those mean different things in this project).

The Pi host surfaces `hostExtras.pi.*` fields — `promptSnippet`, `promptGuidelines`, `pendingMessage` — that the MCP host does not consume. Tool behavior is identical across hosts because both run the same `perform` function. Source-of-truth is the `createExaTools` factory in `packages/pi-exa/extensions/tools.ts`; per-host adapters (`extensions/index.ts` for Pi, `extensions/mcp-server.ts` for MCP) just register the returned tools.

## Synthesis

The evidence-grounded text or structured result produced by an Exa Agent run, as distinct from the individual pages found during ordinary search. A synthesis may be natural-language text or an object shaped by a caller-provided schema, with per-field grounding citations.

*Avoid:* answer (used by Exa's `/answer` endpoint with different semantics — see the `web_answer_exa` tool).

Default mode is text. Object mode is an explicit request for schema-shaped structured extraction.

## Agent run

An asynchronous Exa research job with a stable run ID and a lifecycle of queued, running, completed, failed, or cancelled. The run ID is the handle for polling and remote cancellation.

*Avoid:* search request (ordinary Exa search is synchronous and has no independently managed lifecycle).

## Research plan

The in-memory state accumulated by `exa_research_step` calls — topic, criteria, sources, gaps, assumptions, branches, and warnings — that `exa_research_summary.mode === "payload"` translates into a suggested `web_research_exa` invocation. The plan is a per-process singleton built by `createResearchPlanner()`; resetting is explicit via `exa_research_reset`.

*Avoid:* research project, research task.

The planner never calls Exa network APIs internally — it only tracks and summarizes planning state, leaving the actual retrieval to an explicit later call (typically `web_research_exa` with the suggested payload, which produces a synthesis).

## Agent work journal

The durable source of operational state that lets a frontier-model agent resume work without replaying its narrated reasoning. It contains typed journal entries and compact checkpoints, retrieves only relevant prior state, and flags stale or conflicting records when judgment is required.

*Avoid:* sequential thinking, code reasoning, chain-of-thought store (those describe the predecessor products or imply that internal model reasoning is being captured).

## Journal entry

An append-only agent work journal record with a required operational type and freeform content. Entry types cover observations, evidence, assumptions, decisions, rejected alternatives, validations, and next actions; entries may link to one another with `supersedes` or `alternative-to`.

*Avoid:* thought (a journal entry records durable work state, not a claim about the model's internal cognition).

## Checkpoint

A compact resumable projection of an agent work journal: current objective, work status, settled decisions, open questions, relevant evidence or artifacts, and next action. A checkpoint references its supporting journal entries instead of duplicating the complete history.

*Avoid:* summary (a summary describes accumulated content; a checkpoint is an operational continuation contract).

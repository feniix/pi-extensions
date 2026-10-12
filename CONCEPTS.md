# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Portable tool

A tool definition that runs in multiple agent host environments (Pi, MCP) via bridgekit's `createExaTools` factory. Each portable tool carries a `description`, a `parameters` schema (TypeBox), and a `perform` function that the host invokes.

*Avoid:* extension, plugin (those mean different things in this project).

The Pi host surfaces `hostExtras.pi.*` fields — `promptSnippet`, `promptGuidelines`, `pendingMessage` — that the MCP host does not consume. Standalone behavior shares the portable implementation. Opt-in Pi research cycles add durable ownership, request compilation and spending guards at the host boundary; MCP does not acquire cycle semantics.

## Synthesis

The evidence-grounded text or structured result produced by an Exa Agent run, as distinct from the individual pages found during ordinary search. A synthesis may be natural-language text or an object shaped by a caller-provided schema, with per-field grounding citations.

*Avoid:* answer (used by Exa's `/answer` endpoint with different semantics — see the `web_answer_exa` tool).

Default mode is text. Object mode is an explicit request for schema-shaped structured extraction.

## Agent run

An asynchronous Exa research job with a stable run ID and a lifecycle of queued, running, completed, failed, or cancelled. The run ID is the handle for polling and remote cancellation.

*Avoid:* search request (ordinary Exa search is synchronous and has no independently managed lifecycle).

## Deep Search

A synchronous Exa `/search` request using `deep-lite`, `deep`, or `deep-reasoning`. Deep Search supports search filters, additional query branches, and text or structured synthesis through `web_search_advanced_exa`.

*Avoid:* Agent run. Deep Search has no independently managed run ID, polling lifecycle, continuation, or remote cancellation.

## Research plan

The curated objective, criteria, sources, gaps, assumptions and planning progress accumulated by explicit planning updates. Standalone/default-opt-out/MCP plans are local to a planner instance; an opted-in Pi cycle persists its plan and compiles a versioned execution artifact.

*Avoid:* research project, research task.

The planner never calls Exa network APIs internally — it only tracks and summarizes planning state, leaving the actual retrieval to an explicit later call (typically `web_research_exa` with the suggested payload, which produces a synthesis).

## Research cycle

A research plan together with curated evidence, spending authorization, execution
attempts, results, and liabilities. A cycle targets one successful Agent run;
retrying a confirmed failure does not start a new cycle.

*Avoid:* Agent run (one remote execution, not the planning and approval history).

Its scope and consent are separate from the remote job's lifecycle.

## Recorded gap

A missing-evidence, ambiguity, conflict or scope-boundary record. Its resolution
names a proposed disposition, not a resolved-state flag. Carrying an assumption
or excluding work does not establish the missing fact.

*Avoid:* completed criterion (remote success does not resolve recorded gaps).

## Final cycle report

A read-only projection of recorded criteria, gaps, assumptions, completion facts
and classified usage after remote completion. It distinguishes criteria still
requiring review from recorded support/exclusion without independently verifying
either evidence or billing.

*Avoid:* spending authorization (reporting cannot reopen a completed cycle).

## Evidence candidate

Metadata from a cycle-attributed exploratory retrieval, identified by normalized
source URL and carrying operation-bound provenance and retrieval state. A
candidate is not selected evidence, a processing row, or proof of criterion
coverage. Its durable record does not automatically retain source excerpts.

*Avoid:* verified source (selection and independent verification are separate).

## Selected evidence

A source deliberately chosen for the research brief, with a label and explicit
curated notes. For captured candidates, provenance is frozen at selection;
later candidate discovery does not silently refresh the compiled source context.

*Avoid:* input record (processing rows require explicit `input.data`).

## Execution attempt

A recorded submission intent for an Agent run and its remote or unknown outcome.
An unknown attempt may have incurred spending even without a known run ID.
Remote outcome and local result-processing outcome are separate facts. A local
validation or persistence error does not prove that remote research failed.

*Avoid:* retry (another attempt does not erase the earlier one).

## Completed cycle

A cycle whose Agent run has confirmed remote completion. It stops further
automatic research even when the result leaves gaps or fails local validation.
Completion does not establish criterion coverage or independently verified cost.

*Avoid:* verified answer (completion and evidence quality are separate).

## Spending grant

Operator-issued permission for a cycle's budget and scope, including specifically
named uncertainty or replacement exceptions. Cost evidence is not permission.

*Avoid:* budget argument (an assistant-supplied number is not verified consent).

## Agent work journal

The durable source of operational state that lets a frontier-model agent resume work without replaying its narrated reasoning. It contains typed journal entries and compact checkpoints, retrieves only relevant prior state, and flags stale or conflicting records when judgment is required.

*Avoid:* sequential thinking, code reasoning, chain-of-thought store (those describe the predecessor products or imply that internal model reasoning is being captured).

## Journal entry

An append-only agent work journal record with a required operational type and freeform content. Entry types cover observations, evidence, assumptions, decisions, rejected alternatives, validations, and next actions; entries may link to one another with `supersedes` or `alternative-to`.

*Avoid:* thought (a journal entry records durable work state, not a claim about the model's internal cognition).

## Checkpoint

A compact resumable projection of an agent work journal: current objective, work status, settled decisions, open questions, relevant evidence or artifacts, and next action. A checkpoint references its supporting journal entries instead of duplicating the complete history.

*Avoid:* summary (a summary describes accumulated content; a checkpoint is an operational continuation contract).

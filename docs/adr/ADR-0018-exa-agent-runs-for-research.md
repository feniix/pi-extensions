---
title: "Exa Agent Runs for Research"
adr: ADR-0018
status: Accepted
date: 2026-09-01
decision: "Back web_research_exa with Agent Runs and an Agent-native schema"
---

# ADR-0018: Exa Agent Runs for Research

## Status

Accepted

## Context

`web_research_exa` originally used synchronous `/search` Deep Search modes. That surface produced synthesis, but it offered no run handle for polling or remote cancellation. Exa's Agent API now provides asynchronous runs with terminal statuses, run IDs, structured output, effort tiers, usage/cost metadata, and cancellation.

The Agent request shape differs from Deep Search. Search-specific controls such as `type`, `additionalQueries`, result counts, domain/date filters, and content limits do not map honestly to Agent Runs. Agent-native controls include `effort`, `input`, `previousRunId`, `metadata`, `dataSources`, and `budget`.

## Decision

Keep `web_research_exa` as the dedicated synthesis tool, but back it with Exa Agent Runs:

1. Submit a run, poll it until terminal, and return its run ID and lifecycle metadata.
2. Attempt remote cancellation when the host aborts or the research deadline expires after a run ID is known.
3. Replace the Deep Search parameter schema with the Agent-native schema rather than silently translating or ignoring old fields.
4. Default to `medium` effort and text output. Send object-mode JSON Schema to Exa and read the result from structured output.
5. Keep filtered retrieval in `web_search_advanced_exa`.

`max` effort opts into Exa's required beta token. Metered budgets are accepted only with `auto` or `max`.

## Consequences

### Positive

- Research has a stable run handle, explicit terminal status, usage/cost metadata, and real cancellation.
- Tool parameters match the API that receives them.
- Retrieval and synthesis retain separate, legible tool boundaries.

### Negative

- Existing `web_research_exa` payloads using Deep Search fields fail validation and must migrate.
- Agent effort tiers have a different cost model from Deep Search types.
- The SDK does not expose per-request `AbortSignal`; local waits are bounded, but a timed-out submit that never returned a run ID cannot be cancelled by ID.

## Supersedes

- `ADR-0005` remains the history for choosing a dedicated research tool, but its decision to implement that tool with Deep Search modes is superseded.

---
title: "pi-exa Research Planning Tools"
prd: "PRD-008-pi-exa-research-planning-tools"
date: 2026-05-03
author: "pi"
status: Implemented
---

# Plan: pi-exa Research Planning Tools

## Source

- **Package**: `packages/pi-exa`
- **Prompt**: User wants `packages/pi-exa/skills/exa-research-planner/` to behave more like `packages/pi-sequential-thinking` and `packages/pi-code-reasoning`.
- **Context**: The current Exa research planner is a markdown skill. It can recommend iterative discovery, criteria expansion, paper retrieval, and human-readable planning, but it cannot reliably track state or enforce the process across multiple tool calls.

## Architecture Overview

Add stateful research-planning tools to `packages/pi-exa` that mirror the ergonomics of sequential/code reasoning tools:

- one tool records each research-planning step,
- one tool reports current status,
- one tool summarizes the accumulated plan,
- one tool resets the session.

V1 uses one active in-memory planning session at a time. Planning tools are default-enabled local tools and do not require an Exa API key because they do not perform network calls.

These tools do **not** replace Exa retrieval tools. Instead, they orchestrate how the model should use existing tools such as `web_search_exa`, `web_fetch_exa`, `web_research_exa`, `web_answer_exa`, and `web_find_similar_exa`.

The main shift is from a prompt-only skill to a stateful workflow where the model externalizes:

- autodiscovered search criteria,
- discovery rounds,
- coverage gaps,
- source retrieval status,
- paper-content inspection notes,
- assumptions,
- recommended next actions.

The user-facing draft should remain human-readable. Raw `web_research_exa` payloads are optional implementation details shown after the readable plan or on request.

## Components

### 1. `exa_research_step`

Records one research-planning step and returns updated state plus the recommended next action.

**Purpose**

- Force the model to externalize the research process.
- Track criteria discovery and revisions.
- Track source discovery/fetching and evidence quality.
- Decide whether to search more, fetch sources, ask the user, draft a plan, or execute deep research.

**Key parameters**

| Field | Type | Required | Purpose |
|---|---|---:|---|
| `topic` | string | yes | User-facing research topic or question. |
| `stage` | enum | yes | `framing`, `criteria_discovery`, `cheap_discovery`, `source_retrieval`, `coverage_analysis`, `deep_research_plan`, `synthesis_plan`, `conclusion`. |
| `note` | string | yes | What was learned, decided, or proposed in this step. |
| `criteria` | array | no | Search/evaluation criteria discovered or revised in this step. |
| `sources` | array | no | Source records discovered or fetched in this step. |
| `gaps` | array | no | Missing evidence, ambiguity, conflicts, or user decisions needed. |
| `assumptions` | array | no | Assumptions carried unless corrected. |
| `nextAction` | enum | no | `ask_user`, `web_search_exa`, `web_search_advanced_exa`, `web_fetch_exa`, `web_find_similar_exa`, `web_answer_exa`, `web_research_exa`, `draft_plan`, `finalize`. |
| `nextActionReason` | string | no | Why this is the cheapest useful next move. |
| `thought_number` | integer | yes | Step number, matching sequential-thinking ergonomics. |
| `total_thoughts` | integer | yes | Estimated total steps; can change as scope changes. |
| `next_step_needed` | boolean | yes | Set false only when planning is complete. |
| `is_revision` | boolean | no | Marks a correction to earlier planning. |
| `revises_step` | integer | no | Step number being revised. |
| `branch_from_step` | integer | no | Step number where an alternative strategy branches. |
| `branch_id` | string | no | Identifier for the branch. |

**Return shape**

- current stage and progress,
- criteria coverage matrix,
- source pack summary,
- open gaps,
- recommended next action,
- whether user clarification is warranted,
- concise human-readable plan fragment.

### 2. `exa_research_status`

Returns current planning session state.

Includes:

- topic,
- step count,
- active stage,
- branches,
- criteria coverage summary,
- source pack summary,
- open gaps,
- last recommended next action.

### 3. `exa_research_summary`

Generates a human-readable plan, Source Pack, or optional implementation payload from current state.

| Mode | Output |
|---|---|
| `brief` | Short plan with objective, coverage areas, source strategy, next action. |
| `execution_plan` | Detailed multi-round research plan suitable for user review. |
| `source_pack` | Table of discovered/fetched sources with retrieval status. |
| `payload` | Optional implementation payload for `web_research_exa`, derived from the readable plan. |

Default output must be human-readable. JSON payloads should be labeled **Implementation payload** and shown only after the readable plan or when requested. V1 payload mode generates only `web_research_exa` payloads; search/fetch calls remain plain next-action recommendations.

### 4. `exa_research_reset`

Clears the current planning session.

### 5. Core Data Model

#### Research Criterion

A criterion represents one search/evaluation angle the model discovered.

Fields:

- `id`: stable identifier, e.g. `C1`.
- `label`: short name, e.g. `Force plate validation`.
- `category`: `method`, `metric`, `source_class`, `population`, `market`, `risk`, `contrarian`, `timeframe`, `geography`, `use_case`, `other`.
- `description`: what this criterion covers.
- `priority`: `high`, `medium`, `low`.
- `status`: `proposed`, `searched`, `supported`, `conflicting`, `missing`, `excluded`.
- `evidenceRefs`: source IDs or tool-call notes. Refs must resolve to known sources or explicit tool-call notes before the criterion is counted as covered.

#### Source Record

A source record tracks source retrieval and whether content was actually inspected.

Fields:

- `id`: stable identifier, e.g. `S1`.
- `title`.
- `url`.
- `sourceType`: `paper`, `white_paper`, `pdf`, `official_doc`, `filing`, `news`, `blog`, `github`, `forum`, `analyst_report`, `other`.
- `retrievalStatus`: `discovered_only`, `fetched`, `fetch_failed`, `unavailable`.
- `retrievalEvidence`: optional reference to fetched URL, tool-call/result ID, or other evidence that content was directly inspected.
- `usedFor`: criteria IDs.
- `contentNotes`: methods, claims, data, limitations, or relevant excerpts.
- `qualityNotes`: bias, recency, sample size, vendor framing, peer review status.

#### Gap Record

A gap captures ambiguity or missing evidence.

Fields:

- `id`: stable identifier, e.g. `G1`.
- `description`.
- `severity`: `blocking`, `important`, `minor`.
- `resolution`: `ask_user`, `search_more`, `fetch_source`, `carry_assumption`, `exclude`.

### 6. Planning Loop

The tools should encourage this workflow:

1. **Frame** — record objective and assumptions.
2. **Autodiscover criteria** — infer many possible search angles before deep synthesis.
3. **Broad cheap discovery** — use `web_search_exa` to learn vocabulary, source classes, and named entities.
4. **Revise criteria** — update priorities based on discovery.
5. **Targeted cheap discovery** — use advanced search, similar search, or answer when helpful.
6. **Retrieve sources** — fetch representative URLs, especially papers, white papers, reports, PDFs, standards, and filings.
7. **Analyze coverage** — decide what is covered, missing, contradictory, or out of scope.
8. **Clarify only if needed** — ask one focused user question only when a gap changes objective or criteria.
9. **Produce human-readable plan** — show objective, coverage, source strategy, assumptions, output shape.
10. **Optional payload** — derive `web_research_exa` JSON after the readable plan.
11. **Optional synthesis** — if deep research runs, use fetched source contents as first-class evidence.

### 7. Clarification Policy

Ask the user only when ambiguity materially changes the research.

Ask when:

- several domains require different source strategies,
- evaluation criteria conflict,
- timeframe/geography materially changes results,
- the user must choose between source classes,
- optimization target is unclear.

Do not ask when the ambiguity can be safely carried as an assumption.

### 8. Source Retrieval Policy

For white papers, academic papers, technical reports, standards, filings, or PDFs:

- discover actual paper/report URLs,
- fetch the contents with `web_fetch_exa` when available,
- track retrieval status and retrieval evidence in the Source Pack,
- synthesize from fetched contents, not only from `web_research_exa`,
- mark unfetched items as `discovered_only`,
- prefer directly inspected source text over broader synthesis when they conflict.

## Implementation Order

| Phase | Component | Change | Dependencies | Estimated Scope | Files | Verification |
|---:|---|---|---|---|---|---|
| 1 | Research planner state | Add research planning types and in-memory tracker with one active session and topic-mismatch warnings. | None | Medium | `packages/pi-exa/extensions/research-planner.ts`, `packages/pi-exa/extensions/research-planner-types.ts` | Unit tests for add/reset/status. |
| 2 | Tool registration | Register default-enabled, no-auth `exa_research_step`, `exa_research_status`, `exa_research_summary`, `exa_research_reset`. | Phase 1 | Medium | `packages/pi-exa/extensions/index.ts`, `packages/pi-exa/extensions/schemas.ts` | Extension registration tests. |
| 3 | Coverage model | Implement criteria/source/gap aggregation, evidence-ref validation, and retrieval-evidence flags. | Phase 1 | Medium | `packages/pi-exa/extensions/research-planner.ts` | Tests for coverage and source pack summaries. |
| 4 | Branching model | Add branch/revision validation. | Phase 1 | Small | `packages/pi-exa/extensions/research-planner.ts` | Tests mirroring code-reasoning branch/revision behavior. |
| 5 | Skill integration | Update `exa-research-planner` skill to require the tools. | Phases 2-4 | Small | `packages/pi-exa/skills/exa-research-planner/SKILL.md` | Skill text tests. |
| 6 | Documentation | Document tools in README. | Phases 2-5 | Small | `packages/pi-exa/README.md` | README/package tests. |
| 7 | Quality gate | Run package checks. | All prior phases | Small | N/A | `npx tsc --noEmit --project packages/pi-exa/tsconfig.json`, `npx vitest run packages/pi-exa/__tests__`, `npx biome ci packages/pi-exa`. |

## ADR Index

| ADR | Title | Status | Notes |
|---|---|---|---|
| `docs/adr/ADR-0016-stateful-exa-research-planning-tools.md` | Stateful Exa Research Planning Tools | Proposed | Chooses stateful `exa_research_*` planning tools inside `pi-exa`; planning tools recommend but do not execute Exa retrieval calls. |
| `docs/adr/ADR-0017-in-memory-exa-research-planning-sessions.md` | In-Memory Exa Research Planning Sessions | Proposed | Chooses in-memory planning sessions for the first implementation and defers persistence. |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tool surface area grows too large. | More prompt/tool-selection overhead. | Keep planning tools clearly prefixed with `exa_research_`, default-enabled because they are local-only, and document their orchestration role. |
| Planning tool duplicates existing Exa tools. | Confusing workflow and accidental hidden costs. | Planning tools only recommend next actions; existing Exa tools perform retrieval/synthesis explicitly. |
| State becomes too verbose. | Poor model usability and truncated outputs. | Summaries should compress criteria/source/gap state and support output truncation limits. |
| Model still shows JSON-first drafts. | User experience regresses. | Add tests and skill guidance requiring human-readable summaries before implementation payloads. |
| Paper retrieval creates false confidence when fetch fails. | Weak evidence may be overused. | Track `retrievalStatus`, `retrievalEvidence`, and mark unfetched sources as `discovered_only`. |

## Example Flow

User asks: “Research computer vision jump analysis.”

Expected flow:

1. `exa_research_step(stage: "framing")` records objective and assumptions.
2. `exa_research_step(stage: "criteria_discovery")` proposes criteria: pose method, validation target, metrics, camera setup, population, field deployment, limitations.
3. Model calls `web_search_exa` for broad discovery.
4. `exa_research_step(stage: "cheap_discovery")` records found terms and papers.
5. Model calls `web_fetch_exa` on strongest paper URLs.
6. `exa_research_step(stage: "source_retrieval")` records fetched source contents and Source Pack status.
7. `exa_research_step(stage: "coverage_analysis")` identifies gaps and whether user clarification is needed.
8. `exa_research_summary(mode: "execution_plan")` returns a readable plan.
9. User approves execution or asks for refinements.

## Open Questions

1. **Resolved:** Planning sessions start in-memory, as captured in `docs/adr/ADR-0017-in-memory-exa-research-planning-sessions.md`.
2. Should `exa_research_step` allow arbitrary source metadata, or should source records be strictly typed from day one?
3. **Resolved:** V1 `exa_research_summary(mode: "payload")` generates only `web_research_exa` payloads; recommended search/fetch calls remain plain next-action text.
4. **Resolved:** Research planning tools are default-enabled in V1 because they are local-only and non-cost-incurring; retrieval tools keep existing gating.

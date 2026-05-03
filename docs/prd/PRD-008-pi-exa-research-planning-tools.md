---
title: "pi-exa Research Planning Tools"
prd: PRD-008
status: Draft
owner: "Sebastian Otaegui"
issue: "N/A"
date: 2026-05-03
version: "1.0"
---

# PRD: pi-exa Research Planning Tools

---

## 1. Problem & Context

`packages/pi-exa/skills/exa-research-planner/SKILL.md` currently describes an iterative research workflow, but it is still only prompt guidance. A prompt-only skill cannot reliably enforce or track the behavior the user wants: multi-round criteria discovery, source retrieval, paper-content inspection, gap analysis, human-readable plan drafts, and optional deep-research execution.

This is the same class of problem solved by `packages/pi-sequential-thinking` and `packages/pi-code-reasoning`: stateful tools force the model to externalize each step, track sequence state, branch/revise when scope changes, and produce summaries from accumulated state. `pi-exa` needs a similar stateful workflow for research planning.

The immediate design plan exists at `docs/architecture/plan-pi-exa-research-planning-tools.md`. This PRD formalizes the product requirements that plan should implement.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Stateful research planning** | New planning tools registered and callable | `exa_research_step`, `exa_research_status`, `exa_research_summary`, and `exa_research_reset` are available |
| **Criteria coverage** | Planning state tracks discovered criteria | Criteria records include category, priority, status, and evidence refs |
| **Multi-round discovery** | Tool output recommends next research action | Step results can recommend search, fetch, clarify, draft, execute, or finalize |
| **Source retrieval accountability** | Source Pack tracks retrieval state | Sources distinguish `discovered_only`, `fetched`, `fetch_failed`, and `unavailable` |
| **Human-readable planning** | Summary defaults to readable plan | `exa_research_summary` leads with objective, coverage, source strategy, assumptions, and next action before any payload |
| **Paper-content evidence discipline** | Fetched source contents are tracked separately from synthesized output | Source records can store content notes and quality notes |

**Guardrails (must not regress):**

- Existing web retrieval tools (`web_search_exa`, `web_fetch_exa`, `web_research_exa`, `web_answer_exa`, `web_find_similar_exa`) continue to work unchanged.
- Planning tools do not hide Exa network calls or costs; they recommend next actions, while the model explicitly calls retrieval tools.
- Existing package checks continue to pass.
- `web_research_exa` remains opt-in according to existing config behavior.

---

## 3. Users & Use Cases

### Primary: Research-oriented pi user

> As a pi user, I want the Exa research planner to walk through multi-round discovery and source coverage so that final research is broader, more auditable, and less dependent on one deep-research call.

**Preconditions:** `@feniix/pi-exa` is installed and configured with an Exa API key for retrieval tools that require network access.

### Secondary: LLM using pi-exa skills

> As the model executing an Exa research workflow, I want stateful tools for criteria, sources, gaps, and next actions so that I do not lose track of the plan across multiple searches and fetches.

**Preconditions:** Research planning tools are registered in the current pi session.

### Future: Automation / handoff consumer

> As an automation or downstream agent, I want a structured research plan summary so that I can continue research, review source coverage, or execute the recommended payload later.

---

## 4. Scope

### In scope

1. **Research planning step tool** — record topic, stage, notes, criteria, sources, gaps, assumptions, branch/revision metadata, and recommended next action.
2. **Research planning status tool** — report current session state, criteria coverage, source pack summary, open gaps, branches, and last next action.
3. **Research planning summary tool** — generate human-readable briefs, execution plans, source packs, handoff packets, and optional implementation payloads.
4. **Research planning reset tool** — clear the in-memory planning session.
5. **Criteria model** — track discovered search/evaluation angles and their evidence coverage.
6. **Source model** — track source type, URL, retrieval status, content notes, and quality notes.
7. **Gap model** — track ambiguity, missing evidence, and whether to ask the user, search more, fetch, assume, or exclude.
8. **Skill update** — update `exa-research-planner` to use these tools instead of relying only on prompt instructions.
9. **Tests and docs** — cover tool registration, state tracking, reset, summaries, branch/revision behavior, and README documentation.

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| Persistent research sessions | In-memory state is enough for first implementation and matches `pi-code-reasoning` simplicity | Open question |
| Automatic execution of recommended Exa tool calls | Hidden network calls would obscure cost and user/model control | N/A |
| Full citation manager | Source Pack is sufficient for planning; citation management is a larger product | TBD |
| New Exa API endpoints | This work orchestrates existing tools only | N/A |
| UI rendering beyond normal tool text output | Useful later, not required for behavior | TBD |

### Design for future (build with awareness)

The state model should keep stable IDs for criteria (`C1`), sources (`S1`), and gaps (`G1`) so future import/export, richer UI, or external handoff can reference them without re-parsing prose. The summary mode should be extensible so later modes such as `audit` or `cost_report` can be added without changing step state shape.

---

## 5. Functional Requirements

### FR-1: Record research planning steps

The extension must expose `exa_research_step` to record one step in a stateful research planning session.

**Acceptance criteria:**

```gherkin
Given no research planning session exists
When the model calls exa_research_step with topic "computer vision jump analysis", stage "framing", thought_number 1, total_thoughts 5, and next_step_needed true
Then the tool records the step
And the result includes progress, current stage, open gaps, and recommended next action fields
```

**Files:**

- `packages/pi-exa/extensions/research-planner.ts` — implement in-memory tracker and step handling.
- `packages/pi-exa/extensions/research-planner-types.ts` — define step, criterion, source, gap, summary, and status types.
- `packages/pi-exa/extensions/schemas.ts` — define TypeBox schema for `exa_research_step`.
- `packages/pi-exa/extensions/index.ts` — register the tool.

### FR-2: Track autodiscovered criteria coverage

The planning state must track criteria discovered by the model, including category, priority, status, and evidence references.

**Acceptance criteria:**

```gherkin
Given a research planning session exists
When the model records criteria for "force plate validation" and "camera angle sensitivity"
Then exa_research_status lists both criteria
And each criterion includes category, priority, status, and evidence reference fields when provided
```

**Files:**

- `packages/pi-exa/extensions/research-planner-types.ts` — define `ResearchCriterion`.
- `packages/pi-exa/extensions/research-planner.ts` — aggregate and update criteria across steps.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test criteria aggregation.

### FR-3: Track source pack and retrieval status

The planning state must track discovered/fetched sources and distinguish source retrieval state.

**Acceptance criteria:**

```gherkin
Given a paper-heavy research session exists
When the model records one source with retrievalStatus "discovered_only" and another with retrievalStatus "fetched"
Then exa_research_summary with mode "source_pack" shows both sources
And the fetched source is distinguishable from the discovered-only source
```

**Files:**

- `packages/pi-exa/extensions/research-planner-types.ts` — define `ResearchSource`.
- `packages/pi-exa/extensions/research-planner.ts` — aggregate source records and source pack output.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test source pack summaries.

### FR-4: Track gaps and clarification policy

The planning state must track gaps and indicate when user clarification is warranted.

**Acceptance criteria:**

```gherkin
Given a research planning session has a gap with severity "blocking" and resolution "ask_user"
When the model calls exa_research_status
Then the result identifies that user clarification is warranted
And the status includes the blocking gap description
```

**Files:**

- `packages/pi-exa/extensions/research-planner-types.ts` — define `ResearchGap`.
- `packages/pi-exa/extensions/research-planner.ts` — compute clarification recommendation.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test gap behavior.

### FR-5: Support branch and revision metadata

The planning step tool must support revision and branching metadata similar to `pi-code-reasoning`.

**Acceptance criteria:**

```gherkin
Given a research planning session has two recorded steps
When the model records a third step with is_revision true and revises_step 1
Then the step is accepted and marked as a revision
When the model records a branch with branch_from_step 2 and branch_id "paper-first"
Then exa_research_status lists the "paper-first" branch
```

**Files:**

- `packages/pi-exa/extensions/research-planner.ts` — validate revision and branch references.
- `packages/pi-exa/extensions/schemas.ts` — include branch/revision fields.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test branch/revision flows.

### FR-6: Generate human-readable summaries before payloads

`exa_research_summary` must default to human-readable plans. Raw JSON payloads are optional and labeled as implementation payloads.

**Acceptance criteria:**

```gherkin
Given a research planning session has objective, criteria, source strategy, and assumptions
When the model calls exa_research_summary with mode "execution_plan"
Then the output starts with a human-readable research objective and coverage plan
And raw web_research_exa JSON is absent unless mode "payload" is requested
```

**Files:**

- `packages/pi-exa/extensions/research-planner.ts` — implement summary modes.
- `packages/pi-exa/extensions/schemas.ts` — define summary mode schema.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test human-readable output ordering.

### FR-7: Reset research planning state

The extension must expose `exa_research_reset` to clear state.

**Acceptance criteria:**

```gherkin
Given a research planning session has recorded steps, criteria, sources, and gaps
When the model calls exa_research_reset
Then exa_research_status reports zero steps and no active topic
```

**Files:**

- `packages/pi-exa/extensions/research-planner.ts` — implement reset.
- `packages/pi-exa/extensions/index.ts` — register reset tool.
- `packages/pi-exa/__tests__/research-planner.test.ts` — test reset.

### FR-8: Update skill and README guidance

The Exa research planner skill and README must document the new stateful workflow.

**Acceptance criteria:**

```gherkin
Given the package documentation is updated
When a reader opens packages/pi-exa/skills/exa-research-planner/SKILL.md
Then it instructs the model to use exa_research_step for iterative planning
And packages/pi-exa/README.md lists the research planning tools
```

**Files:**

- `packages/pi-exa/skills/exa-research-planner/SKILL.md` — require stateful planning tools.
- `packages/pi-exa/README.md` — document tools and intended workflow.
- `packages/pi-exa/__tests__/index.test.ts` — test docs/skill references.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Cost transparency** | Planning tools must not call Exa network APIs internally. They recommend explicit existing Exa tool calls. |
| **Output quality** | Summaries must lead with human-readable plans, not raw JSON payloads. |
| **Type safety** | Tool schemas must avoid `Type.Unknown()` and use typed objects or flexible object schemas with `additionalProperties`. |
| **Performance** | In-memory operations should be fast enough to add/status/summarize sessions with at least 50 steps, 100 criteria, and 100 sources. |
| **Testability** | State aggregation, reset, branch/revision validation, and summary output must be unit-testable without Exa network access. |
| **Compatibility** | Existing Exa tools and config behavior must remain backward compatible. |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Tool surface area becomes confusing | Medium | Medium | Prefix planning tools with `exa_research_` and document their orchestration role separately from web retrieval tools. |
| The model still skips planning tools | Medium | Medium | Update `exa-research-planner` skill and prompt guidance to require tool use for non-trivial research. |
| State output becomes too verbose | Medium | Medium | Add concise status/summary formats and reuse package output truncation patterns if needed. |
| Planning tools are mistaken for retrieval tools | Low | Medium | Make descriptions explicit: planning tools do not perform network search. |
| Source Pack gives false confidence for unfetched papers | High | Medium | Track retrieval status and require summaries to label `discovered_only` sources clearly. |

### Assumptions

- In-memory state is acceptable for the first implementation.
- Existing Exa tools remain responsible for network calls and cost-incurring operations.
- Research planning state belongs in `packages/pi-exa` rather than a new package because it is Exa-specific and tied to Exa tool workflows.
- Human-readable plans are more useful to users than raw `web_research_exa` payloads, but payloads remain useful as optional implementation detail.

---

## 8. Design Decisions

### D1: Stateful tools instead of prompt-only skill

**Options considered:**

1. Keep improving `SKILL.md` only — low implementation cost, but behavior remains unreliable and untracked.
2. Add stateful planning tools — more implementation work, but mirrors successful `pi-sequential-thinking` / `pi-code-reasoning` patterns.

**Decision:** Add stateful planning tools.

**Rationale:** The desired workflow depends on accumulated state: criteria, discoveries, fetched sources, gaps, assumptions, branches, and revisions. A prompt-only skill cannot reliably preserve or expose that state.

**Future path:** The tool state can later support import/export, richer UI, or automated handoff.

### D2: Planning tools recommend, but do not execute, Exa searches

**Options considered:**

1. Planning tools auto-call Exa retrieval tools — convenient, but hides network cost and blends orchestration with retrieval.
2. Planning tools recommend next actions — explicit, auditable, and consistent with existing tool boundaries.

**Decision:** Planning tools recommend next tool calls; the model explicitly calls existing Exa tools.

**Rationale:** `web_research_exa` is intentionally cost/latency transparent. Keeping retrieval calls explicit preserves that design.

### D3: Human-readable summaries before implementation payloads

**Options considered:**

1. Show raw JSON payloads by default — precise for tools, but poor for user review.
2. Show readable plans first and payloads only as optional implementation details — better for user decisions.

**Decision:** Human-readable summaries first.

**Rationale:** Users need to review scope, criteria, source strategy, and assumptions. JSON payloads are derived implementation details.

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `packages/pi-exa/extensions/research-planner-types.ts` | New | FR-1, FR-2, FR-3, FR-4, FR-5 | Types for steps, criteria, sources, gaps, summary state, and branch/revision metadata. |
| `packages/pi-exa/extensions/research-planner.ts` | New | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7 | In-memory tracker, aggregation, validation, status, summary, reset. |
| `packages/pi-exa/extensions/schemas.ts` | Modify | FR-1, FR-5, FR-6, FR-7 | TypeBox schemas for new tools. |
| `packages/pi-exa/extensions/index.ts` | Modify | FR-1, FR-6, FR-7 | Register planning tools and wire handlers. |
| `packages/pi-exa/skills/exa-research-planner/SKILL.md` | Modify | FR-8 | Require stateful tools for non-trivial research planning. |
| `packages/pi-exa/README.md` | Modify | FR-8 | Document research planning tools and workflow. |
| `packages/pi-exa/__tests__/research-planner.test.ts` | New | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7 | Focused unit coverage for planner state and summaries. |
| `packages/pi-exa/__tests__/extension.test.ts` | Modify | FR-1, FR-6, FR-7 | Tool registration and execute behavior coverage. |
| `packages/pi-exa/__tests__/index.test.ts` | Modify | FR-8 | README/skill reference tests. |

---

## 10. Dependencies & Constraints

- Must follow existing TypeScript, Biome, and Vitest conventions in this repo.
- Must not introduce divergent package-specific TypeScript compiler options.
- Must avoid `Type.Unknown()` in tool schemas.
- Should follow state/truncation patterns from `packages/pi-code-reasoning` and `packages/pi-sequential-thinking` where appropriate.
- Must keep existing Exa API key/config behavior unchanged.

---

## 11. Rollout Plan

1. Implement planner state and tests behind new tool names.
2. Register tools and verify default package behavior.
3. Update `exa-research-planner` skill to route non-trivial workflows through the stateful tools.
4. Update README and skill tests.
5. Run package checks.
6. Optionally create an ADR for the stateful-tool decision before or during implementation.

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Should research planning sessions persist to disk or stay in-memory initially? | Sebastian | Before implementation | Open |
| Q2 | Should planning tools be enabled by default or gated behind config? | Sebastian | Before implementation | Open |
| Q3 | Should `exa_research_summary(mode: "payload")` generate only `web_research_exa` payloads or also suggested search/fetch calls? | Sebastian | During implementation | Open |
| Q4 | Should this require an ADR before implementation? | Sebastian | Before implementation | Open |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| `docs/architecture/plan-pi-exa-research-planning-tools.md` | Initial architecture plan for this PRD |
| `docs/adr/ADR-0005-exa-deep-search-tool-strategy.md` | Existing decision that deep synthesis stays in `web_research_exa` |
| `packages/pi-sequential-thinking` | Pattern source for staged stateful thinking tools |
| `packages/pi-code-reasoning` | Pattern source for branch/revision process tools |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-05-03 | Initial draft | pi |

---

## 15. Verification (Appendix)

Post-implementation checks:

1. Start a planning session for “computer vision jump analysis” and confirm `exa_research_step` records criteria before any deep research payload is shown.
2. Run broad discovery with `web_search_exa`, then record updated criteria and sources with `exa_research_step`.
3. Fetch a paper URL with `web_fetch_exa`, then record it as `retrievalStatus: "fetched"` and confirm `exa_research_summary(mode: "source_pack")` shows it.
4. Record a blocking gap with `resolution: "ask_user"` and confirm status recommends user clarification.
5. Generate `exa_research_summary(mode: "execution_plan")` and confirm it is human-readable and does not lead with JSON.
6. Generate `exa_research_summary(mode: "payload")` and confirm the implementation payload derives from the recorded criteria and source strategy.

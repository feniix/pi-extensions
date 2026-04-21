---
description: "End-to-end initiative planning — assess feasibility, decompose into workstreams, produce PRDs/ADRs/plans"
---

# /architect

Assess a feature or initiative end-to-end: evaluate technical feasibility, decompose into workstreams, and produce the right specification artifacts (PRDs, ADRs, implementation plans) in coordinated sequence.

**Input**: $@

## Role

Act as a **Product Architect** — a senior technical IC who bridges business strategy and engineering execution. Combine the strategic thinking of a Technical Product Manager with the architectural depth of a Staff Engineer.

The goal is to take an ambiguous or complex feature request and produce a clear, actionable plan the team can execute against.

## Tool Strategy

Use direct repository evidence first, then external research only when it materially improves the assessment.

- **Built-in file and search tools** — primary tools for codebase investigation:
  - `read` — inspect docs, configs, and source files
  - `bash` — use `find`, `rg`, and directory listing to map the project structure and locate relevant references
- **exa** (`web_search_exa`, `web_search_advanced_exa`, and `web_fetch_exa` when reading a found page matters) — web research on technology claims, implementation examples, and supporting documentation.
- **ref** (`ref_search_documentation`, `ref_read_url`) — verify referenced standards, specifications, and library documentation.
- **sequential-thinking** (`process_thought`, `generate_summary`, `clear_history`) — work through the assessment systematically.

## Process

### 1. Understand the Request

Clarify with the user before proceeding:

**Must establish:**
- Business objective — what and why now
- Success criteria — how will we know this worked
- Constraints — timeline, team size, tech stack boundaries

**Ask if unclear:**
- Stakeholders and decision-makers
- Scope boundaries — anything explicitly out of scope
- Related ongoing work or past attempts

If a GitHub issue was provided, read it thoroughly (body + comments) — it often contains context the user didn't mention verbally.

### 2. Explore the Codebase

Use `read` and `bash` to understand the current state before proposing anything:

1. **Orient** — inspect key directories, docs, and configs to map the architecture
2. **Trace** — read the most relevant files and search for references to understand the blast radius
3. **Search** — use `rg` and directory listing to find similar implementations, existing patterns, or configuration

Use **exa** and **ref** for external research when evaluating technology choices or comparing approaches.

Don't propose what to build until you know what exists.

### 3. Assess & Decompose

Present a **structured assessment** to the user for approval before producing artifacts:

| Section | Content |
|---------|---------|
| **Feasibility Verdict** | Viable? Confidence level? Key unknowns? |
| **Workstream Breakdown** | Logical phases or workstreams with brief descriptions |
| **Artifact Map** | For each workstream: PRD needed? ADR needed? Implementation plan? Just a ticket? |
| **Risk Register** | Severity, likelihood, concrete mitigation per risk |
| **Dependency Graph** | What blocks what, what can be parallelized |
| **Open Questions** | What needs resolution, with suggested owners |

**Wait for user confirmation before proceeding to artifact production.** The user may want to adjust scope, reorder priorities, or skip certain workstreams.

### 4. Produce Artifacts

After user approval, produce artifacts in this order:

1. **PRDs first** — for workstreams that need requirements definition
   - Follow the PRD template from the `prd` skill
   - Store at `docs/prd/PRD-NNN-slug.md`
   - Use the numbering convention from the prd skill

2. **ADRs next** — for decisions that pass the 4-point test:
   - Multiple approaches — 2+ viable solutions exist
   - Lasting consequences — effects beyond the current sprint
   - Disagreement potential — a reasonable engineer might prefer differently
   - Future constraints — the decision limits or shapes future work
   - Follow the ADR template from the `adr` skill
   - Store at `docs/adr/ADR-NNNN-slug.md`

3. **Suggest implementation plans** — for complex workstreams, tell the user they can run `/plan-prd` on completed PRDs

Cross-reference between all artifacts. PRDs should reference relevant ADRs. ADRs should link back to the PRD that motivated them.

After saving each artifact:
- run `specdocs-validate` so structural/frontmatter issues are surfaced immediately
- if formatting cleanup is needed, run `specdocs-format <path>` explicitly on that artifact before moving on

**Checkpoint after each artifact** — briefly confirm with the user before moving to the next one. Don't produce everything in a single uninterruptible run.

### 5. Present the Roadmap

Summarize:
- Table of all artifacts produced with file paths
- Recommended execution order with rationale
- Open questions that need human decision-making (flag prominently)
- Concrete next steps

## Quality Standards

- **Concrete over abstract** — File paths, not "the auth module." Specific metrics, not "improve performance."
- **Honest about unknowns** — Mark confidence levels. Flag assumptions explicitly.
- **Right-sized artifacts** — A simple feature doesn't need three ADRs. A massive initiative shouldn't be one PRD. Match documentation to complexity.
- **Opinionated but transparent** — Make recommendations. Show what you considered and why. Let the team disagree with reasoning, not guess at it.
- **Codebase-grounded** — Every recommendation informed by what actually exists, not assumptions.

## When NOT to use this command

- **Single PRD** — use the `prd` skill directly (it auto-triggers)
- **Single ADR** — use the `adr` skill directly (it auto-triggers)
- **Implementation plan from existing PRD** — use `/plan-prd`

This command is for initiative-level work that spans multiple artifacts and needs orchestration.

---
title: "pi-specdocs in-process markdown linting and formatting"
prd: "PRD-004-pi-specdocs-in-process-markdown-linting"
date: 2026-04-21
author: "Pi"
status: Draft
---

# Plan: pi-specdocs in-process markdown linting and formatting

## Source

- **PRD**: `docs/prd/PRD-004-pi-specdocs-in-process-markdown-linting.md`
- **Date**: 2026-04-21
- **Author**: Pi

## Architecture Overview

This work should reshape `@feniix/pi-specdocs` around a two-layer document pipeline: a shared in-process parsing layer that produces structured document data for spec artifacts, and a specdocs-specific semantic layer that validates and formats PRDs, ADRs, and plans using repository rules. That architecture is already directionally established by the PRD and the existing ADRs: use a unified/remark-style parser pipeline for Markdown structure (`ADR-0008`), keep repo-specific rules separate from parser infrastructure (`ADR-0009`), and expose formatting only through an explicit `specdocs-format` command in the first release (`ADR-0010`).

In the current codebase, the validation path is split across `extensions/frontmatter.ts`, `extensions/spec-validation.ts`, `extensions/runtime.ts`, and `extensions/workspace-scan.ts`, with most logic built on manual line parsing and filename checks. The implementation should preserve the existing extension shape rather than introducing a new subsystem: `frontmatter.ts` becomes the parser and normalization entry point, `spec-validation.ts` becomes the semantic rule engine, `runtime.ts` remains the orchestrator for post-tool linting and commands, and `workspace-scan.ts` continues to handle lightweight workspace summaries and tracker config behavior. The key change is that those modules should stop reasoning from raw strings and instead operate on a stable parsed document representation.

The safest delivery path is to build the parser-backed model first, then migrate validation in layers, then add formatting last. Validation touches session-start summaries, `tool_result` notifications, and workspace-wide command output, so the plan favors sequencing that keeps each stage testable and shippable. The formatter should be intentionally narrow in scope and reuse the same parsed representation so that rewrite safety, no-op detection, and future extensibility all rest on the same document model instead of a second formatting-only implementation.

## Components

### 1. Parser and Document Model

**Purpose**: Replace lightweight string parsing with a shared, in-process representation for YAML frontmatter, headings, and GFM tables.

**Key Details**:
- Introduce runtime dependencies in `packages/pi-specdocs/package.json` for a unified/remark-based Markdown pipeline and YAML frontmatter handling, per `ADR-0008`.
- Refactor `packages/pi-specdocs/extensions/frontmatter.ts` from a file-level string helper into parser-backed helpers that can return:
  - parsed frontmatter fields
  - parse errors distinct from missing fields
  - heading inventory
  - discovered tables and section anchors
  - normalized frontmatter serialization for formatting
- Keep `.claude/tracker.md` parsing stable for `packages/pi-specdocs/extensions/workspace-scan.ts`; if the full parser is too heavy for config reads, keep config parsing on a dedicated helper path instead of forcing tracker files through the spec document pipeline.
- Define a stable internal shape such as `ParsedSpecDocument` so semantic rules do not depend directly on raw parser nodes.
- Ensure that representation can associate multiple tables with a single section so required-table validation remains correct when documents include auxiliary tables alongside required ones.

**ADR Reference**: -> `ADR-0008-specdocs-parser-pipeline-strategy.md`; -> `ADR-0009-specdocs-validation-layering-strategy.md`

### 2. Semantic Validation Layer

**Purpose**: Apply specdocs-specific rules for frontmatter, filename alignment, required sections, and required tables on top of parsed document data.

**Key Details**:
- Expand `packages/pi-specdocs/extensions/spec-validation.ts` from PRD/ADR frontmatter-only checks into a multi-document validator for PRDs, ADRs, and plans.
- Separate concerns inside the validator:
  - document classification (`PRD`, `ADR`, `Plan`)
  - schema-backed frontmatter validation
  - filename/number alignment, duplicate-number detection, and numbering-gap checks
  - required heading checks
  - required table-shape checks
  - severity mapping for error vs warning, especially for first-release plan sections
- Preserve current repo-specific checks already relied on in tests and runtime notifications: required fields, valid status values, number formatting, filename matching, and workspace-level numbering integrity.
- Add plan-specific rules for `docs/architecture/plan-*.md`, canonical plan `prd` slug validation (`PRD-NNN-descriptive-slug`), and direct-child filename enforcement for other markdown files in `docs/architecture/`.

**ADR Reference**: -> `ADR-0009-specdocs-validation-layering-strategy.md`

### 3. Runtime and Command Integration

**Purpose**: Keep the extension UX intact while broadening validation and adding explicit formatting.

**Key Details**:
- `packages/pi-specdocs/extensions/runtime.ts` remains the orchestration layer for:
  - post-tool linting on `write` and `edit`
  - workspace-wide `specdocs-validate`
  - new `specdocs-format <path>` execution
- Post-tool behavior should stay lint-only, but now include supported plan documents in addition to PRDs and ADRs, per `ADR-0010`.
- Validation output should become richer and more structured, grouped by file when possible, while still surfacing the affected rule type and section/table when applicable.
- Command-path validation and formatting should share the same detection logic so unsupported paths, malformed docs, and no-op results behave consistently.

**ADR Reference**: -> `ADR-0010-specdocs-formatting-activation-model.md`

### 4. Formatting and Normalization Engine

**Purpose**: Provide deterministic, in-process formatting for supported spec docs without changing semantics.

**Key Details**:
- Formatting should be implemented as a thin transformation layer over the parsed document model rather than a separate regex-based formatter.
- The first release should support only the PRD-defined normalization scope:
  - frontmatter fence normalization
  - blank-line normalization around frontmatter and top-level sections
  - table padding/alignment and surrounding blank lines
  - preservation of thematic breaks rather than insertion/removal
  - preservation of common GFM constructs such as task lists and strikethrough while whitespace is normalized
- `specdocs-format <path>` should validate target eligibility before writing and must fail safely on unsupported paths, missing files, or documents that cannot be normalized confidently.
- Formatter results should distinguish between rewritten files and explicit no-op outcomes.

**ADR Reference**: -> `ADR-0010-specdocs-formatting-activation-model.md`

### 5. Workspace Scan and Summary Compatibility

**Purpose**: Preserve fast session-start summaries and tracker-aware behavior while the parser and validators change underneath.

**Key Details**:
- `packages/pi-specdocs/extensions/workspace-scan.ts` should continue to scan `docs/prd`, `docs/adr`, and `docs/architecture` using the current file-pattern approach.
- Existing summary behavior for draft PRDs and proposed ADRs should remain readable and resilient when directories are absent.
- Any new plan filename enforcement should apply in workspace validation, but should not degrade session-start summary output or make empty workspaces noisy.
- Performance-sensitive paths should avoid repeated full AST parsing when a lighter read is sufficient for a summary.

**ADR Reference**: None — straightforward compatibility work

### 6. Test and Documentation Updates

**Purpose**: Land the parser migration safely using test-first changes and keep the package documentation aligned with the new command surface.

**Key Details**:
- Extend `packages/pi-specdocs/__tests__/spec-validation.test.ts` for schema-backed frontmatter parse failures, missing sections, required tables, and per-document plan validation.
- Add new coverage in `packages/pi-specdocs/__tests__/runtime.test.ts` for richer runtime reporting, duplicate-number collisions, plan file linting, canonical plan `prd` slug validation surfaced through workspace/runtime flows, and `specdocs-format` command behavior.
- Extend `packages/pi-specdocs/__tests__/scanner.test.ts` so parser/frontmatter refactors do not break workspace scanning or tracker summaries.
- Add or update `packages/pi-specdocs/__tests__/index.test.ts` coverage to verify registration of `specdocs-format`.
- Update `packages/pi-specdocs/README.md` to describe validation coverage and explicit formatting usage.

**ADR Reference**: None — execution support work

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope |
|-------|-----------|-------------|-----------------|
| 1 | Validation contract tests | None | M |
| 2 | Parser and document model | Phase 1 | L |
| 3 | Frontmatter/schema migration for PRD and ADR validation | Phase 2 | M |
| 4 | Plan detection and workspace filename enforcement | Phase 3 | M |
| 5 | Required heading and required table validation | Phase 2, 3, 4 | L |
| 6 | Runtime reporting integration for single-file and workspace validation | Phase 3, 4, 5 | M |
| 7 | Explicit `specdocs-format <path>` command and normalization engine | Phase 2, 6 | L |
| 8 | README polish and final regression pass | Phase 6, 7 | S |

### Phase details and sequencing rationale

**Phase 1 — Validation contract tests**
- Update tests first to encode the new expected behavior from the PRD.
- Focus on failing tests for:
  - YAML parse failures vs missing fields
  - duplicate PRD/ADR number collisions in workspace validation
  - plan inclusion in workspace validation
  - canonical plan `prd` slug validation
  - required section detection
  - required table-shape checks
  - filename enforcement in `docs/architecture/`
  - `specdocs-format` registration and command behavior
- Outcome: a concrete safety net that allows the parser migration without losing existing repo rules.

**Phase 2 — Parser and document model**
- Add parser dependencies and build the shared parsed representation in `frontmatter.ts` or a closely-related helper module.
- Preserve or explicitly split tracker/config parsing so `workspace-scan.ts` does not regress.
- Outcome: one source of truth for structured document access.

**Phase 3 — Frontmatter/schema migration for PRD and ADR validation**
- Move existing PRD and ADR validation from manual frontmatter handling to typed validation on parsed data.
- Preserve number-format, filename-alignment, and status checks while improving parse-error reporting.
- Outcome: existing document types work on the new pipeline before new rule families are added.

**Phase 4 — Plan detection and workspace filename enforcement**
- Add plan classification for `docs/architecture/plan-*.md`.
- Update workspace validation to flag direct-child markdown files in `docs/architecture/` that are not named `plan-*.md`.
- Add canonical plan `prd` slug validation so plan frontmatter must use the required `PRD-NNN-descriptive-slug` format.
- Outcome: plan artifacts enter the validation model with naming and source-PRD reference integrity established before broader structural rules land.

**Phase 5 — Required heading and required table validation**
- Implement heading inventories and section matching for PRDs, ADRs, and plans.
- Implement minimum-column-set table validation for the required PRD and plan tables identified in the PRD.
- Add severity handling so first-release plan sections can produce warnings where specified.
- Outcome: full structural validation beyond frontmatter.

**Phase 6 — Runtime reporting integration**
- Update `runtime.ts` so post-tool linting and `specdocs-validate` both surface richer validation results.
- Ensure messages remain concise, grouped, and actionable instead of exposing parser internals.
- Outcome: end-user behavior matches the expanded validator.

**Phase 7 — Explicit formatting command and normalization engine**
- Register `specdocs-format` in `index.ts` and add/update `index.test.ts` to verify command registration.
- Implement target-path validation, normalization, safe rewrite, and no-op reporting in `runtime.ts` plus parser-backed serialization helpers.
- Reuse the parser-backed document model from Phase 2 to avoid divergent formatting logic.
- Outcome: first-release formatting ships without touching the post-tool lint flow.

**Phase 8 — README and regression pass**
- Update package docs.
- Run repo/package checks and verify the full `docs/` tree does not emit unexpected issues.
- Outcome: implementation is releasable and user-facing guidance matches behavior.

## Dependencies

### Code dependencies

- `packages/pi-specdocs/package.json` must add production runtime dependencies for Markdown parsing, GFM table support, and YAML/frontmatter handling.
- `packages/pi-specdocs/extensions/frontmatter.ts` is a hard dependency for both validation and formatting work.
- `packages/pi-specdocs/extensions/spec-validation.ts` depends on the shared parsed document model before structural rules are added.
- `packages/pi-specdocs/extensions/runtime.ts` depends on the validator shape stabilizing before richer notifications and formatting command output are wired.
- `packages/pi-specdocs/extensions/workspace-scan.ts` depends on preserving lightweight config parsing behavior during the parser migration.

### Execution dependencies

- Phase 3 should not start until Phase 2 defines a stable parsed representation, otherwise semantic rules will couple directly to parser nodes.
- Phase 5 should wait until plan classification exists, otherwise required heading/table logic will need rework once plan rules are added.
- Phase 7 depends on Phase 2 because formatting should share the same parsing model; building formatting first would create duplicated or divergent logic.
- README updates should wait until the command names and output behavior are stable.

### Parallelizable work

- Once Phase 2 lands, PRD/ADR schema migration and some test-fixture authoring can proceed in parallel.
- After Phase 4 lands, required heading checks and required table checks can be implemented as separate validator passes if they share the same parsed document interface.
- README updates and fixture cleanup can proceed in parallel with late-stage regression testing.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Parser migration breaks current summary/config behavior in `workspace-scan.ts` or `.claude/tracker.md` parsing | Medium | High | Keep tracker parsing isolated if necessary; add scanner tests before migration and verify session-start output after the refactor |
| Validation logic couples too tightly to raw parser nodes, making future parser changes expensive | Medium | Medium | Introduce a stable parsed-document adapter in Phase 2 and keep semantic rules in `spec-validation.ts` working against that interface rather than raw AST nodes |
| Plan validation expands scope too early and blocks delivery of the parser-backed PRD/ADR improvements | Medium | Medium | Sequence plan support after PRD/ADR schema migration; treat plan rules as a dedicated phase rather than mixing all document types into the first parser change |
| Table validation becomes brittle because section lookup and table association are implemented heuristically | Medium | High | Use heading-scoped table discovery in the shared document model and validate minimum required columns rather than exact full-table reproduction |
| Formatter rewrites documents in surprising ways or cannot guarantee safe normalization on malformed files | Medium | High | Keep first-release formatting intentionally narrow, preserve semantic text, reject unsafe rewrites, and ship only behind the explicit `specdocs-format` command per ADR-0010 |
| Validation/reporting becomes noisy once section and table checks are added | Medium | Medium | Group issues by file and severity, use warnings for lower-priority first-release plan sections, and keep command/runtime messaging focused on actionable rule failures |
| PRD and implementation plan drift causes engineers to miss newly added validation rules such as duplicate-number checks or canonical plan `prd` validation | Medium | Medium | Sync the plan whenever PRD validation scope changes, and encode the latest requirements in Phase 1 contract tests before implementation proceeds |
| New runtime dependencies slow post-edit validation beyond the PRD targets | Low | Medium | Parse once per file, avoid repeated work in summary paths, and confirm representative performance during the final regression pass |

## Open Questions

- Should parsed document helpers live entirely inside `frontmatter.ts`, or should the package introduce a new parser-focused helper module to keep responsibilities clearer while preserving the public surface?
- How strict should first-release table association be when multiple tables exist under a section or when a required section contains prose before the table?
- Should workspace validation report plan filename violations only as errors, or should it also recommend the normalized `plan-*.md` filename when the target is obvious?
- Do any existing docs in this repository need one-time cleanup before stricter required-section and table validation is enabled broadly?

## ADR Index

Decisions made or relied on during this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-0008](../adr/ADR-0008-specdocs-parser-pipeline-strategy.md) | Specdocs parser pipeline strategy | Proposed |
| [ADR-0009](../adr/ADR-0009-specdocs-validation-layering-strategy.md) | Specdocs validation layering strategy | Proposed |
| [ADR-0010](../adr/ADR-0010-specdocs-formatting-activation-model.md) | Specdocs formatting activation model | Proposed |

No additional ADRs are required immediately beyond the three already created from PRD-004. If implementation uncovers a durable decision around parsed-document adapters/module boundaries or formatter serialization strategy that constrains future document types, that would be a reasonable follow-up ADR candidate.

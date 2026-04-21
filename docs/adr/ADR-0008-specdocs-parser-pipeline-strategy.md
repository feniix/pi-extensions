---
title: "Specdocs parser pipeline strategy"
adr: ADR-0008
status: Proposed
date: 2026-04-21
prd: "PRD-004-pi-specdocs-in-process-markdown-linting"
decision: "Use an in-process unified/remark-based parser pipeline as the preferred parser stack"
---

# ADR-0008: Specdocs parser pipeline strategy

## Status

Proposed

## Date

2026-04-21

## Requirement Source

- **PRD**: `docs/prd/PRD-004-pi-specdocs-in-process-markdown-linting.md`
- **Decision Point**: FR-1 through FR-4, D1, and Q1 — choosing the parser-stack strategy for PRD, ADR, and plan linting/formatting

## Context

`@feniix/pi-specdocs` currently validates spec documents with lightweight string parsing in `packages/pi-specdocs/extensions/frontmatter.ts` and rule logic in `packages/pi-specdocs/extensions/spec-validation.ts`. Workspace scanning in `packages/pi-specdocs/extensions/workspace-scan.ts` also depends on the current frontmatter helpers for `.claude/tracker.md` and session-start document summaries.

PRD-004 expands the package from basic frontmatter checks into a broader authoring workflow that must support:
- YAML frontmatter parsing with typed validation and parse-error reporting
- GFM table inspection for required PRD and plan tables
- required section/heading validation
- implementation plan validation in `docs/architecture/`
- safe, in-process formatting via an explicit command
- preservation of current repo-specific rules such as PRD/ADR numbering, status checks, and tracker-aware config parsing

This creates a real architectural choice. A richer parser stack could make validation and formatting robust and extensible, but it also changes the runtime dependency surface and affects shared code paths used during session start and post-tool lint notifications. The choice will constrain how easily future rules, fixes, and document types can be added.

## Decision Drivers

- Validation and formatting must run entirely in-process with no subprocess spawning
- Repo-specific rules must remain first-class rather than being approximated by generic Markdown linting
- The implementation must support table-aware and section-aware validation, not just raw frontmatter extraction
- Parser changes must not break `.claude/tracker.md` config handling or session-start workspace summaries
- The package should be able to add future rules and safe autofix behavior without rewriting the whole pipeline
- Runtime dependency and performance costs must stay reasonable for interactive use

## Considered Options

### Option 1: Unified/remark-based Markdown AST pipeline with specdocs-specific validators

Use an in-process Markdown pipeline based on unified/remark for document parsing, frontmatter extraction, and GFM table support. Build a shared parsed representation once, then layer PRD-, ADR-, and plan-specific validators and safe formatting transforms on top.

- Good, because it directly satisfies the no-subprocess requirement while supporting structural Markdown analysis
- Good, because an AST-based pipeline can inspect headings, tables, and document structure without brittle line splitting
- Good, because repo-specific validators stay explicit and reusable on top of a shared parse result
- Bad, because it introduces a more complex runtime dependency stack and a steeper implementation curve than today's helpers
- Bad, because shared parsing behavior must be carefully isolated so tracker/config parsing is not accidentally broken

### Option 2: Gray-matter plus targeted Markdown parsing helpers

Use `gray-matter` or a similar frontmatter parser for robust YAML handling, then keep the rest of the validation path largely custom with targeted logic for headings and tables.

- Good, because it is a smaller migration from the current code and likely easier to land incrementally
- Good, because frontmatter parsing becomes much more reliable without committing to a full AST model immediately
- Bad, because table and section validation would still require custom structural parsing that can become brittle again
- Bad, because formatting and future semantic rules would likely reintroduce one-off parsing paths instead of a durable shared representation

### Option 3: External CLI linter/formatter wrapped by the extension

Call established Markdown linting or formatting CLIs from `pi-specdocs` and translate their output into extension notifications.

- Good, because it could reduce initial implementation effort by delegating parsing and formatting to existing tools
- Good, because mature CLI tools already solve many generic Markdown problems
- Bad, because it violates PRD-004's in-process requirement
- Bad, because generic CLI rules do not model specdocs-specific concerns such as PRD/ADR numbering, required section shapes, plan conventions, and tracker-related parsing needs
- Bad, because subprocess management would complicate runtime portability and author feedback loops

## Decision

Chosen option: **"Unified/remark-based Markdown AST pipeline as the preferred parser stack"**, because it best satisfies the combination of structural validation, in-process operation, and future extensibility.

This ADR is specifically about parser-stack choice:
1. Use a unified/remark-style in-process parser pipeline as the preferred first implementation path for spec documents.
2. Keep parser selection separate from higher-level semantic validation architecture; the rule-layer boundary is addressed separately in ADR-0009.

If a short implementation spike shows that the unified/remark approach cannot meet the PRD's interactive performance or implementation-complexity constraints, the team may fall back to a gray-matter-plus-targeted-parsing approach **only if** it preserves equivalent validation behavior.

## Consequences

### Positive

- PRD, ADR, and plan validation can share one parsing pipeline instead of duplicating frontmatter, heading, and table logic
- Future rules such as richer section checks, safer autofix, and cross-reference analysis can build on a stable parsed representation
- A robust parser stack is chosen early enough to guide implementation and dependency selection
- The architecture can cleanly separate document parsing from tracker/config parsing, reducing accidental coupling when validation evolves

### Negative

- The initial implementation is more complex than a frontmatter-only parser upgrade and will require careful test coverage across `frontmatter.ts`, `spec-validation.ts`, `workspace-scan.ts`, and runtime notification paths
- AST tooling may impose runtime and dependency costs that need active measurement against the PRD performance targets
- Formatter behavior must be deliberately scoped to safe transforms so the power of the AST does not lead to surprising document rewrites

### Neutral

- `.claude/tracker.md` parsing may remain on a dedicated helper path rather than using the full document pipeline; this is acceptable as long as behavior is preserved
- A later fallback to gray-matter plus targeted parsing remains possible, but only as an implementation fallback rather than the preferred architectural direction

## Related

- **Plan**: N/A
- **ADRs**: Relates to `docs/adr/ADR-0005-exa-deep-search-tool-strategy.md` and complements `docs/adr/ADR-0009-specdocs-validation-layering-strategy.md`
- **Implementation**: `packages/pi-specdocs/extensions/frontmatter.ts`, `packages/pi-specdocs/extensions/spec-validation.ts`, `packages/pi-specdocs/extensions/workspace-scan.ts`, `packages/pi-specdocs/extensions/runtime.ts`

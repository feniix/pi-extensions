---
title: "Specdocs validation layering strategy"
adr: ADR-0009
status: Proposed
date: 2026-04-21
prd: "PRD-004-pi-specdocs-in-process-markdown-linting"
decision: "Keep specdocs-specific validation and formatting rules as a separate layer on top of shared parsed document data"
---

# ADR-0009: Specdocs validation layering strategy

## Status

Proposed

## Date

2026-04-21

## Requirement Source

- **PRD**: `docs/prd/PRD-004-pi-specdocs-in-process-markdown-linting.md`
- **Decision Point**: D2 plus FR-2 through FR-5 — whether specdocs should rely mostly on generic Markdown rules or preserve a dedicated repo-specific rule layer

## Context

`@feniix/pi-specdocs` currently applies project-specific validation in `packages/pi-specdocs/extensions/spec-validation.ts`, with lightweight frontmatter parsing in `packages/pi-specdocs/extensions/frontmatter.ts` and workspace scanning in `packages/pi-specdocs/extensions/workspace-scan.ts`. Those checks are narrow today, but they already encode semantics that generic Markdown tooling does not know about, including PRD/ADR numbering conventions, required frontmatter fields, filename alignment, and status constraints.

PRD-004 expands the validator to cover typed frontmatter validation, required sections, table-aware validation, and plan validation. This creates a design choice beyond parser selection: should the package mostly adopt generic Markdown lint rules and only sprinkle in a few local exceptions, or should it keep a clear specdocs-specific rule layer that runs on top of parsed document structure?

This matters because specdocs artifacts are not generic Markdown documents. PRDs, ADRs, and plans all have project-specific templates, naming rules, and section/table expectations. The extension also needs actionable messages that reference file paths, sections, and rule categories in a way that matches this repo's authoring workflow.

## Decision Drivers

- PRD, ADR, and plan validation must preserve repo-specific semantics such as numbering and required fields
- New rules should be easy to add without editing unrelated parsing code
- Validation output should map cleanly to specdocs concepts rather than only generic Markdown concepts
- The design should support future safe formatting and richer document analysis
- The implementation should avoid recreating brittle one-off parsing logic in multiple places

## Considered Options

### Option 1: Shared parser with specdocs-specific rule layer

Parse the document once into a shared representation, then run PRD-, ADR-, and plan-specific validators and formatters as a distinct semantic layer.

- Good, because project semantics remain explicit and testable in one place
- Good, because generic parsing concerns and repo-specific rule concerns stay separated
- Good, because future rules such as additional plan checks or cross-reference validation can be added without replacing the whole architecture
- Bad, because it requires designing and maintaining a small rule framework rather than relying purely on off-the-shelf lint rules

### Option 2: Mostly generic Markdown linting with a few local exceptions

Adopt general Markdown rule sets as the primary validation model and add custom checks only where absolutely necessary.

- Good, because some generic Markdown concerns can be covered quickly
- Good, because it may reduce the amount of custom code written initially
- Bad, because the core value of specdocs is validating repo-specific document semantics, not generic prose style
- Bad, because PRD/ADR/plan concepts such as numbering alignment, required tables, and plan conventions would still need a separate semantic layer anyway
- Bad, because actionable feedback would be split between generic lint terminology and project terminology

### Option 3: Per-document-type monolithic validators with no shared rule boundary

Implement PRD, ADR, and plan validation independently, each with its own parsing assumptions and rule code.

- Good, because each document type can move quickly in isolation at the start
- Bad, because shared behaviors like frontmatter handling, table detection, and section lookups would drift over time
- Bad, because future formatting and analysis work would have to reconcile duplicated logic later
- Bad, because testing and maintenance costs increase as document types evolve

## Decision

Chosen option: **"Shared parser with specdocs-specific rule layer"**, because it best preserves project semantics while still benefiting from a common document parsing pipeline.

The package should treat parsing as infrastructure and validation/formatting as specdocs semantics. Generic Markdown parsing libraries may provide structure, but they should not define the meaning of a valid PRD, ADR, or plan in this repository.

## Consequences

### Positive

- Repo-specific requirements remain first-class and visible in code and tests
- Validation messages can use domain terms like PRD, ADR, plan, section name, and table name instead of leaking generic parser internals
- Future rule additions remain additive rather than requiring architecture rewrites
- Shared infrastructure can still be reused for parsing, traversal, and formatting support

### Negative

- The package will own ongoing maintenance of a custom semantic rule layer
- Generic lint rules may still need selective integration later, which means maintaining a boundary between generic and project-specific concerns
- The implementation must avoid letting the semantic layer leak parser-specific details too widely, or later parser swaps become harder

**Mitigation:** keep parser-specific node access behind parser helpers or adapter-style utilities so semantic rules depend on stable document concepts rather than raw parser internals.

### Neutral

- Some generic Markdown checks may still be useful in the future, but they will remain subordinate to specdocs-specific validation priorities
- This ADR complements rather than replaces the parser-pipeline choice in ADR-0008

## Related

- **Plan**: N/A
- **ADRs**: Relates to `docs/adr/ADR-0008-specdocs-parser-pipeline-strategy.md`
- **Implementation**: `packages/pi-specdocs/extensions/spec-validation.ts`, `packages/pi-specdocs/extensions/frontmatter.ts`, `packages/pi-specdocs/extensions/runtime.ts`

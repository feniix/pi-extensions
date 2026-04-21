---
title: "pi-specdocs in-process markdown linting and formatting"
prd: PRD-004
status: Implemented
owner: "Sebastian Otaegui"
issue: "N/A"
date: 2026-04-21
version: "1.1"
---

# PRD: pi-specdocs in-process markdown linting and formatting

---

## 1. Problem & Context

`@feniix/pi-specdocs` currently validates spec documents with a small set of custom checks implemented in the extension. That covers important repo-specific rules such as PRD/ADR numbering, required frontmatter fields, and status validation, but it leaves several gaps:

- Markdown is parsed with lightweight string logic rather than a real Markdown parser
- YAML frontmatter is hand-parsed rather than validated with a robust parser and schema
- tables are not structurally validated or normalized
- implementation plans in `docs/architecture/` are not linted with the same rigor as PRDs and ADRs
- the extension can warn, but it cannot improve document formatting in-process

This becomes more important as `pi-specdocs` evolves from a simple session helper into a document authoring workflow. The package now owns templates, skills, and extension logic that encourage frequent generation and editing of spec documents. As a result, document quality problems are likely to show up in the same places repeatedly: malformed frontmatter, inconsistent headings, weak or broken tables, and spec artifacts that are syntactically valid Markdown but hard to review and maintain.

The desired improvement is an in-process Markdown linting and formatting layer that runs inside the existing extension without spawning subprocesses. It should preserve the current repo-specific rules while adding robust Markdown, frontmatter, table-aware validation, explicitly defined section/heading validation, plus required normalization/formatting support.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Robust parsing** | Spec documents are parsed through a real Markdown + frontmatter pipeline instead of manual line parsing | 100% of PRD, ADR, and plan validation paths use the new parser |
| **Broader validation** | Validation covers frontmatter, explicitly defined required sections/headings, and required table structures for supported document types | PRDs, ADRs, and plans all receive the structural validation explicitly defined for their document type in this PRD |
| **In-process operation** | No subprocess spawning for linting or formatting | 0 shell-outs required for document lint/format flows |
| **Actionable author feedback** | Validation output identifies the file and precise issue type | Warnings/errors are grouped by file when possible and remain human-readable in extension notifications/command output |
| **Required normalization** | Formatting pass rewrites at least frontmatter layout and table/section spacing safely | Autofix support for a scoped initial set of formatting rules ships in the first release |

**Guardrails (must not regress):**
- Existing PRD and ADR filename/frontmatter numbering checks must continue to work
- Workspace validation must report duplicate PRD and ADR numbers as errors
- Session-start workspace summaries must remain fast and readable
- The extension must continue working when no docs exist
- Validation must still work without external MCP tools or external executables

---

## 3. Users & Use Cases

### Primary: Spec author

> As a maintainer writing or refining PRDs, ADRs, and plans, I want immediate linting feedback and explicit on-demand formatting so that generated docs stay consistent without manual cleanup.

**Preconditions:** The maintainer is editing files in `docs/prd/`, `docs/adr/`, or `docs/architecture/` via pi tools.

### Secondary: Extension maintainer

> As the maintainer of `pi-specdocs`, I want validation to be implemented through a real parser pipeline so that new document rules can be added safely without brittle string parsing.

**Preconditions:** The maintainer is updating the extension code and needs a predictable place to add semantic document rules.

### Future: Team contributor

> As a contributor consuming specdocs outputs, I want tables, headings, and frontmatter to be consistently structured so that the documents are easy to scan and review.

---

## 4. Scope

### In scope

1. **In-process Markdown parsing** — introduce a parser pipeline for Markdown, GFM tables, and YAML frontmatter
2. **Schema-backed frontmatter validation** — replace hand-parsed metadata checks with robust parsing plus typed validation
3. **Plan validation support** — extend document linting to implementation plans in `docs/architecture/` using an objective filename rule
4. **Table-aware validation** — validate required first-release table structures for PRDs and plans, plus any additional optional table checks explicitly defined by document-type rules
5. **Explicit section/heading validation** — validate a defined first-release set of required sections/headings for PRDs, ADRs, and plans
6. **In-process formatting** — support safe normalization of selected document elements without subprocesses as part of the initial release
7. **Extension integration** — wire the new parser/validator into post-tool linting and the `specdocs-validate` and `specdocs-format` commands

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| Full prose/style linting for every Markdown convention | High noise risk; should follow after structural validation proves useful | N/A |
| Automatic mutation of every adjacent cross-reference document | Separate workflow concern from linting core | N/A |
| General-purpose Markdown formatting for non-spec docs | This work is specific to specdocs artifacts | N/A |

### Design for future (build with awareness)

The validator should be structured as a reusable document-analysis layer with document-type-specific rules on top. That means parsing once into a shared representation, then applying PRD-, ADR-, and plan-specific validators. Formatting should follow the same pattern: a small set of safe transforms now, with room to add richer fixes later without rewriting the whole pipeline.

---

## 5. Functional Requirements

### FR-1: Parse spec documents with a real Markdown + frontmatter pipeline

The extension must parse PRDs, ADRs, and plans with a proper in-process Markdown parser that understands YAML frontmatter and GFM tables. This refactor must not break non-document frontmatter-style config parsing such as `.claude/tracker.md`; tracker/config parsing should either remain on a dedicated helper path or be explicitly preserved by a separate parser utility.

**Acceptance criteria:**

```gherkin
Given a PRD file with YAML frontmatter, headings, and Markdown tables
When the specdocs validator reads the file
Then it parses the document through an in-process Markdown pipeline
And the validator can inspect frontmatter and table structure without manual line splitting
```

**Files:**
- `packages/pi-specdocs/extensions/frontmatter.ts` — replace lightweight parsing or turn it into parser-backed frontmatter helpers
- `packages/pi-specdocs/extensions/spec-validation.ts` — consume structured metadata and document nodes
- `packages/pi-specdocs/package.json` — add parser dependencies required at runtime

### FR-2: Validate frontmatter with typed rules

The extension must validate PRD, ADR, and plan frontmatter using typed rules rather than string heuristics alone.

Malformed or unparseable YAML frontmatter must be reported as a validation error for the affected file. Parse failures must not crash validation, silently skip the document, or degrade into misleading "missing field" warnings when the frontmatter block itself cannot be parsed.

When frontmatter parsing fails, the validator should still report any filename-only issues that can be determined independently from document contents, but it must skip field-dependent checks that rely on parsed frontmatter values. In particular, the validator should not emit frontmatter number-format or filename-to-frontmatter mismatch warnings when the relevant frontmatter fields could not be parsed reliably.

Workspace-wide validation must also detect duplicate PRD and ADR numbers based on the canonical filename patterns (`PRD-NNN-*.md`, `ADR-NNNN-*.md`) and report those collisions as errors, since duplicate identifiers undermine numbering integrity even when each file is individually well-formed.

**Acceptance criteria:**

```gherkin
Given a PRD with a missing owner field and an invalid status value
When validation runs
Then the output reports both issues clearly
And the validator still checks that the frontmatter number matches the filename
```

```gherkin
Given a PRD whose YAML frontmatter is syntactically invalid
When validation runs
Then the validator reports a frontmatter parse error for that file
And validation continues for other documents without crashing
```

```gherkin
Given two PRD files whose filenames both start with "PRD-007"
When workspace validation runs
Then the validator reports a duplicate PRD number error
And identifies both conflicting files
```

```gherkin
Given two ADR files whose filenames both start with "ADR-0004"
When workspace validation runs
Then the validator reports a duplicate ADR number error
And identifies both conflicting files
```

**Files:**
- `packages/pi-specdocs/extensions/spec-validation.ts` — define schema-backed field validation for individual documents
- `packages/pi-specdocs/extensions/runtime.ts` — surface richer validation output after writes and edits and perform workspace-level duplicate-number checks
- `packages/pi-specdocs/__tests__/spec-validation.test.ts` — extend coverage for schema-backed per-document validation behavior
- `packages/pi-specdocs/__tests__/runtime.test.ts` — cover duplicate-number detection and workspace/runtime reporting behavior

### FR-3: Validate key table structures for supported doc types

The validator must understand and check a defined first-release set of required or high-value tables in supported documents.

Unless a document-type rule explicitly says otherwise, required table validation is based on a **minimum required column set**: the required columns below must all be present in any order, and additional columns are permitted. The first release must not treat extra columns as structural errors by default.

**First-release table inventory:**
- **PRD**
  - `Open Questions` — required columns: `#`, `Question`, `Owner`, `Due`, `Status`
  - `File Breakdown` — required columns: `File`, `Change type`, `FR`, `Description`
  - `Changelog` — required columns: `Date`, `Change`, `Author`
- **ADR**
  - No required tables in the first release; if tables are present, they may be reformatted but are not structurally required for validity
- **Plan**
  - `Implementation Order` — required columns: `Phase`, `Component`, `Dependencies`, `Estimated Scope`
  - `ADR Index` — required columns: `ADR`, `Title`, `Status`

**Severity policy:**
- Missing or structurally invalid required tables for PRDs and plans should be reported as validation issues for the affected section
- For plan documents, the first release may classify incomplete lower-priority sections as warnings as defined in FR-4

**Acceptance criteria:**

```gherkin
Given a PRD whose Open Questions table is missing the Status column
When validation runs
Then the validator reports that the table shape is invalid
And identifies the affected file and section
```

**Files:**
- `packages/pi-specdocs/extensions/spec-validation.ts` — add table-aware validators
- `packages/pi-specdocs/extensions/runtime.ts` — include table issues in validation reporting
- `packages/pi-specdocs/__tests__/runtime.test.ts` — cover tool-result reporting for structural table issues

### FR-4: Support implementation plan linting

Implementation plans in `docs/architecture/` must be validated alongside PRDs and ADRs using plan-specific rules.

The validator should treat Markdown files that are direct children of `docs/architecture/` as plan artifacts for naming purposes. Files matching the existing plan naming convention `plan-*.md` should be validated as plan documents. Workspace-wide validation should report a filename error for any other `.md` file found directly under `docs/architecture/` that does not match the `plan-*.md` convention. Nested Markdown files in subdirectories under `docs/architecture/` are out of scope for first-release plan filename enforcement unless a later requirement expands the scan recursively.

Session-start workspace summaries may continue to count only files matching `plan-*.md` and do not need to treat invalidly named Markdown files in `docs/architecture/` as plans for first-release summary output. However, those invalidly named files must still be surfaced by explicit workspace validation as filename errors.

The first release must validate at least:
- required plan frontmatter fields from the plan template (`title`, `prd`, `date`, `author`, `status`)
- allowed plan `status` values: `Draft`, `Implemented`, `Archived`
- `date` must be present and serialized as an ISO-style `YYYY-MM-DD` string
- `prd` must be present as a non-empty string using the canonical source PRD slug format `PRD-NNN-descriptive-slug` as used by the plan template
- presence of the `Source` section
- presence of the `Implementation Order` section and basic table structure of its table
- presence of the `ADR Index` section and basic table structure of its table

The first release may report less central plan sections such as `Architecture Overview`, `Components`, `Risks and Mitigations`, and `Open Questions` as warnings rather than hard errors if their structure is incomplete.

**Acceptance criteria:**

```gherkin
Given a plan document in docs/architecture/
When the user runs specdocs-validate
Then the plan is included in validation
And missing required plan structure is reported as a warning or error
And the validator checks required frontmatter plus Source, Implementation Order, and ADR Index in the first release
```

```gherkin
Given a Markdown file in docs/architecture/ named architecture-outline.md
When the user runs specdocs-validate
Then the validator reports that the filename does not match the plan-*.md convention
```

```gherkin
Given a plan document whose frontmatter contains `prd: PRD-004`
When the user runs specdocs-validate
Then the validator reports that the plan `prd` reference does not use the required `PRD-NNN-descriptive-slug` format
```

**Files:**
- `packages/pi-specdocs/extensions/spec-validation.ts` — add plan detection and validation rules
- `packages/pi-specdocs/extensions/runtime.ts` — include plan files in workspace-wide validation
- `packages/pi-specdocs/__tests__/runtime.test.ts` — add plan validation coverage

### FR-5: Validate required sections/headings for supported doc types

The validator must check a defined first-release set of required sections/headings for each supported document type.

**First-release required section inventory:**
- **PRD**
  - required top-level numbered sections: `## 1. Problem & Context` through `## 14. Changelog`
  - `## 15. Verification (Appendix)` remains optional as defined by the PRD template
- **ADR**
  - required sections: `## Status`, `## Date`, `## Requirement Source`, `## Context`, `## Decision Drivers`, `## Considered Options`, `## Decision`, `## Consequences`, `## Related`
- **Plan**
  - required sections: `## Source`, `## Architecture Overview`, `## Components`, `## Implementation Order`, `## ADR Index`
  - `## Risks and Mitigations` and `## Open Questions` may be reported as warnings rather than hard errors in the first release

For the first release, section validation is heading-based and does not require semantic validation of every subsection body beyond the explicit checks defined elsewhere in this PRD.

**Acceptance criteria:**

```gherkin
Given a PRD missing the "## 9. File Breakdown" heading
When validation runs
Then the validator reports a missing required section for that file
And identifies the missing heading by name
```

```gherkin
Given an ADR missing the "## Decision" section
When validation runs
Then the validator reports a missing required section for that ADR
```

```gherkin
Given a plan document missing the "## ADR Index" section
When validation runs
Then the validator reports a missing required section for that plan
And classifies the issue according to the first-release plan section policy
```

**Files:**
- `packages/pi-specdocs/extensions/spec-validation.ts` — add document-type-specific required heading checks
- `packages/pi-specdocs/__tests__/spec-validation.test.ts` — cover missing required-section behavior

### FR-6: Provide safe in-process formatting/normalization

The extension must support a scoped set of automatic formatting improvements performed entirely in-process as part of the initial release.

The initial product surface is a dedicated formatting command named `specdocs-format`. Its invocation contract for the first release is:
- `specdocs-format <path>`
- `<path>` may be relative to the current working directory or absolute
- exactly one path is accepted per invocation
- only PRD, ADR, or plan documents are supported targets

The first release must not perform automatic document rewrites on `tool_result`; post-tool behavior remains lint-and-notify only. Post-tool linting must continue to validate supported PRD, ADR, and plan documents after writes/edits, but formatting remains explicit-command-only. This first-release activation model is recorded in `docs/adr/ADR-0010-specdocs-formatting-activation-model.md`.

If the target path does not exist, is not a supported spec document path, or contains malformed content that the formatter cannot safely normalize, the command must fail safely with a human-readable message and must not partially rewrite the file. If the file is already normalized, the command should report a no-op outcome rather than rewriting it unnecessarily.

Canonical normalization rules for the first release must be limited to the following deterministic transforms:
- frontmatter fences use `---` on their own lines
- exactly one blank line follows the closing frontmatter fence before the document title heading
- exactly one blank line surrounds top-level section headings
- existing thematic breaks written as standalone `---` lines between major sections may be normalized for surrounding blank lines, but must be preserved rather than removed or inserted opportunistically in the first release
- Markdown tables may be re-padded for consistent pipe alignment and surrounding blank lines, but cell content must not be rewritten semantically
- Common GFM constructs such as thematic breaks, task lists, and strikethrough must be preserved semantically during formatting even if their whitespace is normalized
- formatting must not rename headings, reorder sections, alter prose text, or change frontmatter field values

**Acceptance criteria:**

```gherkin
Given a spec document with valid content but inconsistent frontmatter spacing and malformed table spacing
When the formatter runs via "specdocs-format <path>"
Then it rewrites the document in place without spawning a subprocess
And preserves the document's semantic content
```

```gherkin
Given the user runs "specdocs-format <path>" on a nonexistent path or unsupported Markdown file
When the formatter validates the target
Then it reports a clear error
And does not rewrite any files
```

```gherkin
Given the user runs "specdocs-format <path>" on an already-normalized supported spec document
When formatting completes
Then the command reports that no changes were needed
```

**Files:**
- `packages/pi-specdocs/extensions/runtime.ts` — expose formatting entry points and command execution behavior
- `packages/pi-specdocs/extensions/index.ts` — register the `specdocs-format` command
- `packages/pi-specdocs/extensions/frontmatter.ts` — normalize frontmatter serialization
- `packages/pi-specdocs/__tests__/index.test.ts` — cover `specdocs-format` command registration
- `packages/pi-specdocs/__tests__/runtime.test.ts` — cover `specdocs-format <path>` behavior and plan-file post-tool lint coverage

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Runtime model** | Linting and formatting must run entirely in-process with no subprocess spawning |
| **Performance** | Single-file post-edit linting should target completion in under 250 ms for representative spec documents of up to roughly 500 lines and 5 tables, and workspace validation over a repo-scale `docs/` tree of roughly up to 25 spec documents should target completion in under 2 s on a typical local development machine |
| **Performance verification** | Before release, measure both targets against representative local fixtures: (1) a single supported spec document of roughly 500 lines with up to 5 tables, and (2) a workspace containing roughly 25 spec documents across `docs/prd/`, `docs/adr/`, and `docs/architecture/`; record the observed durations during implementation validation |
| **Safety** | Formatting must be limited to deterministic, low-risk transforms and must not rewrite semantic document content unexpectedly |
| **Extensibility** | New document rules should be addable without editing unrelated parsing code |
| **Testability** | New validation and formatting behavior must be covered by unit tests in `packages/pi-specdocs/__tests__/` |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Parser integration rewrites too much of the existing validation path at once | Medium | Medium | Introduce parser-backed helpers first, then migrate rules incrementally behind existing test coverage |
| Autofix changes documents in surprising ways | High | Medium | Limit initial formatting scope to frontmatter normalization and safe table/spacing fixes; keep semantic edits out of scope |
| Table rules become too rigid for real-world docs | Medium | Medium | Validate only known high-value tables and report issues as warnings where strictness is uncertain |
| New dependencies increase maintenance burden | Medium | Low | Choose a small, well-supported parser stack and isolate it behind helper modules |

### Assumptions

- The existing extension remains the right place for specdocs linting and validation behavior
- PRDs, ADRs, and plans will continue to be stored under `docs/prd/`, `docs/adr/`, and `docs/architecture/`
- A Markdown AST pipeline is acceptable as a runtime dependency for `@feniix/pi-specdocs`

---

## 8. Design Decisions

### D1: Use an in-process Markdown AST pipeline instead of CLI-based linting

**Options considered:**
1. **In-process Markdown AST pipeline** — more implementation work, but fully compatible with the requirement to avoid subprocesses and easier to extend semantically
2. **Spawn a CLI linter/formatter** — faster initial integration, but violates the in-process requirement and is harder to tailor to specdocs semantics

**Decision:** Use an in-process Markdown parser and validation pipeline.

**Rationale:** The current requirement explicitly rejects subprocess spawning, and specdocs needs semantic document rules that generic CLI linting cannot fully express.

**Future path:** The same pipeline can later support richer autofix, section validation, and cross-reference checks.

### D2: Keep repo-specific rules alongside generic Markdown parsing

**Options considered:**
1. **Replace custom validation entirely with generic Markdown rules** — simpler on paper, but loses project semantics
2. **Layer specdocs-specific rules on top of robust parsing** — preserves current behavior while improving structure awareness

**Decision:** Keep custom PRD/ADR/plan rules, but run them on structured parsed content.

**Rationale:** Numbering, tracker-aware references, and spec section expectations are package-specific and should remain first-class behavior.

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `packages/pi-specdocs/package.json` | Modify | FR-1 | Add parser/linting dependencies needed at runtime |
| `package-lock.json` | Modify | FR-1 | Capture runtime dependency changes for the npm workspace/root lockfile |
| `packages/pi-specdocs/extensions/frontmatter.ts` | Modify | FR-1, FR-6 | Replace manual spec-document parsing helpers with parser-backed frontmatter utilities and serialization helpers while preserving tracker/config parsing support |
| `packages/pi-specdocs/extensions/workspace-scan.ts` | Modify | FR-1 | Keep `.claude/tracker.md` parsing correct after the frontmatter/parser refactor |
| `packages/pi-specdocs/extensions/spec-validation.ts` | Modify | FR-1, FR-2, FR-3, FR-4, FR-5 | Add parser-backed per-document validation, table rules, plan validation, and required-section checks |
| `packages/pi-specdocs/extensions/runtime.ts` | Modify | FR-2, FR-3, FR-4, FR-5, FR-6 | Surface richer validation, perform workspace-level duplicate-number and filename checks, include plan docs in post-tool linting, and implement explicit formatting command behavior |
| `packages/pi-specdocs/extensions/index.ts` | Modify | FR-6 | Register the public `specdocs-format` command |
| `packages/pi-specdocs/__tests__/spec-validation.test.ts` | Modify | FR-2, FR-3, FR-4, FR-5 | Add validation coverage for parser-backed per-document metadata and structural rules |
| `packages/pi-specdocs/__tests__/runtime.test.ts` | Modify | FR-2, FR-3, FR-4, FR-6 | Verify duplicate-number detection, runtime reporting, plan-file post-tool lint coverage, and explicit-format command behavior |
| `packages/pi-specdocs/__tests__/scanner.test.ts` | Modify | FR-1, FR-4 | Verify workspace scan and summary behavior remain correct after parser/frontmatter refactors and plan filename enforcement |
| `packages/pi-specdocs/__tests__/index.test.ts` | Modify | FR-6 | Validate `specdocs-format` command registration |
| `packages/pi-specdocs/README.md` | Modify | FR-6 | Document the new formatting capability and command usage |

---

## 10. Dependencies & Constraints

- The implementation must use in-process JavaScript/TypeScript libraries rather than external CLIs
- Any runtime dependency must be installable as a production dependency because pi packages use production installs at runtime
- Formatting must preserve existing Markdown semantics and frontmatter content
- Validation should continue to work even when no external research or MCP tools are configured
- Validation and formatting output must identify the affected file, issue type, and section when applicable so both post-tool notifications and command output are actionable

---

## 11. Rollout Plan

1. Introduce parser-backed helpers and keep current frontmatter validation behavior passing existing tests while preserving workspace-scan compatibility
2. Migrate PRD and ADR validation to structured parsing, expand tests, and add workspace-level duplicate-number checks
3. Add plan validation, plan filename enforcement, and table-aware rules
4. Add required section/heading validation for PRDs, ADRs, and plans
5. Add scoped in-process formatting support and expose it through the dedicated `specdocs-format <path>` command
6. Validate command behavior for unsupported paths, malformed documents, and no-op formatting outcomes
7. Update README and, only if the user-facing authoring workflow changes materially, follow up with prompt/skill guidance updates

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Which parser stack should be adopted first: unified/remark-based, gray-matter plus targeted Markdown parsing, or another in-process option? | Sebastian Otaegui | Before implementation starts | **Resolved:** Prefer a unified/remark-based pipeline first; if implementation complexity or performance is unacceptable during the spike, fall back to gray-matter plus targeted Markdown parsing with equivalent validation behavior |
| Q2 | Should extension-internal autofix be explored after the dedicated formatting command ships and proves safe in real usage? | Sebastian Otaegui | After initial release | Open |
| Q3 | Which additional plan sections should move from warnings to hard validation after the first release? | Sebastian Otaegui | After Phase 3 | Open |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| `docs/prd/PRD-005-pi-exa-api-alignment.md` | Implemented; informed discussion about deprecated tool references and current runtime constraints |
| `docs/adr/ADR-0005-exa-deep-search-tool-strategy.md` | Related; provides context for current Exa tool surface used by specdocs skills |
| `docs/adr/ADR-0008-specdocs-parser-pipeline-strategy.md` | Derived from this PRD; records the preferred parser-stack strategy |
| `docs/adr/ADR-0009-specdocs-validation-layering-strategy.md` | Derived from this PRD; records the semantic rule-layer architecture |
| `docs/adr/ADR-0010-specdocs-formatting-activation-model.md` | Derived from this PRD; records the first-release formatting activation model |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-21 | Initial draft | Sebastian Otaegui |
| 2026-04-21 | Refined requirements, clarified scope/edge cases, and added explicit ADR references for parser strategy, validation layering, and formatting activation | Sebastian Otaegui |
| 2026-04-21 | Aligned cross-document references and implementation-ready decisions after iterative review passes | Sebastian Otaegui |
| 2026-04-21 | Marked implemented after landing parser-backed validation, typed/schema-backed frontmatter checks, plan linting, explicit formatting, and recorded local performance measurements | Sebastian Otaegui |

---

## 15. Verification (Appendix)

1. Create malformed PRD, ADR, and plan fixtures and verify the validator reports frontmatter parse/schema issues, required section/heading issues, required table-structure issues, plan filename issues, and duplicate-number collisions without shelling out.
2. Include fixtures with syntactically invalid YAML frontmatter and confirm the validator reports a parse error, still reports filename-only issues that do not depend on parsed fields, and suppresses field-dependent frontmatter warnings for the malformed document.
3. Include fixtures with duplicate `PRD-NNN` and `ADR-NNNN` filename prefixes and confirm workspace validation reports each collision as an error that identifies all conflicting files.
4. Edit a spec document through pi and confirm post-tool linting still notifies immediately with the new validator.
5. Run workspace validation over the current `docs/` tree and confirm existing valid docs do not produce false positives beyond known real issues.
6. Measure single-file and workspace validation times against representative fixtures and confirm they meet the stated performance targets. Latest recorded local benchmark from `PI_SPECDOCS_BENCH=1 npx vitest run packages/pi-specdocs/__tests__/performance.test.ts --reporter=verbose`: single-file validation `7.41 ms`, workspace validation over 25 docs `19.14 ms`.
7. Run formatting against a sample malformed doc and confirm only targeted formatting changes occur.

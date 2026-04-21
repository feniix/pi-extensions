# @feniix/pi-specdocs

Structured spec documentation workflow for [pi](https://pi.dev/) — PRDs, ADRs, and implementation plans with cross-referencing.

## Features

- **PRD Skill** (`prd`): Draft structured Product Requirements Documents with Gherkin acceptance criteria, design decisions, and concrete file breakdowns
- **ADR Skill** (`adr`): Create Architecture Decision Records in MADR 4.0 format with PRD linkage
- **Plan-PRD Skill** (`plan-prd`): Generate implementation plans from PRDs with ADR cross-references
- **Architect Prompt** (`/architect`): End-to-end initiative planning — assess feasibility, decompose into workstreams, produce artifacts
- **Refine Prompt** (`/refine`): Deep review of PRDs/ADRs for risks, bugs, ambiguities, errors, and inconsistencies
- **Session Hook**: Automatically scans `docs/` on session start and displays a summary of existing spec documents
- **Validation Command** (`specdocs-validate`): Checks spec docs for typed frontmatter validity, required sections/tables, numbering, duplicate IDs, and plan filename issues
- **Formatting Command** (`specdocs-format <path>`): Normalizes supported spec documents in-process without external tools while preserving common GFM constructs

## Install

```bash
pi install npm:@feniix/pi-specdocs
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-specdocs
```

## Skills (auto-trigger)

### `prd`

Triggers when you ask to write a PRD, scope a feature, write requirements, or break down a GitHub issue. Produces a 14-section PRD stored at `docs/prd/PRD-NNN-slug.md` and optionally posted to GitHub.

### `adr`

Triggers when you ask to create an ADR, document a technical decision, or compare options. Uses the 4-point test to determine if a decision warrants a standalone ADR. Stored at `docs/adr/ADR-NNNN-slug.md`.

### `plan-prd`

Triggers when you ask to create an implementation plan from a PRD. Generates architecture overview, component breakdown, phased implementation, and flags ADR candidates.

## Prompt Templates (manual invocation)

### `/architect [description | issue-number | prd-path]`

End-to-end initiative planning. Acts as a Product Architect — assesses feasibility, decomposes into workstreams, determines which artifacts are needed, and produces them in sequence.

### `/refine [path-to-document]`

Deep review of a PRD or ADR. Validates against the codebase, researches external claims, and presents findings organized by category with severity levels.

## Document Storage

| Type | Location | Naming |
|------|----------|--------|
| PRDs | `docs/prd/` | `PRD-NNN-slug.md` (3-digit) |
| ADRs | `docs/adr/` | `ADR-NNNN-slug.md` (4-digit) |
| Plans | `docs/architecture/` | `plan-slug.md` |

## Commands

- `specdocs-validate` — validate spec documents in the workspace
- `specdocs-format <path>` — format a PRD, ADR, or plan document in place
  - validates typed frontmatter, required headings, and required table shapes
  - plan docs also warn on missing recommended sections such as `Risks and Mitigations` and `Open Questions`
  - duplicate PRD/ADR numbers and invalid direct-child plan filenames are surfaced in workspace validation
  - normalizes frontmatter fences and section spacing
  - normalizes GFM table spacing/alignment
  - preserves thematic breaks, task lists, and other common GFM syntax

## Tool Integration

Skills prefer MCP tools when available, with fallback to built-in alternatives:

| Purpose | Preferred | Fallback |
|---------|-----------|----------|
| Codebase exploration | serena | Read, Grep, Glob |
| External research | exa, ref | WebSearch, WebFetch |
| GitHub | gh CLI | gh CLI |

## Session Hook

On session start, the extension scans `docs/prd/`, `docs/adr/`, and `docs/architecture/` and displays:
- Count of existing PRDs, ADRs, and plans
- Proposed ADRs needing review
- Draft PRDs still in progress

## Performance verification

A reproducible local benchmark is included for the PRD-004 validation targets.

Run it from `packages/pi-specdocs/`:

```bash
npm run perf:validation
```

Latest recorded local measurement in this repo:
- single-file validation: ~7.41 ms
- workspace validation (25 docs): ~19.14 ms

## Requirements

- pi v0.51.0 or later
- `gh` CLI (for GitHub integration)

## Uninstall

```bash
pi remove npm:@feniix/pi-specdocs
```

## License

MIT

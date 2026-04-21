# Shared Document Conventions

Use this reference before numbering, naming, or saving specdocs artifacts.

## Storage locations

- PRDs: `docs/prd/`
- ADRs: `docs/adr/`
- Implementation plans: `docs/architecture/`

Create the target directory if it does not already exist.

## Naming

- PRDs: `PRD-NNN-slug.md`
- ADRs: `ADR-NNNN-slug.md`
- Plans: `plan-slug.md`

Use kebab-case for the slug and keep it specific enough to distinguish the document later.

## Numbering rules

### PRDs

1. List existing files in `docs/prd/`
2. Find the highest `PRD-NNN` number
3. Increment by one
4. Start at `PRD-001` if none exist

### ADRs

1. List existing files in `docs/adr/`
2. Find the highest `ADR-NNNN` number
3. Increment by one
4. Start at `ADR-0001` if none exist

## Cross-reference discipline

- PRDs should reference related issues, plans, and ADRs when they materially affect the work
- ADRs should link back to the PRD or plan that created the decision pressure
- Plans should link back to their source PRD and reference existing ADRs where relevant
- Only mutate adjacent documents automatically when the workflow explicitly calls for it or the user asked for it; otherwise offer the update as a follow-up step

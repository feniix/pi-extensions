# Plan Template

Use this structure when drafting an implementation plan from a PRD. Do not wrap the output in a code fence — produce it as regular markdown.

Filename convention: `plan-descriptive-slug.md` (e.g., `plan-infra-deploy-framework.md`)

---

```yaml
---
title: "[Feature Name]"
prd: "[PRD-NNN-slug]"
date: YYYY-MM-DD
author: "[Name or Claude Code]"
status: Draft
---
```

# Plan: [Feature Name]

## Source

- **PRD**: [Link to PRD, e.g. `docs/prd/PRD-007-infra-deploy-framework.md`]
- **Date**: YYYY-MM-DD
- **Author**: [Name or "Claude Code"]

## Architecture Overview

[High-level description of the technical approach. 2-3 paragraphs covering the major components, how they interact, and why this structure was chosen.]

## Components

### [Component 1 Name]

**Purpose**: [What this component does]

**Key Details**:
- [Detail 1]
- [Detail 2]

**ADR Reference**: [Link to ADR if a decision was made here, e.g. `-> ADR-0015: Use CRDTs over OT`, or "None — straightforward implementation"]

### [Component 2 Name]

**Purpose**: [What this component does]

**Key Details**:
- [Detail 1]
- [Detail 2]

**ADR Reference**: [Link to ADR if applicable]

## Implementation Order

| Phase | Component | Dependencies | Estimated Scope |
|-------|-----------|-------------|-----------------|
| 1 | [Component] | None | S/M/L |
| 2 | [Component] | Phase 1 | S/M/L |
| 3 | [Component] | Phase 1, 2 | S/M/L |

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [Risk 1] | Low/Med/High | Low/Med/High | [Strategy] |

## Open Questions

- [Question that needs resolution before or during implementation]

## ADR Index

Decisions made during this plan:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-NNNN](../adr/ADR-NNNN-slug.md) | [Title] | Proposed |

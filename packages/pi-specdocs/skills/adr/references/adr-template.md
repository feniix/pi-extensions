# ADR Template

Use this structure when drafting an Architecture Decision Record. Follows MADR 4.0 format with PRD linkage. Do not wrap the output in a code fence — produce it as regular markdown.

Filename convention: `ADR-NNNN-descriptive-slug.md` (e.g., `ADR-0015-custom-framework-vs-pulumi.md`)

---

```yaml
---
title: "[Decision Title]"
adr: ADR-NNNN
status: Proposed
date: YYYY-MM-DD
prd: "[PRD-NNN-slug or N/A]"
decision: "[Chosen option — filled after decision is made]"
---
```

# ADR-NNNN: [Decision Title]

## Status

Proposed

## Date

YYYY-MM-DD

## Requirement Source

- **PRD**: [PRD reference, e.g. `docs/prd/PRD-007-infra-deploy-framework.md`, or N/A for foundational decisions]
- **Decision Point**: [Which section/requirement in the PRD drives this decision]

## Context

[Describe the forces at play. What technical problem does the requirement create? Why is a decision needed now? Include links to relevant plan sections.]

## Decision Drivers

- [Driver 1: e.g. "PRD requires sub-100ms latency for collaborative editing"]
- [Driver 2: e.g. "Team has existing expertise in Redis"]
- [Driver 3: e.g. "Must support offline-first mobile clients"]

## Considered Options

### Option 1: [Name]

[Description of the approach.]

- Good, because [advantage]
- Good, because [advantage]
- Bad, because [disadvantage]

### Option 2: [Name]

[Description of the approach.]

- Good, because [advantage]
- Bad, because [disadvantage]
- Bad, because [disadvantage]

### Option 3: [Name] *(optional)*

[Description of the approach.]

- Good, because [advantage]
- Bad, because [disadvantage]

## Decision

Chosen option: **"[Option Name]"**, because [justification linking back to decision drivers].

## Consequences

### Positive

- [Positive consequence]

### Negative

- [Negative consequence and mitigation]

### Neutral

- [Neutral observation, e.g. "Team will need to learn X"]

## Related

- **Plan**: [Link to plan document, e.g. `docs/architecture/plan-infra-deploy.md`, or N/A]
- **ADRs**: [Links to related ADRs, e.g. "Supersedes ADR-0012", "Relates to ADR-0015"]
- **Implementation**: [Links to tasks or PRs once available]

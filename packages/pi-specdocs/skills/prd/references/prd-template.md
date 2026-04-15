# PRD Template

Use this exact section structure when drafting a PRD. Every section is required unless marked `<!-- optional -->`. Sub-elements marked optional should be included when the PRD's complexity warrants them — use judgment. Do not wrap the output in a code fence — produce it as regular markdown.

Filename convention: `PRD-NNN-descriptive-slug.md` (e.g., `PRD-007-infra-deploy-framework.md`)

---

```yaml
---
title: "[Title]"
prd: PRD-NNN
status: Draft
owner: "[Name]"
issue: "[issue-ref or N/A]"  # use #N for GitHub or TEAM-N for Linear
date: YYYY-MM-DD
version: "1.0"
---
```

# PRD: [Title]

---

## 1. Problem & Context

[What problem does this solve? Why now? What about the current state of the codebase or product makes this the right time? Include enough architectural context that a developer unfamiliar with this area can orient themselves.]

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **[Goal name]** | [How measured] | [Target value or TBD with what you'd measure] |

<!-- optional: include when existing behavior could regress -->
**Guardrails (must not regress):**
- [Existing behavior that must be preserved]

---

## 3. Users & Use Cases

### Primary: [User type]

> As a [role], I want to [action] so that [outcome].

**Preconditions:** [What must be true before this use case applies]

### Secondary: [User type]

> As a [role], I want to [action] so that [outcome].

<!-- optional: include when this work explicitly enables a future user or use case -->
### Future: [User type] (enabled by this work)

> As a [role], I want to [action] so that [outcome].

---

## 4. Scope

### In scope

1. **[Item]** — [brief description]
2. **[Item]** — [brief description]

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| [Feature] | [Concrete reason for deferral] | [Issue #] |

<!-- optional: include when current design intentionally accommodates future work -->
### Design for future (build with awareness)

[Describe extension points and how the current design enables future work without overbuilding now. Include concrete examples of what "future-ready" looks like in the code — e.g., "use an interface so alternative backends can be swapped in later" rather than "make it extensible."]

---

## 5. Functional Requirements

### FR-1: [Requirement name]

[Description of the requirement — what it does and why it matters.]

**Acceptance criteria:**

```gherkin
Given [concrete precondition with specific values]
When [user action]
Then [observable, verifiable result]
```

<!-- optional: include when the FR maps to specific files; omit for lighter PRDs -->
**Files:**
- `path/to/file.ext` — [what changes and why]

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **[Category]** | [Specific, measurable requirement] |

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| [Risk description] | High/Medium/Low | High/Medium/Low | [Actionable mitigation — not "handle gracefully"] |

### Assumptions

- [Assumption 1 — stated so it can be challenged]
- [Assumption 2]

---

## 8. Design Decisions

### D1: [Decision title]

**Options considered:**
1. [Option A] — [brief pro/con]
2. [Option B] — [brief pro/con]

**Decision:** [What was decided]

**Rationale:** [Why this approach was chosen over the alternatives]

<!-- optional: include when the decision has meaningful implications for future work -->
**Future path:** [How this decision enables or constrains future work]

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| [concrete/path/to/file.ext] | New / Modify / Move / Delete | FR-N | [What changes] |

Every file should trace to at least one FR. Every FR should have at least one file.

---

## 10. Dependencies & Constraints

- [Dependency or constraint — be specific about versions, APIs, or system requirements]

---

## 11. Rollout Plan

1. [Step 1 — what gets deployed/merged first and why]
2. [Step 2]
3. ...

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | [Question] | [Owner] | [Date] | Open |
| Q2 | [Question] | [Owner] | [Date] | **Resolved:** [Concise answer — keep the resolution here so it's scannable alongside open items] |

---

## 13. Related

| Issue | Relationship |
|-------|-------------|
| [Issue ref — Title] | [How it relates — blocks, blocked-by, depends-on, enables, completed] |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| YYYY-MM-DD | Initial draft | [Author] |

---

<!-- optional: include for features complex enough to need post-implementation verification beyond FR acceptance criteria -->
## 15. Verification (Appendix)

Post-implementation checklist — distinct from acceptance criteria. These are manual or exploratory checks to confirm the feature works end-to-end in a real environment.

1. [Verification step — specific enough that someone else could execute it]
2. [Verification step]

---

## Section Guidance

These notes explain why each structural element matters — use them to calibrate depth and focus:

- **Gherkin acceptance criteria** — makes testability explicit; every FR needs at least one scenario covering the happy path. Use concrete values in Given/When/Then, not abstractions.
- **Scope table "Tracked in" column** — every deferral links to a real issue so nothing gets lost.
- **Design Decisions "Options considered"** — showing the alternatives you rejected (and why) is as valuable as explaining what you chose. It prevents future developers from re-litigating settled decisions.
- **File Breakdown FR column** — bidirectional traceability between requirements and code. If a file doesn't map to an FR, question whether it belongs. If an FR has no files, the requirement isn't concrete enough.
- **Guardrails** — explicitly state what must NOT regress; prevents scope creep from breaking existing behavior.
- **Open Questions** — be honest about unknowns; assign owners and due dates so they get resolved, not forgotten. Resolutions go in the Status column with a **Resolved:** prefix — never in the Question column — so open vs resolved is scannable at a glance.
- **Related issues** — specify the relationship type (blocks, enables, depends-on, completed) not just "related".
- **Verification** — post-implementation sanity checks; these catch integration issues that unit tests miss. Write them as executable steps, not vague descriptions.

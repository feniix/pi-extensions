# ADR 4-Point Test

Use this test to decide whether a technical choice deserves a standalone ADR. If **2 or more** of these are true, the decision should usually become an ADR:

1. **Multiple approaches** — there are at least two viable technical options
2. **Lasting consequences** — the effects extend beyond the current sprint or implementation detail
3. **Disagreement potential** — a reasonable engineer might choose differently
4. **Future constraints** — the decision shapes or limits future work

## Common ADR-worthy topics

- storage technology choices
- API style decisions
- auth and identity strategy
- deployment and hosting model
- third-party service selection
- messaging/event patterns
- state management approach
- framework or major library selection
- caching strategy

## Usually not ADR-worthy on their own

- tiny implementation details with one obvious answer
- naming decisions
- local refactors with no broader architectural consequence
- configuration values that do not materially affect future architecture

If the decision does **not** pass the test, capture it in the PRD or plan instead of forcing a standalone ADR.

# Task Completion Checklist

After completing any coding task in this repo, always run the following:

1. **Format/Lint**: `npm run lint:fix` — auto-fix, then `npm run lint` to verify
2. **Type check**: `npm run typecheck`
3. **Tests**: `npm run test` (or scoped: `npx vitest run packages/<name>/__tests__`)
4. **Coverage**: If modifying extension code, verify coverage with `npm run test:coverage`

For pi-conductor specifically, write or update the test *first*, then implement.

Combined quick-check: `npm run check` (runs lint + typecheck together).

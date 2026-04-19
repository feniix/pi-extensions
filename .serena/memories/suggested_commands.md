# Suggested Commands

## Development (run from repo root)
```bash
npm run lint            # Biome lint/format check
npm run lint:fix        # Auto-fix Biome issues
npm run typecheck       # TypeScript type checking
npm run check           # lint + typecheck
npm run check:ci        # CI-friendly (biome ci + tsc)
npm run test            # Run all Vitest tests
npm run test:coverage   # Run tests with v8 coverage
npm run audit:workspaces # Audit workspace dependencies
npm run ci:detect -- <base> <head>  # Detect which packages CI would check
```

## Single-package commands
```bash
npx biome ci packages/<name>                           # Lint one package
npx tsc --noEmit --project packages/<name>/tsconfig.json  # Typecheck one package
npx vitest run packages/<name>/__tests__               # Test one package
```

## Running an extension locally
```bash
cd packages/<name>
pi -e .     # Load extension into pi without installing
```

## Git / Utility
```bash
git log --oneline -20
git status
git diff
```

## Task completion checklist
After completing a coding task, run:
1. `npm run lint:fix` — auto-fix formatting
2. `npm run typecheck` — verify types
3. `npm run test` — run tests
4. Review with `npm run check` (combines lint + typecheck)

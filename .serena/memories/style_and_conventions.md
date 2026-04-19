# Code Style & Conventions

## TypeScript
- Strict mode enabled, target ES2022, module Node16
- No build/compile step — pi loads `.ts` files directly
- No `any` (enforced by Biome `noExplicitAny: error`)
- No non-null assertions (`noNonNullAssertion: error`)
- No unused imports (`noUnusedImports: error`)

## Formatting (Biome)
- 2-space indentation
- 120 character line width
- Double quotes for strings
- Semicolons always
- Biome config: `biome.json` at repo root

## File & Package Layout
- Package dir: `packages/pi-<name>/`
- Extension entry: `extensions/index.ts`
- Tests: `__tests__/*.test.ts`
- Each package has its own `package.json`, `tsconfig.json` (extends root), `README.md`, `LICENSE`
- npm scope: `@feniix/pi-<name>`

## Extension Pattern
- Each extension exports a function (e.g., `devtoolsExtension`, `statuslineExtension`)
- Tools are defined with TypeBox schemas for parameters
- Tools return `{ content, details?, isError? }` (see `ToolResult` interface in pi-devtools)

## Testing
- Vitest with node environment
- Fast, isolated unit tests focused on extension behavior and helpers
- Coverage thresholds enforced: lines 70, statements 70, functions 70, branches 60
- `pi-conductor` uses test-first development

## Commits
- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- Scope to affected package when possible (e.g., `feat(pi-devtools): add merge tool`)

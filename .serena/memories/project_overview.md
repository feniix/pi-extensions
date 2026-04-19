# pi-extensions — Project Overview

## Purpose
A monorepo of extensions (plugins) for **pi**, an AI coding agent CLI (`pi.dev`). Each package adds tools, status-line features, or integrations that pi can load at runtime.

## Tech Stack
- **Language**: TypeScript (strict mode, ES2022 target, Node16 module resolution)
- **Package manager**: npm workspaces (`packages/*`)
- **Linter/Formatter**: Biome 2.x (2-space indent, 120 line width, double quotes, semicolons)
- **Testing**: Vitest 4.x with v8 coverage (thresholds: lines 70, statements 70, functions 70, branches 60)
- **Type-checking**: `tsc --noEmit` (no build step; extensions are loaded as TS directly by pi)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — detects changed packages and runs scoped lint/typecheck/test/coverage

## Packages (9 total)
| Package | Purpose |
|---|---|
| `pi-code-reasoning` | Structured code-reasoning MCP tool |
| `pi-conductor` | Orchestration layer for multi-agent / worktree workflows |
| `pi-devtools` | Git/PR/release helper tools (commit, push, merge, CI check, etc.) |
| `pi-exa` | Exa web search integration |
| `pi-notion` | Notion integration |
| `pi-ref-tools` | Documentation search & reading via ref.docs |
| `pi-sequential-thinking` | Step-by-step structured reasoning tools |
| `pi-specdocs` | PRD/ADR/plan management |
| `pi-statusline` | Status-line display extension |

## Key Conventions
- Each extension exports a function from `extensions/index.ts` that registers tools via the pi SDK
- Tests in `__tests__/*.test.ts`
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`)
- No `any` (`noExplicitAny: error`), no non-null assertions, no unused imports
- Avoid `Type.Unknown()` in tool params; use `Type.Object({}, { additionalProperties: true })` instead
- `pi-conductor` follows test-first development

## Docs
- ADRs in `docs/adr/` (4 ADRs)
- PRDs in `docs/prd/` (1 PRD for pi-conductor MVP)
- Architecture plans in `docs/architecture/`

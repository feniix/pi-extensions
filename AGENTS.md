# Repository Guidelines

## Project Structure & Module Organization
- This repo is an npm workspace with independent packages in `packages/*`.
- Each package follows a consistent layout:
  - `extensions/index.ts` for the pi extension entry point.
  - `__tests__/` for Vitest tests (e.g., `index.test.ts`, `helpers.test.ts`).
  - `README.md`, `package.json`, and `LICENSE` per package.
- Root-level configs live in `biome.json`, `tsconfig.json`, and `vitest.config.ts`.

## Build, Test, and Development Commands
Run these from the repo root unless noted:
- `npm run lint` — Biome lint/format checks.
- `npm run lint:fix` — auto-fixable Biome issues.
- `npm run typecheck` — TypeScript type checking only.
- `npm run test` — Vitest test suite.
- `npm run check` — lint + typecheck.
- `npm run check:ci` — CI-friendly Biome + typecheck.

Local package testing:
- `cd packages/<package-name>`
- `pi -e .` — run the package in pi without installing.

## Coding Style & Naming Conventions
- Language: TypeScript.
- Formatting: Biome with **tabs** for indentation and `lineWidth` 120.
- File naming: tests live in `__tests__` and use `*.test.ts`.
- Package naming: `packages/pi-<name>` with npm scope `@feniix/pi-<name>`.

## Testing Guidelines
- Framework: Vitest (see `vitest.config.ts`).
- Tests are per-package under `packages/*/__tests__/`.
- Keep unit tests focused on extension behavior and helpers; prefer fast, isolated tests.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- PRs should include:
  - A short summary and the affected package(s).
  - Tests run (e.g., `npm run test`, `npm run check`).
  - Linked issues or context for behavior changes.
  - Notes on any new configuration or environment variables.

## Available Tools

### Ref.tools — Documentation Search & Reading

This workspace includes the `pi-ref-tools` extension which provides two tools for looking up technical documentation. **Use these tools proactively** when working with any library, framework, or API — checking the docs avoids hallucinating parameters, options, or patterns.

#### `ref_search_documentation`

Search indexed technical documentation. Returns a list of relevant doc pages with URLs and summaries.

```
ref_search_documentation({ query: "Next.js App Router dynamic routes" })
ref_search_documentation({ query: "Rust tokio spawn async tasks" })
ref_search_documentation({ query: "PostgreSQL JSONB indexing" })
```

- `query` (string, required): A full sentence or question. **Always include the language, framework, or library name** for best results.
- Returns: A list of doc pages, each with an overview/description, URL, and module ID.

#### `ref_read_url`

Read a documentation URL and return its content as optimized markdown. Use this to get the full details of a page found via `ref_search_documentation`, or to read any documentation URL directly.

```
ref_read_url({ url: "https://tailwindcss.com/docs/flex" })
ref_read_url({ url: "https://docs.rs/tokio/latest/tokio/task/fn.spawn.html" })
```

- `url` (string, required): The exact URL to read. Best results come from passing URLs returned by `ref_search_documentation`.
- Returns: The page content as token-optimized markdown.

#### Typical workflow

1. **Search first**: `ref_search_documentation({ query: "Express.js middleware error handling" })`
2. **Read the best result**: `ref_read_url({ url: "<url from search results>" })`
3. **Use what you learned** to write correct code.

Both tools support optional `piMaxBytes` and `piMaxLines` integer parameters to override client-side output truncation (clamped by configured maximums).

## Security & Configuration Tips
- Do not commit API keys. Use environment variables or the config file locations documented in each package README (e.g., under `~/.pi/agent/extensions/`).
- If you change defaults or CLI flags, update the package README accordingly.
- Tool schemas: avoid `Type.Unknown()` in tool parameters. It serializes to `{}`, which some inference backends reject as invalid JSON Schema. Prefer `Type.Object({}, { additionalProperties: true })`.

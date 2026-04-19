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
- `npm run test:coverage` — Vitest coverage run with repo-wide thresholds.
- `npm run check` — lint + typecheck.
- `npm run check:ci` — CI-friendly Biome + typecheck.
- `npm run ci:detect -- <base> <head>` — show which packages the CI workflow will check for a given diff.

Local package testing:
- `cd packages/<package-name>`
- `pi -e .` — run the package in pi without installing.
- `npx biome ci packages/<package-name>` — lint a single package.
- `npx tsc --noEmit --project packages/<package-name>/tsconfig.json` — typecheck a single package using the shared root TS config via the package wrapper tsconfig.
- `npx vitest run packages/<package-name>/__tests__` — run tests for a single package.

## Coding Style & Naming Conventions
- Language: TypeScript.
- Formatting: Biome with **2 spaces** for indentation and `lineWidth` 120.
- File naming: tests live in `__tests__` and use `*.test.ts`.
- Package naming: `packages/pi-<name>` with npm scope `@feniix/pi-<name>`.

## Testing Guidelines
- Framework: Vitest (see `vitest.config.ts`).
- Tests are per-package under `packages/*/__tests__/`.
- Keep unit tests focused on extension behavior and helpers; prefer fast, isolated tests.
- CI uses a single GitHub Actions workflow at `.github/workflows/ci.yml` that detects changed packages and runs package-scoped lint, typecheck, test, and coverage summary jobs.
- Package-scoped CI coverage is enforced per extension with the same thresholds for every package: lines 70, statements 70, functions 70, branches 60.
- Changes to shared files such as `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, or `.github/workflows/**` should be treated as affecting all packages.
- Each package must keep its `tsconfig.json` aligned by extending the shared root `tsconfig.json`; do not introduce divergent compiler options in individual package configs unless the repo-wide config is intentionally updated.
- Coverage thresholds are enforced in `vitest.config.ts` at: lines 70, statements 70, functions 70, branches 60.
- For `packages/pi-conductor/`, follow **test-first development**: write or update the failing test first, then implement the minimal code needed to make it pass.

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

### Sequential Thinking — Structured Problem Solving

This workspace includes the `pi-sequential-thinking` extension which provides tools for breaking down complex problems into structured, sequential thoughts through five cognitive stages. **Use these tools when facing complex decisions, architecture planning, or multi-faceted analysis** where step-by-step reasoning produces better outcomes.

#### `process_thought`

Record and analyze a sequential thought with metadata. Each thought progresses through stages and is analyzed in context of the full sequence.

```
process_thought({
  thought: "The authentication system needs to support both JWT and session-based auth for backward compatibility.",
  thought_number: 1,
  total_thoughts: 5,
  next_thought_needed: true,
  stage: "Problem Definition",
  tags: ["auth", "backward-compat"],
  axioms_used: ["Maintain backward compatibility during migrations"],
  assumptions_challenged: ["All clients can support JWT"]
})
```

- `thought` (string, required): The content of your thought.
- `thought_number` (integer, required): Position in the sequence (starting at 1).
- `total_thoughts` (integer, required): Expected total number of thoughts.
- `next_thought_needed` (boolean, required): Whether more thoughts follow this one.
- `stage` (string, required): One of `"Problem Definition"`, `"Research"`, `"Analysis"`, `"Synthesis"`, `"Conclusion"`.
- `tags` (string[], optional): Keywords or categories.
- `axioms_used` (string[], optional): Principles or axioms applied.
- `assumptions_challenged` (string[], optional): Assumptions questioned.
- Returns: Analysis including related thoughts, progress percentage, and stage context.

#### `generate_summary`

Generate a summary of the entire thinking process after recording multiple thoughts.

```
generate_summary()
```

- Returns: Stage counts, timeline, top tags, and completion status.

#### `clear_history`

Reset the thinking session by clearing all recorded thoughts.

```
clear_history()
```

#### `export_session` / `import_session`

Save or load thinking sessions for reuse.

```
export_session({ file_path: "/tmp/my-analysis.json" })
import_session({ file_path: "/tmp/my-analysis.json" })
```

#### Typical workflow

1. **Define the problem**: `process_thought({ ..., stage: "Problem Definition", thought_number: 1, ... })`
2. **Research**: `process_thought({ ..., stage: "Research", thought_number: 2, ... })`
3. **Analyze**: `process_thought({ ..., stage: "Analysis", thought_number: 3, ... })`
4. **Synthesize**: `process_thought({ ..., stage: "Synthesis", thought_number: 4, ... })`
5. **Conclude**: `process_thought({ ..., stage: "Conclusion", thought_number: 5, next_thought_needed: false, ... })`
6. **Review**: `generate_summary()`

## Security & Configuration Tips
- Do not commit API keys. Use environment variables or the config file locations documented in each package README (e.g., under `~/.pi/agent/extensions/`).
- If you change defaults or CLI flags, update the package README accordingly.
- Tool schemas: avoid `Type.Unknown()` in tool parameters. It serializes to `{}`, which some inference backends reject as invalid JSON Schema. Prefer `Type.Object({}, { additionalProperties: true })`.

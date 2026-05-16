# Code Context

## Files Retrieved
1. `AGENTS.md` (lines 1-83) - repo conventions: npm workspace, TS, Biome 2-space/120 cols, Vitest, package layout.
2. `package.json` (lines 1-45) - root scripts/workspaces and registered pi extensions.
3. `packages/pi-sequential-thinking/README.md` (lines 1-126) - documented tools/config/stages.
4. `packages/pi-sequential-thinking/extensions/index.ts` (lines 317-386, 393-778) - schemas, flags, tools, runtime flow incl undocumented `sequential_think`.
5. `packages/pi-sequential-thinking/extensions/types.ts` (lines 1-143) - stage enum, `ThoughtData`, validation/serialization/UUID.
6. `packages/pi-sequential-thinking/extensions/analyzer.ts` (lines 1-186) - related-thought analysis and summary generation.
7. `packages/pi-sequential-thinking/extensions/storage.ts` (lines 1-147) - persistent session store/import/export.
8. `packages/pi-code-reasoning/README.md` (lines 1-122) - adjacent package feature model: branching/revision/status/reset/checklist.
9. `packages/pi-code-reasoning/extensions/types.ts` (lines 1-153), `extensions/index.ts` (lines 309-699) - stricter validation, tracker, ergonomic errors.

## Key Code
- Root shape: npm workspace `packages/*`; each package has `extensions/index.ts`, `__tests__`, README/package metadata; root scripts: `lint`, `typecheck`, `test`, `check`.
- `pi-sequential-thinking` registers flags at `index.ts` 393-414 and tools at 594-778: `process_thought`, `generate_summary`, `clear_history`, `export_session`, `import_session`, plus `sequential_think` not documented in README/tests.
- `process_thought` (`index.ts` 511-557) casts raw params, parses 5 fixed stages, validates only non-empty thought, thought_number >=1, total >= current, stores then analyzes.
- Schemas (`index.ts` 317-386) include `additionalProperties: true`, `piMaxBytes/piMaxLines`; no branch/revision fields.
- `ThoughtAnalyzer` finds related thoughts by same stage/shared tags and summarizes stage counts/timeline/top tags/completion (`analyzer.ts` 47-186).
- `ThoughtStorage` persists to `~/.mcp_sequential_thinking/current_session.json` by default and supports JSON import/export with corrupted-file backup (`storage.ts` 13-147).

## Architecture
- Extension entrypoint owns config/flags/output truncation; creates singleton `ThoughtStorage` + `ThoughtAnalyzer`.
- Tool calls deserialize params -> build `ThoughtData` -> persist in storage -> analyzer returns JSON-ish result -> `formatToolOutput` truncates and attaches details.
- Session state is durable for sequential-thinking, unlike `pi-code-reasoning` which uses an in-memory tracker for branches/revisions/status.

## Current capabilities/gaps
- Capabilities: staged thinking, tagging/axioms/assumptions metadata, related-thought lookup, summaries, persistent import/export, output limits.
- Gaps likely vs external sequential-thinking implementations: no branching, revision, dynamic total adjustment semantics beyond caller-supplied fields, thought reference validation/order limits, status tool, or rich guidance/error examples.
- Validation gap: `types.ts` has reusable `validateThoughtData` but `index.ts` duplicates partial checks and does not enforce integer types/required booleans/array element types/max length.
- UX/doc gap: `sequential_think` exists but is not in README feature/tool list or registration test expectations; it stores prompt templates as thoughts rather than model-generated reasoning.

## Likely leverage points
- Borrow from `pi-code-reasoning`: `ValidatedThoughtData`, max thought length/count constants, cross-field validation, tracker/status/reset tools, guidance-rich `buildError`, checklist-oriented descriptions.
- Add branch/revision fields to `ThoughtData` + schemas/storage/analyzer if aligning with external sequential-thinking MCP behavior; migration safe because storage serialization already tolerates missing fields if extended carefully.
- Consider extracting duplicated config/output helpers later, but keep package-scoped changes and tests first per repo guidance.

## Start Here
Open `packages/pi-sequential-thinking/extensions/index.ts` first: it defines public schemas/tools and is where external sequential-thinking behavior would be surfaced.

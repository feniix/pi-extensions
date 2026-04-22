# Shared Tooling Policy

Use this reference whenever a specdocs skill needs to explore the repository, inspect related documents, or research external technologies.

## Tool priority

Use the tools that are actually available in the harness and prefer the simplest option that gives reliable evidence:

1. **Codebase exploration:** use built-in tools such as `read` and `bash` with `find`, `rg`, and directory listing to inspect files, related docs, and existing patterns
2. **Specdocs validation/formatting:** prefer the `specdocs_validate` and `specdocs_format` tools when they are available; these are the LLM-callable path for validating and formatting spec artifacts
3. **External research:** prefer **exa** (`web_search_exa`, `web_search_advanced_exa` when filters or tighter control are needed) and/or **ref** (`ref_search_documentation`, `ref_read_url`)
4. **Fallbacks:** if Exa or Ref are unavailable, continue with built-in file and search tools plus repository-local documentation
5. **File writes and final artifact creation:** use built-in file I/O tools for writing PRDs, ADRs, plans, or config files

## Specdocs command/tool guidance

`specdocs-validate` and `specdocs-format` exist in two forms:
- **Tools**: `specdocs_validate` and `specdocs_format` — preferred when the LLM should execute validation/formatting itself
- **Pi slash commands**: `/specdocs-validate` and `/specdocs-format <path>` — useful for manual invocation by the user

Do not treat `specdocs-validate` or `specdocs-format` as bash executables or check PATH for them.
Use the tools when available. Mention the slash commands only for manual use or when explicitly discussing interactive pi usage.

## Working style

- Read existing docs before drafting new ones
- Prefer repository-specific evidence over generic assumptions
- Trace recommendations back to actual files, symbols, and patterns in the codebase
- When doing external research, capture only the findings that materially affect the recommendation or spec
- Avoid doing broad research if the decision is obviously local to the current codebase

## Output expectations

- Produce concrete file paths, not vague references to “the auth module” or “the backend layer”
- Link recommendations to the constraints you discovered
- If a required tool or data source is unavailable, say so and continue with the best fallback rather than stalling

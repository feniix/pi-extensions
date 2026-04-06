---
description: "Deep review of a PRD or ADR for risks, bugs, ambiguities, errors, and inconsistencies"
---

# /refine

Deep review of a spec document (PRD or ADR) for risks, bugs, ambiguities, errors, and inconsistencies. Designed to be run iteratively — each pass sharpens the document further.

**Input**: $@

## Tool Strategy

Use MCP tools as the primary means of investigation. Fall back to built-in tools only when the corresponding MCP server is not connected.

- **serena** — primary tool for codebase investigation. Key tools:
  - `list_dir`, `find_file`, `search_for_pattern` — navigate the project structure and find relevant files
  - `find_symbol`, `get_symbols_overview`, `find_referencing_symbols` — trace symbol references and understand module relationships
  - `read_file` — read full files when symbol-level tools aren't precise enough
- **code-reasoning** (`code-reasoning`) — reason through complex dependency chains and architectural implications that aren't obvious from reading code alone.
- **exa** (`web_search_exa`, `get_code_context_exa`) — web research on technology claims and known issues.
- **ref** (`ref_search_documentation`, `ref_read_url`) — verify referenced standards, specifications, and library documentation.
- **sequential-thinking** (`process_thought`, `generate_summary`, `clear_history`) — work through the review systematically.

## Input

- `$@` — Path to a PRD or ADR file. If not provided, check conversation context for a recently created or discussed document. As a last resort, search `docs/prd/` and `docs/adr/` for the most recently modified file.

## Process

### 1. Read and Classify the Document

Read the document fully. Determine whether it's a PRD or ADR from its structure and frontmatter. This determines which review criteria to apply.

### 2. Research and Validate

Before flagging issues, do the homework. Use **sequential-thinking** to structure your approach — identify what needs checking, work through it methodically, and track what you've verified vs what remains.

- **Codebase validation** — use **serena** to verify that file paths actually exist, that referenced modules behave as described, and that the blast radius is accurately captured. Use **code-reasoning** when you encounter complex dependency chains.
- **External research** — use **exa** and **ref** to validate technology claims, check for known issues with proposed approaches, and verify that referenced standards or specifications are current.

### 3. Analyze by Category

Review the document against these categories:

#### For PRDs:

| Category | What to look for |
|----------|-----------------|
| **Risks** | Unidentified technical risks, missing mitigations, severity/likelihood mismatches, risks that should block implementation |
| **Ambiguities** | Vague requirements ("should handle errors gracefully"), undefined terms, requirements that could be interpreted multiple ways, missing acceptance criteria |
| **Errors** | Incorrect file paths, wrong module references, inaccurate descriptions of current behavior, stale API references, Gherkin scenarios that don't match the requirement |
| **Inconsistencies** | Requirements that contradict each other, scope items that don't match the file breakdown, success metrics that don't align with goals, design decisions that conflict with requirements |
| **Gaps** | Missing requirements for edge cases, unaddressed NFRs, missing rollout considerations, open questions that should be resolved before implementation |

#### For ADRs:

| Category | What to look for |
|----------|-----------------|
| **Risks** | Consequences not fully explored, missing negative consequences, mitigations that are vague or insufficient |
| **Ambiguities** | Decision drivers that are subjective without criteria, options lacking concrete evaluation, unclear boundary between this decision and related ones |
| **Errors** | Incorrect technical claims about options, outdated benchmarks or comparisons, wrong assumptions about the current codebase |
| **Inconsistencies** | Chosen option doesn't align with stated drivers, pros/cons that contradict each other across options, consequences that conflict with the rationale |
| **Gaps** | Missing viable options, pros/cons that apply to all options but are only listed for some, missing consideration of migration or rollback path |

### 4. Present Findings

Organize findings in a table:

| # | Category | Severity | Section | Finding | Suggestion |
|---|----------|----------|---------|---------|------------|
| 1 | Error | High | §9 File Breakdown | `src/auth/session.ts` doesn't exist — the module was renamed to `src/auth/session-manager.ts` in PR #89 | Update path to `src/auth/session-manager.ts` |
| 2 | Ambiguity | Medium | §5 FR-3 | "Handle rate limiting appropriately" — no Gherkin scenario defines what "appropriately" means | Add scenario: `Given the API returns 429, When the client retries, Then it uses exponential backoff with max 3 retries` |
| ... | | | | | |

**Severity levels:**
- **High** — would cause implementation to go in the wrong direction or miss critical requirements
- **Medium** — creates confusion or could lead to rework, but won't derail implementation
- **Low** — polish items, minor inconsistencies, or suggestions for clarity

### 5. Summarize

After the findings table, provide:

- **Total findings** by severity (e.g., "3 high, 5 medium, 2 low")
- **Top priority** — the 1-3 findings that should be addressed before moving forward
- **Assessment** — is this document ready for implementation, or does it need another pass?

Do NOT make changes to the document automatically. Present findings and let the user decide what to address. If the user asks you to fix specific findings, apply the changes and note what was updated.

### 6. On Subsequent Passes

When `/refine` is run again on the same document (or the user says "refine again"):

- Note which previously identified issues have been resolved
- Look deeper — the first pass catches surface issues, subsequent passes should dig into subtler problems
- Check that fixes didn't introduce new inconsistencies
- Be honest if the document looks solid — don't invent issues to justify the pass

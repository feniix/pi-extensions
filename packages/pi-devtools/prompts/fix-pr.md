---
description: "(devtools plugin) Fetch, classify, and resolve PR review feedback — then commit and push fixes."
argument-hint: "[PR number]"
---

# /fix-pr

Fetch all pending review comments on a PR, classify them, and apply fixes in a single round.

**Usage**: `/fix-pr [PR number]`

## Preconditions

Before starting, verify all of these. If any fail, stop and explain why.

1. **gh CLI**: `gh` must be installed and authenticated (`gh auth status`)
2. **Git repo**: current directory must be a git repository
3. **PR exists**: there must be an open PR for the current branch (or the PR number provided as `$ARGUMENTS`)

## Process

### 1. Identify the PR

- If `$ARGUMENTS` contains a PR number, use that
- Otherwise, detect the current branch and find its PR:
  ```bash
  gh pr view --json number,title,headRefName,body,state,author
  ```
- If no PR exists or it's closed/merged, report "No open PR found for the current branch" and suggest switching to a feature branch or providing a PR number

If the user provided a PR number and is not on the PR's branch, tell them and offer to check out the branch. Wait for confirmation before switching.

Store the PR number, title, head branch, body, and **author login** for later steps.

### 2. Fetch review feedback and detect linked issue

Fetch both comment types in parallel. Also detect the linked issue now (it only needs the PR body and branch name from step 1) so it's available for the commit message later.

#### 2a. Inline review threads (GraphQL)

This is the only way to get thread resolution state (`isResolved`). Extract the owner and repo from the remote URL, then run:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            comments(last: 5) {
              nodes {
                body
                path
                originalLine
                diffHunk
                createdAt
                author { login }
              }
            }
          }
        }
      }
    }
  }
' -F owner=OWNER -F repo=REPO -F number=NUMBER
```

If `pageInfo.hasNextPage` is `true`, paginate using the `after` cursor on the `reviewThreads` connection until all threads are fetched.

For each unresolved thread, collapse the reply chain: surface only the **latest reviewer message** (skip comments whose `author.login` matches the PR author from step 1) as the actionable item. Include the `path`, `originalLine`, and `diffHunk` for locating the code.

#### 2b. Top-level PR comments (REST)

```bash
gh pr view NUMBER --json comments
```

These are freeform markdown with no structured file/line data. File references must be parsed from the body (see step 3).

Also fetch the list of commits pushed after the PR was created, for the "addressed" heuristic:

```bash
gh pr view NUMBER --json commits
```

#### 2c. Detect linked issue

Discover the issue the PR addresses for the commit message (step 7). This is best-effort — never prompt the user for an issue number. Run this alongside the comment fetching since it only needs the PR body and branch name from step 1.

**PR body scan** — scan the PR body for issue references:

| Pattern | Tracker | Example |
|---------|---------|---------|
| `Closes #N`, `Fixes #N`, `Resolves #N` (case-insensitive) | GitHub Issues | `Closes #78` → `#78` |
| `Close #N`, `Fix #N`, `Resolve #N` (case-insensitive) | GitHub Issues | `Fix #78` → `#78` |
| `#N` (bare, without closing keyword) | GitHub Issues | `#78` → `#78` |
| `TEAM-N` (uppercase letters + hyphen + number) | Linear | `SPA-72` → `SPA-72` |

When multiple references are found, prefer the one with a closing keyword (`Closes`, `Fixes`, `Resolves`, etc.). If none have closing keywords, use the first reference found. Only one issue is included in the commit message.

**Branch name scan** — if no issue was found in the PR body, parse the branch name (from step 1):

| Pattern | Example | Result |
|---------|---------|--------|
| `type/TEAM-N-slug` (team prefix present) | `feature/SPA-57-evie-cli` | `SPA-57` (Linear — prefix is self-describing) |
| `type/N-slug` (bare number, no prefix) | `bug/48-ansible-warning` | `#48` (GitHub Issues — default) |

**Tracker config** (fallback for bare numbers) — if the branch name yielded a bare number (no team prefix), use the Read tool to check `.claude/tracker.md`. If the file exists and contains `tracker: linear` with a `linear-team: TEAM` field, reinterpret the bare number as a Linear issue: `N` → `TEAM-N`. For example, if `linear-team: SPA`, then `42` → `SPA-42`. If the file doesn't exist or `tracker` is not `linear`, keep the bare number as a GitHub issue: `#N`.

**Result**: store the linked issue reference (e.g., `#78`, `SPA-72`) or `null` if none found.

### 3. Parse and normalize comments

Merge both comment types into a unified list grouped by file.

#### Inline review threads

Already have structured `path` and `originalLine`. Add each unresolved thread to the list under its file path.

#### Top-level comments — file reference extraction

Parse file references from comment body text using these patterns (in order of specificity):

| Pattern | Example | Extracted |
|---------|---------|-----------|
| Backtick-wrapped path with line range | `` `src/auth.ts:42-55` `` | `src/auth.ts`, lines 42-55 |
| Backtick-wrapped path with line | `` `src/auth.ts:42` `` | `src/auth.ts`, line 42 |
| Parenthesized path with line range | `(RadarChart.vue:193-214)` | `RadarChart.vue`, lines 193-214 |
| Parenthesized path with line | `(Matrix.vue:88)` | `Matrix.vue`, line 88 |
| Backtick-wrapped path only | `` `src/auth.ts` `` | `src/auth.ts`, no line |

A "path" must contain at least one `/` or end with a recognized code file extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.vue`, `.svelte`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.md`, `.json`, `.yaml`, `.yml`, `.toml`, `.css`, `.scss`, `.html`, `.sh`).

Comments with no file references go to a **"General"** group.

#### Multi-item comment splitting

Top-level comments frequently contain multiple numbered findings (e.g., code-review bot output). When a comment body matches this pattern:

```
**N. Title** (`file:line`) or **N. Title** (`file:line-line`)
```

...or uses structured severity headings:

```
### Critical
**1. Finding title** (`file:line`)
...
### Major
**2. Finding title** (`file:line`)
...
### Minor
**3. Finding title**
...
```

Split each numbered item into a separate entry in the unified list with its own file references. Preserve the severity heading (`Critical`, `Major`, `Minor`, `Nit`) as metadata on each item. Items under a heading inherit that heading's severity until the next heading.

If the comment does not match these patterns, treat the entire comment as a single item.

#### "Addressed" heuristic

- **Inline review threads**: use the `isResolved` field from GraphQL. If `true`, mark as "Already resolved."
- **Top-level comments** (or individual split items): compare the comment's `createdAt` timestamp against commits pushed after that time. If all files referenced by the item were modified in a commit after the comment timestamp, mark as "Likely addressed" and show the commit SHA. The user can choose to skip or re-examine these.

### 4. Classify comments

Classify each unresolved, non-addressed comment on two dimensions:

#### Intent

| Category | Signal | Action |
|----------|--------|--------|
| **Actionable fix** | Concrete code change requested — "rename this", "use >= instead of >", "remove this line" | Will propose a fix |
| **Question** | Interrogative phrasing — "why did you…", "have you considered…", "what happens if…" | Flag for manual response |
| **Nit** | Optional / non-blocking — "consider extracting", "might be cleaner as", "nit:", "minor:" | Show but deprioritize |
| **Already addressed** | Matched by the addressed heuristic in step 3 | Show with commit SHA |

**Severity-heading shortcut**: when an item was split from a comment with structured severity headings:
- `### Critical` or `### Major` → default to **Actionable fix**
- `### Minor` or `### Nit` → default to **Nit**

The classification may still be adjusted based on the actual comment content (e.g., a "Major" heading on a question is still a question).

#### Complexity (actionable fixes only)

| Tier | Criteria | Behavior |
|------|----------|----------|
| **Simple** | Single-line or localized change; the fix is extractable from the comment text (e.g., "use `>=`", "rename `foo` to `bar`", "add null check") | Auto-propose a fix |
| **Complex** | Requires reading surrounding code, cross-file patterns, or judgment calls (e.g., "refactor to use the same pattern as PughMatrix") | Describe what needs to change; defer editing to user/agent |

### 5. Present the summary (hybrid strategy)

Display all comments grouped by file, with classification labels and summary counts.

#### Summary header

```
## PR #42 Review Feedback — 8 comments across 4 files

| Status          | Count |
|-----------------|-------|
| Actionable fix  | 4 (3 simple, 1 complex) |
| Question        | 1 |
| Nit             | 1 |
| Already resolved| 1 |
| Likely addressed| 1 |
```

#### Per-file detail

For each file with comments, show:

```
### src/auth.ts (2 comments)

1. **[Simple fix]** "Use >= instead of > to handle the boundary case" (line 42, @reviewer)
   → Proposed: change `>` to `>=` on line 42

2. **[Complex fix]** "Refactor latestScores to use NormalizedRating" (lines 88-101, @reviewer)
   → Needs: restructure the latestScores map to use NormalizedRating with .timestamp field
```

For the General group (no file references):

```
### General (2 comments)

1. **[Already resolved]** Inline thread about naming convention (@reviewer)
2. **[Nit]** "Consider adding a brief doc comment on the exported types" (@reviewer)
```

#### Condensed path for trivial reviews

If **all** comments are simple fixes (no complex, no questions), condense the summary to a single confirmation:

```
All 2 comments are simple fixes:
- src/auth.ts:42 — change `>` to `>=`
- src/config.ts:15 — rename `foo` to `fooBar`

Apply these fixes? [yes / no / show details]
```

#### User selection

After presenting the summary, ask the user which items to address. The default is **all simple fixes selected**:

```
Apply 3 simple fixes? (1 complex fix and 1 question need manual attention)
[yes / no / select individually]
```

- **yes** → apply all simple fixes in batch (proceed to step 6)
- **no** → stop; the summary is still useful as a review organizer
- **select individually** → let the user toggle specific items on/off, then apply selected

**Do not modify any files until the user confirms.**

### 6. Apply fixes

For each confirmed simple fix:

1. Read the target file
2. Locate the code to change:
   - For inline review comments: use the `diffHunk` context and `originalLine` to find the exact position. If line numbers have shifted since the review, search for the code pattern from the `diffHunk` in the surrounding area (±20 lines). Warn the user if the match is ambiguous.
   - For top-level comments with parsed line references: read the file and verify the code at that line matches what the comment describes. If it doesn't match, search nearby.
3. Apply the fix using the `Edit` tool
4. Stage the file: `git add <file>`

After applying all simple fixes, list any remaining items:

```
## Applied
- src/auth.ts:42 — changed `>` to `>=`
- src/config.ts:15 — renamed `foo` to `fooBar`
- src/utils.ts:8 — added null check

## Remaining (needs manual attention)
- **[Complex]** src/auth.ts:88-101 — refactor latestScores to use NormalizedRating
- **[Question]** src/auth.ts:120 — reviewer asks: "Why Redis over Memcached?"
```

### 7. Commit and push

If no fixes were applied (user declined all, or all comments were already addressed), report "No changes to commit" and stop.

Otherwise:

#### 7a. Craft the commit message

Format: `fix: address PR #N review feedback (ISSUE-REF)` — use the linked issue reference from step 2c.

- If a linked issue was found: `fix: address PR #42 review feedback (SPA-72)`
- If no linked issue: `fix: address PR #42 review feedback`

The commit body lists each file changed with a one-line summary:

```
- src/auth.ts: use >= instead of > for boundary check
- src/config.ts: rename foo to fooBar
- src/utils.ts: add null check for optional param
```

#### 7b. Create the commit

```bash
git commit -m "$(cat <<'EOF'
fix: address PR #42 review feedback (SPA-72)

- src/auth.ts: use >= instead of > for boundary check
- src/config.ts: rename foo to fooBar
- src/utils.ts: add null check for optional param
EOF
)"
```

If the commit fails due to a pre-commit hook, show the hook output, help fix the issue, re-stage, and create a **new** commit. Never use `--amend`.

#### 7c. Push

```bash
git push
```

If the push fails, show the error and suggest next steps.

#### 7d. Report

```
Pushed fix commit <SHA> to PR #42.
- 3 simple fixes applied
- 1 complex fix remaining (needs manual attention)
- 1 question remaining (needs response to @reviewer)
```

### 8. Idempotency

If the command is run again with no new unresolved comments since the last fix commit:

```
No new review comments to address on PR #42.
All inline threads are resolved and no new top-level comments since last fix commit (<SHA> at <timestamp>).
```

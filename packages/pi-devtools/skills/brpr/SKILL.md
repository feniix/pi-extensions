---
name: brpr
description: "(devtools plugin) Create a branch, commit changes, push, and open a PR — or just commit+push+PR if already on a feature branch. Links related issues from GitHub or Linear based on project tracker config."
argument-hint: "[branch-type/description]"
context: fork
---

# Branch, Push, and PR Workflow

Creates a branch (if needed), commits changes, pushes, and opens a pull request. Links related issues from GitHub or Linear based on project tracker config.

## Tool Restrictions (Critical)

Use ONLY these tools:
- `devtools_get_repo_info` - Get current branch/status
- `devtools_create_branch` - Create feature branch
- `devtools_commit` - Stage and commit changes
- `devtools_push` - Push to remote
- `devtools_create_pr` - Create PR
- `Read` - Read tracker config and PR templates
- `Glob` - Find PR template files
- `Grep` - Search for branch conventions
- `Write` - Create tracker config file

## Branch type reference

Default mapping from branch types to prefixes and conventional commit types. Both branch creation (step 2) and commit crafting (step 3) reference this table. If repo conventions (discovered in step 2a) define different prefixes or additional types, those override this table.

| Type | Branch prefix | Conventional commit type |
|------|--------------|------------------------|
| feature | `feature/` or `feat/` | `feat` |
| bug | `bugfix/` | `fix` |
| hotfix | `hotfix/` | `fix` |
| spike | `spike/` | `chore` |
| docs | `docs/` | `docs` |
| refactor | `refactor/` | `refactor` |

## Process

### Step 1: Check Current State

Call `devtools_get_repo_info` to understand current state:
- Are we on a feature branch or main/default?
- Are there uncommitted changes?

If on detached HEAD, abort with: "You're in detached HEAD state. Please checkout a branch first."

- **On the default branch** → continue to Step 2 (branch creation). The PR will target this branch.
- **On any other branch** → skip to Step 3 (commit). The PR will target the default branch.

### Step 2: Create Branch (if needed)

Only when on the default branch.

#### 2a. Discover branch naming conventions

Look for branch naming conventions in the repository:

- Check `CONTRIBUTING.md`, `CLAUDE.md`, `.github/CONTRIBUTING.md` using Read/Glob
- Check for patterns in recent branch names: `git branch -r --sort=-committerdate | head -20`

If conventions are found, follow them. Otherwise use the defaults from the **Branch type reference** table.

#### 2b. Determine branch type and name

- If `$ARGUMENTS` contains a branch spec like `feature/add-login`, parse the type from before the `/` and the description from after it. Normalize the prefix to match the reference table — so `bug/fix-login` becomes `bugfix/fix-login` because type "bug" maps to prefix `bugfix/`.
- If `$ARGUMENTS` contains just a type like `feature`, ask for a short description
- If `$ARGUMENTS` is empty, ask the user what type of change this is (feature, bug, hotfix, spike, docs, refactor) and a short description

Construct the branch name from the normalized type prefix and a kebab-case slug.

#### 2c. Create the branch

Call `devtools_create_branch` with the branch name.

### Step 3: Commit Changes

#### 3a. Show what will be committed

**Important**: Always ask user to confirm which files to commit. Never auto-stage everything.

Show `git status` summary. Watch for files that should **not** be committed: `.env`, credentials, private keys (`*.pem`, `*.key`), large binaries, build artifacts (`dist/`, `node_modules/`, `__pycache__/`). If any are present, call them out explicitly.

Tell the user exactly which files you intend to commit and **wait for confirmation**.

#### 3b. Craft the commit message

Use conventional commit format. Look up the commit type from the **Branch type reference** table using the current branch prefix. For branches created outside this command, also recognize shorthand prefixes: `feat/` → `feat`, `fix/` → `fix`.

If the branch prefix doesn't match any known pattern, ask the user which commit type to use.

Analyze the staged changes and draft a concise commit message:
- Subject line: `type: short description` (under 72 chars). If the repo uses scopes, include one — e.g., `feat(auth): add JWT validation`.
- Body (if needed): explain the **why**, not the what

Show the commit message and **wait for confirmation**.

#### 3c. Commit

Call `devtools_commit` with the confirmed message and files.

If the commit fails due to pre-commit hooks, show the error, help fix the issue, re-stage, and create a **new** commit. Do not use `--amend`.

### Step 4: Push

Call `devtools_push` to push to origin with upstream tracking.

### Step 5: Create the Pull Request

The PR covers **all commits on the branch** since it diverged from the base — not just the commit created in this run.

#### 5a. Read tracker config and ask about related issues

**Read the tracker config** using the Read tool on `.claude/tracker.md`. If the file doesn't exist, run the inline first-run setup:

1. Tell the user: "No tracker config found. I'll create `.claude/tracker.md`."
2. Ask: "Which issue tracker does this project use? **GitHub** (default) or **Linear**?"
3. If GitHub (or user confirms default): write `.claude/tracker.md` with `tracker: github`.
4. If Linear: ask for the team key (e.g., `SPA`, `ENG`), then write `.claude/tracker.md` with `tracker: linear` and `linear-team: <KEY>`.

Extract the `tracker` field (default: `github`) and `linear-team` field from the config.

**Auto-detect issue from branch name** by parsing the current branch name (after stripping the type prefix like `feature/`, `bugfix/`). Apply these patterns in order:

1. **Team-prefixed** — match `[A-Z]{2,}-\d+` (e.g., `SPA-42`, `ENG-123`). Always treated as a Linear identifier regardless of the configured tracker — the all-caps team prefix is unambiguous.
2. **Bare number** — match `^\d+-` at the start of the slug (e.g., `42-add-auth` → `42`). Interpreted based on the active tracker: `#42` for GitHub, `{linear-team}-42` for Linear.
3. **No match** — no issue auto-detected; fall through to the manual prompt.

**If an issue was auto-detected**, confirm with the user:
- Linear: "I detected Linear issue SPA-42 from the branch name. Include it in the PR? (yes/no)"
- GitHub: "I detected GitHub issue #42 from the branch name. Include it in the PR? (yes/no)"

**If no issue was auto-detected** (or user declined), prompt manually:
- When `tracker = linear`: "Is this work related to a Linear issue? (e.g., `SPA-42`)"
- When `tracker = github`: "Is this work related to an existing GitHub issue?"

If the user provides a bare number (e.g., `57`) and the tracker is Linear, interpret it as `{linear-team}-57`.

**Format the issue reference in the PR body:**

- **GitHub issues**: For PRDs or ADRs, use `Related to #123` — **never** use closing keywords (`Closes`, `Fixes`, `Resolves`) because GitHub auto-closes issues. For regular issues, `Closes #123` is fine.
- **Linear issues**: Always use `Related to SPA-42` — **never** use GitHub closing keywords with Linear identifiers.

#### 5b. Check for a PR template

Use Glob to look for a PR template:
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE/`

If a template exists, read it and fill it in based on the changes. If no template exists, use this structure — auto-check the type that matches the branch:

```markdown
## Summary
<1-3 bullet points describing what changed and why>

## Type of change
- [ ] Feature
- [ ] Bug fix
- [ ] Hotfix
- [ ] Spike / exploration
- [ ] Documentation
- [ ] Refactor

## Test plan
<how to verify this works>
```

For example, on a `feature/` branch the template would show `- [x] Feature` with the rest unchecked.

#### 5c. Create the PR

Call `devtools_create_pr` with:
- **title**: conventional commit style, under 70 chars (e.g., `feat: add JWT-based user authentication`)
- **body**: filled template with issue reference appended
- **base**: default branch from Step 1
- **draft**: true if user indicates work is still in progress

Report the PR URL to the user when done.

## Examples

### Basic workflow
```
User: Create a branch feature/user-auth and push my changes

1. devtools_get_repo_info → on main, changes present
2. devtools_create_branch { branchName: "feature/user-auth" }
3. (ask user to confirm files)
4. devtools_commit { message: "feat: add user authentication", files: [...] }
5. devtools_push
6. Read .claude/tracker.md → tracker: linear, linear-team: SPA
7. Auto-detect issue from branch → none found → ask user
8. devtools_create_pr { title: "feat: add user authentication", body: "..." }
```

### On existing branch with Linear issue
```
User: commit and push, then open a PR

1. devtools_get_repo_info → on feature/SPA-42-add-auth
2. (ask user to confirm files)
3. devtools_commit { message: "feat: add auth middleware", files: [...] }
4. devtools_push
5. Read .claude/tracker.md → tracker: linear, linear-team: SPA
6. Auto-detect issue: SPA-42 from branch → confirm with user
7. devtools_create_pr { title: "feat: add auth middleware", body: "...Related to SPA-42..." }
```

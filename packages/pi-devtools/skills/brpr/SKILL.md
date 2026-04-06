---
name: brpr
description: Branch, commit, push, and open a PR in one workflow. Use when user says "create a branch and PR", "branch and push", "/brpr", or any variation of branch + commit + push + PR workflow.
context: fork
---

# Branch, Push, and PR Workflow

Creates a branch (if needed), commits changes, pushes, and opens a pull request.

## Tool Restrictions (Critical)

Use ONLY these tools:
- `devtools_get_repo_info` - Get current branch/status
- `devtools_create_branch` - Create feature branch
- `devtools_commit` - Stage and commit changes
- `devtools_push` - Push to remote
- `devtools_create_pr` - Create PR

## Process

### Step 1: Check Current State

Call `devtools_get_repo_info` to understand current state:
- Are we on a feature branch or main?
- Are there uncommitted changes?

### Step 2: Create Branch (if needed)

If on main/default branch and have changes:
1. Ask user for branch name (format: `type/description`, e.g., `feature/add-login`)
2. Call `devtools_create_branch` with the branch name

If already on a feature branch, skip to Step 3.

### Step 3: Commit Changes

**Important**: Always ask user to confirm which files to commit. Never auto-stage everything.

1. Show `git status` summary
2. Ask user which files to commit
3. Call `devtools_commit` with the confirmed files

Use conventional commit format:
- `feat: add new feature`
- `fix: resolve bug`
- `docs: update readme`
- `refactor: improve code structure`

### Step 4: Push

Call `devtools_push` to push to origin.

### Step 5: Create PR

Call `devtools_create_pr` with:
- Title (conventional commit style)
- Optional body/description
- Base branch (usually default branch)

## Examples

### Basic workflow
```
User: Create a branch feature/user-auth and push my changes

1. devtools_get_repo_info
2. devtools_create_branch { branchName: "feature/user-auth" }
3. (ask user to confirm files)
4. devtools_commit { message: "feat: add user authentication" }
5. devtools_push
6. devtools_create_pr { title: "feat: add user authentication" }
```

### On existing branch
```
User: commit and push my changes, then open a PR

1. devtools_get_repo_info
2. (ask user to confirm files)
3. devtools_commit { message: "fix: resolve login redirect" }
4. devtools_push
5. devtools_create_pr { title: "fix: resolve login redirect" }
```

## Branch Naming

Use prefixes:
- `feature/` - New features
- `bugfix/` - Bug fixes
- `hotfix/` - Urgent fixes
- `docs/` - Documentation
- `refactor/` - Code refactoring
- `chore/` - Maintenance tasks

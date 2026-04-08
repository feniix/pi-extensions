---
description: "(devtools plugin) Merge a PR and delete the source branch."
argument-hint: "[PR number]"
---

# /md

Merge the current pull request using a standard merge commit (preserves all commit history) and delete the source branch.

**Usage**: `/md [PR number]`

## Tool Restrictions

Use ONLY these tools:
- `devtools_get_repo_info` - Get current branch/PR info
- `devtools_check_ci` - Check CI status before merging
- `devtools_merge_pr` - Merge and delete branch

## Preconditions

Before starting, verify all of these. If any fail, stop and explain why.

1. **Not on main**: if on `main`, abort with "Already on main — nothing to merge."
2. **PR exists**: there must be an open PR for the current branch or the PR number provided

## Process

### Step 1: Identify the PR

- If `$ARGUMENTS` contains a PR number, use that
- Otherwise, call `devtools_get_repo_info` to get the current branch and find its PR
- If no PR exists or it's already merged/closed, abort with an explanation

Show the PR details (number, title, base branch) and ask for confirmation.

### Step 2: Check CI Status

**Always** call `devtools_check_ci` before merging.

- If checks are failing or pending, warn the user and ask if they want to proceed anyway or wait
- If checks are passing, continue

### Step 3: Merge

Call `devtools_merge_pr` with:
- `prNumber`: The PR number
- `squash`: false
- `deleteBranch`: true

The merge creates a merge commit preserving the full branch history. The branch is deleted after merge (both remote and local).

If the merge fails (e.g., conflicts, branch protection), show the error and suggest next steps.

### Step 4: Cleanup

After the merge succeeds, checkout main/default branch and pull to update.

Report the merged PR URL and confirm the branch was deleted.

---
description: "(devtools plugin) Squash merge a PR and report best-effort source-branch cleanup."
argument-hint: "[PR number]"
---

# /smd

Squash-merge the current pull request (combines all commits into one) and request best-effort source-branch cleanup.

**Usage**: `/smd [PR number]`

## Tool Restrictions

Use ONLY these tools:
- `devtools_get_repo_info` - Get current branch/PR info
- `devtools_check_ci` - Check CI status before merging
- `devtools_squash_merge_pr` - Squash merge and report separate remote/local cleanup outcomes

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
- If no CI checks exist for the PR, continue without warning or additional confirmation

### Step 3: Squash Merge

Call `devtools_squash_merge_pr` with:
- `prNumber`: The PR number
- `deleteBranch`: true

The squash combines all commits into one. If the merge itself fails (e.g., conflicts, branch protection), show the error and suggest next steps.

### Step 4: Report Merge and Cleanup

Branch first on `mergeStatus`. When it is `pending`, report that the merge is queued or auto-merge is pending and that cleanup was skipped; do not report the PR as merged. When it is `unknown`, report that the merge command was accepted but its result could not be confirmed, that cleanup was skipped, and that the merge must not be retried automatically. Only when `mergeStatus` is `merged`, report the successful merge, then inspect `remoteCleanup` and `localCleanup` separately. Report `localCleanup.worktrees` paths and states when there is a retained local branch, and use `cleanupComplete` to identify partial cleanup. Only for a merged result, a retained local branch, skipped cleanup, or cleanup failure is incomplete cleanup after a successful merge rather than a merge failure. Do not switch to or update the default branch, which may be occupied by another worktree.

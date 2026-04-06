---
description: "Squash-merge the current PR and delete the branch"
---

# /smd

Squash-merge the current pull request (combines all commits into one) and delete the source branch.

**Requires**: PR number or current branch must have an associated PR.

## Process

### Step 1: Get PR Info

Call `devtools_get_repo_info` to identify the current PR.

### Step 2: Check CI

Always call `devtools_check_ci` before merging. If checks are failing, warn the user.

### Step 3: Squash Merge

Call `devtools_squash_merge_pr` with:
- `prNumber`: The PR number
- `squash`: true
- `deleteBranch`: true

### Step 4: Cleanup

After merge, checkout main and pull to update.

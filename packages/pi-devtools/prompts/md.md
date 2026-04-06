---
description: "Merge the current PR with a merge commit"
---

# /md

Merge the current pull request using a standard merge commit (preserves all commit history).

**Requires**: PR number or current branch must have an associated PR.

## Process

### Step 1: Get PR Info

Call `devtools_get_repo_info` to identify the current PR.

### Step 2: Check CI

Always call `devtools_check_ci` before merging. If checks are failing, warn the user.

### Step 3: Merge

Call `devtools_merge_pr` with:
- `prNumber`: The PR number
- `squash`: false
- `deleteBranch`: true

### Step 4: Cleanup

After merge, checkout main and pull to update.

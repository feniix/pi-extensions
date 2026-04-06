---
name: merge
description: Merge or squash-merge a pull request and delete the source branch. Use when user says "merge this PR", "squash merge", "md", "smd", or anything about merging pull requests.
context: fork
---

# Merge PR Workflow

Merge or squash-merge a pull request and optionally delete the source branch.

## Tool Restrictions (Critical)

Use ONLY these tools:
- `devtools_check_ci` - Check CI status before merging
- `devtools_merge_pr` - Standard merge (merge commit)
- `devtools_squash_merge_pr` - Squash merge
- `devtools_get_repo_info` - Get current PR info

## Process

### Step 1: Identify the PR

If user provides PR number, use it. Otherwise:
1. Call `devtools_get_repo_info` to get current branch
2. Find PR for current branch via `gh pr list`

### Step 2: Check CI Status

**Important**: Always check CI before merging.

Call `devtools_check_ci`:
- If checks are failing: warn user, ask to proceed or wait
- If checks are passing: continue
- If no checks: warn user (may need to proceed anyway)

### Step 3: Merge PR

Ask user for merge strategy:
- **Merge commit** (`devtools_merge_pr`): Preserves all commit history
- **Squash merge** (`devtools_squash_merge_pr`): Combines all commits into one

Default: Squash merge (cleaner history).

Call the appropriate tool with:
- `prNumber`: The PR number (or detect from current branch)
- `deleteBranch`: true (clean up source branch)
- `squash`: true for squash merge

### Step 4: Cleanup

After merge:
1. Checkout main/default branch
2. Pull to update

## Examples

### Merge PR
```
User: Merge PR #42

1. devtools_check_ci { prNumber: 42 }
   → All checks passing
2. devtools_merge_pr { prNumber: 42, deleteBranch: true }
3. gh pr 42 merged
```

### Squash merge
```
User: Squash merge and delete the branch

1. devtools_get_repo_info
2. devtools_check_ci
   → CI passing
3. devtools_squash_merge_pr { deleteBranch: true }
   → Squash-merged and branch deleted
```

### Check CI first
```
User: Can I merge this PR?

1. devtools_check_ci { prNumber: 123 }
   → 2 checks passing, 1 pending
2. "CI is still running. Wait for it to complete before merging."
```

## Merge Options

| Option | Description |
|--------|-------------|
| `--merge` | Standard merge (merge commit) |
| `--squash` | Squash merge (one commit) |
| `--rebase` | Rebase and merge |
| `--delete-branch` | Remove source branch after merge |

## Important Notes

- Always check CI status before merging
- Default to squash merge for cleaner history
- Always delete branch after merge (keeps repo clean)
- If merge fails, show error and suggest solutions (e.g., resolve conflicts)

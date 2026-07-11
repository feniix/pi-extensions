---
name: merge
description: Merge or squash-merge a pull request and report best-effort remote and local source-branch cleanup. Use when user says "merge this PR", "squash merge", "md", "smd", or anything about merging pull requests.
context: fork
---

# Merge PR Workflow

Merge or squash-merge a pull request and optionally request best-effort source-branch cleanup.

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
- `deleteBranch`: true to request best-effort remote and local cleanup
- `squash`: true for squash merge

### Step 4: Report Merge and Cleanup

Branch first on `mergeStatus` before interpreting any cleanup fields:
- When `mergeStatus` is `pending`, the merge is queued or auto-merge is pending. Explicitly report that it is pending and that cleanup was skipped; do not report the PR as merged or describe cleanup as incomplete after a successful merge.
- Only when `mergeStatus` is `merged`, report the successful merge and then inspect `remoteCleanup` and `localCleanup` separately. `remoteCleanup` reports whether the remote head ref was deleted, skipped, or failed. `localCleanup` reports whether the local branch was deleted, retained by one or more worktrees, skipped, or failed. When it is `retained`, report each retaining worktree path and state. Use `cleanupComplete` to summarize whether all requested cleanup completed.

Only for `mergeStatus: merged`, a retained local branch, skipped cleanup, or cleanup failure is incomplete cleanup after a successful merge, not a merge failure. Clearly report any recommended manual follow-up. Do not switch to or update the default branch after merging; it may be checked out in another worktree.

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
   → Squash-merged; remoteCleanup: deleted; localCleanup: retained (report worktree path)
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
| `deleteBranch` | Request separate best-effort remote and local source-branch cleanup |

## Important Notes

- Always check CI status before merging
- Default to squash merge for cleaner history
- Always branch first on `mergeStatus`; report `pending` as queued/auto-merge pending with cleanup skipped
- Only for `mergeStatus: merged`, inspect and report `remoteCleanup` and `localCleanup` separately and describe partial cleanup without misreporting the successful merge as failed
- If the merge itself fails, show the error and suggest solutions (e.g., resolve conflicts)

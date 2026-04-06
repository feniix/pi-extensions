---
name: release
description: Automate the release process. Use when user says "cut a release", "new version", "bump version", "publish release", or anything about versioning and publishing.
context: fork
---

# Release Workflow

Automates release: analyze commits, bump version, generate changelog, commit, push, and create GitHub release.

## Tool Restrictions (Critical)

Use ONLY these tools:
- `devtools_get_latest_tag` - Get current version
- `devtools_analyze_commits` - Analyze commits for version bump
- `devtools_bump_version` - Update package.json
- `devtools_commit` - Commit version bump
- `devtools_push` - Push changes
- `devtools_create_release` - Create GitHub release

## Preconditions

Verify these before starting:
1. On main/default branch (`devtools_get_repo_info`)
2. Working tree is clean (no uncommitted changes)
3. CI is passing on main

If any fail, stop and explain.

## Process

### Step 1: Analyze Commits

Call `devtools_analyze_commits` to:
- Find commits since last tag
- Determine bump type (major/minor/patch)
- Get suggested new version

Present to user:
- Show commits grouped by type
- Show suggested version bump
- Ask for confirmation or override

### Step 2: Bump Version

After user confirms:
1. Call `devtools_bump_version` with new version
2. Show the change to user

### Step 3: Generate Changelog

Create changelog from commit analysis:
- Group commits by type (Features, Fixes, Other)
- Capitalize first letter
- Keep concise

Present for user review and approval.

### Step 4: Commit and Push

1. Commit with message: `chore: bump version to vX.Y.Z`
2. Call `devtools_push`

### Step 5: Create Release

Call `devtools_create_release` with:
- Tag: `vX.Y.Z`
- Title: `vX.Y.Z`
- Body: Generated changelog

## Version Bump Rules

| Prefix | Bump |
|--------|------|
| `feat!:` or BREAKING CHANGE | Major |
| `feat:` | Minor |
| `fix:`, `perf:` | Patch |
| `chore:`, `docs:`, `refactor:`, etc. | Patch |

## Changelog Format

```markdown
### Features
- New feature description
- Another feature

### Fixes
- Bug fix description

### Other
- Chore or refactor
```

## Examples

```
User: Cut a new release

1. devtools_get_repo_info (verify on main, clean tree)
2. devtools_analyze_commits
   → Shows 2 features, 1 fix, 1 chore
   → Suggests: 1.2.0 → 1.3.0 (minor)
3. (user confirms minor bump)
4. devtools_bump_version { newVersion: "1.3.0" }
5. Generate changelog, show to user
6. devtools_commit { message: "chore: bump version to v1.3.0" }
7. devtools_push
8. devtools_create_release {
     tag: "v1.3.0",
     title: "v1.3.0",
     body: "### Features\n- Feature 1\n..."
   }
```

## Important Notes

- Tags are created via `gh release create` (not `git tag`)
- Always create a GitHub Release with changelog
- Wait for user confirmation before each destructive/important step

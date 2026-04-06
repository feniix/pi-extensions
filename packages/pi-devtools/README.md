# @feniix/pi-devtools

Devtools extension for [pi](https://pi.dev/) — branch and PR workflow, release automation, and merge commands.

## Features

- **Git Workflow Tools**: Create branches, commit, push, create PRs
- **Merge Commands**: Merge or squash-merge PRs with branch cleanup
- **Release Automation**: Analyze commits, bump versions, generate changelogs, create releases
- **CI Status Checking**: Check GitHub Actions status before merging or releasing

## Install

```bash
pi install npm:@feniix/pi-devtools
```

Ephemeral (one-off) use:

```bash
pi -e npm:@feniix/pi-devtools
```

## Tools

### Branch & PR Tools

| Tool | Description |
|------|-------------|
| `devtools_create_branch` | Create and switch to a new git branch |
| `devtools_commit` | Stage files and create a commit with conventional format |
| `devtools_push` | Push branch to remote with upstream tracking |
| `devtools_create_pr` | Create a GitHub pull request |
| `devtools_get_repo_info` | Get current branch, default branch, and remote info |

### Merge Tools

| Tool | Description |
|------|-------------|
| `devtools_merge_pr` | Merge a PR with optional branch deletion |
| `devtools_squash_merge_pr` | Squash-merge a PR with optional branch deletion |
| `devtools_check_pr_status` | Check CI status for a PR |
| `devtools_check_ci` | Check CI status for the current branch |

### Release Tools

| Tool | Description |
|------|-------------|
| `devtools_get_latest_tag` | Get the latest version tag from git |
| `devtools_analyze_commits` | Analyze commits since last tag to determine version bump |
| `devtools_bump_version` | Update version in package.json |
| `devtools_create_release` | Create a GitHub release with changelog |

## Skills

- **brpr**: Branch, commit, push, and open PR workflow
- **release**: Automated release process with changelog generation
- **merge**: Merge or squash-merge PRs

## Configuration

### Required: GitHub CLI

The `gh` CLI must be installed and authenticated:

```bash
gh auth login
```

### Optional: Default Branch

The extension auto-detects the default branch, but you can set it explicitly:

```bash
export DEFAULT_BRANCH=main  # or 'master'
```

## Requirements

- pi v0.51.0 or later
- `git` CLI
- `gh` CLI (authenticated)
- `jq` (for JSON parsing)

## License

MIT

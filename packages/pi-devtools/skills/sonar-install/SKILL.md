---
name: sonar-install
description: "(devtools plugin) Set up SonarQube scanning for a GitHub repo. Triggers when onboarding a new repo onto SonarQube, setting up code quality scanning, adding SonarQube to a project, or when user says 'set up sonar', 'add sonarqube', 'onboard to sonar', or 'sonar-install'."
---

# Set up SonarQube scanning for a GitHub repo

Onboard a repository onto SonarQube + the shared GitHub Action.

## Prerequisites

- `gh` CLI installed and authenticated
- `jq` installed
- User must be a Spantree GitHub org member (grants SonarQube admin via OAuth)
- Current directory must be a git repo with a GitHub remote

## Constants

| Name | Value |
|------|-------|
| SONAR_HOST_URL | `https://sonarqube.span.land` |
| GHA_SCANNER_USER | `gha-scanner` |
| Shared workflow | `Spantree/github-actions/.github/workflows/sonar.yml@main` |
| Shared action | `Spantree/github-actions/sonar@main` |

## Tools

Use **Bash** for all operations (curl, gh, open, echo, write).

## Process

### Step 1: Gather Repo Info

Get the GitHub org and repo name:

```bash
gh repo view --json owner,name -q '"\(.owner.login)_\(.name)"' | tr '[:upper:]-' '[:lower:]_'
```

Derive the project key: `<org>_<repo>`, lowercased, hyphens replaced with underscores.

Examples:
- `Spantree/trellis` → `spantree_trellis`
- `Spantree-SomeClient/bar` → `spantree_someclient_bar`

### Step 2: Authenticate to SonarQube

Open the auth page in browser (uses port 64120 which SonarQube validates):

```bash
open "https://sonarqube.span.land/sonarlint/auth?ideName=claude-sonar-skill&port=64120"
```

Ask user to copy the token value from the browser page, then store it:

```bash
USER_TOKEN="<pasted token>"
```

**Note:** Do NOT use `sonar auth login` — its interactive flow doesn't work in agent shell.

Verify the token:

```bash
curl -sf -u "$USER_TOKEN:" "https://sonarqube.span.land/api/authentication/validate" | jq .
```

If validation fails, stop and report the error.

### Step 3: Create SonarQube Project

Check if project exists:

```bash
curl -sf -u "$USER_TOKEN:" "https://sonarqube.span.land/api/components/show?component=PROJECT_KEY"
```

If 404, create it:

```bash
curl -sf -u "$USER_TOKEN:" -X POST "https://sonarqube.span.land/api/projects/create?project=PROJECT_KEY&name=PROJECT_NAME"
```

Use the repo name as the project name.

### Step 4: Generate Scan Token for gha-scanner

```bash
curl -sf -u "$USER_TOKEN:" -X POST \
  "https://sonarqube.span.land/api/user_tokens/generate?login=gha-scanner&name=PROJECT_KEY&type=USER_TOKEN"
```

Store the token value from the `token` field:

```bash
GHA_SCANNER_TOKEN="<token value>"
```

If a token with this name already exists (error returned), revoke and recreate:

```bash
curl -sf -u "$USER_TOKEN:" -X POST \
  "https://sonarqube.span.land/api/user_tokens/revoke?login=gha-scanner&name=PROJECT_KEY"
```

### Step 5: Set GitHub Repo Secret

```bash
echo "$GHA_SCANNER_TOKEN" | gh secret set SONAR_TOKEN --repo ORG/REPO
```

### Step 6: Add Workflow File

Ask user which approach they prefer:

**Option A — Reusable workflow (simpler, no build step):**

Template in `references/sonar-reusable.yml`. Write to `.github/workflows/sonar.yml`.

Ask about source directories (default: `src`).

**Option B — Composite action (for repos needing build/codegen):**

Template in `references/sonar-composite.yml`. Write to `.github/workflows/sonar.yml`.

Ask about:
- Source directories (default: `src`)
- Test directories (default: none)
- Test file patterns (default: none)
- Exclusions (default: `**/node_modules/**,**/dist/**`)
- Build steps needed before scanning

### Step 7: Grant gha-scanner Permissions

```bash
curl -sf -u "$USER_TOKEN:" -X POST \
  "https://sonarqube.span.land/api/permissions/add_user?login=gha-scanner&permission=scan&projectKey=PROJECT_KEY"
```

### Step 8: Cleanup

Get user login and revoke temp token:

```bash
USER_LOGIN=$(curl -sf -u "$USER_TOKEN:" "https://sonarqube.span.land/api/users/current" | jq -r '.login')
TOKEN_NAME=$(curl -sf -u "$USER_TOKEN:" "https://sonarqube.span.land/api/user_tokens/search?login=$USER_LOGIN" | jq -r '.userTokens[] | select(.name | startswith("SonarLint-claude-sonar-skill")) | .name')
curl -sf -u "$USER_TOKEN:" -X POST \
  "https://sonarqube.span.land/api/user_tokens/revoke?name=$TOKEN_NAME&login=$USER_LOGIN"
```

### Step 9: Summary

Print:
- SonarQube project URL: `https://sonarqube.span.land/dashboard?id=PROJECT_KEY`
- GitHub secret `SONAR_TOKEN` set
- Workflow file at `.github/workflows/sonar.yml`
- Reminder to commit and push to trigger first scan
- Note: dashboard shows onboarding tutorial until first analysis completes (normal)

## Error Handling

| Error | Action |
|-------|--------|
| `gh` not authenticated | Suggest: `gh auth login` |
| Project already exists | Skip creation, continue |
| gha-scanner token exists | Offer to revoke and recreate |
| API call fails | Show error response, stop |

## Important Notes

- Each repo gets its own token on gha-scanner, named by project key, for easy identification
- gha-scanner only needs scan permission on main project (auto-grants on branch projects)
- User's temp token is revoked at end — no lingering credentials
- Never use `git tag` — all tags created via `gh release create`

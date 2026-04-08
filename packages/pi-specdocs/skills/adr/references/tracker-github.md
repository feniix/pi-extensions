# Tracker: GitHub

Operations for GitHub issue tracking via the `gh` CLI. This file is loaded when the active tracker is `github` (the default).

## Identifier Format

- `#42` or plain `42` — GitHub issue numbers
- When the user provides an identifier, strip the `#` prefix if present to get the numeric ID

## Operations

### Fetch Issue

```bash
gh issue view <number> --comments
```

Retrieves the issue title, body, labels, and all comments. Always include `--comments` for source issues — the discussion often contains context the user didn't mention verbally.

### Create Issue

```bash
gh issue create --title "PRD-NNN: <title>" --body-file <path>
```

Use when a PRD is original work (no source issue). The PRD file becomes the issue body.

### Post Comment

```bash
gh issue comment <number> --body-file <path>
```

Use when a PRD was written *for* an existing issue. The PRD is posted as a comment on that issue.

### List Issues

```bash
gh issue list --state open --limit 20
```

Use when exploring related issues or searching for context.

## Frontmatter Convention

In PRD/ADR frontmatter, the `issue` field uses GitHub format:

```yaml
issue: "#42"
```

Or `"N/A"` if no source issue.

## Related Section Format

In the Related section of PRDs, reference issues as:

```markdown
| [#42 — Issue title](https://github.com/owner/repo/issues/42) | blocks / depends-on / enables |
```

## Tool Table Row

When listing tools in a skill, the tracker row is:

```markdown
| Tracker | **gh CLI** | Fetch issue details, post PRD/ADR as comment, create issues |
```

## Publishing Rules

| Origin | Action |
|--------|--------|
| **Source issue exists** — the PRD was written *for* a specific issue | `gh issue comment <number> --body-file <path>` |
| **Original PRD** — no source issue | `gh issue create --title "PRD-NNN: <title>" --body-file <path>` |

The distinction matters: "spec out a caching layer, see #42 for background" references #42 for context but the PRD is original work (new issue). Versus "write a PRD for #42" — the PRD is *for* that issue (comment). When in doubt, ask.

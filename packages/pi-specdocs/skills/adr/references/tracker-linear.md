# Tracker: Linear

Operations for Linear issue tracking via the Linear MCP server. This file is loaded when the active tracker is `linear`.

## Prerequisites

- The **Linear MCP server** must be connected. If the `mcp__linear-server__get_issue` tool is not available, warn the user: "Linear MCP server is not connected. Please connect it or switch to GitHub in `.claude/tracker.md`."
- The `linear-team` field in `.claude/tracker.md` must be set (e.g., `ENG`). This is the team key used when creating issues.

## Identifier Format

- `ENG-42` or similar team-prefixed identifiers — the format is `<TEAM>-<NUMBER>`
- When the user provides an identifier like `ENG-42`, use it directly with Linear MCP tools
- The user may also provide just a number (e.g., `42`) — in that case, combine it with the configured `linear-team` to form the identifier

## Operations

### Fetch Issue

Use `mcp__linear-server__get_issue` with the issue identifier:

```
Tool: mcp__linear-server__get_issue
Parameters:
  id: "ENG-42"
  includeRelations: true
```

This returns the issue title, description, status, labels, assignee, and related issues. To also get comments:

```
Tool: mcp__linear-server__list_comments
Parameters:
  issueId: "<issue-uuid>"
```

Note: `list_comments` requires the issue's UUID (returned by `get_issue`), not the human-readable identifier.

### Create Issue

Use `mcp__linear-server__save_issue`:

```
Tool: mcp__linear-server__save_issue
Parameters:
  title: "PRD-NNN: <title>"
  team: "ENG"
  description: "<full file content including YAML frontmatter>"
```

The `team` value comes from the `linear-team` config field. The description accepts full markdown.

**Important:** Include the entire PRD file content — including the YAML frontmatter block — as the description. Do not strip the frontmatter; it provides useful at-a-glance metadata (PRD number, status, version, owner, date).

Use when a PRD is original work (no source issue). The PRD content becomes the issue description.

### Post Comment

Use `mcp__linear-server__save_comment`:

```
Tool: mcp__linear-server__save_comment
Parameters:
  issueId: "<issue-uuid>"
  body: "<full file content including YAML frontmatter>"
```

**Important:** Include the entire PRD file content — including the YAML frontmatter block — as the comment body. Do not strip the frontmatter.

Use when a PRD was written *for* an existing issue. The PRD is posted as a comment.

Note: Use the issue's UUID from the `get_issue` response, not the human-readable identifier.

### Search Issues

Use `mcp__linear-server__list_issues` to search for related issues:

```
Tool: mcp__linear-server__list_issues
Parameters:
  teamId: "<team-uuid>"
  limit: 20
```

Or use `mcp__linear-server__research` for natural language queries:

```
Tool: mcp__linear-server__research
Parameters:
  query: "open issues about caching in team ENG"
```

## Frontmatter Convention

In PRD/ADR frontmatter, the `issue` field uses Linear format:

```yaml
issue: "ENG-42"
```

Or `"N/A"` if no source issue.

## Related Section Format

In the Related section of PRDs, reference issues as:

```markdown
| ENG-42 — Issue title | blocks / depends-on / enables |
```

## Tool Table Row

When listing tools in a skill, the tracker row is:

```markdown
| Tracker | **Linear MCP** (`get_issue`, `save_issue`, `save_comment`) | Fetch issue details, post PRD/ADR as comment, create issues |
```

## Publishing Rules

| Origin | Action |
|--------|--------|
| **Source issue exists** — the PRD was written *for* a specific issue | `save_comment` on that issue (use UUID from `get_issue`) |
| **Original PRD** — no source issue | `save_issue` to create a new issue with the PRD as description |

The same distinction applies as with GitHub: "spec out a caching layer, see ENG-42 for background" references the issue for context but the PRD is original work (new issue). Versus "write a PRD for ENG-42" — the PRD is *for* that issue (comment). When in doubt, ask.

## Operation Mapping (GitHub → Linear)

| Operation | GitHub (`gh` CLI) | Linear (MCP) |
|-----------|-------------------|--------------|
| Fetch issue | `gh issue view <N> --comments` | `get_issue` + `list_comments` |
| Create issue | `gh issue create --title "..." --body-file <path>` | `save_issue` with `title`, `team`, `description` |
| Post comment | `gh issue comment <N> --body-file <path>` | `save_comment` with `issueId`, `body` |
| List issues | `gh issue list` | `list_issues` or `research` |

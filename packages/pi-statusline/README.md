# @feniix/pi-statusline

A fixed two-line status display for pi.

By default it renders in the footer in interactive/RPC mode and logs to stdout in non-UI modes (`-p`, JSON mode).
It is not injected into model context and is not sent as messages.
It also exposes a `/statusline` tool for explicit retrieval.

## Display

```text
Model: ... | Thinking: ... | Ctx: ... | ⎇ ... | dirty: +... | ↑.../↓...
<repo> | cwd: ... | 𖠰 ... | Skill: ...
```

## Included fields

- Model
- Thinking level
- Context usage percent
- Git branch
- Dirty file count
- Input/output token totals
- Repo name
- Current working directory
- Git worktree label
- Last explicitly invoked skill

## Skill behavior

The skill segment tracks the latest explicit skill command seen in user input.
Examples:
- `/skill:release` -> `Skill: release`
- `/release` -> `Skill: release` if `release` is registered as a skill command in the current session

## Worktree behavior

- linked worktree -> branch-derived label for that worktree
- main worktree -> `𖠰 main`
- non-git repo -> `𖠰 no git`

## Development

Run from the repo root:

```bash
npm run test
npm run typecheck
```

For quick manual testing:

```bash
cd packages/pi-statusline
pi -e ./extensions/index.ts
```

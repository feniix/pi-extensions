# @feniix/pi-statusline

A fixed two-line status footer for pi.

It is intentionally UI-only:
- rendered via `ctx.ui.setFooter()`
- not injected into model context
- not sent as messages
- not exposed through tools

## Display

```text
Model: ... | Thinking: ... | Ctx: ... | ⎇ ... | dirty: +... | ↑... ↓...
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

- linked worktree -> `𖠰 <label>`
- main worktree / no linked worktree -> `𖠰 none`

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

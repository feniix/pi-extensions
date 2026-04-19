# @feniix/pi-statusline

A fixed two-line status display for pi.

By default it renders in the footer in interactive/RPC mode and logs to stdout in non-UI modes (`-p`, JSON mode).
It is not injected into model context and is not sent as messages.
It also exposes a `/statusline` tool for explicit retrieval.

## Display

```text
Model: ... | Thinking: ... | Ctx: ... | ⎇ ... | dirty: +... | ↑.../↓...
<repo> | cwd: ... | 𖠰 ... | Skill: ... | Act: ...
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
- Live activity indicator

## Live updates

The footer now updates continuously during active work instead of only at the end of a turn.
This includes:

- after user input is submitted
- when the agent starts and each turn starts
- while assistant messages are streaming
- while tools are starting, streaming updates, and finishing
- when the agent returns control to the user

To avoid excessive redraws, streaming-triggered footer renders are throttled.

## Activity behavior

The activity segment summarizes what pi is doing right now.
Examples:

- `Act: queued`
- `Act: thinking`
- `Act: responding`
- `Act: bash`
- `Act: bash x2`
- `Act: idle`

## Skill behavior

The skill segment tracks the latest explicit skill command seen in user input.
Examples:
- `/skill:release` -> `Skill: release`
- `/release` -> `Skill: release` if `release` is registered as a skill command in the current session

## Token behavior

Token totals are based on assistant usage in the session branch.
During active streaming, the extension also uses the latest live assistant usage when available so the token display can update before the turn fully finishes.

## Worktree behavior

- linked worktree -> branch-derived label for that worktree
- main worktree -> `𖠰 main`
- non-git repo -> `𖠰 no git`

## Palette configuration

`pi-statusline` uses a built-in `defaultPalette`, but you can override any subset of colors through pi's standard settings files.

Settings locations:

- global: `~/.pi/agent/settings.json`
- project: `.pi/settings.json`

Use the `pi-statusline` key for non-secret configuration:

```json
{
  "pi-statusline": {
    "palette": {
      "model": "#008787",
      "activity": "#5FAF00"
    }
  }
}
```

`pi-statusline` does not need secrets. As a general pi convention, keep `settings.json` for non-secret defaults; credentials belong in environment variables, OAuth/private auth files, or explicit custom config files used by extensions that support them.

Supported palette keys:

- `background`
- `model`
- `repo`
- `thinking`
- `skill`
- `context`
- `branch`
- `dirty`
- `token`
- `separators`
- `cwd`
- `worktree`
- `activity`

Behavior:

- project settings override global settings
- missing keys fall back to `defaultPalette`
- invalid color values are ignored
- colors must be 6-digit hex values like `#008787`

## Development

Run from the repo root:

```bash
npm run test
npm run typecheck
```

For quick manual testing from this monorepo:

```bash
cd packages/pi-statusline
pi
```

This repo's root `package.json` already auto-loads `packages/pi-statusline/extensions/index.ts`, so using `pi -e .` or `pi -e ./extensions/index.ts` from inside the workspace will load the extension twice and cause a tool-name conflict.

If you want to test it as a standalone extension outside this workspace, run pi from another directory and pass the explicit file path:

```bash
cd /tmp
pi -e /Users/feniix/src/personal/pi/pi-extensions/packages/pi-statusline/extensions/index.ts
```

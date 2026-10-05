# @feniix/pi-statusline

A fixed two-line status display for pi.

Requires **pi 1.x** (tested with pi 1.0.3).

It renders in the footer in interactive TUI mode, including both fullscreen and regular terminal modes.
RPC clients cannot render custom terminal footers; in RPC mode only the explicit `statusline` tool is available.
It stays inert in non-UI modes (`-p`, JSON mode).
It is not injected into model context and is not sent as messages.
In TUI/RPC sessions, it exposes a model-callable `statusline` tool for explicit plain-text retrieval (not a slash command).

## Display

```text
Model: ... | Thinking: ... | Ctx: ... | ⎇ ... | dirty: +... | ↑.../↓...
<repo> | cwd: ... | 𖠰 ... | Skill: ... | Act: ...
```

Other extensions' status messages are appended to the second line in status-key order, preserving their ANSI styling.
On narrow terminals, context moves to the front of the first line, and activity/status messages move to the front of the second.
Remaining fields are truncated to the available terminal columns; the footer always uses exactly two lines.
Emoji, wide characters, combining characters, and ANSI escape sequences are measured using pi-tui's column-aware helpers.

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
- Other extensions' status messages
- Optional cost and cache-read/cache-write totals

## Live updates

The footer now updates continuously during active work instead of only at the end of a turn.
This includes:

- after user input is submitted
- when the agent starts and each turn starts
- while assistant messages are streaming
- while tools are starting, streaming updates, and finishing
- when the agent returns control to the user
- after thinking-level changes, compaction, or session-tree navigation

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
- `Act: waiting for user`

`agent_end` means one agent loop ended, not necessarily that pi is done: retries, compaction, or queued continuations may follow.
The footer reports idle only after `agent_settled`.
Blocking extension prompts temporarily show waiting-for-user activity.
Parallel and nested tool calls are tracked by call ID; the label names the most recently started still-active tool and shows the total active-call count.

## Skill behavior

The skill segment tracks the latest explicit skill command seen in user input.
Examples:
- `/skill:release` -> `Skill: release`
- `/release` -> `Skill: release` if `release` is registered as a skill command in the current session

## Token behavior

Token totals follow the **active session branch**, not abandoned alternative histories.
They include assistant and tool-result usage, compaction, branch summaries, and standalone usage entries.
Nested model usage propagated into a tool result is counted through that result, not separately through nested tool execution events.

Completed usage is cached across streaming deltas. Live assistant usage is added to completed totals without replacing the previous assistant message.
Finalized messages are retained until pi persists them, so the display does not drop or double-count usage across `message_end`.
Compaction, navigation, finalized messages, and session lifecycle boundaries invalidate the cache.

Enable optional detail in global or project settings:

```json
{
  "pi-statusline": {
    "showCost": true,
    "showCache": true
  }
}
```

Example: `↑18.2k/↓14.2k R120.0k W5.0k $0.125`.
Both flags default to `false`; project booleans override global booleans, and invalid values are ignored.
Cost is the model-reported cumulative estimate, not a subscription bill.

## Worktree behavior

- linked worktree -> branch-derived label for that worktree
- main worktree -> `𖠰 main`
- non-git repo -> `𖠰 no git`

## Palette configuration

The footer uses **pi's active theme** by default and follows theme changes without caching colored strings.
You can override individual foreground colors through pi's standard settings files.
Pi converts colors to truecolor or 256-color output according to terminal capabilities.
The exported `defaultPalette` remains the fallback for standalone formatting without a supplied pi theme.

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
- missing keys use the active pi theme in the footer
- invalid color values are ignored
- colors must be 6-digit hex values like `#008787`
- the legacy `background` key remains accepted for compatibility but does not paint the footer

Settings are loaded at session start; use `/reload` after editing them.

## Development

Run from the repo root:

```bash
pnpm run test
pnpm run typecheck
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

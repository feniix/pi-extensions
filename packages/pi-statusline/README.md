# pi-statusline

A pi extension that renders a two-line status line with model info, thinking effort, context %, git branch/worktree, dirty changes, token consumption, and skill info.

## Output Format

```
Model: Opus 4.6 (1M context) | Thinking: medium | Ctx: 11.0% | ⎇ main | dirty: +0 | Tokens: ↑10.5k/↓3.2k
evie-platform | cwd: ~/src/spantree/evie-platform | 𖠰 main | Skill: none
```

## Features

- **Model**: Display name from Claude settings (`Opus 4.6 (1M context)`)
- **Thinking Effort**: Current thinking effort level from transcript metadata (`low`, `medium`, `high`, `max`)
- **Context %**: Context window usage percentage from Claude settings
- **Git Branch**: Current branch name with `⎇` prefix
- **Dirty Changes**: Count of uncommitted files with `+N` format
- **Token Consumption**: Input/output token counts with `↑` / `↓` arrows
- **Project Name**: Git repo root directory name
- **CWD**: Current working directory with `~` abbreviation for home
- **Worktree**: Git worktree name with `𖠰` prefix
- **Skill**: Last skill invoked (from transcript parsing)

## Installation

Copy the extension file to your pi extensions directory:

```bash
# Create extensions directory if it doesn't exist
mkdir -p ~/.pi/agent/extensions

# Symlink or copy the extension
ln -s /path/to/pi-statusline/extensions/index.ts ~/.pi/agent/extensions/pi-statusline.ts
```

Or add it to your project's `.pi/extensions/` directory.

## Configuration

v1 has no configuration — the widget layout is hardcoded. The extension reads:

- Claude settings from `~/.claude/settings.json` or `$CLAUDE_CONFIG_DIR`
- Transcript files from standard Claude locations
- Git state from the current working directory

## Development

```bash
cd packages/pi-statusline
npm install
npm run check   # lint + typecheck
npm run test    # run tests
```

## Architecture

```
src/
├── index.ts          # Main orchestrator, widget formatters, render functions
├── types.ts          # Shared TypeScript interfaces
├── format.ts         # ANSI colors, token formatting helpers
└── data/
    ├── git.ts        # Git branch, worktree, dirty count
    ├── session.ts    # CWD, repo root, transcript path discovery
    ├── settings.ts   # Claude settings.json reader
    └── transcript.ts # JSONL parser for tokens, thinking effort, skills

extensions/
└── index.ts          # pi extension entry — registers session_start hook
```

# Shared Tracker Setup

Use this reference whenever a specdocs skill needs to fetch issues, publish a PRD, or resolve tracker-specific links.

## Detection order

1. Check the session context for the active tracker if it was printed by the extension's session hook
2. Read `.claude/tracker.md` directly before performing tracker-specific work so mid-session setup is respected
3. If no tracker is indicated anywhere, default to **GitHub**

## First-run setup

If `.claude/tracker.md` does not exist:

1. Tell the user: `No tracker config found. I'll create .claude/tracker.md.`
2. Ask whether the project uses **GitHub** (default) or **Linear**
3. If GitHub, write:

```yaml
tracker: github
```

4. If Linear, ask for the team key (for example `SPA` or `ENG`) and write:

```yaml
tracker: linear
linear-team: SPA
```

5. Continue the workflow after the config is written

## Tracker references

Each skill keeps its tracker-specific fetch/publish instructions in its local `references/` directory:

- `references/tracker-github.md`
- `references/tracker-linear.md`

Load the matching reference only when you actually need tracker operations.

## Publishing principle

- Save the local artifact first
- Use tracker operations only when the workflow calls for them
- If a tracker operation fails, preserve the local artifact and explain what remains to be done manually

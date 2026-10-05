# Changelog

All notable changes to `@feniix/pi-statusline` are recorded here.

Historical entries are reconstructed from package-scoped Git history and npm
publication metadata. Dates are npm publication dates (UTC).

## [Unreleased]

## [1.0.0] - 2026-10-05

### Changed

- Require pi 1.x; validate against pi 1.0.3 and declare the host-provided pi-tui peer.
- Follow the active pi theme by default while preserving explicit global/project hex palette overrides and terminal color capability handling.
- Prioritize context, activity, and other extensions' status messages when terminal space is limited.
- Cache completed active-branch usage across streaming updates and count live/finalized usage exactly once.
- Install the terminal footer only in TUI mode; provide plain-text status snapshots through the `statusline` tool in TUI and RPC sessions.

### Added

- Display other extensions' `ctx.ui.setStatus()` messages in deterministic key order within the two-line footer.
- Show waiting-for-user activity during extension prompts, restoring the underlying activity afterward.
- Optional `showCost` and `showCache` settings for cumulative cost and cache-read/cache-write totals.
- Immediate refreshes after thinking-level changes, compaction, and session-tree navigation.

### Fixed

- Measure and truncate terminal columns correctly for ANSI text, emoji, CJK, and combining characters.
- Report idle only after `agent_settled`, rather than prematurely at `agent_end`.
- Track parallel and nested tools by call identity; ignore duplicate starts and unknown/duplicate completion updates.
- Include tool-result, compaction, branch-summary, and standalone usage entries in active-branch totals without subtracting previous completed assistant usage.
- Keep print/JSON sessions inert and preserve stale-session guards and shutdown cleanup.

## [0.5.4] - 2026-09-30

### Changed

- Migrate workspace tooling to pnpm and update the npm homepage.

## [0.5.3] - 2026-07-12

### Changed

- Workspace patch version bump.

## [0.5.2] - 2026-05-15

### Changed

- Workspace package version bump.

## [0.5.1] - 2026-05-15

### Fixed

- Skip the statusline in non-UI sessions, guard stale tool paths, and harden session refresh lifecycle.

### Changed

- Add regression coverage for lifecycle behavior and extracted helpers.

## [0.5.0] - 2026-05-11

### Changed

- Migrate Pi dependencies to the `@earendil-works` namespace.

## [0.4.4] - 2026-04-23

### Changed

- Release-workflow test publication.

## [0.4.3] - 2026-04-23

### Changed

- Patch version bump; package-scoped Git history records no additional runtime changes.

## [0.4.2] - 2026-04-23

### Fixed

- Avoid stale session context in the footer.

## [0.4.1] - 2026-04-22

### Changed

- Migrate schemas to `typebox` for Pi 0.69 and resolve lint issues.

## [0.4.0] - 2026-04-19

### Added

- Configure the footer palette through settings.

## [0.3.0] - 2026-04-19

### Added

- Live footer updates and a configurable palette.

## [0.2.2] - 2026-04-19

### Changed

- Expand runtime coverage for helpers, session events, and tool output; align formatting with package-scoped CI.

## [0.2.1] - 2026-04-17

### Changed

- Format the extension and update repository metadata.

## [0.2.0] - 2026-04-17

### Added

- Two-line terminal footer and a modernized extension event pipeline.

### Changed

- Document status output and worktree semantics.

## [0.1.0] - 2026-04-17

### Added

- Initial statusline extension.

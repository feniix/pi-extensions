# Changelog

All notable changes to `@feniix/pi-devtools` are recorded here.

Historical entries are reconstructed from package-scoped Git history and npm
publication metadata. Dates are npm publication dates (UTC). Early publishes
sometimes share a Git revision or differ from committed manifest versions;
uncertain release boundaries are noted rather than inferred.

## [Unreleased]

## [3.1.3] - 2026-10-05

### Fixed

- Remove direct console output during session startup to avoid corrupting Pi's fullscreen UI.
- Require dated, nonempty package changelogs before npm publication and maintain the file in the release skill.

## [3.1.2] - 2026-09-30

### Changed

- Migrate workspace tooling to pnpm, make Git integration tests hermetic, and update the npm homepage.

## [3.1.1] - 2026-07-12

### Changed

- Workspace patch version bump.

## [3.1.0] - 2026-07-12

### Added

- Scope tools to the active working directory and expose linked-worktree context.
- Make merge cleanup worktree-safe, verify authoritative merge hosts and completed merges before cleanup, and harden checkout isolation.

### Changed

- Centralize command execution and document continuing merges when no CI checks exist.

## [3.0.1] - 2026-05-15

### Changed

- Workspace package version bump.

## [3.0.0] - 2026-05-11

### Changed

- Migrate Pi dependencies to the `@earendil-works` namespace.

## [2.2.3] - 2026-04-28

### Fixed

- Use GitHub CLI's subject flag for squash-merge titles (#68); includes the changes prepared under the unpublished 2.2.2 version.

## [2.2.1] - 2026-04-22

### Changed

- Migrate extension schemas to `typebox` for Pi 0.69 compatibility.

## [2.2.0] - 2026-04-21

### Changed

- Split the extension into maintainable modules (#39) and update author/license metadata.

## [2.1.5] - 2026-04-19

### Changed

- Stabilize CI tests and align formatting with package-scoped CI.

## [2.1.4] - 2026-04-18

### Fixed

- Correct CI PR mode handling and reduce complexity (#19).

## [2.1.3] - 2026-04-17

### Removed

- Remove the sonar installation skill.

## [2.1.2] - 2026-04-17

### Fixed

- Update repository metadata and runtime tests.

## [2.1.1] - 2026-04-16

### Changed

- Improve Git test coverage.

## [2.1.0] - 2026-04-15

### Fixed

- Honor `switchBranch`, select the newest tag, harden shell argument handling, and improve CI parsing.

### Changed

- Align committed package versions with published npm majors after a workspace version reset.

## [2.0.0] - 2026-04-15

### Added

- Show Git context at session start and add a sonar installation skill.

## [1.1.0] - 2026-04-08

### Added

- Support Linear tracker integration and Notion sync in workflow skills.

## [1.0.7] - 2026-04-07

### Fixed

- Resolve lint issues and type errors.

## [1.0.6] - 2026-04-06

### Added

- Add merge prompts and comprehensive unit/integration coverage for Git, PR, and merge operations.

## [1.0.5] - 2026-04-06

### Changed

- Published patch; npm records the same Git revision as 1.0.4, so the exact package delta cannot be recovered from that revision.

## [1.0.4] - 2026-04-06

### Changed

- Workspace integration accompanying the Notion package addition (#1).

## [1.0.3] - 2026-04-06

### Changed

- Published during the Notion workspace integration; npm points to an intermediate revision rather than a matching committed version bump.

## [1.0.2] - 2026-04-06

### Changed

- Workspace packaging and lockfile updates; npm publication metadata differs from the committed manifest version.

## [1.0.1] - 2026-04-06

### Changed

- Published patch; npm records the same Git revision as 1.0.0, so the exact package delta cannot be recovered from that revision.

## [1.0.0] - 2026-04-06

### Added

- Initial Git workflow, branch, PR, CI, and release tools and skills.

# Changelog

All notable changes to `@feniix/pi-ref-tools` are recorded here.

Historical entries are reconstructed from package-scoped Git history and npm
publication metadata. Dates are npm publication dates (UTC). Early publishes
sometimes differ from committed manifest versions; uncertain release boundaries
are noted rather than inferred.

## [Unreleased]

## [3.0.5] - 2026-10-06

### Changed

- Declare Node.js 22.19.0 or newer, matching Pi's runtime requirement.
- Align shared CI and release tooling with Pi upstream's Node 22 runtime and typings; extension behavior is unchanged.

## [3.0.4] - 2026-10-05

### Fixed

- Remove the startup connection banner to avoid writing outside Pi's fullscreen renderer; MCP initialization remains lazy.

## [3.0.3] - 2026-09-30

### Changed

- Workspace patch release following the pnpm migration; update the npm homepage.

## [3.0.2] - 2026-07-12

### Changed

- Workspace patch version bump.

## [3.0.1] - 2026-05-15

### Changed

- Workspace package version bump.

## [3.0.0] - 2026-05-11

### Changed

- Migrate Pi dependencies to the `@earendil-works` namespace.

## [2.1.1] - 2026-04-22

### Changed

- Migrate schemas to `typebox` for Pi 0.69, split the extension into maintainable modules, and reorganize tests.

## [2.1.0] - 2026-04-19

### Changed

- Standardize settings and secret handling, rename config path flags/environment variables, drop legacy config fallbacks, and warn when legacy files are ignored.
- Update author/license metadata.

## [2.0.3] - 2026-04-19

### Changed

- Reduce cognitive complexity (#21) and align tests/formatting with package-scoped CI.

## [2.0.2] - 2026-04-17

### Fixed

- Correct test mocks and repository metadata.

## [2.0.1] - 2026-04-16

### Changed

- Improve runtime test coverage.

## [2.0.0] - 2026-04-15

### Fixed

- Harden config parsing and normalization.

### Changed

- Align committed package versions with published npm majors after a workspace version reset.

## [1.0.5] - 2026-04-15

### Added

- Check authentication status at session start. npm published this as 1.0.5 although the corresponding Git manifest was prepared as 1.1.0.

## [1.0.4] - 2026-04-07

### Fixed

- Resolve lint issues and type errors.

## [1.0.3] - 2026-04-06

### Changed

- Expand documentation-tool unit and integration test coverage.

## [1.0.2] - 2026-04-06

### Changed

- Early patch publication; npm points to the initial extension commit, so the exact package delta is not recoverable from that revision.

## [1.0.1] - 2026-04-06

### Changed

- Early patch publication; npm contains no Git revision for this version, so its exact changes cannot be assigned reliably.

## [1.0.0] - 2026-04-06

### Added

- Initial Ref.tools MCP documentation search and URL reading extension.

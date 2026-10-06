# Changelog

All notable changes to `@feniix/pi-notion` are recorded here.

Historical entries are reconstructed from package-scoped Git history and npm
publication metadata. Dates are npm publication dates (UTC). Early publishes
sometimes share a Git revision or differ from committed manifest versions;
uncertain release boundaries are noted rather than inferred.

## [Unreleased]

## [3.0.5] - 2026-10-06

### Changed

- Declare Node.js 22.19.0 or newer, matching Pi's runtime requirement.
- Pin Node typings to 22.19.19 and align shared CI and release tooling with Pi upstream's Node 22 runtime; extension behavior is unchanged.

## [3.0.4] - 2026-09-30

### Changed

- Workspace patch release following the pnpm migration; update the npm homepage.

## [3.0.3] - 2026-08-23

### Fixed

- Launch OAuth browser URLs correctly on Windows and align the callback host with the listener.

### Changed

- Expose the browser launcher for regression coverage.

## [3.0.2] - 2026-07-12

### Changed

- Workspace patch version bump.

## [3.0.1] - 2026-05-15

### Changed

- Workspace package version bump.

## [3.0.0] - 2026-05-11

### Changed

- Migrate Pi dependencies to the `@earendil-works` namespace.

## [2.2.2] - 2026-04-22

### Changed

- Migrate schemas to `typebox` for Pi 0.69 and isolate auth tests from environment configuration.

## [2.2.1] - 2026-04-21

### Fixed

- Change the default Notion auth path.

## [2.2.0] - 2026-04-19

### Changed

- Store secrets in private files, rename/migrate the MCP auth file, add an override environment variable, ignore legacy direct-token files, and warn about migrations.
- Rename legacy config path inputs and expand MCP runtime coverage.

## [2.1.4] - 2026-04-19

### Fixed

- Remediate an audit issue and add workspace auditing.

## [2.1.3] - 2026-04-19

### Changed

- Reduce cognitive complexity (#22), isolate auth tests, and expand MCP connection/OAuth callback coverage.
- Stabilize CI tests and formatting.

## [2.1.2] - 2026-04-17

### Fixed

- Update repository metadata and runtime tests.

## [2.1.1] - 2026-04-16

### Changed

- Improve runtime test coverage.

## [2.1.0] - 2026-04-15

### Fixed

- Align auth status with MCP OAuth connectivity, correct auth environment variables, and update MCP-first documentation.

### Changed

- Remove machine-specific test paths and align committed versions with published npm majors after a workspace version reset.

## [2.0.0] - 2026-04-15

### Changed

- Major version publication following the auth-check and tool-call guardrail work; npm and committed manifest versions diverged during this release sequence.

## [1.2.2] - 2026-04-15

### Added

- Session-start authentication checks and tool-call guardrails. npm identifies the feature commit, although no matching 1.2.2 manifest bump exists in local history.

## [1.2.1] - 2026-04-07

### Fixed

- Correct skill documentation to match MCP schemas and fix number coercion.

## [1.2.0] - 2026-04-07

### Fixed

- Use `Type.Unsafe` for MCP tool input schemas.

## [1.1.23] - 2026-04-07

### Changed

- Update the MCP client and tests.

## [1.1.22] - 2026-04-07

### Fixed

- Resolve lint issues and type errors.

## [1.1.21] - 2026-04-07

### Changed

- Update the workspace-explorer skill based on MCP exploration.

## [1.1.20] - 2026-04-07

### Fixed

- Improve the MCP client.

## [1.1.19] - 2026-04-07

### Fixed

- Address skill review feedback.

## [1.1.18] - 2026-04-07

### Changed

- Simplify skills around workflows rather than tool listings.

## [1.1.17] - 2026-04-07

### Changed

- Update the workspace-explorer skill for MCP tools.

## [1.1.16] - 2026-04-07

### Changed

- Update the setup-oauth skill for the simplified MCP flow.

## [1.1.15] - 2026-04-07

### Fixed

- Improve the OAuth flow.

## [1.1.14] - 2026-04-07

### Fixed

- Improve OAuth flow handling.

## [1.1.13] - 2026-04-07

### Fixed

- Improve the OAuth flow.

## [1.1.12] - 2026-04-07

### Fixed

- Correct OAuth flow behavior.

## [1.1.11] - 2026-04-07

### Fixed

- Improve the OAuth flow and tests.

## [1.1.10] - 2026-04-07

### Fixed

- Properly handle the OAuth callback and token exchange.

## [1.1.9] - 2026-04-07

### Changed

- Simplify the MCP client to accept a URL and token directly.

## [1.1.8] - 2026-04-07

### Fixed

- Use the MCP server's authorize endpoint with fallback to dynamic registration.

## [1.1.7] - 2026-04-07

### Fixed

- Use Notion OAuth endpoints instead of protected discovery.

## [1.1.6] - 2026-04-07

### Removed

- Remove the obsolete setup-notion prompt.

## [1.1.5] - 2026-04-06

### Fixed

- Rewrite the MCP client with OAuth dynamic client registration.

## [1.1.4] - 2026-04-06

### Fixed

- Correct the setup prompt to use the public-integration OAuth flow.

## [1.1.3] - 2026-04-06

### Fixed

- Complete the OAuth token exchange flow.

## [1.1.2] - 2026-04-06

### Added

- Further MCP client OAuth support.

## [1.1.1] - 2026-04-06

### Added

- MCP client with OAuth support and comprehensive unit/runtime test coverage.

## [1.0.2] - 2026-04-06

### Changed

- Rename the setup prompt to setup-notion (#3).

## [1.0.1] - 2026-04-06

### Changed

- Published patch; npm records the same Git revision as 1.0.0, so the exact package delta cannot be recovered from that revision.

## [1.0.0] - 2026-04-06

### Added

- Initial Notion extension with interactive setup. npm points to a revision before the package's mainline addition, so the initial release boundary is approximate.

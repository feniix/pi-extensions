# pnpm migration verification

Baseline: `6586e7bed90c1eef8c3c583674779cd704809048`.
Verification date: 2026-09-30. Selected pnpm: **12.8.1**.

## Implemented scope

- Pinned pnpm and Node minimum; completed the existing minimal workspace YAML.
- Imported the npm lock, moved effective overrides into YAML, removed npm lock.
- Updated root scripts, CI/release installs and check caching, audit helper,
  prepack and active development documentation. npm registry publication remains.
- Removed root's explicit global portfinder type inclusion: the isolated-layout
  spike reproduced TS2688; normal pi-notion module imports resolve its own types.
- Reviewed dependency hooks: allow exact esbuild0.28.2 binary setup; deny exact
  genai2.21.0 no-op preinstall and protobufjs7.6.6 version-warning postinstall.
- Added fail-closed dependency checks and test-first shared-file detection/audit
  regressions. CI discovery now ignores leftover directories without manifests.

No child package version, dependency range, peer optionality, pi manifest, export,
bin, files list or coverage threshold changed. Release detection, publish condition,
environment and permissions were compared structurally with baseline and are
unchanged. No new audit gate or privileged publish cache was added.

## Actual results

| Verification | Result |
| --- | --- |
| Baseline npm lint/typecheck | Passed on Node24.21.0. |
| Baseline npm coverage | 664 passed, 8 skipped; statements84.86%, branches78.53%, functions89.57%, lines85.12%. |
| pnpm clean install | Passed with no root node_modules on Node24.21.0 and in a disposable checkout on exact Node22.19.0. |
| Repeat frozen install | Passed; Node22 lock/workspace hashes unchanged. |
| Stale run/exec fixture | Both failed with ERR_PNPM_VERIFY_DEPS_BEFORE_RUN; lock hash unchanged, no silent repair. |
| Root checks | `check` and `check:ci` passed on Node24; `check:ci` passed on Node22.19.0. |
| Final root coverage, both Nodes | **682 passed, 8 skipped**; statements84.86%, branches78.49%, functions89.57%, lines85.12%. |
| Scoped CI checks, all five packages | Lint, types and coverage passed on Node24, at unchanged70/70/70/60 thresholds. |
| Regression suite | 18 tests cover pnpm/existing shared triggers, manifest-only discovery, scoped/no-change selection, Git errors and audit exit0/1/2 propagation. Initial new cases were observed failing before implementation. |
| Workspace discovery | Five child projects plus private root. |
| Extension smoke-load | Host extension loader imported/initialized all six child-declared entries, with zero errors and tools/commands/hooks registered, using isolated agent configuration. No session-start events/tool execution/API calls. |
| npm artifacts | All five packages packed successfully in a disposable checkout. pi-exa explicit export/bin targets present; wrapper and MCP entry executable. |
| pi-exa consumer fixture | Clean consumer install of npm tarball; root/tools/mcp exports imported successfully. |
| MCP startup | Packed CLI and real bridgekit missing-dist fallback each returned valid initialize responses naming pi-exa6.0.0. No external tool/API calls. |
| Single-child version fixture | pnpm filter bumped pi-exa6.0.0 to6.0.1 without Git tag/commit; subsequent frozen install passed. Fixture restored; actual child versions unchanged. |
| Workflow syntax/invariants | YAML parsed; action-setup v6 schema verified from its upstream action.yml. Release detection/guard/permissions/environment unchanged. |
| Audit | **Failed, intentionally unsuppressed**: same three brace-expansion advisories are present against the original npm lock. |

The original npm audit reports one affected package; pnpm reports three
vulnerability entries. Both reference:

- GHSA-q2hr-2g5m-vwhr (moderate)
- GHSA-qhr7-859c-m2p7 (high)
- GHSA-6j4f-fj2g-mc7p (high)

This is not a clean audit or a security remediation. The migration preserves the
failure rather than upgrading unrelated transitive dependencies.

## Lock comparison

Parsed the application dependency document in pnpm's multi-document lock and
compared package-name/version sets with the baseline npm lock. **No new
application dependency name/version pair was introduced.** Duplicate older
resolutions disappeared through deduplication; for example root @types/node now
uses22.19.19, already present in the npm graph, instead of22.19.17. Peer contexts
and layout differ, so this is not a claim of identical graph topology.

The pnpm lock also records the pinned package manager and its platform packages
in a separate configuration dependency document.

## Limits and operational notes

- GitHub-hosted checks/release dry-run were not dispatched. No publish,
  authorization/provenance acceptance, commit or push occurred.
- Smoke-load verifies import/registration, not authenticated extension operations.
- Node22 was downloaded from the official release URL and SHA256-checked.
  An earlier npm-based Node bootstrap failed under this machine's npm script
  policy; it was not treated as passing or worked around by relaxing policy.
- A disposable wrapper-fallback test confirmed upstream bridgekit still calls
  `npm run build:mcp --silent`; that exception is intentionally retained.
- The baseline already contained a minimal pnpm-workspace.yaml, missed by the
  earlier draft; the research and issue draft now correct that wording.
- Vite prints a nonfatal config-loader warning under the imported dependency
  layout. No unrelated module-format refactor or warning suppression was added.
- Original root npm node_modules was preserved at
  `/tmp/pi-pnpm-migration.dMdQOj/npm-node_modules-backup`; root now uses pnpm.
  Disposable fixtures, tarballs and detailed logs are under that same temporary
  parent. No global package manager/version configuration was changed.

Remaining follow-up: run GitHub checks against an authorized PR/ref and handle the
existing brace-expansion findings separately. The migration's local checks passed;
the audit and remote release verification are explicitly not green.

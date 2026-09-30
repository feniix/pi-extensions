# npm to pnpm migration fact-check

Research date: 2026-09-30 UTC (2026-09-29 locally).
Repository baseline: `6586e7bed90c1eef8c3c583674779cd704809048`.

## Conclusion and evidence boundary

Migration is feasible in principle, but clean-install and runtime compatibility
remain untested. Repository inspection and primary-source research were followed
by an independent evidence audit. No dependency installation, migration, functional
test suite, audit, packing, workflow dispatch, or publication was performed.

Only shell syntax validation and the existing detector's unchanged-diff case were
executed by the research workflow. Neither establishes migration acceptance.

The accompanying [issue draft](2026-09-30-pnpm-migration-issue.md) distinguishes
preservation requirements from new policy recommendations.

## Verified repository facts

All local anchors refer to the baseline above.

| Evidence | Fact / implication |
| --- | --- |
| `package.json:6–19,38–57` | Root owns tooling, npm workspace declaration, a nested npm call in `check`, and overrides `fast-xml-parser: ^5.7.0`, `uuid: ^14.0.0`. No root packageManager or engines declaration. |
| `pnpm-workspace.yaml:1–2` | A minimal workspace YAML already existed at the baseline, containing only `packages/*`. Earlier draft wording about adding this file was inaccurate; migration completes its configuration. |
| `packages/*/package.json` | Five child packages plus private root. pi-notion declares two extension entries; six child-declared entries total. Root-only tooling scripts are not equivalent to recursive child scripts. |
| `README.md:58`; `packages/pi-exa/package.json:65–67` | Documented Node minimum is 22.19.0. Both workflows already use Node 24. |
| `tsconfig.json:7`; `packages/pi-notion/package.json` | Root explicitly requests portfinder types, although portfinder ownership is in pi-notion. This is an isolated-layout risk, not an observed installation/typecheck failure. |
| `.github/workflows/ci.yml:61–96`; `vitest.config.ts` | Package-scoped checks and root coverage preserve thresholds 70/70/70/60. Release tests currently do not enforce coverage. |
| `scripts/detect-ci-packages.sh:12–35` | Shared-file detection names npm lockfile, not pnpm lock/workspace configuration. Enumerates immediate package directories. |
| `scripts/audit-workspaces.sh` | Audits child workspace names, accumulates failure status. Neither inspected workflow invokes it. Full-root audit is a deliberate scope/reporting change. |
| `.github/workflows/release.yml:110–153` | Publication selection is version-based, separate from CI's affected-package matrix. Lock-only changes must not become all-package publication. |
| `.github/workflows/release.yml:157–246` | dry_run skips publishing, not selected checks. Empty selection skips checks; already-published versions can fail the registry guard. No packaging/OIDC validation occurs. |
| `.github/workflows/release.yml:172–179,221–237` | Checks currently cache npm; publish currently has no explicit cache. Retains npm view and npm publish with public access/provenance. |
| `packages/pi-exa/package.json:16–64` | prepack builds published dist JS/declarations; bin wrapper and exports require actual artifact validation. Existing manifest test is not artifact coverage. |
| `packages/pi-devtools/extensions/release-tools.ts:127–166` | Version tool writes the selected manifest, not a lockfile. Existing release skill commits/pushes/releases and must not be used as a harmless rehearsal. |

## Upstream findings and corrections

1. **Current release is version-sensitive.** The official registry returned
   **12.8.1**, independently retrieved by researchers, the evidence auditor, and
   the parent. Do not use old pnpm-10 advice without checking the selected major.
   An exact approved pin is required; "latest" is not a reproducibility contract.
   [Registry](https://registry.npmjs.org/pnpm/latest).

2. **Bootstrap is separate from packageManager.** pnpm 12 is native; official
   npm-based installation guidance requires Node 22.13+. An installed/enabled,
   sufficiently current Corepack cannot be assumed from Node 24 alone.
   Preserve this repository's higher Node floor and test it.
   [Installation](https://pnpm.io/installation),
   [Corepack](https://github.com/nodejs/corepack#readme).

3. **Create YAML before import.** Workspace membership comes from YAML; root is
   always included. Put overrides in effective configuration for the chosen
   pnpm version. pnpm 12 import translates npm locked versions into resolution
   preferences, then resolves: it does not guarantee identical graph/peer
   contexts. Compare and explain differences before removing the npm lock.
   [Workspace](https://pnpm.io/pnpm-workspace_yaml),
   [Import](https://pnpm.io/cli/import),
   [Pinned implementation](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/import.rs),
   [Overrides](https://pnpm.io/settings/dependency-resolution#overrides).

4. **Build approval and run-time install behavior changed.** Current docs use
   `allowBuilds`, with strict dependency build checking. Required approvals
   cannot be known without installing the real graph. `verifyDepsBeforeRun`
   defaults to `install`; `error` is a recommended fail-closed choice so run/exec
   cannot silently repair stale dependencies during verification.
   Do not blanket-approve builds or use broad hoisting to conceal missing deps.
   [Build settings](https://pnpm.io/settings/build),
   [Module layout](https://pnpm.io/settings/node-modules),
   [Peers](https://pnpm.io/settings/peer-dependencies).

5. **Audit is not mechanical flag substitution.** Unfiltered pnpm 12 audit
   selects the full lockfile including root. Production/development are included;
   optional coverage depends on configuration. Vulnerability results exit
   nonzero. Pinned source accepts informational severity, although the public
   CLI documentation enumerates low through critical. If adopting literal
   any-severity policy, verify `--audit-level=info` against the approved pin.
   Root inclusion, severity policy, and new workflow enforcement are distinct
   policy choices, not existing behavior to claim as preserved.
   [Docs](https://pnpm.io/cli/audit),
   [Scope source](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/audit/importers.rs),
   [Options/outcomes](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/audit.rs),
   [Exit dispatch](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/dispatch_query.rs).

6. **Version command exists now.** Introduced in pnpm 11. Ordinary explicit
   bump source does not establish automatic lock synchronization. Validate
   child filtering, lifecycle hooks, no unintended Git operations, unchanged
   siblings, and lock reconciliation separately in a disposable fixture.
   [Version docs](https://pnpm.io/cli/version),
   [Pinned source](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/version.rs).

7. **Cache ordering and publish scope matter.** Provision pnpm before setup-node
   asks for its store path. Cache is package-manager data, not node_modules;
   frozen install remains necessary. Preserve caching in checks, but do not
   automatically add caching to the privileged publish job. setup-node warns
   about unnecessary privileged-workflow caching; npm's trusted-publishing
   example disables it. This is guidance, not a universal ban.
   [pnpm setup](https://github.com/pnpm/action-setup#readme),
   [setup-node v6](https://github.com/actions/setup-node/blob/v6/README.md),
   [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

8. **Validate the retained npm artifact path.** npm publish runs prepack.
   pnpm pack can transform manifests differently from npm packing; testing
   only pnpm's tarball is insufficient if npm publication remains.
   Packing/dry-runs may execute lifecycle scripts and generate files.
   Provision pnpm in publish if prepack invokes it. Inspect/test bridgekit's
   bin-wrapper fallback rather than assuming compatibility.
   [npm lifecycles](https://docs.npmjs.com/cli/v11/using-npm/scripts#npm-publish),
   [pnpm pack](https://pnpm.io/cli/pack),
   [Pack implementation](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/pack/src/lib.rs).

9. **No nonpublishing check proves authorization.** Trusted publishing requires
   supported hosted runners, matching package-side configuration, OIDC permission,
   npm >=11.5.1 and Node >=22.14.0 per retrieved official docs. Node24/provenance
   flags alone do not prove authorization. Preserve existing workflow identity,
   environment and permissions; do not change credentials for this migration.
   [Official guidance](https://docs.npmjs.com/trusted-publishers/),
   [Official source](https://raw.githubusercontent.com/npm/documentation/main/content/packages-and-modules/securing-your-code/trusted-publishers.mdx).

## Remaining verification

- Approved pin/action revision and documented bootstrap.
- Imported graph, effective overrides, actual build approvals and dependency ownership.
- Clean frozen installs on Node22.19.0/24; baseline versus migrated lint/types/tests/coverage.
- Audit coverage and failure behavior with deterministic fixtures.
- Child-only version bump and frozen installation after reconciliation.
- npm-built artifacts, exports/bin modes and wrapper fallback.
- Loading all declared extension entries with isolated configuration.
- Authorized release dry-run with nonempty selection; report skipped/failed jobs honestly.

Existing `npm view` guard treats any lookup failure as "not published"; improving
it is separate hardening. Live advisories may fail audit independently of the
migration. Record baseline failures and require explicit disposition rather than
weakening checks or claiming success. Public `pi install npm:` selectors and
registry commands are legitimate retained npm references.

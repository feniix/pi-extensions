# Goal: migrate workspace development and CI to pinned pnpm while preserving npm publication

## AI goal

Make pnpm the reproducible installer and tool runner for this repository's private
root and five independently published packages. Preserve supported Node versions,
package behavior, peer contracts, CI coverage gates, and existing npm publication.

Deliver a focused migration PR with reproducible evidence, not a dependency upgrade,
release redesign, or actual publication.

Grounding baseline: `6586e7bed90c1eef8c3c583674779cd704809048`.
See the [cited research report](2026-09-30-npm-to-pnpm-migration.md) for upstream
contracts, limitations and version-sensitive findings.

## Grounded requirements

### Configuration and lockfile

- Approve and pin an exact pnpm release through root `packageManager`.
  Official registry observation on 2026-09-30 UTC was **12.8.1**; recheck before
  implementation, and use matching-version documentation/source.
- Document bootstrap separately from the pin. Preserve Node **22.19.0+** and CI
  **Node24** (`README.md:58`, workflows). Do not silently raise the Node floor.
- Complete the existing minimal workspace YAML selecting `packages/*`. Verify the five existing children
  plus private root; do not count five total projects.
- Preserve effective override ranges `fast-xml-parser: ^5.7.0` and
  `uuid: ^14.0.0` (`package.json:50–53`) in supported pnpm configuration.
- Declare workspace/configuration before importing the npm lock. Review and
  explain dependency/peer/platform differences; import is not graph-equivalence
  proof. Commit pnpm lock and remove npm lock as the final installer lockfile.
- Review required dependency-script approvals narrowly. Do not blanket-approve
  builds or enable broad hoisting to bypass failures.
- For pnpm12, recommend `verifyDepsBeforeRun: error` and verify that run/exec
  cannot silently install stale dependencies during checks. Document the selected
  behavior explicitly.

### Tooling, workflows and detection

- Translate root nested npm calls, including `check` (`package.json:10`).
  Root owns lint/types/tests; use root scripts and installed `pnpm exec` tools,
  not nonexistent recursive child scripts or downloaded substitutes.
- Provision the pinned pnpm before setup-node pnpm cache discovery. Perform
  explicit frozen installs in CI checks, release checks **and publish**.
- Preserve caching in CI/release checks using pnpm lockfile. Preserve the
  publish job's current no-explicit-cache posture; adding privileged-job caching
  requires a separate reviewed decision.
- Preserve existing scoped lint/typecheck/test commands, root/scoped coverage
  **70 lines / 70 statements / 70 functions / 60 branches**, summaries/artifacts.
  Do not silently add coverage enforcement to release tests.
- Update `scripts/detect-ci-packages.sh` and regression tests: pnpm lock/workspace
  and introduced effective shared configuration select all five CI packages;
  existing shared triggers, package-local and irrelevant-change behavior remain.
- Keep release version-based selection unchanged. All-package CI selection does
  not imply all-package publication; lock-only changes must not select releases.
- Investigate root `portfinder` type lookup (`tsconfig.json:7`), whose dependency
  belongs to pi-notion. Fix demonstrated migration-induced dependency ownership
  failures while preserving shared TS configuration and peer optionality.

### Audit, artifacts and release compatibility

- Preserve a documented audit entry point and nonzero vulnerability/error status.
  pnpm12 root unfiltered audit covers the whole lockfile, including root; adopt
  that broader scope explicitly rather than claim identical per-child reporting.
- State production/development/optional coverage and severity policy. If literal
  any-severity policy is chosen, confirm informational severity support against
  the approved pin. Do not suppress findings/errors to make migration green.
  Adding a CI/release audit gate is not implied by migrating the existing helper.
- Retain npm registry lookup and `npm publish --access public --provenance`,
  publication identity/environment/permissions, and public `pi install npm:...`
  instructions. Document these intentional exceptions.
- Validate pi-exa's actual **npm-packed** artifact and prepack build
  (`packages/pi-exa/package.json:16–64`), including exports, declarations, bin
  and executable modes. If prepack changes to pnpm, provision pnpm in publishing.
  Inspect/test bin-wrapper build fallback rather than assume compatibility.
- Document and test a single-child versioning procedure for the selected pin,
  unchanged sibling versions, no unintended tags/commits, and lock reconciliation
  followed by frozen installation. pnpm version exists in current releases;
  automatic lock synchronization must not be assumed.
- Update active README/AGENTS/package development documentation. Classify
  historical npm mentions rather than replace globally.

## Acceptance criteria

Record exact commands, tool versions, exit codes and relevant artifacts.
Use disposable clean checkouts/fixtures; existing npm node_modules is not proof.

- [ ] Baseline results are captured under comparable conditions before migration.
- [ ] Clean `pnpm install --frozen-lockfile` works on Node **22.19.0** and **24**;
      repeated install leaves committed lock/config unchanged.
- [ ] Workspace discovery includes exactly five child packages plus root.
- [ ] Root `pnpm run check`, `pnpm run check:ci`, `pnpm test` and
      `pnpm run test:coverage` pass without reduced thresholds.
- [ ] All five package-scoped workflow checks and coverage commands pass;
      argument/coverage scopes, summaries and artifacts are preserved.
- [ ] Configured fail-closed run/exec behavior is verified without hidden installs.
- [ ] Test-first regressions prove pnpm shared-file detection, existing shared
      triggers, scoped/no-relevant-change cases, and lock-only nonpublication.
- [ ] Audit evidence covers the declared dependency classes/importers and proves
      nonzero vulnerability and tool/registry failure outcomes using fixtures.
      Live advisory findings are reported, not suppressed.
- [ ] Disposable child-versioning test changes only the intended package version,
      reviews lifecycle effects, performs necessary lock reconciliation, creates
      no tags/commits, and ends with successful frozen installation.
- [ ] npm-packed pi-exa has valid exports/declarations/bin/modes and starts in an
      isolated consumer fixture without external API calls. Other package
      artifact contracts remain valid.
- [ ] All five packages' declared extension entries load using an approved
      isolated harness, including pi-notion's additional mcp-client entry.
- [ ] Where an authorized runnable workflow ref exists, existing release dry-run
      records run/ref, nonempty selection and actual job conclusions; publish is
      skipped. Otherwise report this check blocked, not passed.
- [ ] Dependency graph differences, effective overrides, build approvals,
      retained npm commands and any baseline failures are explained in the PR.

**Failure policy:** Reproduce baseline failures; fix migration-induced regressions.
Unrelated fixes require separate approval. Failed/skipped checks are not passes,
and exceptions require explicit maintainer disposition. Never lower security or
coverage policy, bypass the duplicate-version guard, or bump versions solely to
obtain a green dry-run.

**Validation limits:** Existing release dry-run does not run prepack, coverage,
publication authorization or provenance validation. Packing can run lifecycle
scripts and write files, so perform it in disposable checkouts. No actual publish
is an acceptance check.

## Non-goals

No package renaming/version bumps, unrelated upgrades, authentication redesign,
registry-side changes, new publication selection, unrelated security hardening,
or publication for verification. Existing npm-view error classification can be
raised separately; do not silently redesign it in this migration.

## Key primary sources

- [pnpm import](https://pnpm.io/cli/import) and
  [v12.8.1 implementation](https://github.com/pnpm/pnpm/blob/v12.8.1/pnpm/crates/cli/src/cli_args/import.rs)
- [Workspace](https://pnpm.io/pnpm-workspace_yaml),
  [overrides](https://pnpm.io/settings/dependency-resolution#overrides),
  [build/run safety](https://pnpm.io/settings/build)
- [Audit](https://pnpm.io/cli/audit),
  [versioning](https://pnpm.io/cli/version),
  [npm lifecycles](https://docs.npmjs.com/cli/v11/using-npm/scripts#npm-publish)
- [pnpm setup action](https://github.com/pnpm/action-setup#readme),
  [setup-node](https://github.com/actions/setup-node/blob/v6/README.md),
  [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

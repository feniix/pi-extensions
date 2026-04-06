# PRD Example Excerpt

These are sections adapted from a production PRD (replacing Ansible with a typed Bun framework for server provisioning). Use them to calibrate tone, depth, and level of detail. Each section shows what "good" looks like — not as content to copy, but as a benchmark for your own drafting.

---

## Example: Header

Filename: `PRD-007-infra-deploy-framework.md`

```yaml
---
title: "infra-deploy — Type-safe, Bun-native configuration-as-code framework"
prd: PRD-007
status: Draft
owner: Alex
issue: "#78"
date: 2026-03-23
version: "1.0"
---
```

# PRD: infra-deploy — Type-safe, Bun-native configuration-as-code framework

---

## Example: Problem & Context (Section 1)

The application is managed by Ansible — two playbooks (`provision.yml` and `deploy.yml`) across 9 roles, ~130 tasks, 18 Jinja2-processed files (10 config templates + 8 systemd units with Jinja2 variables), and ~280 lines of YAML variables. The project has already migrated all operational scripts from Bash to Bun TypeScript (`migrate-to-bun` branch), making Ansible the last remaining Python dependency.

Ansible served well for initial setup, but its weaknesses are now a daily friction:

- **No type safety.** A typo in `all.yml` (`cachRead` instead of `cacheRead`) isn't caught until deploy time — or worse, runtime. Jinja2 templates fail silently on missing variables.
- **No orphan cleanup.** Removing a task from a role leaves the corresponding file on disk forever. The codebase has 13 manual cleanup tasks (`state: absent`) across roles to remove deprecated scripts, units, and configs — each one is a task someone had to remember to add.
- **Jinja2 is hostile to JSON.** The largest template (`app-config.json.j2`, 407 lines) is full of `{{ "," if not loop.last else "" }}` hacks because Jinja2 is building structured data with string templating.
- **Dry-run is limited.** `ansible-playbook --check` skips all `command`/`shell` tasks entirely (shows "skipping"), gives no useful diff for templates, and the output is noisy with irrelevant `[localhost]` prefixes.
- **Python dependency.** Ansible requires Python on the target — a dependency this project no longer needs for anything else.

Both playbooks use `connection: local` — Ansible runs directly on the target machine, no SSH. This means the replacement does not need an SSH layer, making a custom framework tractable.

The timing is right because the `migrate-to-bun` branch has already converted every script to TypeScript. Ansible is the last piece.

**Calibration notes:**
- Opens with quantified context (9 roles, ~130 tasks, 18 templates, ~280 lines) — a reader can gauge scope immediately
- Each pain point is specific and evidenced, not vague ("13 manual cleanup tasks", "407 lines")
- Ends with why now — timing tied to a concrete event (branch migration completed)

---

## Example: Goals & Success Metrics (Section 2)

| Goal | Metric | Target |
|------|--------|--------|
| **Eliminate Python dependency** | Python packages required for deploy | 0 (currently: ansible, jinja2, pyyaml) |
| **Catch config errors at compile time** | Type errors caught by `tsc --noEmit` before deploy | 100% of type errors caught at compile time; semantic errors caught by `validateConfig()` before any task executes |
| **Automatic orphan cleanup** | Files left on disk after removing a task from config | 0 (currently: orphans persist until manual `absent` task added) |
| **Better dry-run** | Tasks with useful output in dry-run mode | 100% (currently: command/shell tasks show "skipping") |
| **Full test coverage of deploy logic** | Templates and role plans covered by `bun test` | 100% (currently: 0% — Ansible playbooks cannot be unit tested) |
| **Fast deploys** | Wall-clock time for full dry-run | < 5s (currently ~15-20s with Ansible) |

**Guardrails (must not regress):**
- All files currently deployed by Ansible must continue to be deployed in the same locations with the same permissions
- Dry-run must remain the default mode (no args = safe); `--apply` required for any mutation
- No secrets may appear in `config.ts` or any version-controlled file
- The two-user model (`admin` runs deploy, `appuser` owns the files) must be preserved

**Calibration notes:**
- Every goal has a specific, measurable target — not "improve performance" but "< 5s (currently ~15-20s)"
- Current state is included for contrast ("currently: 0%", "currently: orphans persist")
- Guardrails state what must NOT change — creating a safety net for the implementer

---

## Example: Users & Use Cases (Section 3)

### Primary: Alex (admin user)

> As the admin user, I want to deploy configuration changes by running `infra-deploy --apply`, with a type-safe config and automatic cleanup of removed resources, so that I spend less time debugging deploy issues and never leave orphaned files on disk.

**Preconditions:** Logged in as `admin`, repo checked out, `bun` installed.

### Secondary: AI agent (via Claude Code)

> As an AI agent editing configuration, I want compile-time type safety on all config values so that I can make surgical edits with confidence and catch mistakes before they reach the deploy step.

**Preconditions:** Claude Code session with access to the repo, `tsc --noEmit` available for validation.

### Future: macOS deployment (enabled by this work)

> As a developer, I want to deploy the application on macOS using the same framework, with platform-specific providers for Homebrew, launchd, and Keychain, so that I don't maintain a separate deployment system per OS.

**Calibration notes:**
- Named real users, not abstract personas — "Alex (admin user)" not "Admin User"
- Preconditions are concrete and testable
- Future user tied to a specific extension point the current work enables

---

## Example: Scope (Section 4)

### In scope

1. **Framework core** — DSL primitives organized in three tiers:
   - **Cross-platform** (identical implementation): `role`, `tag`, `copy`, `template`, `symlink`, `absent`, `dir`, `exec`, `download`, `httpCheck`, `replace`, `unarchive`
   - **Cross-platform with provider dispatch** (same interface, platform-specific implementation): `user`, `group`, `npm`
   - **Linux-specific**: `apt`, `aptRepo`, `systemd`
2. **State management** — State file for tracking managed resources with atomic writes; scoped orphan detection and cleanup via `manages` declarations
3. **Config migration** — Port `all.yml` to typed `config.ts` with `AppConfig` interface and runtime validation

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| macOS provider implementations | Linux-only deployment today; macOS DSL functions and provider interfaces are defined but only Linux providers are implemented | TBD |
| Parallel task execution | Sequential is fast enough locally (~2-3s); DSL supports opt-in `parallel: true` on tags for future use | TBD |
| Remote (SSH) deployment | Both playbooks use `connection: local`; no SSH needed today | TBD |
| Interactive prompts | Adds complexity for a rare flow. Accept token via env var or CLI flag instead | TBD |

### Design for future (build with awareness)

- **Cross-platform provider interfaces**: `PackageProvider`, `ServiceProvider`, `UserProvider`, `SecretProvider` are abstract interfaces. Linux providers implement them now. macOS provider interfaces are defined as stubs — implementing them activates the macOS DSL functions without changing any role file or framework code.
- **Parallel execution**: `tag()` accepts an optional `parallel: true` flag. The runner ignores it now (sequential), but the DSL is ready.
- **State file versioning**: State file has a `version` field. Future schema changes are backward-compatible via version-based migration.

**Calibration notes:**
- In-scope items are numbered and specific — not "build the framework" but the actual DSL functions listed
- Out-of-scope has concrete reasons, not "not needed" — explains WHY each item is deferred
- Design for future shows concrete extension points, not vague "make it extensible"

---

## Example: Functional Requirement (Section 5)

### FR-4: State file and orphan reconciliation

After each `--apply` run, the framework writes a JSON state file recording every managed resource (type, path, content hash). On subsequent runs, the reconciler diffs the new task plan against the old state within managed scopes to detect orphans. An orphan is a resource that exists in the **old state file** but is **not in the new task plan**.

**Acceptance criteria:**

```gherkin
Given a previous deploy created state with deploy-app.ts and cleanup-sessions.ts
  And the current config no longer includes cleanup-sessions.ts
  And the role declares manages: ["${bin}/app-*"]
When the framework runs in dry-run mode
Then the output shows "⦿ cleanup-sessions.ts — would remove (not in config)"
  And no file is deleted

Given a file "/usr/bin/node" exists but is NOT within any managed scope
  And the file is not in the current task plan
When the reconciler runs
Then the file is not touched, not reported, not considered an orphan

Given a role with manages: ["/usr/local/bin/ollama"]
  And the ollama tasks are excluded via ...when(config.installOllama, [...]) where installOllama is false
When the reconciler runs
Then the manages scope for ollama tasks is also excluded from orphan detection
  And "/usr/local/bin/ollama" is NOT treated as an orphan
```

**Files:**
- `provision/state/state.ts` — New — `readState()`, `writeState()`, state file schema, version migration
- `provision/state/reconcile.ts` — New — `reconcile(oldState, newPlan, scopes)` → action list (create/update/remove)
- `provision/state/scope.ts` — New — `matchesScope(path, scopeGlob)` with exhaustive tests
- `provision/state/remove.ts` — New — `removeOrphan()` with defense-in-depth (re-verify scope, protected paths list)

**Calibration notes:**
- ~150 words description plus Gherkin — right ballpark for a mid-complexity requirement
- Gherkin covers the happy path AND important edge cases (out-of-scope file, conditional feature flag)
- Scenarios use concrete values (`"/usr/bin/node"`, `cleanup-sessions.ts`) not abstractions
- File paths are concrete with brief notes on what each file does

---

## Example: Non-Functional Requirements (Section 6)

| Category | Requirement |
|----------|-------------|
| **Performance** | Full deploy dry-run completes in < 5 seconds (vs ~15-20s with Ansible) |
| **Safety** | Dry-run is the default mode; `--apply` required for any mutation |
| **Safety** | Orphan removal re-verifies scope at deletion time (defense-in-depth); protected paths list prevents catastrophic deletes |
| **Safety** | State file writes use atomic temp-file + fsync + rename pattern. Embedded SHA-256 checksum verified on read |
| **Testability** | All templates, role plans, reconciler logic, and scope matching are unit-testable without root or real filesystem |
| **Readability** | Role files read as task manifests; a developer unfamiliar with the framework can understand intent by scanning task names |
| **Exit codes** | Exit 0 = all tasks succeeded. Exit 1 = any task failed. Same semantics for both `--apply` and dry-run |

**Calibration notes:**
- Each requirement is specific and measurable — "< 5 seconds" not "fast"
- Multiple entries per category is fine when the requirements are distinct
- Safety requirements describe the mechanism, not just the intent

---

## Example: Risks & Assumptions (Section 7)

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Idempotency edge cases in primitives (file permission comparison, apt held packages, systemd state transitions) | High | Medium | Exhaustive unit tests for every primitive; filesystem tests in temp dirs; validate against Ansible-deployed system (all tasks should report "ok") |
| Orphan reconciler bug deletes files that should exist | Critical | Low | Paranoid test coverage; defense-in-depth with scope re-verification at deletion time; protected paths list; dry-run shows orphans before removal |
| State file corruption or loss causes unexpected behavior | Medium | Low | Atomic writes prevent partial writes; `.bak` copy kept before each write; embedded SHA-256 checksum verified on read — mismatch is a loud failure; missing state treated as first run |
| Greenfield framework with single maintainer — untested in production, maintenance burden compounds over 3-5 years | High | Medium | Paranoid test coverage, structured logging for post-mortem, reconstructable state. Revisit Pulumi if maintenance burden becomes unsustainable |

### Assumptions

- **Single instance per machine.** Each machine runs exactly one application instance with one dedicated service user. This is a hard architectural constraint.
- Both playbooks will continue to use local execution only (no SSH)
- The two-user model (admin deploys, appuser owns) remains the deployment architecture
- Root access (via sudo) is available during deploy for system-level tasks

**Calibration notes:**
- Mitigations are actionable and specific — "exhaustive unit tests + validate against Ansible-deployed system" not "test thoroughly"
- Severity/likelihood are realistic (Critical/Low for the scariest bug, not everything High/High)
- Assumptions are stated so they can be challenged — the bold one explains WHY it's a hard constraint

---

## Example: Design Decision (Section 8)

### D1: Custom framework vs existing tool (Nikita.js / Pulumi)

**Options considered:**
1. **Nikita.js** — Node.js automation framework, closest Ansible equivalent. Built-in actions for files, services, packages. 62 stars, CoffeeScript codebase, uncertain Bun compatibility.
2. **Pulumi** — Mature TypeScript IaC. `@pulumi/command` for local execution. Cloud-focused, requires state backend, no built-in file/template/systemd modules.
3. **Custom Bun framework** — Build idempotent primitives using Bun's native APIs.

**Decision:** Custom Bun framework.

**Rationale:** No mature TypeScript framework does local server configuration management. Nikita.js is the closest with a rich action set, but has 62 stars, a CoffeeScript codebase (47% of source), no commits since August 2024, and uncertain Bun compatibility. Pulumi received a comprehensive evaluation — it would eliminate the highest-risk greenfield code (state management, orphan detection) but has no native primitives for this domain, and dynamic providers are incompatible with Bun. The local-only constraint makes custom feasible — ~16 primitives at ~50-100 lines each, fully understood, fully typed, fully tested.

**Future path:** If the framework proves useful beyond this project, it could be extracted and published. The provider pattern means the core is not project-specific. If cloud or multi-machine needs arise, Pulumi can be adopted at that layer without rewriting the framework's primitives or DSL.

**Calibration notes:**
- Shows the alternatives considered with enough detail to understand why they were rejected
- Rationale explains the WHY with specific evidence (star count, CoffeeScript %, Bun compatibility)
- Future path is concrete — what would trigger revisiting, and what would change

---

## Example: File Breakdown (Section 9)

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `provision/framework/dsl.ts` | New | FR-1 | Cross-platform DSL functions with generic types for compile-time cascading; `when()` helper |
| `provision/framework/runner.ts` | New | FR-1, FR-3 | Task executor: sequential, dry-run, output, stop-on-failure, failOk |
| `provision/config.ts` | New | FR-2 | Typed config object replacing `ansible/group_vars/all.yml` |
| `provision/state/reconcile.ts` | New | FR-4 | `reconcile()` pure function: oldState × newPlan × scopes → actions |
| `provision/templates/app-config.ts` | New | FR-5 | Replaces `app-config.json.j2` — object builder |
| `provision/roles/deploy.ts` | New | FR-6 | Scripts, configs, plugins, workspace, git |
| `bin/infra-deploy.ts` | New | FR-9 | Single entry point replacing both `deploy.ts` and `ansible-playbook provision.yml` |
| `bin/deploy.ts` | Delete (Phase 8) | FR-9 | Kept during soak period; deleted after full validation |
| `CLAUDE.md` | Modify | FR-6 | Update validation commands (remove ansible-playbook references) |

**Calibration notes:**
- Every file traces to an FR; every FR has files
- Change types are specific (New / Modify / Delete) with context ("Delete (Phase 8)")
- Descriptions are brief but actionable — a developer can estimate effort from these

---

## Example: Dependencies & Constraints (Section 10)

- **Bun >= 1.3** (pinned via `.mise.toml`) — required for `Bun.file()`, `Bun.write()`, `Bun.CryptoHasher`, `Bun.spawnSync`
- **`diff` (npm)** — unified diff generation for dry-run file comparisons (41M weekly downloads, zero deps, BSD-3)
- **`citty` (npm)** — UnJS TypeScript-first CLI framework (~16M weekly downloads, zero deps, MIT). Pin version: pre-1.0 (v0.2.1)
- **Root access** — required for system-level tasks; available via existing sudo configuration
- **1Password CLI (`op`)** — must remain installed for secret resolution

**Calibration notes:**
- Versions are specific, with pinning strategy noted
- npm packages include weekly downloads and license — helps assess risk
- System requirements (root, 1P CLI) listed alongside code dependencies

---

## Example: Rollout Plan (Section 11)

1. **Phase 0: Foundation** — `config.ts`, `types.ts`, `validate.ts`, `framework/` (DSL, runner, context, types, output, handlers). Validates that the config shape works and the DSL compiles.
2. **Phase 1: Primitives + providers** — All primitive functions, Linux providers, platform detection. Tests in temp dirs. Primitives depend on providers, so they ship together.
3. **Phase 2: Templates + service definitions** — All config template functions, all service definitions, and the SystemdRenderer. Compare rendered output against Ansible templates using semantic equality.
4. **Phase 3: State & reconciler** — State management with paranoid test coverage. Validates orphan detection works correctly before it touches any real files.
5. **Phase 4: Roles (deploy + systemd + verify)** — Port the day-to-day roles. Run against the Ansible-deployed system — all tasks should report "ok". This replaces `deploy.yml`.
6. **Phase 5: Roles (provision)** — Port system, user, secrets, third-party services. This replaces `provision.yml`.
7. **Phase 6: CLI** — Create `infra-deploy.ts` as single entry point via citty. Old `deploy.ts` kept as fallback during soak period.
8. **Phase 7: Validation & soak** — Run full deploy against live system, verify idempotency. Move `ansible/` to a branch. Begin 2-4 week soak period.
9. **Phase 8: Cleanup** — After soak period with no issues, delete old CLI and the ansible branch.

**Calibration notes:**
- Each phase has a clear deliverable and validation criteria
- Dependencies between phases are explicit (primitives depend on providers → ship together)
- Destruction is deferred to the end and gated on validation ("after soak period with no issues")

---

## Example: Open Questions (Section 12)

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | Should the state file be version-controlled or gitignored? | Alex | Before Phase 3 | **Resolved:** Not version-controlled. State is machine-specific, reconstructable via a full `--apply` run. Lives in `~/.local/state/infra-deploy/` per XDG spec. |
| Q2 | Where does the state file live on disk? | Alex | Before Phase 3 | **Resolved:** `~/.local/state/infra-deploy/` (XDG state directory). Machine-specific state that can be regenerated from a successful apply. |
| Q3 | Should `deploy` become an alias for `infra-deploy` or remain separate? | Alex | Before Phase 6 | **Resolved:** Single entry point. `infra-deploy` replaces both the old deploy script and `ansible-playbook provision.yml`. |
| Q4 | How do we validate that the new framework deploys the exact same files as Ansible? | Alex | Before Phase 4 | **Resolved:** Iterative dry-run against Ansible-deployed system — every task must show "ok" with no diffs. First `--apply` bootstraps state as a no-op. |
| Q5 | Do the old and new CLIs share a single state file? | Alex | Before Phase 3 | **Resolved:** Single state file. With `infra-deploy` as the single entry point (Q3), one state file. |
| Q6 | Byte-identical or semantically identical template comparison? | Alex | Before Phase 2 | **Resolved:** Semantic equality. `JSON.stringify()` hoists integer-like keys per ES2015+ spec, making byte-identical comparison fragile. |

**Calibration notes:**
- **Status column format**: `Open` for unresolved, `**Resolved:** [concise answer]` for resolved. The resolution ALWAYS goes in the Status column — never in the Question column. This makes scanning trivial: you can read down the Status column to see what's still open.
- Each question has an owner and a due date tied to a phase — not "TBD" or "later"
- Resolved questions preserve the answer so future readers understand the decision

---

## Example: Related (Section 13)

| Issue | Relationship |
|-------|-------------|
| `migrate-to-bun` branch | Depends-on — this PRD extends the migration to the last remaining Python component |
| [#84 — Migrate secret storage to systemd-creds](https://github.com/acme/infra/issues/84) | **Completed** (PRD-013, PR #86, merged 2026-03-24). The secrets role starts from systemd-creds as baseline |
| [Pulumi evaluation](../research/pulumi-evaluation.md) | Research — comprehensive analysis of Pulumi as alternative foundation. Confirmed custom approach |

**Calibration notes:**
- Relationship type is specific: depends-on, completed, research — not just "related"
- Completed items include the resolution (PR link, merge date) so the relationship is fully resolved
- Non-issue items (branches, docs) are included when they're meaningful context

---

## Example: Changelog (Section 14)

| Date | Change | Author |
|------|--------|--------|
| 2026-03-23 | Initial draft | Alex + Claude |
| 2026-03-23 | Review pass: fixed role count (8→9), task count (~80→~120), added missing DSL functions, added privilege escalation design | Claude |
| 2026-03-24 | Secret storage redesign: `systemd-creds` replaces clevis/TPM2. New constraint: single instance per machine | Alex + Claude |
| 2026-03-24 | Pulumi evaluation integration: resolved Q1/Q2 (XDG state directory), redesigned handler system to content-hash triggers | Alex + Claude |

**Calibration notes:**
- Each entry summarizes what changed at a high level — not a git diff, but enough to follow the PRD's evolution
- Co-authorship is noted (Alex + Claude) when both contributed
- Factual corrections are specific ("fixed role count 8→9") so readers know what was wrong before

---

## Example: Verification (Section 15)

1. **Idempotency check**: Run `infra-deploy --apply --all` against the Ansible-deployed system. Every task should report `✓ ok`. Zero files changed.
2. **Config change flow**: Change `primary_model` in `config.ts`, run dry-run. Verify the diff shows the expected change. Apply. Verify the file is updated.
3. **Orphan detection**: Add a dummy task that creates a test file, apply. Remove the task, run dry-run. Verify the orphan is reported. Apply. Verify the file is deleted.
4. **Template regression**: For each config template, compare the Bun-rendered output against the Ansible-rendered output. JSON configs must be semantically identical (parsed JSON deep-equal).
5. **Type safety**: Introduce a typo in `config.ts` (`baseUrl: 42` instead of a string). Run `tsc --noEmit`. Verify the error is caught at compile time.
6. **State file resilience**: Corrupt the state file (invalid JSON). Run `infra-deploy`. Verify it fails loudly and does NOT delete any files.
7. **Signal safety**: Start a deploy with overlays mounted, send SIGINT mid-run. Verify overlays are remounted before exit.

**Calibration notes:**
- Each step is executable by someone else — not "verify it works" but "change X, run Y, expect Z"
- Covers happy paths (idempotency), error paths (corruption), and edge cases (signal handling)
- Distinct from FR acceptance criteria — these are end-to-end integration checks, not unit-level Gherkin

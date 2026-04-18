---
title: "pi-conductor — long-lived multi-session worker orchestration for Pi"
prd: PRD-001
status: Implemented
owner: "feniix"
issue: "N/A"
date: 2026-04-18
version: "1.2"
supersededBy: "PRD-002"
---

# PRD: pi-conductor — long-lived multi-session worker orchestration for Pi

> Superseded by `docs/prd/PRD-002-pi-conductor-persistent-resumable-workers.md`.

---

## 1. Problem & Context

Pi is intentionally minimal and extensible, but it does not ship with a first-class system for coordinating multiple long-lived workers across isolated git worktrees. Today, parallel workflows are possible through manual combinations of git worktree, tmux, multiple terminals, and repeated `pi` launches, but the workflow is ad hoc and high-friction.

This is now worth addressing for three reasons:

- **Personal workflow need:** the primary user wants to run multiple workers on the same project at the same time without multiple full clones, constant branch switching, or losing conversational state.
- **Product validation:** this is a good test of whether Pi’s SDK and session model can support long-lived orchestration cleanly.
- **Reusable package opportunity:** if the model works well, it should become a publishable Pi package in this repo under `packages/pi-conductor`.

The target v1 is deliberately narrower than “full agent teams.” It focuses on:
- one worker per git worktree
- resumable worker sessions
- explicit task assignment and updates
- operational status/progress
- one branch / one PR per worker in normal v1 usage
- no iTerm2 automation, no worker-to-worker messaging, no automatic merge

The codebase already provides useful precedent:
- package structure under `packages/*`
- extension-based Pi packages
- `@feniix/pi-devtools` for branch/PR operations and environment assumptions
- Pi SDK support for persistent sessions and runtime-controlled prompting

External Pi-related research also informed this PRD:
- `pi-agent-teams` for lifecycle/task concepts
- `pi-side-agents` for worktree-centric multi-worker execution
- `pi-collaborating-agents` for future coordination ideas, though not for v1 scope

This makes the initiative feasible, but it requires a coherent product model for worker identity, storage, runtime ownership, branch/worktree lifecycle, session-reference lifecycle, and operator UX.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| **Start isolated workers quickly** | Human starts 2 workers from the same repo without any manual `git worktree` commands | 2 workers can be created through conductor-only commands/tools in one flow |
| **Support true resumption** | Worker can be resumed after conductor restart or shell restart without losing branch/worktree/session linkage | 100% of persisted workers retain enough metadata to resume correctly |
| **Make tasking explicit and low-ceremony** | Assigning or updating a worker’s current task requires exactly one conductor command or one conductor tool call | 100% of task mutations meet this constraint |
| **Provide actionable progress visibility** | Status output includes worker id, worker name, branch, worktree path, session reference, task, lifecycle state, summary, and PR reference when present | 100% of persisted workers expose this shape |
| **Produce one PR per worker flow** | A ready worker can complete commit, push, and PR creation without manual git or gh commands | 100% of ready workers can complete conductor-managed PR preparation when prerequisites are met |
| **Ship as a clean Pi package** | Package follows workspace conventions and has tests and README | `packages/pi-conductor` conforms to current repo package patterns |

**Guardrails (must not regress):**
- The package must remain usable without tmux.
- Worker orchestration state must not depend on terminal scraping.
- v1 must not require committing runtime/session artifacts to the repo.
- The design must leave room for a future tmux adapter without making tmux a core dependency.
- Failure to create a PR must not corrupt worker/session/worktree metadata.

---

## 3. Users & Use Cases

### Primary: Pi power user working on one repo

> As a Pi user, I want to start multiple workers in isolated git worktrees and resume them later so that I can pursue parallel tasks without cloning the repo multiple times or losing session context.

**Preconditions:** Git repository exists, worktrees are available, Pi is configured, required CLIs (`git`, optionally `gh`) are installed.

### Secondary: Package author / workflow experimenter

> As a package author, I want a Pi-native orchestration package with explicit runtime and storage boundaries so that the feature can evolve into a reusable public package instead of staying a one-off script.

**Preconditions:** Repo follows the workspace package conventions; the author can add a new package under `packages/pi-conductor`.

### Future: tmux-oriented operator (enabled by this work)

> As a terminal-centric user, I want to surface existing conductor workers in tmux so that I can visually monitor or attach to workers without changing the core orchestration model.

---

## 4. Scope

### In scope

1. **Worker creation** — create one worker with one dedicated git worktree and associated metadata.
2. **Worker persistence and resumption** — persist enough state to resume a worker session after process interruption or restart.
3. **Task assignment/update** — store and update one current task per worker, with continuity-based resumption.
4. **Worker status and summaries** — expose practical operational status, including lifecycle state and summary freshness.
5. **PR preparation flow** — support commit, push, and PR creation for a worker branch when environment prerequisites are satisfied.
6. **Minimal command + tool surface** — provide a small operator UX through commands and underlying tools.
7. **Failure recovery and cleanup** — detect and recover from partially-created workers and allow cleanup of stale worker records/worktrees.
8. **Future adapter seam** — keep the architecture ready for a later tmux adapter without implementing it now.

### Out of scope / later

| What | Why | Tracked in |
|------|-----|------------|
| iTerm2 automation | macOS-specific and brittle; not needed to prove orchestration model | Untracked follow-up |
| Agent-to-agent messaging | Adds protocol and coordination complexity beyond v1 needs | Untracked follow-up |
| Autonomous planner/reviewer hierarchies | Major scope expansion and not needed for explicit operator-led workflow | Untracked follow-up |
| GUI/TUI dashboard beyond basic status | UX-heavy and not required to validate core engine | Untracked follow-up |
| Automatic merge | High-trust operation; PR creation is sufficient for v1 | Untracked follow-up |
| Windows support | Unix-first target for v1 | Untracked follow-up |
| Exact parity with Claude agent teams or any existing tool | Product should be Pi-native and borrow ideas selectively | Untracked follow-up |

### Design for future (build with awareness)

The core model should anticipate:
- a future **tmux adapter package** that surfaces worker sessions
- possible future **alternate worker runtimes** beyond SDK-first
- possible future **auto-assignment** or queueing
- possible future **multi-PR lifetime per worker identity**

Future-readiness in code should mean narrow interfaces and clear state ownership, not speculative features.

Concretely, v1 should:
- keep worker runtime behind a small internal runtime boundary
- keep storage independent from Pi’s internal session directory layout
- keep presentation separate from worker correctness/state
- keep worker ids stable even if user-facing names evolve later

---

## 5. Functional Requirements

### FR-1: Create a worker with an isolated git worktree

The package must create a worker backed by a dedicated git worktree and branch, with conductor-owned metadata linking the worker to its project, branch, worktree path, and Pi session reference.

Each worker has:
- a stable internal `workerId`
- a user-facing `name`
- exactly one active worktree in v1
- exactly one active branch in v1 practice

Worker names must be unique within a project. Stable ids are immutable and remain the storage key even if user-facing naming behavior changes later.

Conductor may be invoked from any path inside the target repository. The repo root must be auto-detected from the current cwd and used as the basis for worker creation, branch detection, and project-key derivation.

By default, a new worker is based on the **current checked-out branch in the repo root** when the worker is created. If that cannot be determined safely, conductor may fall back to the detected default branch.

Branch names must be deterministic and conductor-owned, following a convention like:

`conductor/<worker-name>` or `conductor/<worker-id>-<slug>`

When a branch name is derived from a user-facing worker name, conductor must normalize it into a valid git branch slug by:
- lowercasing
- converting whitespace to `-`
- replacing or removing characters invalid in git refs
- collapsing repeated separators where practical

If normalization would produce an ambiguous or empty slug, conductor must fall back to a `workerId`-based branch component.

**Acceptance criteria:**

```gherkin
Given a git repository with a current checked-out branch
When the user starts a new worker named "backend"
Then conductor creates a dedicated git worktree for that worker
  And creates a conductor-managed branch for that worker from the current branch
  And persists a stable worker id, worker name, worktree path, and branch
  And the worker can be listed in status output

Given a project that already has a worker named "backend"
When the user attempts to create another worker named "backend"
Then conductor rejects the request
  And explains that worker names must be unique within the project
```

**Files:**
- `packages/pi-conductor/extensions/index.ts` — register commands/tools
- `packages/pi-conductor/extensions/worktrees.ts` — create and validate worker worktrees
- `packages/pi-conductor/extensions/types.ts` — worker and run state types
- `packages/pi-conductor/extensions/storage.ts` — persist worker metadata
- `packages/pi-conductor/extensions/project-key.ts` — derive stable project key

### FR-2: Resume a worker as a continuation of the same thread of work

A worker must be resumable across conductor restarts. Worktree reuse must be continuity-based: when resuming the same worker/session/branch thread, reuse the existing worktree; otherwise prefer a new worktree for materially different work.

For v1, “materially different work” means any of:
- the prior PR/branch lifecycle is complete or intentionally closed
- the user intends to start a new independent task stream rather than continue the existing one
- the current worktree/branch state is ambiguous or unsafe to reuse

If a worker’s branch has already been merged or closed out, conductor must not silently resume that worker as if nothing happened.

### Session-reference lifecycle

A worker normally retains one Pi session reference across resumptions. Resuming a healthy worker must continue using the existing referenced session.

Recovery may explicitly replace the worker’s session reference only when:
- the old session file is missing
- the old session file is unreadable or invalid
- the operator explicitly chooses recovery that starts a new session lineage

If a session reference is replaced, conductor must persist that replacement explicitly in worker metadata.

**Acceptance criteria:**

```gherkin
Given an existing worker with a persisted branch, worktree, and session reference
When the user resumes that worker
Then conductor rehydrates the worker from persisted metadata
  And reuses the existing worktree when the work is a continuation
  And reuses the existing session reference when it is healthy
  And does not require a new clone of the repository

Given a previous worker whose earlier branch of work is complete
When the user starts materially different work
Then conductor prefers a new worker/worktree instead of silently reusing the old one

Given a worker whose worktree metadata exists but the worktree directory is missing
When the user resumes that worker
Then conductor reports the worker as broken or recoverable
  And does not silently create a replacement worktree without user confirmation

Given a worker whose referenced session file is missing
When the user requests recovery
Then conductor does not pretend the old session still exists
  And only creates a replacement session reference through an explicit recovery action
```

**Files:**
- `packages/pi-conductor/extensions/runtime.ts` — worker runtime and resume logic
- `packages/pi-conductor/extensions/storage.ts` — lookup and hydrate persisted state
- `packages/pi-conductor/extensions/types.ts` — lifecycle state definitions
- `packages/pi-conductor/extensions/worktrees.ts` — continuity and recovery checks

### FR-3: Assign and update the current task per worker

The package must support explicit task assignment and task updates per worker. V1 is human-assigned first, but the data model must allow later queueing or auto-assignment.

Each worker has exactly one current task in v1. Reassigning the task replaces the old current task.

**Acceptance criteria:**

```gherkin
Given an existing worker named "frontend"
When the user assigns the task "implement status command"
Then the worker record stores that task as the current task
  And future status output shows the task

Given a worker with an existing task
When the user updates the task text
Then the new task replaces the prior current task
  And the update is persisted
  And the mutation requires exactly one conductor command or tool call
```

**Files:**
- `packages/pi-conductor/extensions/commands.ts` — human-facing task commands
- `packages/pi-conductor/extensions/tools.ts` — task mutation tools
- `packages/pi-conductor/extensions/storage.ts` — persist task state

### FR-4: Show practical worker status and progress

The package must expose useful operational status for each worker, including:
- worker id
- worker name
- branch
- worktree path
- session reference
- current task
- lifecycle state
- last summary
- summary freshness indicator
- PR reference if present
- recoverability metadata when broken

The canonical v1 lifecycle states are:

- `idle`
- `running`
- `blocked`
- `ready_for_pr`
- `done`
- `broken`

`broken` means the persisted worker cannot currently be resumed safely without operator action.

### Lifecycle transition rules

The canonical v1 transitions are:

- worker created successfully → `idle`
- task assigned or task updated while no run is active → remains `idle`
- worker actively executing prompted work or summary generation → `running`
- operator or worker surfaces an explicit blocker that prevents progress → `blocked`
- operator decides the worker branch is ready for commit/push/PR → `ready_for_pr`
- worker work is intentionally concluded for v1 purposes → `done`
- missing/invalid worktree or session reference without safe automatic continuation → `broken`

Additional rules:
- PR creation failure does **not** automatically set `done`; the worker typically remains `ready_for_pr` or becomes `blocked`, depending on failure mode.
- A `broken` worker may include `recoverable: true` metadata when a deterministic recovery path exists.
- `recoverable` is metadata, not a separate lifecycle state.

**Acceptance criteria:**

```gherkin
Given two active workers with different tasks
When the user requests conductor status
Then the output lists both workers
  And shows each worker's branch, worktree, current task, and lifecycle state
  And includes last summary when available

Given a worker with no summary yet
When status is requested
Then the worker still appears with summary shown as unavailable or empty

Given a worker with a session reference
  And a persisted pull request reference
  And a stale summary
When status is requested
Then the output includes the worker's session reference
  And includes the persisted pull request reference
  And marks the summary as stale

Given a worker whose worktree is missing or invalid
When status is requested
Then the worker is shown with lifecycle state "broken"
  And indicates whether it is recoverable
```

**Files:**
- `packages/pi-conductor/extensions/status.ts` — status formatting and summaries
- `packages/pi-conductor/extensions/storage.ts` — read worker state
- `packages/pi-conductor/extensions/index.ts` — command/tool wiring
- `packages/pi-conductor/extensions/types.ts` — status enums and display types

### FR-5: Support worker summary generation

The package must support requesting a concise progress summary from a worker and persisting that summary in conductor state.

A summary becomes stale when:
- the worker receives a new task update after the summary was created
- the worker has produced new activity after the last summary timestamp
- the worker has entered a new lifecycle phase after the summary was recorded

Staleness only affects display semantics; it does not delete the summary.

**Acceptance criteria:**

```gherkin
Given an existing worker session with prior work in progress
When the user asks conductor to summarize that worker
Then conductor obtains a concise progress summary
  And stores the summary in worker metadata
  And status output can display that summary

Given a worker whose task was updated after the last summary
When status is requested
Then the summary is still visible
  And is marked stale
```

**Files:**
- `packages/pi-conductor/extensions/runtime.ts` — prompt worker for summary
- `packages/pi-conductor/extensions/status.ts` — display summary and staleness
- `packages/pi-conductor/extensions/storage.ts` — persist summary metadata

### FR-6: Prepare a worker branch as a PR

The package must support the full v1 PR preparation flow for a worker: commit, push, and PR creation. Review and merge remain outside v1 scope.

For v1, `pi-conductor` should shell out through a **minimal conductor-local git/gh helper layer**, not depend on `@feniix/pi-devtools` internals as a code dependency. It may borrow conventions and behavior from `pi-devtools`, but it should only implement the worker-aware primitives needed for:
- branch/base-branch resolution
- commit
- push
- PR creation

It should **not** reimplement higher-level devtools workflows such as `brpr`, `md`, `smd`, release, CI, or version-management features.

PR flow prerequisites:
- worker branch exists
- worker worktree is valid
- git remote is configured
- `gh` is installed for PR creation
- `gh` is authenticated
- user has provided commit message / PR title inputs, or conductor has enough explicit inputs to construct them

PR creation failures must not corrupt worker metadata. Partial success must be reflected clearly:
- commit succeeded
- push succeeded
- PR creation failed

**Acceptance criteria:**

```gherkin
Given a worker branch with local changes ready for review
  And git remote is configured
  And gh is installed and authenticated
When the user invokes the PR flow for that worker
Then conductor can commit the changes
  And push the branch
  And create a pull request
  And persist the resulting PR URL or number in worker state

Given a worker branch with local changes
  And gh is not authenticated
When the user invokes the PR flow
Then conductor reports a PR creation precondition failure
  And does not lose worker state
  And preserves whether commit or push already succeeded

Given a worker branch with local changes
  And commit succeeds
  And push fails
When the user invokes the PR flow
Then conductor records that commit succeeded
  And records that push failed
  And does not mark pull request creation as attempted
```

**Files:**
- `packages/pi-conductor/extensions/pr.ts` — PR flow orchestration
- `packages/pi-conductor/extensions/git.ts` — git/gh helper wrappers
- `packages/pi-conductor/extensions/runtime.ts` — worker context resolution
- `packages/pi-conductor/extensions/storage.ts` — persist PR metadata and partial state

### FR-7: Recover from failed or abandoned worker setup

The package must provide a recovery path for partially-created workers, stale worktrees, and abandoned metadata.

Recovery and cleanup semantics:
- `broken` is the lifecycle state
- `recoverable` indicates whether a deterministic repair path is available
- `stale` is descriptive metadata for old or abandoned records and is not a lifecycle state

**Acceptance criteria:**

```gherkin
Given worker metadata exists for a worker whose worktree was only partially created
When the user requests cleanup or recovery
Then conductor identifies the worker as recoverable or broken
  And offers or performs a deterministic cleanup path

Given a stale worker record with no usable session and no usable worktree
When cleanup is requested
Then conductor removes the stale record
  And does not affect healthy workers
```

**Files:**
- `packages/pi-conductor/extensions/storage.ts` — stale state inspection and cleanup
- `packages/pi-conductor/extensions/worktrees.ts` — worktree cleanup helpers
- `packages/pi-conductor/extensions/commands.ts` — operator cleanup commands

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Architecture** | V1 is SDK/headless-first and must not depend on tmux or terminal scraping for correctness |
| **Storage** | Conductor metadata must live in a conductor-owned, project-scoped namespace under `~/.pi/agent/conductor/projects/<project-key>/` |
| **State ownership** | Conductor owns orchestration metadata; Pi continues to own session internals and session file format |
| **Safety** | Worktree reuse must be conservative and continuity-based, not aggressively automatic |
| **Safety** | PR creation failures must be recoverable and must not corrupt worker lifecycle metadata |
| **Usability** | V1 human-facing command surface should remain within 4–6 top-level command groups |
| **Usability** | The minimum human-facing command set for v1 should cover: worker start, worker status, task assignment/update, summary request, PR preparation, and cleanup/recovery |
| **Portability** | V1 targets macOS and Linux only |
| **Testability** | Core state, worktree selection, resume logic, cleanup logic, project-key derivation, and status formatting must be unit-testable without requiring a live GUI terminal surface |
| **Operational clarity** | Status output must distinguish healthy, stale, and broken workers without requiring filesystem inspection by the user |

### Command/tool contract

The intended v1 split is:
- **Commands** for human operators: start, status, task mutation, summarize, pr, cleanup/recover
- **Tools** for lower-level orchestration primitives and model-callable flows

Implementation may rename the exact commands, but it must preserve this contract and remain within the command-surface limit above.

For this limit, a “top-level command group” means a primary operator entry such as `start`, `status`, `task`, `summarize`, `pr`, or `cleanup`. Nested subcommands within one group do not each count as separate command groups.

---

## 7. Risks & Assumptions

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| SDK-managed multi-worker orchestration may expose edge cases not seen in single-session usage | High | Medium | Isolate runtime layer early and keep future process-backed runtime possible |
| Pi default session storage may be awkward for worktree-heavy worker layouts | Medium | Medium | Store conductor metadata separately and reference session files rather than coupling to Pi session directory internals |
| Worktree reuse may lead to stale or confusing state | High | Medium | Reuse only on explicit continuation; otherwise prefer new worker/worktree |
| Operator UX may become too ceremonial | High | Medium | Keep commands minimal and task model simple; optimize for personal workflow first |
| PR flow may fail due to environment assumptions (`gh`, auth, git config, remote state) | High | High | Validate preconditions before PR flow, record partial progress safely, and surface actionable errors |
| Cleanup/recovery behavior may accidentally remove useful state | High | Low | Require deterministic classification of worker state and scope cleanup to a single targeted worker unless user explicitly requests broader cleanup |

### Assumptions

- Workers are project-bound and one worker corresponds to one git worktree in v1.
- Users are comfortable with explicit worker/task control rather than autonomous delegation.
- A single current task per worker is sufficient for v1.
- PR creation, not merge automation, is the right endpoint for v1 workflow completion.
- New workers should default to the current checked-out branch unless the operator explicitly chooses otherwise.

---

## 8. Design Decisions

### D1: SDK-first runtime with future backend flexibility

**Options considered:**
1. SDK-managed sessions — cleaner state ownership, better fit for headless orchestration
2. Process/RPC-managed workers — closer to CLI supervision, better fit for some terminal surfaces later

**Decision:** Use an SDK-first runtime architecture, while keeping room for a process-backed backend later.

**Rationale:** This best matches the v1 goals of persistence, testability, and headless correctness.

**Future path:** A later tmux or process adapter can reuse the same worker model if runtime boundaries stay narrow.

### D2: Conductor-managed project-scoped storage

**Options considered:**
1. Repo-local state — strong locality but adds repo artifacts and `.gitignore` burden
2. Pi session bucket reuse — convenient but overly coupled to Pi’s internal session layout
3. Conductor-owned global project namespace — clean ownership and no committed runtime files

**Decision:** Use `~/.pi/agent/conductor/projects/<project-key>/` for conductor metadata.

**Rationale:** This keeps runtime state out of Git while avoiding dependence on Pi’s `sessions/` directory structure or extension discovery tree.

### D3: Continuity-based conservative worktree reuse

**Options considered:**
1. Always fresh worktrees — safest but poor fit for long-lived workers
2. Aggressive reuse — efficient but risky
3. Reuse only when resuming the same thread of work

**Decision:** Reuse worktrees only when continuing the same worker/session/branch trajectory.

**Rationale:** This preserves the meaning of “long-lived” without hiding stale-state risks.

### D4: PR flow owns a minimal worker-aware git/gh layer

**Options considered:**
1. Depend on `@feniix/pi-devtools` internals directly — less duplication, but tighter package coupling
2. Implement a conductor-local worker-aware git/gh layer — more isolated and tailored to worker worktrees
3. Require users to run PR steps manually — lower build scope, but fails v1 success criteria

**Decision:** Implement a **minimal conductor-local git/gh layer** for v1, borrowing conventions from `pi-devtools` without taking a direct internal code dependency.

**Rationale:** `pi-conductor` needs worker-aware behavior tied to a specific worktree, branch, and worker lifecycle. That context is core to conductor and should not depend on another package’s internal implementation details.

**Scope of this local layer:** only the primitives needed for:
- branch/base-branch resolution
- git execution in a worker worktree
- commit
- push
- PR creation

**Explicitly out of scope for this layer:** reimplementing higher-level devtools workflows or commands such as:
- `brpr`
- `md`
- `smd`
- release automation
- CI helpers
- versioning/tag utilities

---

## 9. File Breakdown

| File | Change type | FR | Description |
|------|-------------|-----|-------------|
| `packages/pi-conductor/package.json` | New | FR-1 | Package metadata and Pi package declaration |
| `packages/pi-conductor/README.md` | New | FR-1, FR-6 | User-facing install, requirements, and usage documentation |
| `packages/pi-conductor/extensions/index.ts` | New | FR-1, FR-4 | Extension entrypoint; registers commands/tools |
| `packages/pi-conductor/extensions/types.ts` | New | FR-1, FR-2, FR-4, FR-7 | Run, worker, task, status, and storage types |
| `packages/pi-conductor/extensions/storage.ts` | New | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7 | Persist and load conductor metadata, cleanup state |
| `packages/pi-conductor/extensions/project-key.ts` | New | FR-1 | Derive stable project key for storage namespace |
| `packages/pi-conductor/extensions/worktrees.ts` | New | FR-1, FR-2, FR-7 | Create, validate, reuse, and clean up worker worktrees |
| `packages/pi-conductor/extensions/runtime.ts` | New | FR-2, FR-5, FR-6 | Worker runtime, resume, and summary orchestration |
| `packages/pi-conductor/extensions/commands.ts` | New | FR-3, FR-4, FR-7 | Human-facing command handlers |
| `packages/pi-conductor/extensions/tools.ts` | New | FR-3, FR-4 | Tool definitions for worker/task/status operations |
| `packages/pi-conductor/extensions/status.ts` | New | FR-4, FR-5 | Status formatting, lifecycle display, summary staleness |
| `packages/pi-conductor/extensions/pr.ts` | New | FR-6 | PR flow orchestration |
| `packages/pi-conductor/extensions/git.ts` | New | FR-6 | Conductor-local git/gh helper wrappers |
| `packages/pi-conductor/__tests__/index.test.ts` | New | FR-1, FR-4 | Extension wiring tests |
| `packages/pi-conductor/__tests__/storage.test.ts` | New | FR-1, FR-2, FR-3, FR-7 | Storage and cleanup behavior tests |
| `packages/pi-conductor/__tests__/worktrees.test.ts` | New | FR-1, FR-2, FR-7 | Worktree lifecycle tests |
| `packages/pi-conductor/__tests__/status.test.ts` | New | FR-4, FR-5 | Status and summary tests |
| `packages/pi-conductor/__tests__/pr.test.ts` | New | FR-6 | PR flow tests and failure-path tests |
| `packages/pi-conductor/__tests__/project-key.test.ts` | New | FR-1 | Project-key derivation stability and determinism tests |

This is the expected initial decomposition, not a promise that implementation must preserve exactly these boundaries if a simpler structure proves better.

---

## 10. Dependencies & Constraints

- Must fit the repo’s existing package layout and TypeScript test conventions.
- Must work with Pi extension APIs and Pi SDK session capabilities.
- Git worktrees are a hard dependency for the worker isolation model.
- `git` is required for all worker flows.
- `gh` is required for PR creation flows.
- Conductor may be run from any directory inside the target repository; repo root must be auto-detected.
- New workers default to the repo root’s **current checked-out branch** when safely detectable; if unavailable, conductor may fall back to the detected default branch.
- Default branch detection should follow normal git heuristics such as remote HEAD, with a final fallback like `main`.
- V1 should avoid introducing tmux as a required dependency.
- PR creation assumes a configured remote and authenticated GitHub CLI.

---

## 11. Rollout Plan

1. Create `packages/pi-conductor` with types, storage primitives, project-key derivation, and extension scaffold.
2. Implement worker creation and resume flow with git worktrees and persisted metadata.
3. Implement cleanup/recovery classification for stale and broken workers.
4. Add task assignment/update and status/summary surface.
5. Add PR preparation flow with explicit preflight validation and partial-failure persistence.
6. Validate the workflow personally on this repo before considering public release polish.
7. Verify recovery flows by intentionally creating stale state, broken worktrees, missing sessions, and failed PR preconditions.

---

## 12. Open Questions

| # | Question | Owner | Due | Status |
|---|----------|-------|-----|--------|
| Q1 | What runtime model should v1 use for worker execution? | feniix | Before implementation | **Resolved:** SDK-first architecture, with room for a process-based backend later. |
| Q2 | Where should conductor metadata and worker state live? | feniix | Before implementation | **Resolved:** Use `~/.pi/agent/conductor/projects/<project-key>/` for conductor-owned state; worker records reference Pi session files. |
| Q3 | Should v1 expose commands, tools, or both? | feniix | Before implementation | **Resolved:** Both, with a very small command surface. |
| Q4 | How should worktree reuse behave? | feniix | Before implementation | **Resolved:** Reuse conservatively and only when resuming the same thread of work. |
| Q5 | Should `pi-conductor` depend directly on `@feniix/pi-devtools` internals or reimplement its own git/gh helpers? | feniix | Before implementation | **Resolved:** Use a minimal conductor-local git/gh layer for worker-aware primitives only; do not reimplement higher-level devtools workflows like `brpr`, `md`, or `smd`. |
| Q6 | What exact v1 command names should ship? | feniix | Before implementation | Open |

---

## 13. Related

| Reference | Relationship |
|-----------|-------------|
| `pi-agent-teams` | Research input; informed worker lifecycle and task concepts |
| `pi-side-agents` | Research input; informed worktree-oriented execution concepts |
| `pi-collaborating-agents` | Research input; informed future coordination considerations |
| `@feniix/pi-devtools` | Neighbor package; informed git/gh conventions and environment assumptions |

---

## 14. Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial draft | feniix |
| 2026-04-18 | Refined storage boundary, PR dependency strategy, branch/worktree lifecycle, worker identity, status semantics, and cleanup scope | feniix |
| 2026-04-18 | Refined lifecycle transitions, session-reference lifecycle, command/tool contract, repo-root detection, and project-key test coverage | feniix |
| 2026-04-18 | Marked PRD status as Completed after full implementation of the MVP scope and linked ADR decisions | feniix |

---

## 15. Verification (Appendix)

1. Start two workers against the same repo and verify they land in separate git worktrees with distinct branches.
2. Stop and restart the conductor flow, then resume both workers successfully.
3. Assign and update tasks for both workers and verify status output reflects those changes.
4. Request a summary from a worker and verify the summary is persisted and shown in status, then marked stale after task change.
5. Complete commit/push/create-PR flow for one worker and verify PR metadata is saved.
6. Simulate missing `gh` auth and verify PR flow fails safely without corrupting worker metadata.
7. Simulate missing worktree directory and verify the worker becomes `broken`.
8. Simulate stale or partial worker setup and verify cleanup/recovery affects only the targeted worker.
9. Simulate a missing session reference and verify explicit recovery is required before the worker can continue.
10. Verify project-key derivation remains stable across repeated runs from subdirectories inside the same repo.

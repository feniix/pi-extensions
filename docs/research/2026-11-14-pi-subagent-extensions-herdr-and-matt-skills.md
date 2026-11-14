# Pi subagent extensions: Herdr and Matt Pocock skill compatibility

Research date: 2026-11-14. Target environment: Pi 1.5.2, Herdr, and
Matt Pocock's `to-spec`, `implement-spec`, and `tdd` skills.

## Executive recommendation

Keep the existing `nicobailon/pi-subagents` installation unchanged until a
replacement passes a small acceptance test.

- **Herdr desktop (`hc`) or visible workers beneath an existing skill workflow:**
  evaluate [Jordy's interactive fork][jordy] first.
- **Classic Herdr TUI with managed worktrees and guarded integration:**
  evaluate [pi-herdsman][herdsman] first.
- **Least disruption and programmable local orchestration:** retain
  [nicobailon/pi-subagents][nico] and configure bounded workers, explicit
  integration-branch bases, and artifact-oriented results.

These are conditional recommendations, not a universal reliability ranking.
Jordy supplies a relatively direct execution layer; Herdsman adds a role and
project model that must be reconciled with the existing skills.

**Pi does not ship a general subagent orchestrator in core.** It supplies SDK,
CLI/RPC, sessions, extension APIs, and an official example extension. The
orchestration layer is supplied by extensions or external processes.
See the [official README][pi-readme] and [subagent example][pi-example].

## Scope and evidence boundary

This report consolidates two completed Exa research runs and direct reading
performed in the originating conversation:

1. An initial general ecosystem comparison.
2. An expanded pass focused on Herdr, context economy, supervision, and
   compatibility with the user's existing skill workflow.

The second pass screened 17 leads and examined seven finalists more closely.
The [Reddit discussion][reddit] supplied discovery leads and user complaints,
not proof of implementation quality.

Evidence levels must remain distinct:

- **Direct local inspection:** the installed Pi README and the user's
  `to-spec`, `implement-spec`, and `tdd` skill files.
- **Direct browser reading:** the loaded Reddit discussion.
- **Research-agent source inspection:** selected backend, entry-point, and
  notifier implementation files, especially for Jordy and BRL.
- **Primary documentation:** manifests, READMEs, configuration references,
  release notes, issues, and PR discussions.
- **Not performed:** installation, runtime smoke tests, independent execution
  of extension test suites, comparable token benchmarks, or a security audit.

The research agent's claims of source inspection are reported as such; they
were not all independently re-read by the parent assistant. Source coverage
is uneven. Moving branch URLs and contradictory cached versions prevent an
exact-version certification.

Both research outputs passed their frozen output schemas. That establishes
output shape, not factual correctness. The durable planners still record all
criteria as proposed and requiring review; neither run automatically certified
its criteria. No gaps were entered into those planner records, but substantive
unresolved gaps are documented below.

## Requirements derived from Matt's skills

The local skill files, rather than an identically named bundled replacement,
define the intended workflow:

1. `to-spec` synthesizes the prior conversation into a tracker spec and
   confirms public testing seams with the user.
2. `implement-spec` treats tickets as a dependency graph, maintaining a ready
   frontier rather than executing a flat checklist.
3. Implementation lands on one integration branch.
4. Each implementer starts with fresh context, preferably in the background.
5. Each ticket uses its own branch and worktree based on the integration branch.
6. Context travels primarily through pointers to specs, tickets, notes, and commits.
7. Implementers use `tdd` and merge the integration tip into their own branch
   before reporting completion.
8. Separate merger agents integrate completed work.
9. A final independent `mp-code-review` checks the integration branch.
10. Temporary implementer worktrees are cleaned up.

The local TDD contract requires public-behavior tests at user-agreed seams,
one failing test followed by minimal implementation per vertical slice, and
no speculative bulk test batches. Refactoring belongs to the review stage.

An execution extension does not automatically enforce these policies. In
particular, fresh contexts do not imply correct worktree bases, and the
presence of child tools does not establish that the intended skills and
permission extensions load in those children.

Upstream references: [implement-spec][matt-implement], [tdd][matt-tdd], and
[code-review][matt-review]. The user's local review invocation is
`mp-code-review`; this report does not assume that is the current upstream name.

## Candidate screening

“Not established” means the research did not obtain sufficient evidence, not
that a feature is impossible or a repository does not exist.

| Candidate | Role and Herdr relevance | Screening result |
|---|---|---|
| [Jordy's interactive fork][jordy] | Native Herdr TUI and desktop `hc` children | Finalist; strongest visible dual-backend fit |
| [pi-herdsman][herdsman] | Classic Herdr orchestration, branch ownership, managed project worktrees | Finalist; strongest TUI/Git orchestration fit |
| [nicobailon/pi-subagents][nico] | General orchestration; documented restricted Herdr saved-machine placement | Installed baseline and finalist |
| [brl-subagent][brl] | Foreground/background, chains, parallel and dependency graphs; no native Herdr backend established | Finalist for headless orchestration |
| [pi-famulus][famulus] | Daemon-managed children, shells, monitors and parent wakeups; not a pane manager | Finalist for operational supervision |
| [@gotgenes/pi-subagents][gotgenes] | In-process sessions with inherited skills/extensions by default | Finalist for skill discoverability |
| [pi-delegator][delegator] | Narrow subprocess delegation and cleanup contract | Finalist, but ambient skill discovery is disabled |
| [@everyx/pi-subagent][everyx] | Small RPC spawn/send/stop surface, persistent idle children | Relevant minimal alternative; native Herdr backend not established |
| [a-chris/pi-cciotti][cciotti] | Nicobailon fork with narrower delegation and optional review loops | Credible alternative; shallower source verification |
| [Amos's interactive fork][amos] | Direct ancestor of Jordy's fork; tmux-focused implementation | Useful ancestry/control comparison, not the Herdr choice |
| [GaganSD toolkit][gagan] | Bounded subagent harness; separate Herdr dashboard component | Promising; author benchmark savings not independently reproduced |
| [gentle-pi][gentle] | Full development harness with its own routing, review, TDD and UI policies | Broader than an execution-layer replacement |
| [pi-shepherd][shepherd] | Retrieved `catlain/pi-shepherd` is a guardrail layer | Identity may not match the Reddit recommendation; unresolved |
| ArdaYILDIZ-DEV/pi-interactive-subagents | Requested source could not be successfully retrieved | Identity/capabilities unresolved; do not substitute another fork |
| [pi-episodes][episodes] | Context-preserving forks and episode archival | Different goal from fresh ticket workers |
| [billion-context][billion] | Compression/recall and related native integration | Complementary context layer, not independently established as a replacement supervisor |
| [pi-fabric][fabric] | Broader programmable actors/workflow runtime | Separate evaluation needed; not a narrow replacement |

### Identity corrections

- Jordy's project credits HazAT as the origin and Amos as its direct tmux
  ancestor. Related forks must not be counted as independent backend designs.
- Gotgenes identifies itself as a hard fork of Tintinweb and now lives in a
  monorepo; its archived predecessor is not the current source of truth.
- `npm:pi-subagents` installs Nicobailon's project, not Cciotti.
- Gagan's originally linked `pi-extensions` material moved to
  `coding-agent-toolkit`.
- The Shepherd result does **not** conclusively identify the Herdr-oriented
  project intended by the Reddit commenter.

## Finalist comparison

| Extension | Execution/context | Supervision | Git/worktree fit | Main qualification |
|---|---|---|---|---|
| Herdsman | Visible Herdr agents with Manager/Lead ownership and continuation | Owner messages, waiting, stop/resume, durable assignments | Managed project worktrees and guarded integration | Not automatically the per-ticket graph/separate-merger workflow |
| Jordy | Async visible TUI/desktop processes; fresh session default, optional lineage/fork | Live messaging, named resume, child questions, activity/exit observation | `cwd` override; no inspected automatic ticket allocator | Worktree and scheduling policy remain external |
| Nicobailon | Foreground SDK sessions, detached background runner, programmable workflows | Questions, deadlines, budgets, watchdog/control surfaces | Local managed worktrees and explicit `baseRef` | Herdr placement is a distinct path with restrictions |
| BRL | Foreground/background; chain, parallel, graph; separate child contexts | Completion subscriber, stop/timeouts, recovery and transport retry | Branch/worktree state appears in source | Exact integration-base and cleanup behavior insufficiently traced |
| Famulus | Rust daemon owns children, shells and monitors | Completion/questions/overrun wakeups, inactivity recovery | No verified ticket-worktree allocator | Replaces `bash`; larger process-management footprint |
| Gotgenes | Separate sessions in the parent runtime | Queue, concurrency, turn limits, steering, parent questions | No verified automatic allocator | Parent shutdown disposes children; inherited extensions broaden surface |
| Delegator | Fresh subprocesses with fixed role profiles | Abort/cleanup and bounded-drainage contract | Caller supplies working directory | No ambient skills/extensions; session-local background work |

### Herdr TUI and desktop are different backends

Jordy's [backend implementation][jordy-backend] contains separate classic
Herdr and desktop `hc` paths. Its documented behavior includes:

- Top-level children in named, non-focus-stealing tabs by default.
- Nested children splitting their parent's pane.
- Live steering through Herdr's agent prompt interface.
- Desktop detection through `HC_TERMINAL_ID` and the `hc` CLI.
- Desktop launch through the login shell, rather than typing into an
  unready interactive shell.
- Named session messaging/resume and loadout restoration.

The research did not establish a numeric minimum desktop `hc` version.
Cancelling an exit-observation loop is not proof that all process descendants
are terminated.

Herdsman's [manifest][herdsman-manifest] declares a Pi 1.5.2 / Herdr 0.9.5
baseline in the retrieved snapshot. Its classic Herdr support must not be
extrapolated to desktop `hc`. Running a classic Herdr TUI inside a desktop
terminal is coexistence, not proof of native desktop integration.
See the [Herdr backend discussion][herdr-backends].

Nicobailon's [agent documentation][nico-agents] describes Herdr saved-machine
placement. This corrects the earlier suggestion that it was only a headless
launcher. However, the research found that this placement path rejects managed
worktrees; local workflow worktree capabilities are not interchangeable with it.

### Worktrees and integration

Herdsman's [project orchestration contract][herdsman-projects] ties integration
to completed handoffs and source revisions, with cleanliness checks and a
fast-forward default. This does not establish semantic correctness or combined
test success. Managed Lead/project worktrees are not necessarily one fresh
worktree per ticket based on the latest integration tip.

Nicobailon's [tool reference][nico-tools] and [workflow documentation][nico-workflows]
describe local worktree allocation and named `baseRef` controls. These are
useful primitives for Matt's integration branch. Verify cleanup and handoff
behavior before assuming temporary branches remain available to a later merger.

Jordy can launch inside an externally allocated `cwd`. The parent can therefore
create ticket worktrees and use the extension only to execute workers. The
extension itself was not shown to manage that ticket lifecycle.

**Worktrees are not security sandboxes:** they separate checkouts, not host
filesystem authority, credentials, or network access.

### Skills, tools and permission propagation

- **Herdsman:** definitions expose skill inheritance and explicit skill paths.
  Referenced scripts/skills are not automatically synchronized across machines.
- **Jordy:** strict tool/backing-extension allowlists and saved loadouts improve
  configuration fidelity, but `--no-extensions` means parent guardrails and
  providers are not automatically inherited. A tool allowlist is not a sandbox.
- **Nicobailon:** per-agent skills/extensions and trust/capability controls are
  documented; verify the actual installed version and child configuration.
- **Gotgenes:** inherits parent skills/extensions by default and supports package
  exclusions. This helps discovery but increases the child's extension surface.
- **Delegator:** intentionally disables ambient skill discovery. It is not a
  drop-in implementation of “worker invokes the installed `tdd` skill.”
- **BRL/Famulus:** literal compatibility with the complete child-skill contract
  was not established in the deeper pass.

Sources: [Herdsman definition schema][herdsman-schema],
[Jordy entry point][jordy-entry], [Nicobailon agent controls][nico-agents],
[Gotgenes configuration][gotgenes-config], [Delegator requirements][delegator-req].

### Lifecycle evidence and caveats

- **Herdsman:** [issue 613][herdsman-613] reports a coordination-readiness timeout.
  [PR 575][herdsman-575] reports tests and simulated integration checks, not an
  independently reproduced real-provider acceptance run.
- **BRL:** an older [completion-notification issue][brl-147] is not a sound
  current verdict. The research inspected current entry/notifier code containing
  a terminal-event subscription. Current-main fixes were not proven identical
  to the published package.
- **Famulus:** its documentation distinguishes inactivity recovery, soft
  overrun reminders and hard deadlines. Timers pause during tools/questions,
  so they cannot prove semantic progress. Its process-group guarantees have
  documented escape limits such as detached sessions.
- **Gotgenes:** retained session history is not independent process survival.
- **Everyx:** persistent idle children permit follow-up context reuse, but that
  should not be confused with durable recovery after parent failure.

For every candidate, queue acceptance, notification replay, persisted history,
and exactly-once result delivery are different properties.

## Context economy

The Reddit complaints identify useful evaluation questions:

- Does a child get fresh context or the entire parent conversation?
- How much system/tool schema text is added before useful work begins?
- Are only summaries/artifact pointers returned, or whole transcripts?
- Can failed children spill large logs into the parent?
- Are long tasks bounded and handed off before context becomes unwieldy?
- Is an idle persistent specialist reused deliberately rather than by accident?

No comparable token or cost benchmark was performed. Cciotti's prompt-size
claims, Gagan's benchmarks, and user-reported Famulus overhead use different
methods and must not be ranked as if they were equivalent measurements.

Collapsed UI output can still be present in model context. Fresh sessions can
avoid irrelevant history but may repeat discovery, so “fresh” does not itself
prove lower total cost. Choose bounded inline results and artifact pointers
explicitly rather than relying on terminal presentation.

## Workflow conflict versus technical conflict

Matt's skills can overlap with another package in two different ways:

1. **Workflow-policy friction:** competing rules about when to delegate, how
   to plan, who integrates, when to review, and when to refactor.
2. **Mechanical conflict:** duplicate tools/commands, shutdown hooks, child
   extension loading, model/provider registration, or competing result delivery.

Gentle's ODD/review/routing system is broader than an execution tool and can
compete with Matt's prescribed workflow. Herdsman's hierarchy and Cciotti's
optional review loops also require explicit precedence. Merely invoking a skill
does not prove that runtime gates honor that precedence.

### Known overlapping surfaces

| Extension | Relevant documented tools/commands |
|---|---|
| Jordy | `subagent`, `subagent_message`, `subagents_list`, child `ask_question`, `/subagent` |
| Nicobailon | `subagent`, conditional `subagents_enable`, management/control tools |
| Famulus | `bash`, `subagent`, `monitor`, `agent_message`, task tools, `/tasks`, `/famulus`, `/reply` |
| BRL | `delegate_task`, `get_subagent_result`, `steer_subagent`, `stop_subagent` |
| Gotgenes | Subagent controls including `get_subagent_result` |
| Everyx | `agent_spawn`, `agent_send`, `agent_stop` |
| Delegator | `delegate` |
| Herdsman | `/herdsman`, `/agents`, owner/staff/integration tools |

Famulus explicitly replaces `bash` and overlaps with Jordy/Nicobailon on
`subagent`. BRL and Gotgenes overlap on `get_subagent_result`. Distinct names
do not prove compatibility: the full hook inventory was not compared.

**Use one primary execution layer per evaluation profile.** No extension pair
is certified safe to co-install by this report.

## Suggested acceptance test before migration

This is a proposed checklist, not work already performed:

1. Pin and record exact Pi, extension, Herdr and desktop versions.
2. Verify that a fresh child in a ticket worktree can discover the intended
   `tdd` skill and required guardrails/provider extensions.
3. Start two disjoint ticket workers from the same explicit integration ref.
4. Verify branch ownership and prevent shared-checkout writes.
5. Exercise a child question and parent response.
6. Interrupt a child during a tool and inspect surviving descendants.
7. Reload or close the parent and establish what continues, stops, or resumes.
8. Verify completion handling and duplicate/missing notification behavior.
9. Retry partial work without silently rerunning an entire task or losing a diff.
10. Integrate through a distinct merger, then review a fixed integration commit.

Do not enable automatic integration/removal merely to simplify the trial.

## Documented installation selectors

For reference only; no installation was performed:

```bash
pi install npm:pi-herdsman
pi install npm:@jordyvanvorselen/pi-interactive-subagents
pi install npm:pi-subagents
pi install npm:brl-subagent
pi install npm:pi-famulus
pi install npm:@gotgenes/pi-subagents
pi install npm:@everyx/pi-subagent
pi install npm:@mostlyworks/pi-delegator
```

These are documented package identities, not proof that the selected release
works on the target environment. Pin versions for evaluation. Herdsman's
separate `herdr integration install pi` setup command is not part of its npm
selector.

## Unresolved gaps

- No independently executed Pi 1.5.2 compatibility test for any candidate.
  Herdsman's declared baseline is stronger metadata, not runtime proof.
- Source inspection was deeper for Jordy/BRL than for several other finalists.
- Herdr desktop version requirements and comprehensive restart semantics remain
  insufficiently established.
- The intended Herdr-oriented Shepherd project remains ambiguous.
- Arda's requested repository could not be inspected.
- Moving-source snapshots disagreed on Nicobailon versions; Everyx old/new tool
  inventories and Gotgenes/Gagan repository moves also require version awareness.
- Branch/worktree allocation, cleanup and integration-base semantics were not
  fully traced for BRL.
- No complete crash/reload/retry/notification matrix or process-security audit.
- No measured comparable prompt overhead, token savings, failure rates or cost.
- No exhaustive co-install hook inventory or proof of automatic skill precedence.

The initial general shortlist also included HazAT upstream, Pasky's
`pi-side-agents`, Tintinweb, Mjakl and Noickare. They remain relevant ecosystem
options; their omission from the focused finalist table is not a quality
judgment. HazAT upstream's documented multiplexer list does not establish Herdr
support; Jordy's fork is the specific Herdr implementation discussed here.

## Research provenance and classified usage

| Pass | Cycle | Exa run | API-reported cost |
|---|---|---|---|
| General comparison | `3525c47d-7f17-4edd-8215-a30b33c6310a` | `agent_run_1d06144e1c7740ec92827a7cd5fd2a1a` | $0.10 |
| Herdr and skill compatibility | `c5561ebe-1743-476b-abdb-d620f57576fe` | `agent_run_d54e5ef9d0934b6bb3aa965c0f695d6f` | $0.50 |

Both runs completed with locally schema-validated output. The first reported
12 searches and the second 60. Their reported total was **$0.60**, matching the
combined estimates for those two runs. This excludes unrelated standalone
retrieval calls in the conversation and is **not independently verified
billing**. Neither completed cycle recorded pending estimates, assessed unknown
liabilities, duplicate successes, or overshoot. Estimates and local lifetime
ceilings are not vendor-enforced caps.

## Sources

[pi-readme]: https://github.com/earendil-works/pi
[pi-example]: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts
[reddit]: https://www.reddit.com/r/PiCodingAgent/comments/1x7iluw/whats_the_best_subagent_extension/
[jordy]: https://github.com/jordyvanvorselen/pi-interactive-subagents
[jordy-backend]: https://github.com/jordyvanvorselen/pi-interactive-subagents/blob/main/pi-extension/subagents/herdr.ts
[jordy-entry]: https://github.com/jordyvanvorselen/pi-interactive-subagents/blob/main/pi-extension/subagents/index.ts
[herdsman]: https://github.com/boadij/pi-herdsman
[herdsman-manifest]: https://github.com/boadij/pi-herdsman/blob/main/package.json
[herdsman-projects]: https://github.com/boadij/pi-herdsman/blob/main/docs/guides/project-orchestration.md
[herdsman-schema]: https://github.com/boadij/pi-herdsman/blob/main/docs/reference/agent-definition-schema.md
[herdsman-613]: https://github.com/boadij/pi-herdsman/issues/613
[herdsman-575]: https://github.com/boadij/pi-herdsman/pull/575
[herdr-backends]: https://github.com/herdrdev/herdr/discussions/5732
[nico]: https://github.com/nicobailon/pi-subagents
[nico-agents]: https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md
[nico-tools]: https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md
[nico-workflows]: https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md
[brl]: https://github.com/azmeenafandi/brl-subagent
[brl-147]: https://github.com/azmeenafandi/brl-subagent/issues/147
[famulus]: https://github.com/Leechael/pi-famulus
[gotgenes]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/README.md
[gotgenes-config]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/configuration.md
[delegator]: https://github.com/itmostlyworks/pi-delegator
[delegator-req]: https://cdn.jsdelivr.net/npm/@mostlyworks/pi-delegator@0.6.6/docs/REQUIREMENTS.md
[everyx]: https://pi.dev/packages/@everyx/pi-subagent
[cciotti]: https://github.com/a-chris/pi-cciotti
[amos]: https://github.com/amosblomqvist/pi-interactive-subagents
[gagan]: https://github.com/GaganSD/coding-agent-toolkit
[gentle]: https://pi.dev/packages/gentle-pi
[shepherd]: https://github.com/catlain/pi-shepherd
[episodes]: https://github.com/arthurfiorette/pi-episodes
[billion]: https://github.com/ranxianglei/billion-context
[fabric]: https://github.com/fabric-runtime/pi-fabric
[matt-implement]: https://github.com/mattpocock/skills/blob/main/skills/engineering/implement-spec/SKILL.md
[matt-tdd]: https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md
[matt-review]: https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md

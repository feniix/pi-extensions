# Pi context-aware handoff and automatic compaction extensions

## Question and conclusion

Is there a third-party Pi extension that detects a configurable percentage of
context usage, prepares relevant continuation state, persists a handoff file,
compacts, and continues with that state?

The closest single-package match found is **@arcanemachine/pi-supercompact**.
It covers percentage thresholds, agent-authored contextual preparation,
automatic native compaction, and exact handoff restoration. Its handoff is
stored through Pi session messages, **not a separate Markdown handoff file**.
No single package examined was verified to satisfy every requirement literally.

This research used Exa discovery, maintainer READMEs/package listings, Pi's
installed compaction documentation, and focused upstream source inspection.
No packages were installed and no live-session behavior was tested. Features
and compatibility requirements below describe the sources inspected, not
measured summary fidelity.

## Closest match: pi-supercompact

[Maintainer repository](https://github.com/arcanemachine/pi-supercompact)
and [package documentation](https://pi.dev/packages/@arcanemachine/pi-supercompact).

- Requires Pi 0.80.10 or later according to its README.
- Automatic mode is opt-in. Default soft threshold is 80%; force threshold is
  90%, with both configurable.
- Soft triggering requests a focused checkpoint: refresh relevant durable
  sources, finish only authorized work, identify blockers and establish an
  exact next action.
- Force triggering bypasses unfinished preparation, not summary generation.
  It is not a guarantee of successful compaction if model calls fail.
- A dedicated full-context assistant turn writes a canonical Markdown handoff,
  preserving the objective, authorization, constraints, actionable state,
  blockers, relevant paths, verified versus unverified results and next action.
- Native compaction runs after a valid handoff. The extension restores the
  exact handoff in a hidden custom message and continues once if authorized,
  otherwise waits. It does not replace Pi's native summary generator.
- Keep Pi's own auto-compaction enabled as an overflow fallback; disabling it
  also disables native automatic overflow recovery.

[Source inspected](https://github.com/arcanemachine/pi-supercompact/blob/f07388118e606fc41d6d881c2017b1ba2a33373e/src/index.ts):
`buildSummaryPrompt`, `buildContinuationMessage`, `ctx.compact` around line 1368,
restoration around lines 1387–1421, and percentage triggering at lines 2001–2038.
These confirm a session-message handoff rather than an external file.

Install:

```bash
pi install npm:@arcanemachine/pi-supercompact
```

Merge this into `~/.pi/agent/settings.json`, preserving existing settings:

```json
{
  "pi-supercompact": {
    "supercompact": {
      "enabled": true,
      "thresholdPercent": 80,
      "forceThresholdPercent": 90
    }
  }
}
```

Automatic triggering does not require granting unrelated agent-driven request
permission. `/supercompact auto-enable` enables it only for the live session.

## Alternatives and their gaps

### @ttiimmaahh/pi-handoff

[Maintainer README](https://github.com/ttiimmaahh/pi-handoff).

- Automatically writes `.pi/handoff.md` at a percentage or absolute-token
  threshold; default 80%.
- Structured Goal / Current State / Next Steps / Open Questions / Key Facts.
- Replaces compaction summaries with its structured format by default and
  offers handoff loading in a new session.
- Explicitly **does not initiate compaction**. This is the closest match if a
  separate handoff file matters most.
- Sends conversation context to the selected summarizer model. Generated
  files can contain sensitive material.

### @wienerberliner/pi-smart-compact

[Maintainer README](https://github.com/dasomji/pi-smart-compact).

- Warns at an absolute-token boundary, default 100k, escalating every 20k.
- Asks the active agent to finish an atomic unit, save relevant artifacts and
  supply a handoff to `smart_compact`.
- Uses that handoff as the actual same-session compaction summary and sends
  one automatic continuation.
- Explicitly cooperative: no forced compaction or guaranteed compliance.
- No guaranteed separate handoff file; saving artifacts is agent-directed.

### pi-continue-better

[Maintainer README](https://github.com/1am2syman/pi-continue-better).

- Replaces manual/native threshold/overflow compaction summaries with a
  structured continuation ledger and supports same-session auto-resume.
- Preserves anchored facts, constraints, failed approaches and next actions.
- Raises tool-result serialization budget from Pi's documented 2000 characters
  to a configurable default of 8000.
- Does not independently schedule a percentage trigger or promise a separate
  handoff file.
- README warns against enabling multiple compaction-owning extensions.

### @pandi-coding-agent/auto-compact

[Package documentation](https://pi.dev/packages/@pandi-coding-agent/auto-compact).

- Initiates compaction at a configurable percentage, default 35%.
- Writes recoverable raw transcript snapshots and later attaches the summary.
- A raw backup is not a curated task-aware Markdown handoff.
- Could supply a trigger alongside a summary-customizing extension, but that
  combination was not tested or verified here.

### pi-smart-compact / Pi Continuity

[Package documentation](https://pi.dev/packages/pi-smart-compact).

This is a **different package** from @wienerberliner/pi-smart-compact.

- Provides Extract → Explore → Synthesize → Verify compaction, retrievable
  evidence archives, checkpoints, optional memory and new-session handoffs.
- Fully automatic mode requests compaction when idle at a configured context
  threshold. Default approval must be explicitly disabled for unattended apply.
- Documentation inspected requires Pi 0.87.1+, unlike supercompact's lower
  minimum; verify local compatibility before choosing it.
- Verification catches known gaps, not semantic completeness or truth.
- Its new-session handoff is a separate workflow, not a demonstrated automatic
  Markdown-file → same-session-compaction pipeline.

### pi-blitz-handoff

[Package documentation](https://pi.dev/packages/pi-blitz-handoff).

- Optional percentage-based automatic handoff, default threshold 70% when
  enabled.
- Agent writes a continuation dossier preserving authorization and working
  state; deterministic code starts a linked replacement session.
- Useful if a fresh session is acceptable, but **not same-session compaction**.

## Recommendation and evidence limits

Try pi-supercompact first if the priority is contextual preparation and
unattended continuation in the same compacted session. Choose pi-handoff if
the independent Markdown artifact is essential, accepting that automatic
compaction still needs another mechanism.

Do not equate a structured prompt or deterministic verifier with a guarantee
that all important facts survive. Evaluate repeated compactions on a realistic
task, checking preserved constraints, exact paths, unresolved decisions and
continuation behavior. Avoid stacking summary-owning extensions without
checking hook conflicts.

Pi's native trigger and persistence behavior are documented in the
[official compaction reference](https://pi.dev/docs/latest/compaction):
native auto-compaction uses `contextWindow - reserveTokens`, retains recent
messages and stores compaction entries in the session. Native summaries
already have goal, constraints, progress, decisions, next steps and critical
context sections; the main distinction here is proactive agent-owned
preparation and exact handoff restoration.

## Follow-up: Pi architecture since supercompact's latest release

The [npm registry](https://registry.npmjs.org/@arcanemachine%2fpi-supercompact)
identifies **0.5.4**, published **2026-09-10T09:19:58.830Z**, as the latest
supercompact release. The repository's GitHub latest-release endpoint returned
404; npm publication is the release baseline used here. The published tarball's
`src/index.ts` was compared with GitHub main and is identical. Its development
dependencies still pin Pi and pi-tui to **0.80.10**, while peer dependencies
accept any version. That is not evidence of validation against newer hosts.
The installed Pi manifest and current upstream both report **1.0.4**.

The [Pi coding-agent changelog](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)
records important subsequent changes:

- **0.86.0, September 19:** transcript-backed prompt/tool updates,
  normalized provider `TranscriptContext`, per-model compaction budgets,
  cancellation-race fixes and a fix for oversized trailing tool results being
  skipped during mid-run compaction.
- **0.87.0, September 21:** SessionManager becomes canonical for provider
  history; append-only `ContextEditEntry` edits; actionable `turn_end` and
  `agent_before_settle` boundaries; deferred execution of runs requested from
  `agent_settled` until all settled handlers complete. Context filters no longer
  receive system messages, and Pi restores prompt/tool state after them. The
  changelog explicitly connects that fix to missing tools after
  extension-driven compaction.
- **0.99.0, September 29:** built-in codemode/MCP, tool exposure/loadout
  controls and nested execution through `ctx.executeTool()` with parent call
  IDs. These expand the execution paths a workflow-control extension should
  test.
- **1.0.0, October 1:** fullscreen default and removal of the experimental
  harness from pi-agent-core. The latter is recorded in the
  [agent-core changelog](https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md);
  supercompact does not import that removed harness.

Source-level compatibility assessment, **not a runtime test**:

- Supercompact uses `context`, `tool_call`, `turn_end`, `message_end`,
  `session_compact` and `agent_settled`; the context/lifecycle changes affect
  the seams it depends on.
- It does not assign `agent.state.messages`, use `shouldStopAfterTurn`, or
  import the removed experimental harness, avoiding several explicit breaks.
- Its primary `ctx.compact`, `getContextUsage`, `pi.sendMessage`, and event
  APIs remain present in
  [current extension types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts).
- No definite compatibility failure was established. Equally, no live test
  establishes reliable sequencing, cancellation, reload or nested-call behavior
  on Pi 1.0.4. Treat it as a promising but unvalidated candidate, not a guaranteed
  drop-in recommendation.

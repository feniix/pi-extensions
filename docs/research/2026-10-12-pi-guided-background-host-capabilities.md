# PRD-010 / #171: Pi host capabilities for guided background research

Research date: 2026-10-12 UTC. Target host: Pi 1.1.0 (`@earendil-works/pi-coding-agent`,
the latest 1.x at the time; the workspace pin moved from 1.0.3 in this slice).
Exa SDK: `exa-js` 2.23.0 (unchanged). Source: issue #171, PRD-010 v1.3 and the
[architecture contract](../architecture/plan-pi-exa-integrated-research-cycle.md).

## Scope and evidence boundary

This document records what the pinned Pi host can and cannot guarantee for the
6.1.0 journey: request → clarify → preview scope/cost → trusted approval →
submit → return the research ID and control → background monitoring →
completion notification → report. Evidence comes from three sources, each
labeled below:

- **Docs**: the shipped `docs/*.md` and `dist/**/*.d.ts` of Pi 1.1.0.
- **Source**: the shipped `dist/core/agent-session.js`, `dist/core/extensions/runner.js`
  and `dist/modes/rpc/rpc-mode.js` of Pi 1.1.0 (line references are to that build).
- **Experiment**: the runnable prototype in
  `packages/pi-exa/__tests__/fixtures/guided-prototype/` driven by
  `packages/pi-exa/__tests__/guided-prototype.test.ts` (in-process SDK session,
  scripted model) and `packages/pi-exa/__tests__/guided-prototype.rpc.test.ts`
  (a real `pi --mode rpc` child process). Both use a controllable mocked Exa job.

No paid Exa call, live model call, interactive TUI smoke or publication was
performed. The prototype is design evidence; it does not implement PRD-010 and
does not touch the merged v1.2 foundation. An interactive TUI demonstration is the
#175 gate.

## Capability matrix

| Requirement | Pi 1.1.0 capability | Evidence | Verdict |
|---|---|---|---|
| Trusted operator approval in the normal guided flow | `ctx.ui.confirm(title, message, { timeout, signal })` is available to tool `execute()` through `ExtensionToolContext`; it blocks the tool until the dialog resolves. Only extension code that received a `true` result can write a grant; no tool parameter can carry one. | Docs `extensions/types.d.ts` (`ExtensionUIContext.confirm`, `ExtensionUIDialogOptions`); Experiment: SDK test "approves through the trusted dialog" and RPC test (dialog title/body carried the proposal, `timeout: 600000`). | Supported |
| Confirmation in RPC/headless clients | RPC forwards `confirm` as `extension_ui_request` and resolves `false` on `cancelled: true` or timeout; `ctx.hasUI` is `true` in TUI and RPC. Print/JSON modes bind no UI: `hasUI` is `false` and the default `confirm` resolves `false`. | Source `runner.js` (`noOpUIContext.confirm: async () => false`; `hasUI()` is `uiContext !== noOpUIContext`), `rpc-mode.js:85`; Docs `rpc-extension-ui.md`; Experiment: SDK test "fails closed without a trusted confirmation surface" (`hasUI=false`, `APPROVAL_UNAVAILABLE`, zero creates), RPC test cancelled dialog → `APPROVAL_NOT_GRANTED`. | Supported; fail closed on `hasUI === false` before calling `confirm`, because a silent `false` is indistinguishable from a decline |
| Distinguish decline, dismissal and timeout | `confirm` returns a bare boolean. The extension cannot tell a decline from a timeout or a cancelled dialog. | Docs `ExtensionUIContext.confirm(): Promise<boolean>`. | Unsupported; report "not granted" and never infer consent |
| Tool returns while the remote job is pending | A tool `execute()` may return after the create acknowledgement; later work continues on extension-owned timers. `pi.sendMessage` is usable from a timer callback (no `ctx` needed). | Experiment: SDK and RPC tests show the tool result "Research started: run_1 … status running" while the mock job stays `running`, followed by an intervening user prompt. | Supported |
| Background scheduling while Pi runs | Node timers started from a tool or `session_start` and cleared in `session_shutdown`. Pi forbids starting timers in the extension factory. | Docs `extensions.md` "Respect the runtime lifecycle"; Experiment: monitor timers in the prototype. | Supported (in-process only; nothing runs after Pi exits) |
| Safe-turn assistant wakeup | `pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" })`: idle → appends the custom message and starts a turn now; streaming → queues it after pending work; during `agent_settled` emission → deferred until settlement completes. `deliverAs: "steer"` would enter after the current assistant turn instead. | Source `agent-session.js` `sendCustomMessage` (lines ~1770–1800, `_isEmittingAgentSettled`, `_deferredSettledActions`); Experiment: SDK test "queues a completion that lands during an active response" shows the notice appended after the streaming assistant message, then the report turn. | Supported |
| Safe boundary signal for extensions | `agent_settled` (now with `aborted`) is the final notification-only boundary; `agent_before_settle` and `turn_end` are actionable. `ctx.isIdle()` and `ctx.hasPendingMessages()` exist but timers have no `ctx`; relying on Pi's queue is sufficient. | Docs `extensions.md`; Pi 1.1.0 changelog (`aborted` on `agent_settled`); Experiment: `agent_settled:aborted=true` observed after `session.abort()`. | Supported |
| Delivery acknowledgement | `pi.sendMessage` returns `void`; rejections are reported as extension errors, not to the caller. There is no API-level acknowledgement. Pi appends a `custom_message` entry to the session file when it actually delivers; an extension can observe that entry (with its own `details`) through `ctx.sessionManager.getEntries()` on `agent_settled` or `session_start`. | Source `agent-session.js` `runner.bindCore({ sendMessage: … .catch(emitError) })`, `_appendCustomMessage`; Docs `session-format.md` (`custom_message` entries); Experiment: `notice_acknowledged` after locating the entry; RPC `get_entries` shows `custom_message:exa-proto-completion`. | Partially supported: acknowledgement by observation, not by return value |
| Durability of queued deliveries | Streaming-time queues (`steer`, `followUp`, `nextTurn`, deferred custom messages) live in process memory until Pi appends them. A crash between `sendMessage` and the append loses the host copy; only the extension's own pending record survives. | Source `agent-session.js` `_pendingCustomMessages`, `_pendingNextTurnMessages`, `agent.followUp/steer`. | Unsupported exactly-once; keep a durable pending notice and reconcile |
| Origin-session targeting | One extension runtime serves one session. `ctx.sessionManager.getSessionId()` identifies it at `session_start`. There is no API to deliver into another session. Session replacement (new/resume/fork/switch) emits `session_shutdown` and invalidates the old runtime; later use of the old `pi` throws the stale-context error. SDK `session.dispose()` invalidates without emitting `session_shutdown`. | Source `agent-session.js` `dispose()` → `runner.invalidate(...)`, `runner.js` `invalidate`; Experiment: SDK test "fences delivery after the runtime is invalidated" (`notice_delivery_failed`, `deliveryError` contains "stale", a second session with a different ID discovers but does not deliver the foreign notice); RPC test `new_session` → monitor `paused:SHUTDOWN`. | Supported for same-session delivery; cross-session delivery unsupported by design |
| Discoverability after restart | `session_start` carries `reason: startup | reload | new | resume | fork` and a `ctx` with the session ID; durable state outside the session must be read by the extension. Nothing resumes implicitly. | Docs `SessionStartEvent`; Experiment: pending notices reported with origin/foreign classification; previous runtime monitors marked `paused:RESTART`. | Supported |
| Blocked-on-dialog visibility | Pi 1.1.0 reports `blocked` with the dialog title through OSC 7501 to supporting terminals and emits `ui_prompt_start/end` extension events. | Docs `terminal-setup.md` "Program status"; `extensions/types.d.ts` `UIPromptStartEvent`. | Supported (informational) |
| Server retry guidance for GET backoff | `ExaError` exposes `statusCode`, `type`, `code`, `detail`; no `Retry-After` value is surfaced by the pinned SDK. | Docs `exa-js` `dist/index.d.ts` `class ExaError`. | Unsupported; use local backoff |
| Create abort / server idempotency | Not assumed. The prototype never cancels and the SDK create is not aborted; an unacknowledged create stays `unknown` and a late acknowledgement settles the original attempt. | Experiment: SDK test "keeps an unacknowledged create unknown and saves a genuine late run ID without resubmitting" (`late_ack`, one create). | Unsupported by design; fail closed |

## Experiment summary

The SDK test (`guided-prototype.test.ts`) proves, against a real Pi 1.1.0
`AgentSession` with a scripted `pi-ai` faux model and no network:

1. Trusted approval, one mocked create, the saved run ID returned while the job is
   pending, an intervening user turn, one completion notice delivered at a settled
   boundary and acknowledged by its `custom_message` entry; terminal facts were
   persisted before the notice was scheduled.
2. Headless (`hasUI=false`): `APPROVAL_UNAVAILABLE`, zero creates.
3. Declined dialog: `APPROVAL_NOT_GRANTED`, zero creates, proposal still open.
4. Superseded proposal: `PROPOSAL_STALE`, no dialog, zero creates.
5. Completion during an active response: notice appended after the streaming
   answer, then a report turn.
6. Aborting the chat turn: `agent_settled aborted=true`, no remote cancel, job
   still running, completion delivered later, still one create.
7. Transient GET errors back off with growing delays; exhausted errors pause with
   `TRANSIENT_EXHAUSTED` while the remote status stays `running` and no outcome or
   notice is fabricated; timers are released.
8. `401` → `AUTH` pause; lost run (`404`) → `NOT_FOUND` pause; no cancel.
9. Unacknowledged create → `SUBMISSION_UNKNOWN` with no run ID; the late genuine
   ID is saved on the original attempt with monitoring `LATE_ACKNOWLEDGEMENT`
   paused; still one create.
10. Disposed runtime: delivery throws the stale-context error, the notice stays
    pending with the error recorded; a different session discovers the foreign
    notice and does not deliver it.

The RPC test (`guided-prototype.rpc.test.ts`) repeats the happy path in a real
`pi --mode rpc` process: the client answers the forwarded `confirm`
(`timeout: 600000`), prompts while the job is pending, completes the job through
`/exa-proto complete run_1` (disposition `handled`), observes the appended
`custom_message` and report through `get_entries`, replaces the session with
`new_session` (second attempt's monitor → `paused:SHUTDOWN`), and sends
`cancelled: true` for a third dialog (`APPROVAL_NOT_GRANTED`, zero creates in the
replaced runtime).

Run the prototype interactively with your own model:

```bash
pi -e packages/pi-exa/__tests__/fixtures/guided-prototype/pi-entry.ts
# ask for research, approve the dialog, then: /exa-proto complete run_1
```

## Prototype review fixes

A 2026-10-12 review of the prototype found store and race gaps. They are fixed in the
prototype as well, so the experiments do not rely on unsafe shortcuts:

- The store is written under a short exclusive lock with read-merge-write, so runtimes
  sharing it never erase each other's records; an unreadable store is moved aside to
  `state.json.corrupt-<time>` instead of being overwritten.
- Proposal consumption is rechecked after the dialog, so parallel submits of one proposal
  create at most one run.
- A GET in flight across shutdown or a pause records nothing; a failing tick pauses with
  `STORAGE` instead of an unhandled rejection.
- A definitive create refusal (4xx other than 408/429) is `rejected` with no liability and
  reopens the proposal; a genuine acknowledgement racing the deadline is recorded as a late
  acknowledgement instead of unknown.
- Acknowledgement by observation also runs at session start, sent-but-unconfirmed notices
  become `uncertain`, and an explicit `resume` action delivers this session's pending or
  uncertain notices.
- `agent_settled` skips the session scan when no notice is in flight, and pending GETs
  persist only on material changes.

## Unsupported guarantees (explicit)

- No exactly-once completion notification across crashes. The host offers no
  delivery acknowledgement API and holds queued deliveries in memory.
- No delivery into a session other than the one the runtime serves. Detached
  origins keep pending notices for explicit resume.
- No notifications after Pi exits. Monitoring is an in-process feature.
- No distinction between decline, dismissal and timeout of the approval dialog.
- No server retry guidance, create abort or idempotency from the Exa SDK.
- No evidence about interactive TUI rendering of the dialog or notice; that is
  the #175 interactive smoke.

## Consequences for the implementation contract

The settled public actions, consent binding, time bounds, cadence/backoff and
pause limits derived from this evidence are recorded in the architecture plan
section "#171 settled implementation contract". The qualification map carries a
#171 evidence row pointing at the two experiments.

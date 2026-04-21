---
title: "Specdocs formatting activation model"
adr: ADR-0010
status: Proposed
date: 2026-04-21
prd: "PRD-004-pi-specdocs-in-process-markdown-linting"
decision: "Ship formatting as an explicit specdocs-format command and keep post-tool behavior lint-only in the first release"
---

# ADR-0010: Specdocs formatting activation model

## Status

Proposed

## Date

2026-04-21

## Requirement Source

- **PRD**: `docs/prd/PRD-004-pi-specdocs-in-process-markdown-linting.md`
- **Decision Point**: FR-6 and related risks — how formatting should be activated in the first release

## Context

PRD-004 adds in-process formatting to `@feniix/pi-specdocs`, but it also emphasizes safety and author trust. The current extension behavior is notification-oriented: `packages/pi-specdocs/extensions/runtime.ts` reacts to `tool_result` events for writes and edits and surfaces validation warnings, while `packages/pi-specdocs/extensions/index.ts` exposes a workspace-wide `specdocs-validate` command. The package does not currently rewrite documents automatically.

Introducing formatting creates a UX and safety choice:
- automatically rewrite documents after edits or writes
- require an explicit user-invoked formatting command
- or introduce some hybrid behavior such as optional auto-formatting later

This decision matters because specdocs documents are often AI-generated or AI-edited, and even safe formatting can feel surprising if it mutates documents without a clear user request. At the same time, if formatting is too manual, the feature may be ignored and document quality gains will be limited.

## Decision Drivers

- The first release must preserve author trust and avoid surprising rewrites
- Formatting must be limited to deterministic, low-risk transforms
- Post-tool feedback should remain fast and easy to understand
- The design should leave room for stronger autofix or automation later if proven safe
- The activation model should align with the current runtime structure, which already separates validation notifications from command execution

## Considered Options

### Option 1: Explicit formatting command only in the first release

Expose formatting through a dedicated command such as `specdocs-format`, and keep post-tool behavior limited to lint-and-notify.

- Good, because document mutation only happens when the user asks for it
- Good, because it aligns with the current runtime model, where post-tool flows already emphasize validation notifications rather than rewrites
- Good, because formatter edge cases such as unsupported paths, malformed docs, and no-op outcomes can be handled in an intentional command UX
- Bad, because users must remember to run a second action to normalize documents
- Bad, because some formatting issues may persist longer if authors ignore the command

### Option 2: Automatic formatting after eligible write/edit tool results

Run the formatter automatically when relevant spec documents are written or edited.

- Good, because formatting happens consistently with minimal user effort
- Good, because generated documents would converge on a clean structure quickly
- Bad, because automatic rewrites can feel surprising or unsafe, especially when the formatter is new
- Bad, because formatter failures or partial edge cases would now sit directly on the post-tool path and could complicate author feedback
- Bad, because it raises the risk of changing documents in ways users did not explicitly authorize

### Option 3: Hybrid mode with explicit command first and opt-in auto-format later

Ship an explicit command now, while designing the implementation so an opt-in auto-format mode could be added later if the formatter proves safe.

- Good, because it captures the safety benefits of explicit formatting now while keeping future automation possible
- Good, because it matches the PRD's staged rollout and future-looking design intent
- Bad, because it still requires choosing what the first-release default should be
- Bad, because a future opt-in mode introduces configuration and UX complexity that should not distract from the initial release

## Decision

Chosen option: **"Explicit formatting command only in the first release"**, because it best balances safety, user trust, and implementation clarity.

The first release should keep post-tool behavior lint-only and expose formatting through an explicit command. The implementation should still be structured so a future opt-in auto-format mode can be considered later without rewriting the formatting core.

## Consequences

### Positive

- Authors retain clear control over when a file is rewritten
- Formatter failures, unsupported paths, and no-op cases can be reported through a dedicated command experience
- Runtime notification flows remain simpler during the first release
- The feature boundary is easy to explain: validation happens automatically, formatting happens on request

### Negative

- Some documents will remain inconsistently formatted until authors invoke the command
- There is an extra step in the authoring workflow compared with automatic formatting
- If adoption is low, future work may be needed to improve discoverability or consider safe opt-in automation

### Neutral

- This decision does not prevent richer autofix later; it only sets the activation model for the first release
- The formatter still needs strong safety guarantees even though it is explicit rather than automatic

## Related

- **Plan**: N/A
- **ADRs**: Relates to `docs/adr/ADR-0008-specdocs-parser-pipeline-strategy.md` and `docs/adr/ADR-0009-specdocs-validation-layering-strategy.md`
- **Implementation**: `packages/pi-specdocs/extensions/runtime.ts`, `packages/pi-specdocs/extensions/index.ts`, `packages/pi-specdocs/extensions/frontmatter.ts`

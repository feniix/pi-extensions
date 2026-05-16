# Fresh trust/debuggability ideas — pi-sequential-thinking

## 1. Effective configuration and storage status report

- **title:** Effective configuration and storage status report
- **summary:** Add a `get_status`/`diagnose_storage` style tool that reports the resolved storage directory, config source for each setting, active output limits, whether the directory is readable/writable, current persisted state file path, thought count, last modified time, and any detected backup/corruption-recovery files.
- **axis:** Session/history/persistence lifecycle
- **basis:** direct: README documents multiple config sources and default storage, while current tools do not expose the resolved runtime state; reasoned: operators trust long-running stateful tools more when they can confirm where state is being written and which limits are active.
- **why_it_matters:** During long agent runs, users need a quick way to answer “which state am I using?” before clearing, exporting, importing, or debugging missing thoughts.
- **meeting_test:** After starting pi with a custom config file and storage dir, calling the status tool returns the effective values, the source of each value, storage health checks, current thought count, and clear warnings for any unwritable or missing paths.

## 2. State fingerprint receipts on mutating calls

- **title:** State fingerprint receipts on mutating calls
- **summary:** Return a compact state receipt from `process_thought`, `clear_history`, `import_session`, and `export_session`: pre/post thought counts, latest thought number, storage file mtime, schema version, and a short deterministic hash/fingerprint of the persisted state.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct: the package is stateful and persists JSON, but normal outputs focus on analysis rather than confirming persistence; reasoned: small deterministic receipts help users and agents detect stale state, accidental clears, failed writes, or concurrent-looking surprises without dumping full history.
- **why_it_matters:** Long runs often fail through ambiguity rather than hard errors; a receipt makes each write auditable and gives users something concrete to compare across turns.
- **meeting_test:** Recording a thought returns a receipt whose count increments by one and whose fingerprint changes; exporting without mutation preserves the fingerprint; clearing history returns the prior count and a new empty-state fingerprint.

## 3. Import/export preview with diff and checksum

- **title:** Import/export preview with diff and checksum
- **summary:** Add dry-run options for import/export that validate the target file, report schema version, thought counts, stage/tag deltas, duplicate or out-of-order thought numbers, destination path, and a checksum before changing active state or writing a file.
- **axis:** Session/history/persistence lifecycle
- **basis:** direct: import/export already exist and storage preserves backward-compatible JSON behavior; reasoned: previews reduce fear around destructive or confusing state transitions.
- **why_it_matters:** Users are more willing to rely on persisted reasoning if they can inspect what an import will replace and verify what an export contains before committing it.
- **meeting_test:** Running import in preview mode against a valid file reports exactly what would change and leaves active history unchanged; running it against malformed JSON reports validation details without modifying storage.

## 4. Summary provenance and coverage markers

- **title:** Summary provenance and coverage markers
- **summary:** Make `generate_summary` include provenance metadata: generated timestamp, number of thoughts considered, first/latest thought numbers, included stage counts, top tags source counts, truncation status, and optional per-section thought references for timeline, assumptions, and conclusions.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct: summaries already produce stage counts, timeline, top tags, and completion status; reasoned: trust in summaries improves when users can see what evidence was included and whether anything was omitted or truncated.
- **why_it_matters:** In long runs, a summary can otherwise look authoritative while silently covering only part of the state or hiding truncation effects.
- **meeting_test:** Given a history with multiple stages and tags, summary output states the exact thought count covered, references source thought numbers for key sections, and flags when output limits caused truncation.

## 5. Consistency check and repair-plan mode

- **title:** Consistency check and repair-plan mode
- **summary:** Add a read-only consistency checker that scans in-memory and persisted state for gaps, duplicate thought numbers, invalid stages, malformed timestamps, missing required metadata, non-array legacy shapes, and storage/file mismatch, then returns a repair plan without applying changes.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct: current storage handles legacy arrays and corrupted-file backup, and grounding notes partial duplicated validation; external: code-reasoning emphasizes cross-field validation and strict/loose guardrails; reasoned: a separate checker gives operators confidence before and after migrations.
- **why_it_matters:** When state survives many agent turns or package upgrades, users need a non-destructive way to verify that the ledger is internally coherent.
- **meeting_test:** A crafted session containing duplicate numbers and an invalid stage produces a structured report with severity, affected thought indices, and recommended fixes, while leaving the session unchanged.

## 6. Mutation backup and restore receipt

- **title:** Mutation backup and restore receipt
- **summary:** Before destructive mutations such as `clear_history` or state-replacing `import_session`, automatically create or expose a timestamped backup path and return a restore command/tool hint plus pre/post counts and fingerprint.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct: storage already backs up corrupted files and import/clear can materially change persistent state; reasoned: explicit restore receipts make destructive operations feel reversible and auditable.
- **why_it_matters:** Users trust long-running reasoning tools more when they can recover from an accidental clear or wrong import without manually hunting through storage internals.
- **meeting_test:** Clearing a non-empty history returns a backup file path that exists on disk; importing that backup restores the original count and state fingerprint.

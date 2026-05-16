# Fresh minimal moves — pi-sequential-thinking

Additional improvement ideas that avoid the current survivor set and favor small product moves with outsized usefulness.

## 1. Copy-paste continuation card

- **summary:** Have every `process_thought` response end with a compact continuation card: next `thought_number`, likely next `stage`, remaining count, and a ready-to-copy mini JSON argument skeleton. No new tool required.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct: current tool already computes progress and next-thought state; reasoned: agents frequently lose exact field names or counters across turns.
- **why_it_matters:** The package would feel immediately more helpful because it reduces the most common friction: “what exact call do I make next?” without changing storage or semantics.
- **meeting_test:** After recording thought 2 of 5, the response includes a tiny “Continue with…” block that a user or agent can paste and fill in for thought 3.

## 2. Optional outcome contract on the first thought

- **summary:** Let users optionally attach `desired_outcome` and `done_when` strings to any thought, especially thought 1; summaries then echo whether the session appears to have satisfied that contract.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct: the current framework has stages but no explicit success target; reasoned: structured thinking is more useful when it remembers what “finished” means.
- **why_it_matters:** This turns a sequence from generic journaling into a lightweight problem-solving loop with a visible finish line, while adding only two optional fields.
- **meeting_test:** A session started with `done_when: "choose one release blocker to fix first"` ends with a summary section saying whether a blocker was actually chosen.

## 3. Confidence and uncertainty chips

- **summary:** Add optional `confidence` and `uncertainties` fields to thoughts, then surface average/lowest confidence and unresolved uncertainties in `generate_summary`.
- **axis:** Safety, limits, and tool-planning metadata
- **basis:** direct: the package already stores assumptions challenged and axioms used; reasoned: users need to distinguish settled reasoning from shaky reasoning without a new workflow.
- **why_it_matters:** A tiny metadata addition makes summaries much more decision-ready: not just what was thought, but how reliable the thinker believed it was.
- **meeting_test:** A five-thought session with two low-confidence research notes produces a summary calling out “lowest confidence: Research thought 2” and listing open uncertainties.

## 4. Evidence snippets for research claims

- **summary:** Add an optional `evidence` array of short strings or URLs to `process_thought`; summaries can show which conclusions are backed by evidence-heavy thoughts versus unsupported notes.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct: the current Research stage has no first-class way to attach source material; external: many reasoning and research workflows benefit from lightweight citation trails; reasoned: short evidence slots avoid building a full citation manager.
- **why_it_matters:** This makes the Research and Analysis stages feel substantially more practical for real work while keeping the tool surface unchanged.
- **meeting_test:** A research thought can include two URLs or quoted facts, and `generate_summary` includes an “Evidence captured” count with the referenced thought numbers.

## 5. Stage-fit warnings, not enforcement

- **summary:** Return gentle warnings when metadata appears mismatched with the selected stage, such as `evidence` on Conclusion but no evidence in Research, or many assumptions in Conclusion with no Analysis thought. Never reject the call.
- **axis:** Thought capture ergonomics and schema compatibility
- **basis:** direct: current stages are explicit but mostly descriptive; reasoned: soft coaching improves reasoning quality without creating strict workflow mode or extra tools.
- **why_it_matters:** The extension would feel like a helpful thinking partner rather than a passive log, while preserving append-only flexibility.
- **meeting_test:** If a user jumps from Problem Definition directly to Conclusion, the response records the thought but adds a short warning suggesting a Research or Analysis pass.

## 6. Resume prompt in summaries

- **summary:** Add a compact “resume prompt” string to `generate_summary` that compresses the current state, key tags, open uncertainties, and next recommended stage into text suitable for a future model turn.
- **axis:** Higher-level synthesis, organization, and tool-surface focus
- **basis:** direct: current summaries already compute timeline, tags, and completion status; reasoned: users often need to carry reasoning state across context windows or between agents.
- **why_it_matters:** This makes existing summaries operational, not just descriptive, and helps users continue work without adding named sessions, history browsing, or new persistence behavior.
- **meeting_test:** Running `generate_summary` after an incomplete session returns a 5-8 line block beginning “Resume this reasoning by…” with the next stage and unresolved questions.

# Fresh ecosystem/package consolidation ideas — pi-sequential-thinking

## 1. Reasoning boundary manifest
**Summary:** Add a lightweight `get_reasoning_manifest` tool that reports this package’s scope, supported thought fields, stage model, persistence behavior, and explicit non-goals relative to `pi-code-reasoning` and future reasoning extensions.
**Axis:** Ecosystem/package consolidation
**Basis:** direct: the repo has multiple reasoning-oriented packages with overlapping concepts; reasoned: an explicit manifest helps agents choose the right tool without merging package responsibilities.
**why_it_matters:** Clear package boundaries reduce duplicate feature growth and make it easier for prompts, docs, and future extensions to route generic deliberation to `pi-sequential-thinking` and code-specific reasoning to `pi-code-reasoning`.
**meeting_test:** A user or agent can call one tool and answer “should I use sequential thinking, code reasoning, or another reasoning tool for this step?” without reading package source.

## 2. Handoff snapshot for downstream reasoning tools
**Summary:** Add an exportable handoff snapshot that distills current sequential-thinking state into decisions, constraints, unresolved questions, and recommended next reasoning domain, without invoking or depending on the downstream package.
**Axis:** Cross-tool interoperability
**Basis:** direct: the package already summarizes stored thoughts; reasoned: handoff artifacts define boundaries between general thinking and specialized future tools while keeping this package non-orchestrating.
**why_it_matters:** Sequential deliberation often precedes code reasoning, research planning, or design review. A stable handoff format lets those tools consume context without `pi-sequential-thinking` becoming a universal workflow engine.
**meeting_test:** After a planning session, the user can export a compact handoff that is immediately useful as input context for `pi-code-reasoning` or a future reasoning extension.

## 3. Shared reasoning vocabulary map
**Summary:** Publish a deterministic vocabulary map from this package’s stages/tags/axioms/assumptions to broader reasoning concepts such as problem, evidence, hypothesis, decision, risk, and follow-up.
**Axis:** Taxonomy and semantic boundaries
**Basis:** direct: current thoughts include stages, tags, axioms, and assumptions; external: adjacent reasoning tools use different step taxonomies; reasoned: mapping concepts avoids forcing every package to adopt one schema.
**why_it_matters:** Future reasoning tools can interoperate semantically while keeping their own specialized language. `pi-sequential-thinking` remains stage-based, but its output becomes easier to compare, search, and reuse across the ecosystem.
**meeting_test:** A summary can include stable concept buckets that preserve current stage behavior while making the same session understandable to another reasoning package.

## 4. External artifact reference anchors
**Summary:** Let thoughts optionally attach typed references to files, docs, tickets, ADRs, or package names as inert anchors, with no code analysis or file reading performed by this package.
**Axis:** Boundary-safe context linking
**Basis:** direct: current metadata captures cognitive context but not where evidence or decisions came from; reasoned: references connect sequential thinking to code/research tools without duplicating their responsibilities.
**why_it_matters:** Reasoning state becomes traceable across packages while preserving separation of concerns: `pi-sequential-thinking` records why something mattered, while `pi-code-reasoning` or future tools can interpret the referenced artifact if needed.
**meeting_test:** A thought can point to `packages/pi-code-reasoning/extensions/types.ts` or an ADR as supporting context, and the package stores and summarizes that link without inspecting or modifying the artifact.

## 5. Package-local interop contract tests
**Summary:** Add fixtures and tests that assert stable import/export and summary shapes intended for other reasoning packages to consume, without introducing a shared dependency yet.
**Axis:** Compatibility and consolidation guardrails
**Basis:** direct: the workspace uses package-local Vitest tests and existing JSON import/export; reasoned: contract fixtures provide consolidation benefits before extracting shared libraries.
**why_it_matters:** As reasoning packages evolve, accidental schema drift can break handoffs. Contract tests make interoperability intentional while keeping package ownership independent.
**meeting_test:** A fixture produced by `pi-sequential-thinking` can be validated in CI as a stable ecosystem artifact, and changes to it require an explicit test update.

## 6. Reasoning context size budget report
**Summary:** Add a report that estimates stored reasoning context size by stage, tag, and metadata category so users can decide what to summarize or hand off to specialized tools.
**Axis:** Operational interoperability
**Basis:** direct: outputs already support truncation controls and summaries; reasoned: cross-tool handoffs need predictable context budgets, especially when multiple reasoning extensions may be chained manually.
**why_it_matters:** This keeps `pi-sequential-thinking` useful as a source of context without overloading downstream tools or prompts. It also clarifies when the sequential record should be summarized before being passed elsewhere.
**meeting_test:** Before copying context into `pi-code-reasoning`, the user can see a compact budget report and choose a stage/tag slice that fits their next tool call.

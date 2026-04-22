---
name: prd
description: "Draft Product Requirements Documents for features, issues, and scoped work using a structured template with measurable goals, acceptance criteria, design decisions, and concrete file breakdowns. Use whenever the user asks to write a PRD, scope a feature, turn a GitHub or Linear issue into requirements, formalize a plan before implementation, break work into implementable requirements, or spec out what should be built even if they do not explicitly ask for a 'PRD'."
---

# PRD Creation

Draft a structured Product Requirements Document that is specific enough to guide implementation, review, and follow-on planning.

## Before you start

- Read `../shared/references/tooling.md`
- Read `../shared/references/document-conventions.md`
- If tracker work is needed, read `../shared/references/tracker-setup.md`

Load local references only when needed:
- `references/prd-template.md` for the canonical section structure
- `references/prd-example-excerpt.md` for tone and depth calibration
- `references/tracker-github.md` or `references/tracker-linear.md` for tracker operations
- `references/notion-sync.md` only if Notion sync is enabled and the user wants sync

## Inputs

Use the richest available input source in this order:

1. `$ARGUMENTS` if supplied
2. relevant conversation context already established
3. tracker issues and comments once identified
4. direct clarifying questions for anything still missing

Treat the input as one of:
- **Issue identifier** such as `#42` or `ENG-42`
- **Issue URL** from GitHub or Linear
- **Free-text feature description**
- **No explicit input** and rely on interactive discovery

## Workflow

### 1. Establish the problem and origin

Before drafting, make sure you know:
- the feature title
- the problem statement and why it matters now
- whether this PRD is **for** an existing issue or is original work
- any known constraints, scope limits, design preferences, or related issues

Be explicit about the distinction between:
- **source issue** — the PRD is being written for that issue
- **related issue** — helpful context, but not the publication target

If the user has already provided enough context, do not ask redundant questions.

### 2. Fetch issue context when relevant

If a source or related issue exists:
- detect the tracker using `../shared/references/tracker-setup.md`
- load the matching local tracker reference
- fetch the issue body and, for the source issue, also fetch comments and linked discussion when the tracker supports it

Use issue data to enrich the PRD, not to blindly copy text.

### 3. Explore the codebase before drafting

Use the tooling policy to inspect the repository and understand:
- current architecture and integration points
- modules, functions, types, or configs likely to change
- similar existing behavior you can pattern-match against
- the realistic blast radius of the feature

Do not start the PRD until you can name concrete affected files or explain why the file surface is still unknown.

### 4. Draft the PRD

Read `references/prd-template.md` and use it as the output structure. Read `references/prd-example-excerpt.md` when you need calibration for depth or tone.

Aim for a PRD that is specific, reviewable, and implementation-oriented.

Quality bar:
- goals are measurable rather than aspirational
- scope is honest about what is excluded and why
- functional requirements describe observable behavior
- Gherkin scenarios are concrete enough to implement against
- risks include actionable mitigations
- design decisions show the main alternatives and why one path is preferred
- file breakdown uses real repository paths, not vague module names
- sections reference each other where useful, especially requirements to files and risks to the requirements they threaten

If the request is too small for a full PRD, say so and propose a lighter-weight artifact instead of forcing the template.

### 5. Save locally

Use the shared document conventions to determine the next PRD number and write the file to:

`docs/prd/PRD-NNN-slug.md`

Always save the local artifact first.

After saving:
- run `specdocs_validate` when available so structural/frontmatter issues are caught immediately
- if spacing or table formatting needs normalization, run `specdocs_format` on the saved PRD when available
- for manual user guidance, the equivalent pi slash commands are `/specdocs-validate` and `/specdocs-format docs/prd/PRD-NNN-slug.md`
- do not treat `specdocs-validate` or `specdocs-format` as bash executables or check PATH for them; they are pi extension capabilities
- report the final file path and any validation/formatting follow-up you performed

### 6. Publish intentionally

If tracker publication is part of the workflow:
- for a **source issue**, post the PRD as a comment on that issue
- for **original work**, create a new issue with the PRD as the body if the user wants tracker publication

If the user only asked for a local PRD, do not assume they want tracker side effects.

If Notion sync is enabled and requested, follow `references/notion-sync.md` after the local save succeeds.

### 7. Offer next steps

After the PRD is saved, mention relevant follow-ups when helpful:
- `/plan-prd` to turn the PRD into an implementation plan
- `/adr` for design decisions that deserve standalone ADRs

## Workflow principles

- Explore the codebase before drafting so the PRD reflects reality
- Use issue context as input, not as a substitute for thinking
- Prefer concrete file paths, metrics, and user scenarios over generic statements
- Ask about scope when it is genuinely ambiguous; wrong scope is worse than a slower draft
- Keep the document useful for future readers, not just for the current conversation

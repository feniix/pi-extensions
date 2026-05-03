/**
 * TypeBox parameter schemas for Exa tools.
 */

import { Type } from "typebox";

const outputSchemaType = Type.Union([Type.Literal("object"), Type.Literal("text")]);

const outputSchema = Type.Object(
  {
    type: Type.Optional(outputSchemaType),
  },
  { additionalProperties: true },
);

const advancedSearchType = Type.Union([
  Type.Literal("auto"),
  Type.Literal("fast"),
  Type.Literal("neural"),
  Type.Literal("keyword"),
  Type.Literal("hybrid"),
  Type.Literal("instant"),
]);

const researchStage = Type.Union([
  Type.Literal("framing"),
  Type.Literal("criteria_discovery"),
  Type.Literal("cheap_discovery"),
  Type.Literal("source_retrieval"),
  Type.Literal("coverage_analysis"),
  Type.Literal("deep_research_plan"),
  Type.Literal("synthesis_plan"),
  Type.Literal("conclusion"),
]);

const researchNextAction = Type.Union([
  Type.Literal("ask_user"),
  Type.Literal("web_search_exa"),
  Type.Literal("web_search_advanced_exa"),
  Type.Literal("web_fetch_exa"),
  Type.Literal("web_find_similar_exa"),
  Type.Literal("web_answer_exa"),
  Type.Literal("web_research_exa"),
  Type.Literal("draft_plan"),
  Type.Literal("finalize"),
]);

const criterionCategory = Type.Union([
  Type.Literal("method"),
  Type.Literal("metric"),
  Type.Literal("source_class"),
  Type.Literal("population"),
  Type.Literal("market"),
  Type.Literal("risk"),
  Type.Literal("contrarian"),
  Type.Literal("timeframe"),
  Type.Literal("geography"),
  Type.Literal("use_case"),
  Type.Literal("other"),
]);

const priority = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]);

const criterionStatus = Type.Union([
  Type.Literal("proposed"),
  Type.Literal("searched"),
  Type.Literal("supported"),
  Type.Literal("conflicting"),
  Type.Literal("missing"),
  Type.Literal("excluded"),
]);

const sourceType = Type.Union([
  Type.Literal("paper"),
  Type.Literal("white_paper"),
  Type.Literal("pdf"),
  Type.Literal("official_doc"),
  Type.Literal("filing"),
  Type.Literal("news"),
  Type.Literal("blog"),
  Type.Literal("github"),
  Type.Literal("forum"),
  Type.Literal("analyst_report"),
  Type.Literal("other"),
]);

const retrievalStatus = Type.Union([
  Type.Literal("discovered_only"),
  Type.Literal("fetched"),
  Type.Literal("fetch_failed"),
  Type.Literal("unavailable"),
]);

const gapSeverity = Type.Union([Type.Literal("blocking"), Type.Literal("important"), Type.Literal("minor")]);

const gapResolution = Type.Union([
  Type.Literal("ask_user"),
  Type.Literal("search_more"),
  Type.Literal("fetch_source"),
  Type.Literal("carry_assumption"),
  Type.Literal("exclude"),
]);

const researchCriterion = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Stable criterion ID, e.g. C1" })),
    label: Type.String({ description: "Short criterion label" }),
    category: Type.Optional(criterionCategory),
    description: Type.Optional(Type.String({ description: "What this criterion covers" })),
    priority: Type.Optional(priority),
    status: Type.Optional(criterionStatus),
    evidenceRefs: Type.Optional(Type.Array(Type.String({ description: "Source IDs or explicit tool-call notes" }))),
  },
  { additionalProperties: true },
);

const researchSource = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Stable source ID, e.g. S1" })),
    title: Type.String({ description: "Source title" }),
    url: Type.Optional(Type.String({ description: "Source URL when known" })),
    sourceType: Type.Optional(sourceType),
    retrievalStatus: Type.Optional(retrievalStatus),
    retrievalEvidence: Type.Optional(
      Type.String({ description: "Fetched URL, tool-call/result ref, or direct inspection note" }),
    ),
    usedFor: Type.Optional(Type.Array(Type.String({ description: "Criterion IDs this source supports" }))),
    contentNotes: Type.Optional(Type.String({ description: "Content notes or snippet-derived notes" })),
    qualityNotes: Type.Optional(Type.String({ description: "Bias, recency, sample size, or quality notes" })),
  },
  { additionalProperties: true },
);

const researchGap = Type.Object(
  {
    id: Type.Optional(Type.String({ description: "Stable gap ID, e.g. G1" })),
    description: Type.String({ description: "Ambiguity, missing evidence, conflict, or decision needed" }),
    severity: Type.Optional(gapSeverity),
    resolution: Type.Optional(gapResolution),
  },
  { additionalProperties: true },
);

export const webSearchParams = Type.Object(
  {
    query: Type.String({
      description:
        "Natural language search query. Should be a semantically rich description of the ideal page, not just keywords.",
    }),
    numResults: Type.Optional(
      Type.Integer({ description: "Number of search results to return (1-20, default: 5)", minimum: 1, maximum: 20 }),
    ),
  },
  { additionalProperties: true },
);

export const webFetchParams = Type.Object(
  {
    urls: Type.Array(Type.String({ description: "URLs to read. Batch multiple URLs in one call." }), {
      description: "URLs to read",
    }),
    maxCharacters: Type.Optional(
      Type.Integer({ description: "Maximum characters to extract per page (default: 3000)", minimum: 1 }),
    ),
    highlights: Type.Optional(Type.Boolean({ description: "Include per-page highlights in the response" })),
    summary: Type.Optional(
      Type.Object({
        query: Type.String({ description: "Query guiding summary generation" }),
      }),
    ),
    maxAgeHours: Type.Optional(
      Type.Integer({ description: "Use cached content only if older than this many hours", minimum: -1 }),
    ),
  },
  { additionalProperties: true },
);

export const webSearchAdvancedParams = Type.Object(
  {
    query: Type.String({ description: "Search query" }),
    numResults: Type.Optional(Type.Integer({ description: "Number of results (1-100)", minimum: 1, maximum: 100 })),
    category: Type.Optional(
      Type.String({
        description: "Category filter: company, research paper, financial report, people, news, etc.",
      }),
    ),
    type: Type.Optional(advancedSearchType),
    startPublishedDate: Type.Optional(Type.String({ description: "ISO date filter (e.g., 2024-01-01)" })),
    endPublishedDate: Type.Optional(Type.String({ description: "ISO date filter (e.g., 2024-12-31)" })),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    textMaxCharacters: Type.Optional(Type.Integer()),
    enableHighlights: Type.Optional(Type.Boolean()),
    highlightsNumSentences: Type.Optional(Type.Integer()),
  },
  { additionalProperties: true },
);

export const webResearchParams = Type.Object(
  {
    query: Type.String({ description: "Research question to synthesize" }),
    type: Type.Optional(Type.Union([Type.Literal("deep-reasoning"), Type.Literal("deep-lite"), Type.Literal("deep")])),
    systemPrompt: Type.Optional(Type.String({ description: "Guidance for source selection and synthesis style" })),
    outputSchema: Type.Optional(outputSchema),
    additionalQueries: Type.Optional(
      Type.Array(Type.String({ description: "Alternative query formulations" }), { maxItems: 5 }),
    ),
    numResults: Type.Optional(Type.Integer({ description: "Number of source results", minimum: 1, maximum: 20 })),
    textMaxCharacters: Type.Optional(
      Type.Integer({ description: "Maximum characters to extract for synthesis", minimum: 1 }),
    ),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    startPublishedDate: Type.Optional(Type.String()),
    endPublishedDate: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export const webAnswerParams = Type.Object(
  {
    query: Type.String({ description: "Research question to answer" }),
    systemPrompt: Type.Optional(Type.String({ description: "Prompt instructions for tone and style" })),
    text: Type.Optional(Type.Boolean({ description: "Include full source text in the result" })),
    outputSchema: Type.Optional(outputSchema),
  },
  { additionalProperties: true },
);

export const webFindSimilarParams = Type.Object(
  {
    url: Type.String({ description: "Base URL to find similar pages for" }),
    numResults: Type.Optional(
      Type.Integer({ description: "Number of similar pages to return (1-20, default: 5)", minimum: 1, maximum: 20 }),
    ),
    textMaxCharacters: Type.Optional(
      Type.Integer({ description: "Maximum characters to extract per similar result", minimum: 1 }),
    ),
    excludeSourceDomain: Type.Optional(Type.Boolean({ description: "Do not include pages from the same domain" })),
    startPublishedDate: Type.Optional(Type.String({ description: "ISO date filter" })),
    endPublishedDate: Type.Optional(Type.String({ description: "ISO date filter" })),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

export const exaResearchStepParams = Type.Object(
  {
    topic: Type.String({ description: "User-facing research topic or question" }),
    stage: researchStage,
    note: Type.String({ description: "What was learned, decided, or proposed in this step" }),
    criteria: Type.Optional(Type.Array(researchCriterion)),
    sources: Type.Optional(Type.Array(researchSource)),
    gaps: Type.Optional(Type.Array(researchGap)),
    assumptions: Type.Optional(Type.Array(Type.String({ description: "Assumptions carried unless corrected" }))),
    nextAction: Type.Optional(researchNextAction),
    nextActionReason: Type.Optional(Type.String({ description: "Why this is the cheapest useful next move" })),
    thought_number: Type.Integer({ description: "Current step number", minimum: 1 }),
    total_thoughts: Type.Integer({ description: "Estimated total planning steps", minimum: 1 }),
    next_step_needed: Type.Boolean({ description: "Set false only when planning is complete" }),
    is_revision: Type.Optional(Type.Boolean({ description: "Marks a correction to earlier planning" })),
    revises_step: Type.Optional(Type.Integer({ description: "Step number being revised", minimum: 1 })),
    branch_from_step: Type.Optional(
      Type.Integer({ description: "Step number where an alternative strategy branches", minimum: 1 }),
    ),
    branch_id: Type.Optional(Type.String({ description: "Identifier for the branch" })),
  },
  { additionalProperties: true },
);

export const exaResearchStatusParams = Type.Object({}, { additionalProperties: true });

export const exaResearchSummaryParams = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([
        Type.Literal("brief"),
        Type.Literal("execution_plan"),
        Type.Literal("source_pack"),
        Type.Literal("payload"),
      ]),
    ),
  },
  { additionalProperties: true },
);

export const exaResearchResetParams = Type.Object({}, { additionalProperties: true });

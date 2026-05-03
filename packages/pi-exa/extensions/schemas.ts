/**
 * TypeBox parameter schemas for Exa tools.
 */

import { Type } from "typebox";
import {
  CRITERION_CATEGORIES,
  CRITERION_STATUSES,
  GAP_RESOLUTIONS,
  GAP_SEVERITIES,
  PRIORITIES,
  RESEARCH_NEXT_ACTIONS,
  RESEARCH_STAGES,
  RETRIEVAL_STATUSES,
  SOURCE_TYPES,
  SUMMARY_MODES,
} from "./research-planner-types.js";

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
  Type.Literal(RESEARCH_STAGES[0]),
  Type.Literal(RESEARCH_STAGES[1]),
  Type.Literal(RESEARCH_STAGES[2]),
  Type.Literal(RESEARCH_STAGES[3]),
  Type.Literal(RESEARCH_STAGES[4]),
  Type.Literal(RESEARCH_STAGES[5]),
  Type.Literal(RESEARCH_STAGES[6]),
  Type.Literal(RESEARCH_STAGES[7]),
]);
const researchNextAction = Type.Union([
  Type.Literal(RESEARCH_NEXT_ACTIONS[0]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[1]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[2]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[3]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[4]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[5]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[6]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[7]),
  Type.Literal(RESEARCH_NEXT_ACTIONS[8]),
]);
const criterionCategory = Type.Union([
  Type.Literal(CRITERION_CATEGORIES[0]),
  Type.Literal(CRITERION_CATEGORIES[1]),
  Type.Literal(CRITERION_CATEGORIES[2]),
  Type.Literal(CRITERION_CATEGORIES[3]),
  Type.Literal(CRITERION_CATEGORIES[4]),
  Type.Literal(CRITERION_CATEGORIES[5]),
  Type.Literal(CRITERION_CATEGORIES[6]),
  Type.Literal(CRITERION_CATEGORIES[7]),
  Type.Literal(CRITERION_CATEGORIES[8]),
  Type.Literal(CRITERION_CATEGORIES[9]),
  Type.Literal(CRITERION_CATEGORIES[10]),
]);
const priority = Type.Union([Type.Literal(PRIORITIES[0]), Type.Literal(PRIORITIES[1]), Type.Literal(PRIORITIES[2])]);
const criterionStatus = Type.Union([
  Type.Literal(CRITERION_STATUSES[0]),
  Type.Literal(CRITERION_STATUSES[1]),
  Type.Literal(CRITERION_STATUSES[2]),
  Type.Literal(CRITERION_STATUSES[3]),
  Type.Literal(CRITERION_STATUSES[4]),
  Type.Literal(CRITERION_STATUSES[5]),
]);
const sourceType = Type.Union([
  Type.Literal(SOURCE_TYPES[0]),
  Type.Literal(SOURCE_TYPES[1]),
  Type.Literal(SOURCE_TYPES[2]),
  Type.Literal(SOURCE_TYPES[3]),
  Type.Literal(SOURCE_TYPES[4]),
  Type.Literal(SOURCE_TYPES[5]),
  Type.Literal(SOURCE_TYPES[6]),
  Type.Literal(SOURCE_TYPES[7]),
  Type.Literal(SOURCE_TYPES[8]),
  Type.Literal(SOURCE_TYPES[9]),
  Type.Literal(SOURCE_TYPES[10]),
]);
const retrievalStatus = Type.Union([
  Type.Literal(RETRIEVAL_STATUSES[0]),
  Type.Literal(RETRIEVAL_STATUSES[1]),
  Type.Literal(RETRIEVAL_STATUSES[2]),
  Type.Literal(RETRIEVAL_STATUSES[3]),
]);
const gapSeverity = Type.Union([
  Type.Literal(GAP_SEVERITIES[0]),
  Type.Literal(GAP_SEVERITIES[1]),
  Type.Literal(GAP_SEVERITIES[2]),
]);
const gapResolution = Type.Union([
  Type.Literal(GAP_RESOLUTIONS[0]),
  Type.Literal(GAP_RESOLUTIONS[1]),
  Type.Literal(GAP_RESOLUTIONS[2]),
  Type.Literal(GAP_RESOLUTIONS[3]),
  Type.Literal(GAP_RESOLUTIONS[4]),
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
        Type.Literal(SUMMARY_MODES[0]),
        Type.Literal(SUMMARY_MODES[1]),
        Type.Literal(SUMMARY_MODES[2]),
        Type.Literal(SUMMARY_MODES[3]),
      ]),
    ),
  },
  { additionalProperties: true },
);

export const exaResearchResetParams = Type.Object({}, { additionalProperties: true });

/**
 * TypeBox parameter schemas for Exa tools.
 */

import { Type } from "@sinclair/typebox";

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
      Type.Integer({ description: "Number of similar pages to return (1-10, default: 5)", minimum: 1, maximum: 20 }),
    ),
    excludeSourceDomain: Type.Optional(Type.Boolean({ description: "Do not include pages from the same domain" })),
    startPublishedDate: Type.Optional(Type.String({ description: "ISO date filter" })),
    endPublishedDate: Type.Optional(Type.String({ description: "ISO date filter" })),
    includeDomains: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

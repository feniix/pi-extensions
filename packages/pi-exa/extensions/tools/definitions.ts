/**
 * Tool parameter schemas
 */

import { Type } from "@sinclair/typebox";

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
    type: Type.Optional(Type.String({ description: "Search type: auto, fast, deep, neural" })),
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

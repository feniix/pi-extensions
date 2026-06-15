/**
 * Exa deep research search — powered by deep search with synthesized output.
 */

import type { DeepOutputSchema, DeepSearchOutput } from "exa-js";
import { DEEP_SEARCH_TYPES } from "./constants.js";
import { getExaClient } from "./exa-client.js";
import type { ToolPerformResult } from "./formatters.js";
import { formatResearchOutput, toMetadata } from "./formatters.js";

export const DEFAULT_DEEP_NUM_RESULTS = 10;
export const DEEP_RESEARCH_TYPES = DEEP_SEARCH_TYPES;

interface ResearchParams {
  query: string;
  type?: (typeof DEEP_RESEARCH_TYPES)[number];
  systemPrompt?: string;
  textMaxCharacters?: number;
  outputSchema?: Record<string, unknown>;
  additionalQueries?: string[];
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
}

function parseOutputSchema(outputSchema: Record<string, unknown> | undefined): DeepOutputSchema {
  // The Exa /search endpoint only returns an `output` field when an
  // outputSchema is provided (see Exa Search API Reference, the
  // canonical guide: "When provided, the response includes `output`").
  // Without a default, every call without an explicit outputSchema
  // would return no synthesis and the canned "no synthesized output"
  // fallback would fire — see issue #115.
  //
  // Default to text-mode synthesis: it is the lowest-friction mode
  // (no schema design required), matches every skill example in this
  // package except `financial-report-search`, and is what the user's
  // manual workaround in the bug report uses. Callers that want
  // structured output pass `outputSchema: { type: "object", properties: {...} }`
  // explicitly; the override is preserved verbatim.
  if (!outputSchema || !Object.hasOwn(outputSchema, "type")) {
    return { type: "text" } as DeepOutputSchema;
  }

  const schemaType = outputSchema.type;
  if (schemaType !== "object" && schemaType !== "text") {
    throw new Error('outputSchema.type must be either "object" or "text".');
  }

  return outputSchema as DeepOutputSchema;
}

export async function performResearch(apiKey: string, params: ResearchParams): Promise<ToolPerformResult> {
  const outputSchema = parseOutputSchema(params.outputSchema);

  const exa = getExaClient(apiKey);

  const response = await exa.search(params.query, {
    type: params.type || "deep-reasoning",
    additionalQueries: params.additionalQueries,
    numResults: params.numResults || DEFAULT_DEEP_NUM_RESULTS,
    systemPrompt: params.systemPrompt,
    outputSchema,
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    startPublishedDate: params.startPublishedDate,
    endPublishedDate: params.endPublishedDate,
    contents: {
      text: {
        maxCharacters: params.textMaxCharacters || 12000,
      },
      highlights: {
        query: params.systemPrompt || params.query,
        numSentences: 4,
      },
    },
  });

  if (!response?.output) {
    // Synthesize an honest diagnostic. The response shape proves the
    // contract issue: top-level keys include requestId/results/etc.
    // but no `output` key. That is the documented behavior of /search
    // when no outputSchema was sent — not a backend failure.
    const responseRecord = response as Record<string, unknown> | null | undefined;
    const results = responseRecord?.results;
    const resultsCount = Array.isArray(results) ? (results as unknown[]).length : 0;
    const responseKeys = responseRecord ? Object.keys(responseRecord) : [];
    const requestId = typeof responseRecord?.requestId === "string" ? (responseRecord.requestId as string) : "unknown";
    const text =
      `Deep search completed but no synthesized output was returned. ` +
      `Synthesis was not requested by the Exa API in this call (requestId: ${requestId}, ` +
      `results returned: ${resultsCount}). Pass outputSchema explicitly to receive synthesis: ` +
      `\`{ "type": "text" }\` for prose or \`{ "type": "object", "properties": {...} }\` for structured output ` +
      `(max 10 properties, max depth 2).`;
    return {
      text,
      details: {
        tool: "web_research_exa",
        kind: "domain",
        error: "no_synthesized_output",
        requestId,
        resultsCount,
        outputSchemaSent: outputSchema,
        responseKeys,
        ...toMetadata(response),
      },
    };
  }

  const formatted = formatResearchOutput(response.output as DeepSearchOutput, outputSchema);

  return {
    text: formatted.text,
    details: {
      tool: "web_research_exa",
      ...toMetadata(response),
      ...(formatted.parsedOutput === undefined ? {} : { parsedOutput: formatted.parsedOutput }),
    },
  };
}

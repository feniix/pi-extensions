/**
 * Exa deep research search — powered by deep search with synthesized output.
 */

import type { DeepOutputSchema, DeepSearchOutput } from "exa-js";
import { DEEP_SEARCH_TYPES, DEFAULT_RESEARCH_OUTPUT_SCHEMA } from "./constants.js";
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
  // Exa /search only returns an `output` field when an outputSchema is
  // provided; default to text so omitted schemas still request synthesis
  // (issue #115). Explicit object-mode schemas pass through unchanged.
  if (!outputSchema || !Object.hasOwn(outputSchema, "type")) {
    return DEFAULT_RESEARCH_OUTPUT_SCHEMA as unknown as DeepOutputSchema;
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
    // Even with the default outputSchema, surface a non-error diagnostic
    // when Exa returns results but omits `output` so the operator and
    // the model-visible text both know what happened.
    const resultsCount = Array.isArray(response?.results) ? response.results.length : 0;
    const responseKeys = response ? Object.keys(response) : [];
    const requestId = typeof response?.requestId === "string" ? response.requestId : "unknown";
    const text =
      `Deep search completed but no synthesized output was returned. ` +
      `An outputSchema was sent to the Exa API (requestId: ${requestId}, ` +
      `results returned: ${resultsCount}, outputSchema: ${JSON.stringify(outputSchema)}), ` +
      `but the response did not include an \`output\` field. ` +
      `Try a different query, simplify filters, or check Exa's status page.`;
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
        // Guard the metadata spread: toMetadata dereferences
        // response.costDollars and response.searchTime, and a nullish
        // response would throw before the diagnostic can be returned.
        ...(response ? toMetadata(response) : {}),
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

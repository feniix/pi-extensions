/**
 * Exa deep research search — powered by deep search with synthesized output.
 */

import type { DeepOutputSchema, DeepSearchOutput } from "exa-js";
import { Exa } from "exa-js";
import type { ToolPerformResult } from "./formatters.js";
import { formatResearchOutput, toMetadata } from "./formatters.js";

export const DEFAULT_DEEP_NUM_RESULTS = 10;
export const DEEP_RESEARCH_TYPES = ["deep-reasoning", "deep-lite", "deep"] as const;

interface ResearchParams {
  query: string;
  type?: (typeof DEEP_RESEARCH_TYPES)[number];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  additionalQueries?: string[];
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
}

function parseOutputSchema(outputSchema: Record<string, unknown> | undefined): DeepOutputSchema | undefined {
  if (!outputSchema || !Object.hasOwn(outputSchema, "type")) {
    return undefined;
  }

  const schemaType = outputSchema.type;
  if (schemaType !== "object" && schemaType !== "text") {
    throw new Error('outputSchema.type must be either "object" or "text".');
  }

  return outputSchema as DeepOutputSchema;
}

export async function performResearch(apiKey: string, params: ResearchParams): Promise<ToolPerformResult> {
  const outputSchema = parseOutputSchema(params.outputSchema);

  const exa = new Exa(apiKey);

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
        maxCharacters: 12000,
      },
      highlights: {
        query: params.systemPrompt,
        numSentences: 4,
      },
    },
  });

  if (!response?.output) {
    return {
      text: "Deep search completed, but no synthesized output was returned. Try a different query or simpler filters.",
      details: {
        tool: "web_research_exa",
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

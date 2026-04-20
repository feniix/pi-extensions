/**
 * Exa answer endpoint wrapper.
 */

import type { AnswerResponse } from "exa-js";
import { Exa } from "exa-js";
import type { ToolPerformResult } from "./formatters.js";
import { formatAnswerResult, toMetadata } from "./formatters.js";

interface AnswerParams {
  query: string;
  systemPrompt?: string;
  text?: boolean;
  outputSchema?: Record<string, unknown>;
}

export async function performAnswer(apiKey: string, params: AnswerParams): Promise<ToolPerformResult> {
  const exa = new Exa(apiKey);

  const result: AnswerResponse = await exa.answer(params.query, {
    text: params.text,
    systemPrompt: params.systemPrompt,
    ...(params.outputSchema ? { outputSchema: params.outputSchema } : {}),
  });

  const formatted = formatAnswerResult(result, params.outputSchema);

  return {
    text: formatted.text,
    details: {
      tool: "web_answer_exa",
      ...toMetadata(result),
      ...(formatted.parsedOutput === undefined ? {} : { parsedOutput: formatted.parsedOutput }),
    },
  };
}

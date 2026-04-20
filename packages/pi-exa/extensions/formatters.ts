/**
 * Exa API response types and result formatters for pi-exa.
 */

import type { AnswerResponse, CostDollars, DeepOutputSchema, DeepSearchOutput } from "exa-js";

export type OutputSchema = DeepOutputSchema | { type?: "object" | "text" } | Record<string, unknown>;

// =============================================================================
// Types
// =============================================================================

export interface ExaResponseMetadata {
  costDollars?: CostDollars;
  searchTime?: number;
  resolvedSearchType?: string;
}

export interface ToolPerformResult {
  text: string;
  details: ExaResponseMetadata & Record<string, unknown>;
}

export interface FormattedResearch {
  text: string;
  parsedOutput?: unknown;
}

type SearchResultSubpage = {
  url?: string;
  title?: string | null;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
};

type SearchResultForFormatting = {
  title?: string | null;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
  subpages?: SearchResultSubpage[] | unknown[];
};

// =============================================================================
// Helpers
// =============================================================================

function formatPublishedDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  return date.split("T")[0];
}

function parseOutputSchemaType(outputSchema: OutputSchema | undefined): "object" | "text" {
  if (
    typeof outputSchema === "object" &&
    outputSchema !== null &&
    "type" in outputSchema &&
    outputSchema.type === "text"
  ) {
    return "text";
  }

  return "object";
}

function normalizeSubpages(subpages: SearchResultForFormatting["subpages"]): SearchResultSubpage[] {
  if (!subpages) {
    return [];
  }

  return subpages.flatMap((entry) =>
    itemHasSubpages(entry)
      ? normalizeSubpages((entry as { subpages: unknown[] }).subpages)
      : [entry as SearchResultSubpage],
  );
}

function itemHasSubpages(value: unknown): value is { subpages: unknown[] } {
  return typeof value === "object" && value !== null && "subpages" in value && Array.isArray(value.subpages);
}

function formatCitations(
  citations: Array<{ url: string; title?: string | null; publishedDate?: string; author?: string; text?: string }>,
) {
  if (citations.length === 0) {
    return "";
  }

  const lines = [
    "",
    "Grounding:",
    ...citations.map((citation) => {
      const citationParts = [citation.title ? `${citation.title}` : citation.url, citation.url];
      const details = [
        citation.publishedDate ? formatPublishedDate(citation.publishedDate) : undefined,
        citation.author,
      ].filter(Boolean);
      if (details.length > 0) {
        citationParts.push(`(${details.join(", ")})`);
      }
      return `- ${citationParts.join(" ")}`;
    }),
  ];

  return lines.join("\n");
}

// =============================================================================
// Formatters
// =============================================================================

export function formatSearchResults(results: SearchResultForFormatting[]): string {
  if (results.length === 0) {
    return "No search results found. Please try a different query.";
  }

  return results
    .map((r) => {
      const lines: string[] = [
        `Title: ${r.title || "N/A"}`,
        `URL: ${r.url}`,
        `Published: ${formatPublishedDate(r.publishedDate) || "N/A"}`,
        `Author: ${r.author || "N/A"}`,
      ];

      if (Array.isArray(r.highlights) && r.highlights.length > 0) {
        lines.push("Highlights:");
        lines.push(...r.highlights.map((entry) => `- ${entry}`));
      } else if (r.summary) {
        lines.push("Summary:");
        lines.push(r.summary);
      } else if (r.text) {
        lines.push("Text:");
        lines.push(r.text);
      }

      const subpages = normalizeSubpages(r.subpages);
      if (subpages.length > 0) {
        lines.push("Subpages:");
        const formattedSubpages = subpages
          .map((subpage, index) => `  ${index + 1}. ${subpage.url || "(no url)"}`)
          .join("\n");
        if (formattedSubpages.length > 0) {
          lines.push(formattedSubpages);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export function formatCrawlResults(results: SearchResultForFormatting[]): string {
  if (results.length === 0) {
    return "No content found.";
  }

  return results
    .map((r) => {
      const lines: string[] = [`# ${r.title || "(no title)"}`, `URL: ${r.url}`];

      const published = formatPublishedDate(r.publishedDate);
      if (published) {
        lines.push(`Published: ${published}`);
      }
      if (r.author) {
        lines.push(`Author: ${r.author}`);
      }

      if (r.highlights && r.highlights.length > 0) {
        lines.push("");
        lines.push("Highlights:");
        lines.push(...r.highlights.map((entry) => `- ${entry}`));
      }

      if (r.summary) {
        lines.push("");
        lines.push("Summary:");
        lines.push(r.summary);
      }

      if (r.text) {
        lines.push("");
        lines.push(r.text);
      }

      const subpages = normalizeSubpages(r.subpages);
      if (subpages.length > 0) {
        lines.push("");
        lines.push("Subpages:");
        const formattedSubpages = subpages.map((subpage, index) => `  ${index + 1}. ${subpage.url || "(no url)"}`);
        lines.push(...formattedSubpages);
      }

      return lines.join("\n");
    })
    .join("\n");
}

export function formatResearchOutput(
  output: DeepSearchOutput | undefined,
  outputSchema?: OutputSchema,
): FormattedResearch {
  if (!output) {
    return {
      text: "Deep search completed, but no synthesized output was returned. Try a different query or avoid unsupported filters.",
    };
  }

  const outputSchemaType = parseOutputSchemaType(outputSchema);
  const content = output.content;

  const citationsText = Array.isArray(output.grounding)
    ? formatCitations(output.grounding.flatMap((grounding) => grounding.citations || []))
    : "";

  if (outputSchemaType === "text") {
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    return {
      text: [text, citationsText].filter(Boolean).join("\n\n"),
    };
  }

  if (typeof content === "string") {
    return {
      text: [content, citationsText].filter(Boolean).join("\n\n"),
    };
  }

  return {
    text: ["```json", JSON.stringify(content, null, 2), "```", citationsText].filter(Boolean).join("\n\n"),
    parsedOutput: content,
  };
}

export function formatAnswerResult(response: AnswerResponse, outputSchema?: OutputSchema): FormattedResearch {
  const outputSchemaType = parseOutputSchemaType(outputSchema);
  const answer = response.answer;

  const citationsText = formatCitations(response.citations ?? []);

  if (outputSchemaType === "text") {
    const text = typeof answer === "string" ? answer : JSON.stringify(answer, null, 2);
    return {
      text: [text, citationsText].filter(Boolean).join("\n\n"),
    };
  }

  if (typeof answer === "string") {
    return {
      text: [answer, citationsText].filter(Boolean).join("\n\n"),
    };
  }

  return {
    text: ["```json", JSON.stringify(answer, null, 2), "```", citationsText].filter(Boolean).join("\n\n"),
    parsedOutput: answer,
  };
}

export function toMetadata(response: {
  costDollars?: CostDollars;
  searchTime?: number;
  resolvedSearchType?: string;
}): ExaResponseMetadata {
  return {
    ...(response.costDollars ? { costDollars: response.costDollars } : {}),
    ...(response.searchTime !== undefined ? { searchTime: response.searchTime } : {}),
    ...(response.resolvedSearchType ? { resolvedSearchType: response.resolvedSearchType } : {}),
  };
}

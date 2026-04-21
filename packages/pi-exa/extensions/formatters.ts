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

// =============================================================================
// Entity Types (exported for use in tests and other modules)
// =============================================================================

export type {
  CompanyEntity,
  Entity,
  EntityCompanyProperties,
  EntityCompanyPropertiesFinancials,
  EntityCompanyPropertiesFundingRound,
  EntityCompanyPropertiesHeadquarters,
  EntityCompanyPropertiesWebTraffic,
  EntityCompanyPropertiesWorkforce,
  EntityDateRange,
  EntityPersonProperties,
  EntityPersonPropertiesCompanyRef,
  EntityPersonPropertiesWorkHistoryEntry,
  PersonEntity,
};

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
  entities?: Entity[];
};

// =============================================================================
// Entity Types
// =============================================================================

/** Company workforce information. */
type EntityCompanyPropertiesWorkforce = {
  total?: number | null;
};

/** Company headquarters information. */
type EntityCompanyPropertiesHeadquarters = {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

/** Funding round information. */
type EntityCompanyPropertiesFundingRound = {
  name?: string | null;
  date?: string | null;
  amount?: number | null;
};

/** Company financial information. */
type EntityCompanyPropertiesFinancials = {
  revenueAnnual?: number | null;
  fundingTotal?: number | null;
  fundingLatestRound?: EntityCompanyPropertiesFundingRound | null;
};

/** Company web traffic information. */
// Note: webTraffic is intentionally not rendered - monthly visits data is not typically
// useful in search result summaries and would add noise.
type EntityCompanyPropertiesWebTraffic = {
  visitsMonthly?: number | null;
};

/** Structured properties for a company entity. */
type EntityCompanyProperties = {
  name?: string | null;
  foundedYear?: number | null;
  description?: string | null;
  industry?: string | null;
  workforce?: EntityCompanyPropertiesWorkforce | null;
  headquarters?: EntityCompanyPropertiesHeadquarters | null;
  financials?: EntityCompanyPropertiesFinancials | null;
  webTraffic?: EntityCompanyPropertiesWebTraffic | null;
};

/** Date range for work history entries. */
type EntityDateRange = {
  from?: string | null;
  to?: string | null;
};

/** Reference to a company in work history. */
type EntityPersonPropertiesCompanyRef = {
  id?: string | null;
  name?: string | null;
  location?: string | null;
};

/** A single work history entry for a person. */
type EntityPersonPropertiesWorkHistoryEntry = {
  title?: string | null;
  location?: string | null;
  dates?: EntityDateRange | null;
  company?: EntityPersonPropertiesCompanyRef | null;
};

/** Structured properties for a person entity. */
type EntityPersonProperties = {
  name?: string | null;
  location?: string | null;
  workHistory?: EntityPersonPropertiesWorkHistoryEntry[];
};

/** Structured entity data for a company. */
type CompanyEntity = {
  id: string;
  type: "company";
  version: number;
  properties: EntityCompanyProperties;
};

/** Structured entity data for a person. */
type PersonEntity = {
  id: string;
  type: "person";
  version: number;
  properties: EntityPersonProperties;
};

/** Structured entity data for company or person search results. */
type Entity = CompanyEntity | PersonEntity;

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
// Entity Property Formatters
// =============================================================================

function isCompanyEntity(entity: Entity): entity is CompanyEntity {
  return entity.type === "company";
}

function isPersonEntity(entity: Entity): entity is PersonEntity {
  return entity.type === "person";
}

function formatEntityProperties(entities: Entity[] | undefined): string {
  if (!entities || entities.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const entity of entities) {
    if (isCompanyEntity(entity)) {
      lines.push(formatCompanyProperties(entity.properties));
    } else if (isPersonEntity(entity)) {
      lines.push(formatPersonProperties(entity.properties));
    }
  }

  return lines.join("\n");
}

function formatCompanyProperties(props: EntityCompanyProperties): string {
  const lines: string[] = ["Company Properties:"];

  if (props.description) {
    lines.push(`  Description: ${props.description}`);
  }

  if (props.industry) {
    lines.push(`  Industry: ${props.industry}`);
  }

  if (props.headquarters) {
    const { city, country } = props.headquarters;
    if (city || country) {
      const locationParts = [city, country].filter(Boolean);
      lines.push(`  Location: ${locationParts.join(", ")}`);
    }
  }

  if (props.workforce?.total) {
    lines.push(`  Employees: ${props.workforce.total.toLocaleString()}`);
  }

  if (props.financials) {
    if (props.financials.fundingTotal) {
      lines.push(`  Total Funding: $${props.financials.fundingTotal.toLocaleString()}`);
    }
    if (props.financials.fundingLatestRound) {
      const round = props.financials.fundingLatestRound;
      const roundParts = [
        round.name,
        round.date ? `(${round.date})` : null,
        round.amount ? `$${round.amount.toLocaleString()}` : null,
      ].filter((s): s is string => s !== null);
      if (roundParts.length > 0) {
        lines.push(`  Latest Funding: ${roundParts.join(" ")}`);
      }
    }
    if (props.financials.revenueAnnual) {
      lines.push(`  Annual Revenue: $${props.financials.revenueAnnual.toLocaleString()}`);
    }
  }

  if (props.foundedYear) {
    lines.push(`  Founded: ${props.foundedYear}`);
  }

  return lines.join("\n");
}

function formatPersonProperties(props: EntityPersonProperties): string {
  const lines: string[] = ["Person Properties:"];

  if (props.location) {
    lines.push(`  Location: ${props.location}`);
  }

  if (props.workHistory && props.workHistory.length > 0) {
    const jobs = props.workHistory.slice(0, 3); // Limit to 3 most recent
    const jobLines: string[] = [];

    for (const job of jobs) {
      const title = job.title || "Unknown title";
      const company = job.company?.name || "Unknown company";
      jobLines.push(`${title} at ${company}`);
    }

    if (jobLines.length > 0) {
      lines.push(`  Job Titles: ${jobLines.join(", ")}`);
      const employers = jobs.map((j) => j.company?.name).filter((s): s is string => s !== null && s !== undefined);
      if (employers.length > 0) {
        lines.push(`  Employers: ${employers.join(", ")}`);
      }
    }
  }

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
          .map((subpage, index) => {
            const label = subpage.title || subpage.url || "(no url)";
            return subpage.title && subpage.url
              ? `  ${index + 1}. ${label} — ${subpage.url}`
              : `  ${index + 1}. ${label}`;
          })
          .join("\n");
        if (formattedSubpages.length > 0) {
          lines.push(formattedSubpages);
        }
      }

      const entityProperties = formatEntityProperties(r.entities);
      if (entityProperties) {
        lines.push(entityProperties);
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
        const formattedSubpages = subpages.map((subpage, index) => {
          const label = subpage.title || subpage.url || "(no url)";
          return subpage.title && subpage.url
            ? `  ${index + 1}. ${label} — ${subpage.url}`
            : `  ${index + 1}. ${label}`;
        });
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

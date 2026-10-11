/** Metadata-only source capture. Returned content is untrusted and never archived here. */
import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { spendingGrantSchema } from "./research-accounting.js";

const strict = { additionalProperties: false };
export const evidenceProvenanceSchema = Type.Object(
  {
    operationId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    requestHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    tool: spendingGrantSchema.properties.tools.items,
    retrievedAt: Type.String({ minLength: 1 }),
  },
  strict,
);
export type EvidenceProvenance = Static<typeof evidenceProvenanceSchema>;
export const candidateSchema = Type.Object(
  {
    id: Type.String({ pattern: "^candidate-[a-f0-9]{64}$" }),
    url: Type.String({ minLength: 1, maxLength: 8192 }),
    title: Type.String({ minLength: 1, maxLength: 512 }),
    retrievalStatus: Type.Union([
      Type.Literal("discovered_only"),
      Type.Literal("fetched"),
      Type.Literal("fetch_failed"),
      Type.Literal("unavailable"),
    ]),
    decision: Type.Union([Type.Literal("candidate"), Type.Literal("selected"), Type.Literal("rejected")]),
    provenance: Type.Array(evidenceProvenanceSchema, { minItems: 1 }),
    sourceId: Type.Optional(Type.String({ minLength: 1 })),
  },
  strict,
);
export type ResearchCandidate = Static<typeof candidateSchema>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function captureCandidates(
  response: unknown,
  provenance: EvidenceProvenance,
  previous: ResearchCandidate[] = [],
): ResearchCandidate[] {
  if (!Value.Check(evidenceProvenanceSchema, provenance)) throw new Error("Invalid evidence provenance.");
  const candidates = structuredClone(previous);
  if (!object(response)) return candidates;
  const results: unknown[] = [
    ...(Array.isArray(response.results) ? response.results : []),
    ...(Array.isArray(response.citations) ? response.citations : []),
  ];
  if (object(response.output) && Array.isArray(response.output.grounding)) {
    for (const grounding of response.output.grounding)
      if (object(grounding) && Array.isArray(grounding.citations)) results.push(...grounding.citations);
  }
  if (Array.isArray(response.statuses)) {
    for (const status of response.statuses)
      if (object(status) && status.status === "error" && typeof status.id === "string")
        results.push({ url: status.id, fetchFailed: true });
  }
  for (const result of results) {
    if (!object(result) || typeof result.url !== "string") continue;
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
    if (
      [...url.searchParams.keys()].some((key) =>
        /(?:^|[-_])(key|token|password|secret|signature|authorization|credential)(?:[-_]|$)/i.test(key),
      )
    )
      continue;
    url.hash = "";
    if (url.href.length > 8192) continue;
    const fetched = [result.text, result.summary, ...(Array.isArray(result.highlights) ? result.highlights : [])].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    const existing = candidates.find((candidate) => candidate.url === url.href);
    const title = (typeof result.title === "string" && result.title.trim() ? result.title.trim() : url.href).slice(
      0,
      512,
    );
    if (existing) {
      if (typeof result.title === "string" && result.title.trim()) existing.title = title;
      if (fetched) existing.retrievalStatus = "fetched";
      if (!existing.provenance.some((entry) => entry.operationId === provenance.operationId))
        existing.provenance.push(structuredClone(provenance));
      continue;
    }
    candidates.push({
      id: `candidate-${createHash("sha256").update(url.href).digest("hex")}`,
      url: url.href,
      title,
      retrievalStatus: fetched ? "fetched" : result.fetchFailed === true ? "fetch_failed" : "discovered_only",
      decision: "candidate",
      provenance: [structuredClone(provenance)],
    });
  }
  return candidates;
}

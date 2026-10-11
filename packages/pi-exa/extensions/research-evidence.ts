/** Metadata-only source capture. Returned content is untrusted and never archived here. */
import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { spendingGrantSchema } from "./research-accounting.js";
import type { ResearchExecutionPlan } from "./research-artifacts.js";
import type { ResearchSource, ResearchSourceInput } from "./research-planner-types.js";

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
    selectedProvenance: Type.Optional(Type.Array(evidenceProvenanceSchema, { minItems: 1 })),
    sourceId: Type.Optional(Type.String({ minLength: 1 })),
  },
  strict,
);
export type ResearchCandidate = Static<typeof candidateSchema>;
export const evidenceDecisionSchema = Type.Union([
  Type.Object(
    {
      candidateId: Type.String({ minLength: 1 }),
      decision: Type.Literal("select"),
      label: Type.String({ minLength: 1 }),
      notes: Type.Optional(Type.String()),
    },
    strict,
  ),
  Type.Object({ candidateId: Type.String({ minLength: 1 }), decision: Type.Literal("reject") }, strict),
]);
export type EvidenceDecision = Static<typeof evidenceDecisionSchema>;

export function curateEvidence(
  previous: ResearchCandidate[],
  decisions: EvidenceDecision[],
  sources: ResearchSource[],
  selections: NonNullable<ResearchExecutionPlan["selectedEvidence"]>,
) {
  if (!Value.Check(Type.Array(evidenceDecisionSchema), decisions)) throw new Error("Invalid evidence decisions.");
  const candidates = structuredClone(previous);
  let selectedEvidence = structuredClone(selections);
  const sourceUpdates: ResearchSourceInput[] = [];
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (seen.has(decision.candidateId)) throw new Error("Duplicate evidence decision.");
    seen.add(decision.candidateId);
    const candidate = candidates.find((entry) => entry.id === decision.candidateId);
    if (!candidate) throw new Error("Unknown evidence candidate.");
    if (decision.decision === "reject") {
      candidate.decision = "rejected";
      selectedEvidence = selectedEvidence.filter((entry) => entry.sourceId !== candidate.sourceId);
      continue;
    }
    const existing = sources.find((source) => source.url === candidate.url);
    // Candidate-created sources use the stable candidate ID. Reused external
    // sources retain their explicit metadata rather than inheriting SDK claims.
    const preserveExternal = existing !== undefined && existing.id !== candidate.id;
    const sourceId = existing?.id ?? candidate.sourceId ?? candidate.id;
    if (sources.some((source) => source.id === sourceId && source.url !== candidate.url))
      throw new Error("Evidence source identity conflict.");
    candidate.sourceId = sourceId;
    candidate.decision = "selected";
    candidate.selectedProvenance = structuredClone(candidate.provenance);
    sourceUpdates.push({
      id: sourceId,
      title: preserveExternal ? existing.title : candidate.title,
      url: candidate.url,
      retrievalStatus: preserveExternal ? existing.retrievalStatus : candidate.retrievalStatus,
      retrievalEvidence: preserveExternal
        ? existing.retrievalEvidence
        : `Exa metadata from operations ${candidate.provenance.map((entry) => entry.operationId).join(", ")}: ${candidate.retrievalStatus}; source bodies not retained or independently verified.`,
    });
    const prior = selectedEvidence.find((entry) => entry.sourceId === sourceId);
    selectedEvidence = selectedEvidence.filter((entry) => entry.sourceId !== sourceId);
    selectedEvidence.push({
      sourceId,
      label: decision.label,
      ...(decision.notes === undefined
        ? prior?.notes === undefined
          ? {}
          : { notes: prior.notes }
        : { notes: decision.notes }),
    });
  }
  return { candidates, sourceUpdates, selectedEvidence };
}

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
      [...url.searchParams.keys()].some(
        (key) =>
          /(?:^|[-_])(key|token|password|secret|sig|signature|authorization|credential)(?:[-_]|$)/i.test(
            key.replace(/([a-z])([A-Z])/g, "$1_$2"),
          ) || /^(apiKey|accessToken|authToken|sessionToken|AWSAccessKeyId)$/i.test(key),
      )
    )
      continue;
    url.hash = "";
    if (url.href.length > 8192) continue;
    const fetched = [result.text, ...(Array.isArray(result.highlights) ? result.highlights : [])].some(
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
      else if (result.fetchFailed === true && existing.retrievalStatus !== "fetched")
        existing.retrievalStatus = "fetch_failed";
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

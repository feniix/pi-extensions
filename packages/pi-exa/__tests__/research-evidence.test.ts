import { describe, expect, it } from "vitest";
import { captureCandidates, curateEvidence, type EvidenceProvenance } from "../extensions/research-evidence.js";

const provenance: EvidenceProvenance = {
  operationId: "operation-one",
  revision: 0,
  requestHash: "a".repeat(64),
  tool: "web_search_exa",
  retrievedAt: "2026-10-11T00:00:00.000Z",
};

describe("metadata-first candidate evidence", () => {
  it("selects/rejects explicitly and preserves curated notes and source provenance", () => {
    const captured = captureCandidates({ results: [{ url: "https://example.com/source", text: "body" }] }, provenance);
    const selected = curateEvidence(
      captured,
      [
        {
          candidateId: captured[0].id,
          decision: "select",
          label: "Primary source",
          notes: "Explicit evidence note",
        },
      ],
      [],
      [],
    );
    expect(selected.candidates[0]).toMatchObject({ decision: "selected", sourceId: captured[0].id });
    expect(selected.sourceUpdates).toMatchObject([
      { id: captured[0].id, url: captured[0].url, retrievalStatus: "fetched" },
    ]);
    expect(selected.selectedEvidence).toEqual([
      {
        sourceId: captured[0].id,
        label: "Primary source",
        notes: "Explicit evidence note",
      },
    ]);
    const rejected = curateEvidence(
      selected.candidates,
      [
        {
          candidateId: captured[0].id,
          decision: "reject",
        },
      ],
      [],
      selected.selectedEvidence,
    );
    expect(rejected.selectedEvidence).toEqual([]);
    expect(rejected.candidates[0]).toMatchObject({ decision: "rejected", provenance: [provenance] });
    expect(captured[0].decision).toBe("candidate");
    expect(() => curateEvidence(captured, [{ candidateId: "unknown", decision: "reject" }], [], [])).toThrow(
      "Unknown evidence candidate",
    );
  });
  it("records failed URL retrieval metadata without inventing fetched content", () => {
    expect(
      captureCandidates(
        {
          results: [{ id: "sdk-id", url: "https://example.com/ok", title: null }],
          statuses: [{ id: "https://example.com/failed", status: "error", error: { message: "raw secret" } }],
        },
        { ...provenance, tool: "web_fetch_exa" },
      ),
    ).toMatchObject([
      { url: "https://example.com/ok", title: "https://example.com/ok", retrievalStatus: "discovered_only" },
      { url: "https://example.com/failed", retrievalStatus: "fetch_failed" },
    ]);
  });
  it("rejects unsafe and credential-bearing URLs, bounds titles, and never turns generated output into sources", () => {
    const candidates = captureCandidates(
      {
        results: [
          { url: "javascript:alert(1)" },
          { url: "https://username:password@example.com" },
          { url: "https://example.com?api_key=secret" },
          { url: "https://example.com?X-Amz-Signature=secret" },
          { url: "https://example.com/valid", title: "x".repeat(1000), summary: {} },
        ],
        output: { content: { sources: [{ url: "https://invented.example" }] } },
        answer: "https://invented.example",
      },
      provenance,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toHaveLength(512);
    expect(candidates[0].retrievalStatus).toBe("discovered_only");
  });
  it("deduplicates normalized URLs across response shapes without losing earlier provenance or curation", () => {
    const first = captureCandidates({ results: [{ url: "https://example.com", text: "body" }] }, provenance);
    first[0].decision = "rejected";
    const next = captureCandidates(
      {
        citations: [{ url: "https://example.com/#citation" }],
        output: {
          content: "not evidence",
          grounding: [{ citations: [{ url: "https://example.com/", title: "Latest title" }] }],
        },
      },
      { ...provenance, operationId: "operation-two", tool: "web_answer_exa" },
      first,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: first[0].id,
      title: "Latest title",
      retrievalStatus: "fetched",
      decision: "rejected",
      provenance: [provenance, { ...provenance, operationId: "operation-two", tool: "web_answer_exa" }],
    });
    expect(first[0].provenance).toHaveLength(1);
  });
  it("retains source metadata and operation provenance, not response content or automatic selection", () => {
    const candidates = captureCandidates(
      {
        results: [
          {
            id: "temporary-sdk-id",
            url: "https://EXAMPLE.com/source#section",
            title: "Source",
            text: "private raw body",
            highlights: ["private highlight"],
            summary: "private generated summary",
          },
        ],
        requestId: "not-retained",
        answer: "private generated answer",
      },
      provenance,
    );
    expect(candidates).toEqual([
      {
        id: expect.stringMatching(/^candidate-[a-f0-9]{64}$/),
        url: "https://example.com/source",
        title: "Source",
        retrievalStatus: "fetched",
        decision: "candidate",
        provenance: [provenance],
      },
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(/private|temporary-sdk-id|not-retained/);
  });
});

import { describe, expect, it } from "vitest";
import { assessExploration, estimateExploration } from "../extensions/research-accounting.js";

describe("exploratory accounting policy", () => {
  const grant = {
    kind: "exa-grant-v1",
    id: "grant-1",
    cycleId: "cycle",
    projectId: "project",
    issuerSessionId: "operator-session",
    source: "command",
    issuedAt: "2026-10-10T00:00:00Z",
    ceilingMicros: 10_000,
    tools: ["web_search_exa"],
  };
  it("requires operator permission even for a published-price estimate", () => {
    const estimate = estimateExploration("web_search_exa", { query: "topic", numResults: 5 });
    expect(estimate).toMatchObject({ dollars: 0.007, basis: expect.stringContaining("March 3, 2026") });
    expect(assessExploration([], [], estimate, "web_search_exa")).toMatchObject({
      canDispatch: false,
      reason: "APPROVAL_REQUIRED",
      reportedDollars: 0,
      billingVerified: false,
    });
  });

  it("uses the latest total ceiling rather than summing repeated approvals", () => {
    const estimate = estimateExploration("web_search_exa", {});
    expect(assessExploration([grant, { ...grant, id: "grant-2" }], [], estimate, "web_search_exa")).toMatchObject({
      canDispatch: true,
      ceilingDollars: 0.01,
      proposedDollars: 0.007,
    });
    expect(
      assessExploration([grant, { ...grant, id: "grant-2", ceilingMicros: 6_000 }], [], estimate, "web_search_exa"),
    ).toMatchObject({ canDispatch: false, reason: "INSUFFICIENT_BALANCE", ceilingDollars: 0.006 });
  });

  it("shares pending exposure and replaces its estimate with a reported total exactly once", () => {
    const operation = {
      kind: "exa-exploration-v1",
      id: "op-1",
      cycleId: "cycle",
      revision: 0,
      tool: "web_search_exa",
      requestHash: "a".repeat(64),
      estimateMicros: 7_000,
      basis: "fixture published estimate",
      status: "reserved",
      createdAt: "2026-10-10T00:00:00Z",
    };
    const estimate = estimateExploration("web_search_exa", {});
    expect(assessExploration([grant], [operation], estimate, "web_search_exa")).toMatchObject({
      canDispatch: false,
      reason: "INSUFFICIENT_BALANCE",
      pendingEstimatedDollars: 0.007,
    });
    expect(
      assessExploration(
        [grant],
        [{ ...operation, status: "reported", reportedMicros: 1_000 }],
        estimate,
        "web_search_exa",
      ),
    ).toMatchObject({
      canDispatch: true,
      reportedDollars: 0.001,
      pendingEstimatedDollars: 0,
    });
  });

  it("never treats an unresolved operation as zero or its old estimate as a proven bound", () => {
    const unknown = {
      kind: "exa-exploration-v1",
      id: "unknown-1",
      cycleId: "cycle",
      revision: 0,
      tool: "web_search_exa",
      requestHash: "b".repeat(64),
      estimateMicros: 1,
      basis: "old estimate, not a billing cap",
      status: "unknown",
      createdAt: "2026-10-10T00:00:00Z",
    };
    expect(
      assessExploration([grant], [unknown], estimateExploration("web_search_exa", {}), "web_search_exa"),
    ).toMatchObject({ canDispatch: false, reason: "UNKNOWN_LIABILITY", unresolvedOperationIds: ["unknown-1"] });
  });

  it("rejects malformed or duplicate recognized grants rather than falling back to an older approval", () => {
    const estimate = estimateExploration("web_search_exa", {});
    expect(() =>
      assessExploration([grant, { ...grant, id: "grant-2", ceilingMicros: -1 }], [], estimate, "web_search_exa"),
    ).toThrow("Invalid accounting record");
    expect(() => assessExploration([grant, grant], [], estimate, "web_search_exa")).toThrow(
      "Duplicate accounting identity",
    );
  });
});

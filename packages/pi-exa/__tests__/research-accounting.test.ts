import { describe, expect, it } from "vitest";
import { assessExploration, estimateExploration } from "../extensions/research-accounting.js";

describe("exploratory accounting policy", () => {
  const identity = { cycleId: "cycle", projectId: "project" };
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
    expect(assessExploration([], [], estimate, "web_search_exa", identity)).toMatchObject({
      canDispatch: false,
      reason: "APPROVAL_REQUIRED",
      reportedDollars: 0,
      billingVerified: false,
    });
  });

  it.each([
    [
      "web_fetch_exa",
      { urls: ["https://a.test", "https://b.test"], highlights: true, summary: { query: "why" } },
      0.006,
    ],
    ["web_search_advanced_exa", { query: "q", type: "deep", numResults: 15, enableSummary: true }, 0.032],
    ["web_search_advanced_exa", { query: "q", type: "deep-reasoning", numResults: 5 }, 0.015],
  ])("uses the published per-request and per-content basis for %s", (tool, args, dollars) => {
    expect(estimateExploration(tool, args)).toMatchObject({
      dollars,
      basis: expect.stringContaining("exa-published-2026-03-03-v1"),
    });
  });

  it.each([
    ["web_search_exa", { query: "q", contact: true }],
    ["web_search_advanced_exa", { query: "q", type: "deep-lite" }],
    ["web_search_advanced_exa", { query: "q", type: "deep", subpages: 2 }],
    ["web_search_advanced_exa", { query: "q", type: "deep", additionalQueries: ["extra"] }],
    ["web_search_advanced_exa", { query: "q", contextMaxCharacters: 2000 }],
  ])("requires exact-request uncertainty permission for unsupported extras/modes in %s", (tool, args) => {
    expect(estimateExploration(tool, args).dollars).toBeNull();
  });

  it("counts explicitly approved uncertainty only for the exact named liability", () => {
    const operation = {
      kind: "exa-exploration-v1",
      id: "unknown",
      cycleId: "cycle",
      revision: 0,
      tool: "web_search_exa",
      requestHash: "a".repeat(64),
      estimateMicros: 1,
      basis: "not a bound",
      status: "unknown",
      createdAt: "now",
    };
    const permission = {
      kind: "exa-uncertainty-v1",
      id: "permission",
      cycleId: "cycle",
      projectId: "project",
      issuerSessionId: "operator",
      source: "command",
      issuedAt: "now",
      targetType: "liability",
      subjectId: "unknown",
      allowanceMicros: 2_000,
    };
    expect(
      assessExploration(
        [grant, permission],
        [operation],
        estimateExploration("web_search_exa", {}),
        "web_search_exa",
        identity,
      ),
    ).toMatchObject({
      canDispatch: true,
      assessedUnknownDollars: 0.002,
      unresolvedOperationIds: ["unknown"],
    });
    expect(
      assessExploration(
        [grant, permission],
        [{ ...operation, id: "different" }],
        estimateExploration("web_search_exa", {}),
        "web_search_exa",
        identity,
      ),
    ).toMatchObject({ canDispatch: false, reason: "UNKNOWN_LIABILITY" });
    expect(
      assessExploration(
        [grant, permission],
        [{ ...operation, status: "reported", reportedMicros: 1_000, conflictingMicros: [2_000] }],
        estimateExploration("web_search_exa", {}),
        "web_search_exa",
        identity,
      ),
    ).toMatchObject({ canDispatch: false, reason: "UNKNOWN_LIABILITY" });
  });

  it("consumes request uncertainty permission once without changing a different request's eligibility", () => {
    const requestHash = "a".repeat(64);
    const permission = {
      kind: "exa-uncertainty-v1",
      id: "request-permission",
      cycleId: "cycle",
      projectId: "project",
      issuerSessionId: "operator",
      source: "command",
      issuedAt: "now",
      targetType: "request",
      subjectId: requestHash,
      allowanceMicros: 5_000,
    };
    const scoped = { ...grant, tools: ["web_answer_exa"] };
    const estimate = estimateExploration("web_answer_exa", { query: "question" });
    expect(
      assessExploration([scoped, permission], [], estimate, "web_answer_exa", identity, requestHash),
    ).toMatchObject({ canDispatch: true, proposedDollars: 0.005, requestPermissionId: permission.id });
    expect(
      assessExploration([scoped, permission], [], estimate, "web_answer_exa", identity, "b".repeat(64)),
    ).toMatchObject({ canDispatch: false, reason: "UNCERTAINTY_APPROVAL_REQUIRED" });
    const consumed = {
      kind: "exa-exploration-v1",
      id: "operation",
      cycleId: "cycle",
      revision: 0,
      tool: "web_answer_exa",
      requestHash,
      estimateMicros: 5_000,
      basis: "operator assessed",
      requestPermissionId: permission.id,
      status: "reported",
      reportedMicros: 0,
      createdAt: "now",
    };
    expect(
      assessExploration([scoped, permission], [consumed], estimate, "web_answer_exa", identity, requestHash),
    ).toMatchObject({ canDispatch: false, reason: "UNCERTAINTY_APPROVAL_REQUIRED" });
    expect(
      assessExploration(
        [scoped, { ...permission, id: "superseded" }, permission],
        [consumed],
        estimate,
        "web_answer_exa",
        identity,
        requestHash,
      ),
    ).toMatchObject({ canDispatch: false, reason: "UNCERTAINTY_APPROVAL_REQUIRED" });
  });

  it("uses the latest total ceiling rather than summing repeated approvals", () => {
    const estimate = estimateExploration("web_search_exa", {});
    expect(
      assessExploration([grant, { ...grant, id: "grant-2" }], [], estimate, "web_search_exa", identity),
    ).toMatchObject({
      canDispatch: true,
      ceilingDollars: 0.01,
      proposedDollars: 0.007,
    });
    expect(
      assessExploration(
        [grant, { ...grant, id: "grant-2", ceilingMicros: 6_000 }],
        [],
        estimate,
        "web_search_exa",
        identity,
      ),
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
    expect(assessExploration([grant], [operation], estimate, "web_search_exa", identity)).toMatchObject({
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
        identity,
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
      assessExploration([grant], [unknown], estimateExploration("web_search_exa", {}), "web_search_exa", identity),
    ).toMatchObject({ canDispatch: false, reason: "UNKNOWN_LIABILITY", unresolvedOperationIds: ["unknown-1"] });
  });

  it("counts retained reported usage even in an already-restored unknown operation", () => {
    const restored = {
      kind: "exa-exploration-v1",
      id: "restored-1",
      cycleId: "cycle",
      revision: 0,
      tool: "web_search_exa",
      requestHash: "c".repeat(64),
      estimateMicros: 7_000,
      reportedMicros: 2_000,
      basis: "fixture",
      status: "unknown",
      createdAt: "2026-10-10T00:00:00Z",
    };
    expect(
      assessExploration([grant], [restored], estimateExploration("web_search_exa", {}), "web_search_exa", identity),
    ).toMatchObject({ reportedDollars: 0.002, canDispatch: false, reason: "UNKNOWN_LIABILITY" });
  });

  it("rejects malformed or duplicate recognized grants rather than falling back to an older approval", () => {
    const estimate = estimateExploration("web_search_exa", {});
    expect(() =>
      assessExploration(
        [grant, { ...grant, id: "grant-2", ceilingMicros: -1 }],
        [],
        estimate,
        "web_search_exa",
        identity,
      ),
    ).toThrow("Invalid accounting record");
    expect(() => assessExploration([grant, grant], [], estimate, "web_search_exa", identity)).toThrow(
      "Duplicate accounting identity",
    );
  });
});

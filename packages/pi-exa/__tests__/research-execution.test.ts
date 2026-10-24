import { expect, it } from "vitest";
import type { EvidenceProvenance } from "../extensions/research-evidence.js";
import { agentRequestHash, assessAgent, curateAgentRun } from "../extensions/research-execution.js";

const identity = { cycleId: "cycle", projectId: "project" };
const grant = {
  kind: "exa-grant-v1",
  id: "grant",
  ...identity,
  issuerSessionId: "operator",
  source: "command",
  issuedAt: "2026-10-11",
  ceilingMicros: 2_000_000,
  tools: ["web_research_exa"],
};
const request = { query: "Research contacts", effort: "medium", outputSchema: { type: "object" } };
const permission = {
  kind: "exa-uncertainty-v1",
  id: "permission",
  ...identity,
  issuerSessionId: "operator",
  source: "command",
  issuedAt: "2026-10-11",
  targetType: "request",
  subjectId: "",
  allowanceMicros: 300_000,
};

it("requires a scoped exact Agent request assessment even when the fixed base price fits a generic grant", () => {
  expect(assessAgent([grant], [], request, identity)).toMatchObject({
    canDispatch: false,
    reason: "UNCERTAINTY_APPROVAL_REQUIRED",
    fixedBaseDollars: 0.1,
  });
  const approved = { ...permission, subjectId: agentRequestHash(request) };
  expect(assessAgent([grant, approved], [], request, identity)).toMatchObject({
    canDispatch: true,
    proposedMicros: 300_000,
    requestPermissionId: "permission",
    fixedBaseDollars: 0.1,
  });
  expect(assessAgent([grant, approved], [], { ...request, effort: "high" }, identity)).toMatchObject({
    canDispatch: false,
    reason: "UNCERTAINTY_APPROVAL_REQUIRED",
  });
});

it("does not permit an assessment below the known fixed price or reuse a consumed exact request permission", () => {
  const approved = { ...permission, subjectId: agentRequestHash(request), allowanceMicros: 90_000 };
  expect(assessAgent([grant, approved], [], request, identity)).toMatchObject({
    canDispatch: false,
    fixedBaseDollars: 0.1,
  });
  const adequate = { ...approved, allowanceMicros: 300_000 };
  const ledger = [
    {
      kind: "exa-exploration-v1",
      id: "operation",
      cycleId: identity.cycleId,
      revision: 1,
      tool: "web_research_exa",
      requestHash: adequate.subjectId,
      estimateMicros: 300_000,
      basis: "Operator assessed exact request",
      requestPermissionId: adequate.id,
      status: "reported",
      reportedMicros: 100_000,
      createdAt: "2026-10-11",
    },
  ];
  expect(assessAgent([grant, adequate], ledger, request, identity)).toMatchObject({
    canDispatch: false,
    reason: "UNCERTAINTY_APPROVAL_REQUIRED",
    reportedDollars: 0.1,
  });
  expect(assessAgent([{ ...grant, tools: ["web_search_exa"] }, adequate], [], request, identity)).toMatchObject({
    canDispatch: false,
    reason: "SCOPE_APPROVAL_REQUIRED",
  });
});

it.each([null, { answer: 7 }, { answer: "valid", extra: "unrequested" }])(
  "classifies remote completed invalid output %j as local failure, never remote failure",
  (output) => {
    const provenance: EvidenceProvenance = {
      operationId: "operation",
      revision: 1,
      requestHash: "a".repeat(64),
      tool: "web_research_exa",
      retrievedAt: "2026-10-11",
    };
    const result = curateAgentRun(
      {
        id: "agent_run_one",
        status: "completed",
        costDollars: { total: 0 },
        output: { structured: output, text: "unvalidated output" },
      },
      { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false },
      provenance,
    );
    expect(result).toMatchObject({
      remoteStatus: "completed",
      terminal: true,
      processing: "failed",
      totalDollars: 0,
      diagnostics: ["INVALID_TASK_OUTPUT: recover and validate the existing run; never submit a replacement."],
    });
    expect(result.taskOutput).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("unvalidated");
  },
);

it("keeps pending costs provisional and filters usage to requested provider metadata", () => {
  const provenance: EvidenceProvenance = {
    operationId: "operation",
    revision: 1,
    requestHash: "a".repeat(64),
    tool: "web_research_exa",
    retrievedAt: "2026-10-11",
  };
  const result = curateAgentRun(
    {
      id: "agent_run_one",
      status: "running",
      costDollars: { total: 0.02 },
      usage: { searches: 3, emails: -1, phoneNumbers: "2", dataSources: { fiber: 4, unrequested: 8 } },
      output: { structured: { answer: "provisional" } },
    },
    { type: "object" },
    provenance,
    ["fiber"],
  );
  expect(result).toMatchObject({
    terminal: false,
    processing: "pending",
    provisionalTotalDollars: 0.02,
    usage: { searches: 3, dataSources: { fiber: 4 } },
  });
  expect(result.usage.emails).toBeUndefined();
  expect(result.usage.phoneNumbers).toBeUndefined();
  expect(result.totalDollars).toBeUndefined();
  expect(result.taskOutput).toBeUndefined();
});

it.each(["failed", "cancelled"])(
  "retains a closed remote diagnostic for %s without copying arbitrary error prose or credentials",
  (status) => {
    const provenance: EvidenceProvenance = {
      operationId: "operation",
      revision: 1,
      requestHash: "a".repeat(64),
      tool: "web_research_exa",
      retrievedAt: "2026-10-11",
    };
    const result = curateAgentRun(
      {
        id: "agent_run_error",
        status,
        costDollars: { total: 0.01 },
        error: {
          code: "INVALID_REQUEST",
          message: "secret credential and private excerpt",
          path: "https://example.com/?sig=credential",
          actual: { apiKey: "secret" },
        },
      },
      { type: "object" },
      provenance,
    );
    expect(result).toMatchObject({
      remoteStatus: status,
      processing: "not-applicable",
      totalDollars: 0.01,
      remoteError: { kind: "exa-reported-error", category: "invalid-request", code: "INVALID_REQUEST" },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|credential|private excerpt|sig=/);
    expect(
      curateAgentRun(
        {
          id: "agent_run_error",
          status,
          error: { code: "secret-opaque-code", message: "secret" },
        },
        { type: "object" },
        provenance,
      ),
    ).toMatchObject({
      remoteError: { category: "unknown" },
    });
  },
);

it("retains only validated task output and curated credential-free grounding, never the full SDK response", () => {
  const raw = {
    id: "agent_run_one",
    status: "completed",
    stopReason: "schema_satisfied",
    request: { apiKey: "secret" },
    credential: "secret",
    costDollars: { total: 0.1, agentCompute: 0.1, secret: "secret" },
    usage: { searches: 2, secret: "secret" },
    output: {
      text: "unrequested generated prose",
      structured: { answer: "result" },
      grounding: [
        {
          field: "answer",
          confidence: "high",
          citations: [
            { url: "https://example.com/read#section", title: "Read", text: "private excerpt" },
            { url: "https://example.com/signed?sig=credential", title: "Signed" },
          ],
        },
      ],
    },
  };
  const provenance: EvidenceProvenance = {
    operationId: "operation",
    revision: 1,
    requestHash: "a".repeat(64),
    tool: "web_research_exa",
    retrievedAt: "2026-10-11",
  };
  const result = curateAgentRun(
    raw,
    { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false },
    provenance,
  );
  expect(result).toMatchObject({
    remoteId: "agent_run_one",
    remoteStatus: "completed",
    terminal: true,
    processing: "validated",
    taskOutput: { answer: "result" },
    totalDollars: 0.1,
    usage: { searches: 2 },
    grounding: [
      { field: "answer", confidence: "high", citations: [{ url: "https://example.com/read", title: "Read" }] },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(/secret|credential|private excerpt|unrequested/);
  raw.output.structured.answer = "mutated";
  expect(result.taskOutput).toEqual({ answer: "result" });
});

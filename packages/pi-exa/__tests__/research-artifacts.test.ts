import type { CreateAgentRunParams } from "exa-js";
import { describe, expect, it } from "vitest";
import { compileResearchArtifact, taskSchemaValidator } from "../extensions/research-artifacts.js";
import type { ResearchCycle } from "../extensions/research-cycles.js";
import { createResearchPlanner } from "../extensions/research-planner.js";

function cycle(): ResearchCycle {
  return {
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "project",
    revision: 2,
    status: "planning",
    archived: false,
    plan: { ...createResearchPlanner().snapshot(), topic: "Pricing" },
    attempts: [],
    ledger: [],
    grants: [],
  };
}

describe("research request artifact compiler", () => {
  it("compiles explicit auto caps, providers and continuation without granting spending", () => {
    const record = cycle();
    record.executionPlan = {
      goal: "Research",
      taskSchema: { type: "object" },
      controls: { effort: "auto", budget: { maxCostDollars: 3 }, dataSources: [{ provider: "baselayer" }] },
      previousRunId: "remote-completed",
      input: { data: [{ name: "A" }] },
    };
    const artifact = compileResearchArtifact(record);
    const sdkRequest: CreateAgentRunParams = artifact.request;
    expect(sdkRequest).toMatchObject({
      effort: "auto",
      budget: { maxCostDollars: 3 },
      dataSources: [{ provider: "baselayer" }],
      previousRunId: "remote-completed",
      metadata: { cycleId: record.id, revision: "2" },
    });
    expect(artifact).toMatchObject({
      executionControls: { effort: "auto", budget: { maxCostDollars: 3 } },
      continuation: { previousRunId: "remote-completed" },
      outputContract: { dialect: "draft-07" },
    });
    expect(record.grants).toEqual([]);
    record.executionPlan.controls = { ...record.executionPlan.controls, effort: "high" };
    expect(() => compileResearchArtifact(record)).toThrow("INVALID_BUDGET");
  });

  it.each([
    { type: "array" },
    { type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" },
    { type: "object", properties: { a: { $ref: "https://external.invalid/schema" } } },
    { type: "object", $async: true },
    { type: "object", properties: { a: { pattern: "[" } } },
  ])("fails closed on unsupported or invalid schemas (%j)", (taskSchema) => {
    const record = cycle();
    record.executionPlan = { goal: "Research", taskSchema };
    expect(() => compileResearchArtifact(record)).toThrow("INVALID_TASK_SCHEMA");
  });

  it("validates draft-07 results, local refs and standard formats without Deep Search property limits", () => {
    const taskSchema = {
      type: "object",
      properties: {
        ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`extra${index}`, { type: "string" }])),
        citation: { $ref: "#/definitions/Citation" },
      },
      definitions: { Citation: { type: "string", format: "uri" } },
      required: ["citation"],
      additionalProperties: false,
    };
    const validate = taskSchemaValidator(taskSchema);
    expect(validate({ citation: "https://example.com" })).toBe(true);
    expect(validate({ citation: "not a URI" })).toBe(false);
    expect(validate({})).toBe(false);
    const record = cycle();
    record.executionPlan = { goal: "Research", taskSchema };
    expect(compileResearchArtifact(record).request.outputSchema).toEqual(taskSchema);
  });

  it.each(["completed", "running", "unknown"] as const)(
    "cannot compile %s cycles into executable requests",
    (status) => {
      const record = cycle();
      record.status = status;
      record.executionPlan = { goal: "Research", taskSchema: { type: "object" } };
      expect(() => compileResearchArtifact(record)).toThrow("CYCLE_NOT_EXECUTABLE");
    },
  );

  it("rejects non-JSON row values and keeps caller mutations outside authoritative state", () => {
    const record = cycle();
    record.executionPlan = {
      goal: "Research",
      taskSchema: { type: "object" },
      input: { data: [{ created: new Date(0) }] },
    };
    expect(() => compileResearchArtifact(record)).toThrow("INVALID_JSON");
    record.executionPlan.input = { data: [{ company: "A" }] };
    const artifact = compileResearchArtifact(record);
    const row = artifact.request.input?.data?.[0];
    if (!row) throw new Error("Missing row");
    Object.assign(row, { company: "CHANGED" });
    expect(record.executionPlan.input.data).toEqual([{ company: "A" }]);
  });

  it("canonicalizes object keys but rejects stale references and conflicting execution fields", () => {
    const record = cycle();
    record.executionPlan = {
      goal: "Research",
      taskSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } },
      input: { data: [{ a: 1, b: 2 }] },
    };
    const first = compileResearchArtifact(record);
    record.executionPlan.taskSchema = {
      properties: { b: { type: "number" }, a: { type: "string" } },
      type: "object",
    };
    record.executionPlan.input = { data: [{ b: 2, a: 1 }] };
    expect(compileResearchArtifact(record).hash).toBe(first.hash);
    expect(
      compileResearchArtifact(record, {
        cycleId: record.id,
        expectedRevision: 2,
        artifactHash: first.hash,
        executionFields: { input: { data: [{ b: 2, a: 1 }] }, effort: "medium" },
      }).hash,
    ).toBe(first.hash);
    expect(() => compileResearchArtifact(record, { expectedRevision: 1 })).toThrow("STALE_REVISION");
    expect(() => compileResearchArtifact(record, { artifactHash: "stale" })).toThrow("STALE_ARTIFACT");
    expect(() => compileResearchArtifact(record, { executionFields: { effort: "high" } })).toThrow(
      "EXECUTION_CONFLICT",
    );
    expect(record.executionPlan.controls).toBeUndefined();
  });

  it("keeps selected evidence separate from processing rows and excludes other candidates", () => {
    const record = cycle();
    record.plan.sources = [
      {
        id: "S1",
        title: "Official pricing",
        url: "https://example.com/pricing",
        sourceType: "official_doc",
        retrievalStatus: "fetched",
        retrievalEvidence: "web_fetch_exa:call-one",
        contentNotes: "Observed official prices",
        usedFor: ["C1"],
        inspectionIssues: [],
      },
      {
        id: "S2",
        title: "Unselected",
        sourceType: "blog",
        retrievalStatus: "discovered_only",
        contentNotes: "UNSELECTED_PRIVATE_NOTES",
        usedFor: [],
        inspectionIssues: [],
      },
    ];
    record.plan.nextSourceId = 3;
    record.plan.assumptions = ["Taxes may vary"];
    record.executionPlan = {
      goal: "Compare prices",
      selectedEvidence: [{ sourceId: "S1", label: "Official evidence", notes: "Use the current pricing table" }],
      input: { data: [{ company: "A" }], exclusion: [{ company: "B" }] },
      controls: { effort: "high" },
      taskSchema: { type: "object", properties: { answer: { type: "string" } } },
    };
    const artifact = compileResearchArtifact(record);
    expect(artifact.request.input).toEqual({ data: [{ company: "A" }], exclusion: [{ company: "B" }] });
    expect(artifact.selectedEvidence).toMatchObject([
      {
        sourceId: "S1",
        label: "Official evidence",
        retrievalEvidence: "web_fetch_exa:call-one",
        notes: "Use the current pricing table",
      },
    ]);
    expect(artifact.request.effort).toBe("high");
    expect(artifact.request.query).toContain("Official evidence");
    expect(artifact.request.query).toContain("assumption");
    expect(artifact.request.systemPrompt).toContain("untrusted");
    expect(JSON.stringify(artifact)).not.toContain("UNSELECTED_PRIVATE_NOTES");
    expect(artifact.request).not.toHaveProperty("sourcePack");
  });

  it("rejects invalid task schemas before generating a request", () => {
    const record = cycle();
    record.executionPlan = {
      goal: "Research",
      taskSchema: { type: "object", properties: { answer: { type: "not-a-json-schema-type" } } },
    };
    expect(() => compileResearchArtifact(record)).toThrow("task schema");
  });

  it("previews a versioned structured request with no planning chatter", () => {
    const record = cycle();
    record.executionPlan = {
      goal: "Compare current official prices",
      scope: ["US"],
      constraints: ["Use official evidence"],
      taskSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    };
    const artifact = compileResearchArtifact(record);
    expect(artifact).toMatchObject({
      artifactVersion: 1,
      cycleId: record.id,
      revision: 2,
      brief: {
        topic: "Pricing",
        goal: "Compare current official prices",
        scope: ["US"],
        constraints: ["Use official evidence"],
      },
      request: { effort: "medium", outputSchema: record.executionPlan.taskSchema },
    });
    expect(artifact.request.query).toContain("Compare current official prices");
    expect(artifact.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(artifact)).not.toContain("owner");
  });
});

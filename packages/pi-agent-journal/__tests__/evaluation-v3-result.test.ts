import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const result = JSON.parse(readFileSync("docs/evaluations/agent-work-journal-v3-results.json", "utf8"));

describe("Agent Journal V3 terminal infrastructure result", () => {
  it("fails before held-out selection without claiming a product outcome", () => {
    expect(result).toMatchObject({
      schemaVersion: 3,
      status: "FAIL",
      failureStage: "infrastructure-acceptance",
      releaseAuthorized: false,
      productOutcome: "not-adjudicated",
      concreteTasksSelected: false,
      infrastructureAccepted: false,
      gateEvaluated: false,
      validTraceCount: 0,
      terminalDecision: "stop-before-held-out-selection",
    });
    expect(result.selectedTaskIds).toEqual([]);
    expect(result.runIds).toEqual([]);
    expect(result.scenarioMedians).toBeNull();
  });

  it("records the real-preflight and independent-review blockers", () => {
    expect(result.blockers).toEqual([
      "real_two_condition_two_phase_capsule_only_provenance_not_proven",
      "byte_complete_independent_quarantine_not_accepted",
      "sandbox_and_attempt_provenance_not_accepted",
      "raw_to_derived_scorer_chain_not_accepted",
    ]);
    expect(result.completedUnits).toEqual(["v3_contract", "material_file_observation"]);
    expect(result.repositorySnapshot).toBe("f33ed7cbfddbeee0251bab0b56f33c8af1ccf830");
    expect(result.preTaskManifest).toEqual({
      digest: createHash("sha256")
        .update(readFileSync("docs/evaluations/agent-work-journal-v3-infrastructure-manifest.json"))
        .digest("hex"),
      taskIds: [],
      promptDigests: [],
    });
  });

  it("contains no private or held-out material and records cleanup", () => {
    const encoded = JSON.stringify(result);
    expect(encoded).not.toMatch(/rawPrompt|phaseA|phaseB|toolArguments|toolResults|credential/i);
    const strings: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(result);
    expect(strings.some((value) => /^\/(?!\/)|^[A-Za-z]:[\\/]/.test(value))).toBe(false);
    expect(result.privateEvidenceCleanup).toEqual({
      syntheticWorktreesDeleted: true,
      syntheticSessionsAndTracesDeleted: true,
      heldOutEvidenceCreated: false,
    });
  });
});

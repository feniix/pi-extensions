import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateV2ReleaseGate } from "../extensions/evaluation-v2.js";

const path = "docs/evaluations/agent-work-journal-v2-results.json";
const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("Agent Journal V2 U6 terminal result", () => {
  it("records the one-shot selection-integrity failure without claiming a product gate", () => {
    expect(result).toMatchObject({
      schemaVersion: 2,
      sourceEvaluationVersion: 2,
      evaluationUnit: "Agent Journal V2 U6",
      status: "FAIL",
      releaseAuthorized: false,
      gateEvaluated: false,
      failureStage: "pretrial-selection-integrity",
      failureCode: "missing-frozen-mutator-template",
      productOutcome: "not-adjudicated",
      repositorySnapshot: "9a1184ce9ca3389f3e1565a81b126149bad6bc4c",
      taskSetDigest: "b76ab2589d90e8b6a5194be37cc1e28badf4bb2d232317c06296d0820fa7604a",
      terminalDecision: "stop-without-post-hoc-task-alteration",
    });
    expect(result).not.toHaveProperty("passed");
    expect(result).not.toHaveProperty("scenarios");
    expect(result.gateClauses).toEqual({
      taskCorrectness: "NOT_EVALUATED",
      repositoryReadParity: "NOT_EVALUATED",
      ownerMaintenance: "NOT_EVALUATED",
      materialSafety: "NOT_EVALUATED",
      noRestatementParity: "NOT_EVALUATED",
      evidenceIntegrity: "FAIL",
    });
    expect(result.scenarioMedians).toBeNull();
    expect(() => evaluateV2ReleaseGate([])).toThrow();
  });

  it("preserves only safe task identities and digests", () => {
    expect(result.selectedTasks).toEqual([
      {
        taskId: "6f3a9c2d4e7186b0",
        category: "automated-multi-file-continuation",
        promptDigest: "7770ab419f7420ca40618cc32bd0b9e1907b2c2ba28c10602ef7d8e72b978597",
        rubricDigest: "2bfe6a01b207978bd6a2fa896e9743ffdf0125bb72e249de79114c72109337a2",
        fixtureDigest: "7dfc4b1ff84a5328c34b993cfd597eb997fb45567857b1f332dac98b6938baad",
      },
      {
        taskId: "b814e7053ac962fd",
        category: "material-dependency-revalidation",
        promptDigest: "63a205ca67c03407edbde00fad6cd4d13ab26204330e7e1442dac43458c8d744",
        rubricDigest: "b4d0a0cfb526382d7f490db63aa2d1bf5b473c1d2eadf94d735f2d1d947d7819",
        fixtureDigest: "f3df4e1b8096e1dba4face8235ec7bd9895f911ebf114e5f33ab7837f4cafc08",
      },
      {
        taskId: "d0274fb19e63a852",
        category: "append-only-conflict-resolution",
        promptDigest: "0630c2398835ad10b0034364233600ccf3bf236dca0a2697ea7966616953bff6",
        rubricDigest: "c91e19aeb8f8212e1ffa42671cf59bf702eb12f9ed087c0901eff3fe7110618a",
        fixtureDigest: "5e0659b298c518bc5b594eaf9f1cd17178d8a4894d2d378c188de516a1c24b2a",
      },
    ]);
    const encoded = JSON.stringify(result);
    expect(encoded).not.toMatch(/rawPrompt|phaseA|phaseB|toolArguments|toolResults|credential|controlSequence/);
    const strings: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(result);
    expect(strings.some((value) => /^\/(?!\/)|^[A-Za-z]:[\\/]/.test(value))).toBe(false);
  });

  it("marks every attempted run invalid and every valid trial count zero", () => {
    expect(result.validTrialCounts).toEqual({
      "automated-multi-file-continuation": { baseline: 0, journal: 0 },
      "material-dependency-revalidation": { baseline: 0, journal: 0 },
      "append-only-conflict-resolution": { baseline: 0, journal: 0 },
    });
    expect(result.excludedAttemptRunIds).toEqual([
      "base-7ea175471e5122cd",
      "base-8ded0d175f6737fe",
      "jrnl-e9d0573a7e6261c6",
      "base-b1f068104d0071de",
      "jrnl-3562e0b3fe1086e5",
    ]);
    expect(result.excludedAttemptReasons).toEqual([
      "smoke-only",
      "non-CLI execution",
      "frozen 8000-token budget was not enforced",
      "minimum repeated-trace count was incomplete",
      "canonical V2 harness provenance was absent",
    ]);
    expect(result.invalidTask).toMatchObject({
      taskId: "d0274fb19e63a852",
      category: "append-only-conflict-resolution",
      fixtureDigest: "5e0659b298c518bc5b594eaf9f1cd17178d8a4894d2d378c188de516a1c24b2a",
    });
    expect(result.privateEvidenceCleanup).toEqual({
      rawTraceDigestsVerified: true,
      privateTrialDirectoriesDeleted: true,
      privateSelectionDeleted: true,
    });
  });
});

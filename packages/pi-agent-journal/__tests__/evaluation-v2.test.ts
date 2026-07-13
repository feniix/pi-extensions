import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeV2DerivedTraceDigest,
  computeV2HarnessReceiptDigest,
  computeV2ParityDigest,
  evaluateV2ReleaseGate,
  V2_EVALUATION_CATEGORIES,
  V2_OWNER_PROTOCOL_DIGEST,
  V2_READ_TOLERANCE,
  type V2EvaluationScenario,
  type V2RunTrace,
  V2ValidationError,
  validateV2InfrastructureManifest,
} from "../extensions/evaluation-v2.js";

function trace(prefix: string, index: number, overrides: Partial<V2RunTrace> = {}): V2RunTrace {
  const value: V2RunTrace = {
    schemaVersion: 2,
    sourceEvaluationVersion: 2,
    runId: `${prefix}-${index}`,
    taskId: `task-${prefix.split("-")[0]}`,
    taskScore: 10,
    repositoryReads: 4,
    resumedWithoutRestatement: true,
    materialTaskCorrect: true,
    interventions: [],
    materialCases: [],
    provenance: {
      normalizerVersion: 2,
      normalizerDigest: "a".repeat(64),
      derivedDigest: "",
      harnessReceipt: {
        schemaVersion: 2,
        runId: `${prefix}-${index}`,
        taskId: `task-${prefix.split("-")[0]}`,
        parityDigest: "",
        workspaceReceiptDigest: "b".repeat(64),
        normalizerDigest: "a".repeat(64),
        derivedDigest: "",
        materialCaseIds: [],
      },
      harnessReceiptDigest: "",
    },
    ...overrides,
  };
  value.provenance.derivedDigest = computeV2DerivedTraceDigest(value);
  value.provenance.harnessReceipt = {
    ...value.provenance.harnessReceipt,
    runId: value.runId,
    taskId: value.taskId,
    parityDigest: computeV2ParityDigest(parity),
    normalizerDigest: value.provenance.normalizerDigest,
    derivedDigest: value.provenance.derivedDigest,
    materialCaseIds: value.materialCases.map((item) => item.id),
  };
  value.provenance.harnessReceiptDigest = computeV2HarnessReceiptDigest(value.provenance.harnessReceipt);
  return value;
}

const parity = {
  repositorySnapshot: "rev-1",
  promptDigest: "d".repeat(64),
  rubricDigest: "c".repeat(64),
  model: "openai-codex/gpt-5.6-sol",
  reasoning: "high",
  contextBudget: 8000,
  resumeBudget: 4000,
  pausePoint: "pause-1",
  ownerProtocolDigest: V2_OWNER_PROTOCOL_DIGEST,
};

function scenario(category: (typeof V2_EVALUATION_CATEGORIES)[number], index: number): V2EvaluationScenario {
  const taskId = `task-${index}`;
  return {
    schemaVersion: 2,
    category,
    taskId,
    selectedAfterInfrastructureFreeze: true,
    exposedDuringImplementation: false,
    baselineParity: { ...parity },
    journalParity: { ...parity },
    expectedMaterialCaseIds: index === 0 ? [] : [`case-${index}`],
    baselineTraces: [1, 2, 3].map((run) =>
      trace(`${index}-baseline`, run, {
        taskId,
        repositoryReads: 5,
        interventions: [{ id: `${index}-b-${run}`, kind: "status_refresh", sequence: 1 }],
      }),
    ),
    journalTraces: [1, 2, 3].map((run) =>
      trace(`${index}-journal`, run, {
        taskId,
        interventions: index === 0 ? [] : [{ id: `${index}-s-${run}`, kind: "material_stale_resolution", sequence: 1 }],
        materialCases:
          index === 0
            ? []
            : [
                {
                  id: `case-${index}`,
                  detectedBeforeContinuation: true,
                  resolvedAppendOnly: true,
                  falsePositive: false,
                },
              ],
      }),
    ),
  };
}

const passing = () => V2_EVALUATION_CATEGORIES.map(scenario);

function reseal(values: V2EvaluationScenario[]): void {
  for (const scenarioValue of values) {
    for (const traceValue of [...scenarioValue.baselineTraces, ...scenarioValue.journalTraces]) {
      traceValue.provenance.derivedDigest = computeV2DerivedTraceDigest(traceValue);
      traceValue.provenance.harnessReceipt = {
        ...traceValue.provenance.harnessReceipt,
        derivedDigest: traceValue.provenance.derivedDigest,
        materialCaseIds: traceValue.materialCases.map((item) => item.id),
      };
      traceValue.provenance.harnessReceiptDigest = computeV2HarnessReceiptDigest(traceValue.provenance.harnessReceipt);
    }
  }
}

const infrastructureManifest = () => ({
  schemaVersion: 2 as const,
  status: "pending-independent-review" as const,
  concreteTasksSelected: false,
  taskIds: [] as string[],
  prompts: [] as string[],
  categories: [...V2_EVALUATION_CATEGORIES],
  readTolerance: 1,
  minimumRunsPerCondition: 3,
  model: "openai-codex/gpt-5.6-sol",
  reasoning: "high",
  contextBudget: 8000,
  resumeBudget: 4000,
  pauseSemantics: "phase A settles and exits before phase B starts in a fresh process",
  rubricPolicy:
    "scenario-specific SHA-256 rubric digest fixed at task selection before trials and shared across conditions",
  ownerProtocol: {
    sameForBothConditions: true,
    baselineActions: ["status_create", "status_refresh", "status_correction"],
    requiredFields: [
      "objective",
      "current_status",
      "settled_decisions",
      "evidence",
      "open_questions",
      "next_action",
      "material_dependencies",
    ],
    maxBytes: 4000,
    digest: V2_OWNER_PROTOCOL_DIGEST,
  },
  interventionTaxonomy: {
    avoidable: [
      "status_create",
      "status_refresh",
      "status_correction",
      "known_context_clarification",
      "resume_restatement",
    ],
    necessarySafety: [
      "material_stale_resolution",
      "material_conflict_resolution",
      "binding_ambiguity_resolution",
      "credential_exclusion_resolution",
    ],
  },
  materialSafety: { detectionBeforeContinuationRequired: true, appendOnlyResolutionRequired: true },
  provenance: {
    rawToDerivedRequired: true,
    parityReceiptRequired: true,
    canonicalHarnessReceiptRequired: true,
    privateRawTraceRetainedUntilIndependentRecomputation: true,
  },
  rawTracePolicy: "private-ephemeral-delete-after-independent-recomputation",
  privacy: { rawPromptsCommitted: false, rawToolBytesCommitted: false, absolutePathsCommitted: false },
});

describe("V2 automated trustworthy status gate", () => {
  it("freezes categories and the absolute read non-inferiority tolerance", () => {
    expect(V2_EVALUATION_CATEGORIES).toEqual([
      "automated-multi-file-continuation",
      "material-dependency-revalidation",
      "append-only-conflict-resolution",
    ]);
    expect(V2_READ_TOLERANCE).toBe(1);
  });

  it("rejects equal conditions that do not use the frozen model, reasoning, and budgets", () => {
    const values = passing();
    for (const scenarioValue of values) {
      scenarioValue.baselineParity.model = "other-model";
      scenarioValue.journalParity.model = "other-model";
    }
    expect(() => evaluateV2ReleaseGate(values)).toThrow(/frozen model|frozen parity/i);
  });

  it("passes only complete derived evidence", () => {
    expect(evaluateV2ReleaseGate(passing())).toMatchObject({
      passed: true,
      maintenanceImprovementScenarios: 3,
      taskCorrectnessPassed: true,
      repositoryReadParityPassed: true,
      materialSafetyPassed: true,
      restatementParityPassed: true,
    });
  });

  it.each([
    ["fewer than three traces", (values: V2EvaluationScenario[]) => values[0].journalTraces.pop()],
    [
      "duplicate run IDs",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[1].runId = values[0].journalTraces[0].runId;
      },
    ],
    [
      "reused run IDs across conditions",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].runId = values[0].baselineTraces[0].runId;
      },
    ],
    [
      "unequal trace counts",
      (values: V2EvaluationScenario[]) =>
        values[0].baselineTraces.push(trace("extra", 4, { taskId: values[0].taskId })),
    ],
    [
      "unequal snapshot",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.repositorySnapshot = "rev-2";
      },
    ],
    [
      "unequal prompt",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.promptDigest = "prompt-2";
      },
    ],
    [
      "unequal model",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.model = "model-2";
      },
    ],
    [
      "unequal reasoning",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.reasoning = "low";
      },
    ],
    [
      "unequal budget",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.contextBudget = 7999;
      },
    ],
    [
      "unequal resume budget",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.resumeBudget = 3999;
      },
    ],
    [
      "unequal pause",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.pausePoint = "other";
      },
    ],
    [
      "unequal owner protocol",
      (values: V2EvaluationScenario[]) => {
        values[0].journalParity.ownerProtocolDigest = "other";
      },
    ],
    [
      "implementation-exposed task",
      (values: V2EvaluationScenario[]) => {
        values[0].exposedDuringImplementation = true;
      },
    ],
    [
      "pre-freeze task",
      (values: V2EvaluationScenario[]) => {
        values[0].selectedAfterInfrastructureFreeze = false;
      },
    ],
    ["precomputed gate", (values: V2EvaluationScenario[]) => Object.assign(values[0], { passed: true })],
    [
      "precomputed count",
      (values: V2EvaluationScenario[]) => Object.assign(values[0], { maintenanceImprovementScenarios: 3 }),
    ],
    [
      "V1 task",
      (values: V2EvaluationScenario[]) => {
        values[0].taskId = "v1-statusline-detached";
        values[0].baselineTraces.forEach((v) => {
          v.taskId = values[0].taskId;
        });
        values[0].journalTraces.forEach((v) => {
          v.taskId = values[0].taskId;
        });
      },
    ],
    [
      "V1 run",
      (values: V2EvaluationScenario[]) => {
        (values[0].journalTraces[0] as unknown as { sourceEvaluationVersion: number }).sourceEvaluationVersion = 1;
      },
    ],
    [
      "unknown intervention",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].interventions = [{ id: "i", kind: "unknown" as never, sequence: 1 }];
      },
    ],
    [
      "negative task score",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].taskScore = -1;
      },
    ],
    [
      "negative reads",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].repositoryReads = -1;
      },
    ],
  ])("rejects invalid evidence: %s", (_name, mutate) => {
    const values = passing();
    mutate(values);
    expect(() => evaluateV2ReleaseGate(values)).toThrow(V2ValidationError);
  });

  it("fails material safety when required planted cases are omitted", () => {
    const values = passing();
    values[1].expectedMaterialCaseIds = ["stale-case"];
    expect(evaluateV2ReleaseGate(values).materialSafetyPassed).toBe(false);
  });

  it("rejects derived evidence changed after normalization", () => {
    const values = passing();
    values[0].journalTraces[0].repositoryReads += 1;
    expect(() => evaluateV2ReleaseGate(values)).toThrow(/derived.*digest|provenance/i);
  });

  it("rejects hand-authored traces without normalizer and harness provenance", () => {
    const values = passing();
    delete (values[0].journalTraces[0] as Partial<V2RunTrace>).provenance;
    expect(() => evaluateV2ReleaseGate(values)).toThrow(/provenance/i);
  });

  it("accepts a frozen independently reviewable pre-task infrastructure manifest", () => {
    const committed = JSON.parse(
      readFileSync("docs/evaluations/agent-work-journal-v2-infrastructure-manifest.json", "utf8"),
    ) as unknown;
    expect(validateV2InfrastructureManifest(committed)).toEqual(
      validateV2InfrastructureManifest(infrastructureManifest()),
    );
    expect(validateV2InfrastructureManifest(infrastructureManifest())).toMatchObject({
      concreteTasksSelected: false,
      readTolerance: 1,
      minimumRunsPerCondition: 3,
    });
  });

  it.each([
    ["task exposure", (manifest: ReturnType<typeof infrastructureManifest>) => manifest.taskIds.push("task")],
    ["prompt exposure", (manifest: ReturnType<typeof infrastructureManifest>) => manifest.prompts.push("prompt")],
    ["post-hoc tolerance", (manifest: ReturnType<typeof infrastructureManifest>) => (manifest.readTolerance = 2)],
    [
      "missing provenance",
      (manifest: ReturnType<typeof infrastructureManifest>) => (manifest.provenance.rawToDerivedRequired = false),
    ],
    [
      "suppressed safety",
      (manifest: ReturnType<typeof infrastructureManifest>) =>
        (manifest.materialSafety.detectionBeforeContinuationRequired = false),
    ],
    [
      "unequal owner protocol",
      (manifest: ReturnType<typeof infrastructureManifest>) => (manifest.ownerProtocol.sameForBothConditions = false),
    ],
  ])("rejects an unfrozen or task-exposing infrastructure manifest: %s", (_label, mutate) => {
    const manifest = infrastructureManifest();
    mutate(manifest);
    expect(() => validateV2InfrastructureManifest(manifest)).toThrow(V2ValidationError);
  });

  it.each([
    [
      "baseline + 2 reads",
      (values: V2EvaluationScenario[]) =>
        values[0].journalTraces.forEach((v) => {
          v.repositoryReads = 7;
        }),
    ],
    [
      "equal maintenance in two scenarios",
      (values: V2EvaluationScenario[]) => {
        values.slice(0, 2).forEach((s) => {
          s.journalTraces.forEach((v, i) => {
            v.interventions = [{ id: `j-${i}`, kind: "status_refresh", sequence: 1 }];
          });
        });
      },
    ],
    [
      "one missed material case",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].materialCases = [
          { id: "m", detectedBeforeContinuation: false, resolvedAppendOnly: true, falsePositive: false },
        ];
      },
    ],
    [
      "task-score regression",
      (values: V2EvaluationScenario[]) =>
        values[0].journalTraces.forEach((v) => {
          v.taskScore = 9;
        }),
    ],
    [
      "material correctness failure",
      (values: V2EvaluationScenario[]) => {
        values[0].journalTraces[0].materialTaskCorrect = false;
      },
    ],
    [
      "worse restatement majority",
      (values: V2EvaluationScenario[]) =>
        values[0].journalTraces.slice(0, 2).forEach((v) => {
          v.resumedWithoutRestatement = false;
        }),
    ],
  ])("fails a single gate dimension: %s", (_name, mutate) => {
    const values = passing();
    mutate(values);
    reseal(values);
    expect(evaluateV2ReleaseGate(values).passed).toBe(false);
  });
});

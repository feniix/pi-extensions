import { createHash } from "node:crypto";

export const V2_EVALUATION_CATEGORIES = [
  "automated-multi-file-continuation",
  "material-dependency-revalidation",
  "append-only-conflict-resolution",
] as const;
export type V2EvaluationCategory = (typeof V2_EVALUATION_CATEGORIES)[number];
export const V2_READ_TOLERANCE = 1;
export const V2_MODEL = "openai-codex/gpt-5.6-sol";
export const V2_REASONING = "high";
export const V2_CONTEXT_BUDGET = 8000;
export const V2_RESUME_BUDGET = 4000;
export const V2_OWNER_STATUS_FIELDS = [
  "objective",
  "current_status",
  "settled_decisions",
  "evidence",
  "open_questions",
  "next_action",
  "material_dependencies",
] as const;
export const V2_BASELINE_ACTIONS = ["status_create", "status_refresh", "status_correction"] as const;
export const V2_OWNER_PROTOCOL_DIGEST = createHash("sha256")
  .update(JSON.stringify({ fields: V2_OWNER_STATUS_FIELDS, actions: V2_BASELINE_ACTIONS, maxBytes: 4000 }))
  .digest("hex");

export const AVOIDABLE_MAINTENANCE_KINDS = [
  "status_create",
  "status_refresh",
  "status_correction",
  "known_context_clarification",
  "resume_restatement",
] as const;
export const NECESSARY_SAFETY_KINDS = [
  "material_stale_resolution",
  "material_conflict_resolution",
  "binding_ambiguity_resolution",
  "credential_exclusion_resolution",
] as const;
export type V2InterventionKind = (typeof AVOIDABLE_MAINTENANCE_KINDS)[number] | (typeof NECESSARY_SAFETY_KINDS)[number];

export interface V2Intervention {
  id: string;
  kind: V2InterventionKind;
  sequence: number;
}

export interface V2MaterialCase {
  id: string;
  detectedBeforeContinuation: boolean;
  resolvedAppendOnly: boolean;
  falsePositive: boolean;
}

export interface V2HarnessTraceReceipt {
  schemaVersion: 2;
  runId: string;
  taskId: string;
  parityDigest: string;
  workspaceReceiptDigest: string;
  normalizerDigest: string;
  derivedDigest: string;
  materialCaseIds: string[];
}

export interface V2TraceProvenance {
  normalizerVersion: 2;
  normalizerDigest: string;
  derivedDigest: string;
  harnessReceipt: V2HarnessTraceReceipt;
  harnessReceiptDigest: string;
}

export interface V2RunTrace {
  schemaVersion: 2;
  sourceEvaluationVersion: 2;
  runId: string;
  taskId: string;
  taskScore: number;
  repositoryReads: number;
  resumedWithoutRestatement: boolean;
  materialTaskCorrect: boolean;
  interventions: V2Intervention[];
  materialCases: V2MaterialCase[];
  provenance: V2TraceProvenance;
}

export interface V2ParityReceipt {
  repositorySnapshot: string;
  promptDigest: string;
  rubricDigest: string;
  model: string;
  reasoning: string;
  contextBudget: number;
  resumeBudget: number;
  pausePoint: string;
  ownerProtocolDigest: string;
}

export interface V2EvaluationScenario {
  schemaVersion: 2;
  category: V2EvaluationCategory;
  taskId: string;
  selectedAfterInfrastructureFreeze: boolean;
  exposedDuringImplementation: boolean;
  baselineParity: V2ParityReceipt;
  journalParity: V2ParityReceipt;
  expectedMaterialCaseIds: string[];
  baselineTraces: V2RunTrace[];
  journalTraces: V2RunTrace[];
}

export interface V2ScenarioResult {
  category: V2EvaluationCategory;
  baselineMedianTaskScore: number;
  journalMedianTaskScore: number;
  baselineMedianReads: number;
  journalMedianReads: number;
  baselineMedianMaintenance: number;
  journalMedianMaintenance: number;
  taskCorrectnessPassed: boolean;
  repositoryReadParityPassed: boolean;
  maintenanceImproved: boolean;
  materialSafetyPassed: boolean;
  restatementParityPassed: boolean;
}

export interface V2InfrastructureManifest {
  schemaVersion: 2;
  status: "pending-independent-review";
  concreteTasksSelected: false;
  taskIds: string[];
  prompts: string[];
  categories: V2EvaluationCategory[];
  readTolerance: 1;
  minimumRunsPerCondition: number;
  model: string;
  reasoning: string;
  contextBudget: number;
  resumeBudget: number;
  pauseSemantics: string;
  rubricPolicy: string;
  ownerProtocol: {
    sameForBothConditions: true;
    baselineActions: string[];
    requiredFields: string[];
    maxBytes: 4000;
    digest: string;
  };
  interventionTaxonomy: { avoidable: string[]; necessarySafety: string[] };
  materialSafety: { detectionBeforeContinuationRequired: true; appendOnlyResolutionRequired: true };
  provenance: {
    rawToDerivedRequired: true;
    parityReceiptRequired: true;
    canonicalHarnessReceiptRequired: true;
    privateRawTraceRetainedUntilIndependentRecomputation: true;
  };
  rawTracePolicy: string;
  privacy: { rawPromptsCommitted: false; rawToolBytesCommitted: false; absolutePathsCommitted: false };
}

export class V2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V2ValidationError";
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new V2ValidationError(`${field} must be non-empty`);
  return value.trim();
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new V2ValidationError(`${field} must be non-negative`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number = nonNegative(value, field);
  if (!Number.isInteger(number)) throw new V2ValidationError(`${field} must be an integer`);
  return number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function majority(values: boolean[]): boolean {
  return values.filter(Boolean).length > values.length / 2;
}

export function computeV2ParityDigest(receipt: V2ParityReceipt): string {
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}

export function computeV2HarnessReceiptDigest(receipt: V2HarnessTraceReceipt): string {
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}

function validateParity(receipt: unknown, field: string): V2ParityReceipt {
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) {
    throw new V2ValidationError(`${field} must be an object`);
  }
  const value = receipt as Record<string, unknown>;
  const normalized = {
    repositorySnapshot: nonEmpty(value.repositorySnapshot, `${field}.repositorySnapshot`),
    promptDigest: nonEmpty(value.promptDigest, `${field}.promptDigest`),
    rubricDigest: nonEmpty(value.rubricDigest, `${field}.rubricDigest`),
    model: nonEmpty(value.model, `${field}.model`),
    reasoning: nonEmpty(value.reasoning, `${field}.reasoning`),
    contextBudget: nonNegativeInteger(value.contextBudget, `${field}.contextBudget`),
    resumeBudget: nonNegativeInteger(value.resumeBudget, `${field}.resumeBudget`),
    pausePoint: nonEmpty(value.pausePoint, `${field}.pausePoint`),
    ownerProtocolDigest: nonEmpty(value.ownerProtocolDigest, `${field}.ownerProtocolDigest`),
  };
  if (!DIGEST.test(normalized.promptDigest) || !DIGEST.test(normalized.rubricDigest)) {
    throw new V2ValidationError(`${field} prompt and rubric digests must be SHA-256`);
  }
  if (
    normalized.model !== V2_MODEL ||
    normalized.reasoning !== V2_REASONING ||
    normalized.contextBudget !== V2_CONTEXT_BUDGET ||
    normalized.resumeBudget !== V2_RESUME_BUDGET ||
    normalized.ownerProtocolDigest !== V2_OWNER_PROTOCOL_DIGEST
  ) {
    throw new V2ValidationError(`${field} does not match the frozen model, reasoning, and budgets`);
  }
  return normalized;
}

const DIGEST = /^[a-f0-9]{64}$/;

export function computeV2DerivedTraceDigest(trace: Omit<V2RunTrace, "provenance"> | V2RunTrace): string {
  const canonical = {
    schemaVersion: trace.schemaVersion,
    sourceEvaluationVersion: trace.sourceEvaluationVersion,
    runId: trace.runId,
    taskId: trace.taskId,
    taskScore: trace.taskScore,
    repositoryReads: trace.repositoryReads,
    resumedWithoutRestatement: trace.resumedWithoutRestatement,
    materialTaskCorrect: trace.materialTaskCorrect,
    interventions: trace.interventions,
    materialCases: trace.materialCases,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function validateTrace(
  trace: unknown,
  field: string,
  taskId: string,
  expectedParityDigest: string,
  globalRunIds: Set<string>,
): V2RunTrace {
  if (typeof trace !== "object" || trace === null || Array.isArray(trace)) {
    throw new V2ValidationError(`${field} trace must be an object`);
  }
  const value = trace as Record<string, unknown>;
  if (value.schemaVersion !== 2 || value.sourceEvaluationVersion !== 2) {
    throw new V2ValidationError(`${field} cannot reuse V1 traces`);
  }
  const runId = nonEmpty(value.runId, `${field}.runId`);
  if (globalRunIds.has(runId)) throw new V2ValidationError("V2 run IDs must be globally unique");
  globalRunIds.add(runId);
  if (nonEmpty(value.taskId, `${field}.taskId`) !== taskId) throw new V2ValidationError(`${field} taskId mismatch`);
  if (runId.startsWith("v1-")) throw new V2ValidationError("V1 run IDs cannot be reused");
  if (!Array.isArray(value.interventions) || !Array.isArray(value.materialCases)) {
    throw new V2ValidationError(`${field} arrays are required`);
  }
  const interventionIds = new Set<string>();
  const interventions = value.interventions.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new V2ValidationError(`${field}.interventions must contain objects`);
    }
    const item = candidate as Record<string, unknown>;
    const id = nonEmpty(item.id, `${field}.interventions.id`);
    if (interventionIds.has(id)) throw new V2ValidationError(`${field} intervention IDs must be unique`);
    interventionIds.add(id);
    if (
      !AVOIDABLE_MAINTENANCE_KINDS.includes(item.kind as never) &&
      !NECESSARY_SAFETY_KINDS.includes(item.kind as never)
    ) {
      throw new V2ValidationError(`${field} has unknown intervention kind`);
    }
    return {
      id,
      kind: item.kind as V2InterventionKind,
      sequence: nonNegativeInteger(item.sequence, `${field}.interventions[${index}].sequence`),
    };
  });
  const materialCases = value.materialCases.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new V2ValidationError(`${field}.materialCases must contain objects`);
    }
    const item = candidate as Record<string, unknown>;
    for (const key of ["detectedBeforeContinuation", "resolvedAppendOnly", "falsePositive"] as const) {
      if (typeof item[key] !== "boolean") throw new V2ValidationError(`${field}.materialCases.${key} must be boolean`);
    }
    return {
      id: nonEmpty(item.id, `${field}.materialCases.id`),
      detectedBeforeContinuation: item.detectedBeforeContinuation as boolean,
      resolvedAppendOnly: item.resolvedAppendOnly as boolean,
      falsePositive: item.falsePositive as boolean,
    };
  });
  if (typeof value.resumedWithoutRestatement !== "boolean" || typeof value.materialTaskCorrect !== "boolean") {
    throw new V2ValidationError(`${field} booleans are required`);
  }
  if (typeof value.provenance !== "object" || value.provenance === null || Array.isArray(value.provenance)) {
    throw new V2ValidationError(`${field} provenance receipt is required`);
  }
  const provenance = value.provenance as Record<string, unknown>;
  if (
    provenance.normalizerVersion !== 2 ||
    !DIGEST.test(String(provenance.normalizerDigest)) ||
    !DIGEST.test(String(provenance.derivedDigest)) ||
    !DIGEST.test(String(provenance.harnessReceiptDigest)) ||
    typeof provenance.harnessReceipt !== "object" ||
    provenance.harnessReceipt === null ||
    Array.isArray(provenance.harnessReceipt)
  ) {
    throw new V2ValidationError(`${field} provenance digests are invalid`);
  }
  const harnessReceipt = provenance.harnessReceipt as unknown as V2HarnessTraceReceipt;
  const normalized: V2RunTrace = {
    schemaVersion: 2,
    sourceEvaluationVersion: 2,
    runId,
    taskId,
    taskScore: nonNegative(value.taskScore, `${field}.taskScore`),
    repositoryReads: nonNegativeInteger(value.repositoryReads, `${field}.repositoryReads`),
    resumedWithoutRestatement: value.resumedWithoutRestatement,
    materialTaskCorrect: value.materialTaskCorrect,
    interventions,
    materialCases,
    provenance: {
      normalizerVersion: 2 as const,
      normalizerDigest: provenance.normalizerDigest as string,
      derivedDigest: provenance.derivedDigest as string,
      harnessReceipt,
      harnessReceiptDigest: provenance.harnessReceiptDigest as string,
    },
  };
  if (computeV2DerivedTraceDigest(normalized) !== normalized.provenance.derivedDigest) {
    throw new V2ValidationError(`${field} derived digest does not match evidence`);
  }
  if (
    harnessReceipt.schemaVersion !== 2 ||
    harnessReceipt.runId !== runId ||
    harnessReceipt.taskId !== taskId ||
    harnessReceipt.parityDigest !== expectedParityDigest ||
    !DIGEST.test(harnessReceipt.workspaceReceiptDigest) ||
    harnessReceipt.normalizerDigest !== normalized.provenance.normalizerDigest ||
    harnessReceipt.derivedDigest !== normalized.provenance.derivedDigest ||
    JSON.stringify(harnessReceipt.materialCaseIds) !==
      JSON.stringify(normalized.materialCases.map((item) => item.id)) ||
    computeV2HarnessReceiptDigest(harnessReceipt) !== normalized.provenance.harnessReceiptDigest
  ) {
    throw new V2ValidationError(`${field} harness provenance receipt does not match evidence`);
  }
  return normalized;
}

function exactStrings(value: unknown, expected: readonly string[], field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new V2ValidationError(`${field} must be a string array`);
  }
  if (value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
    throw new V2ValidationError(`${field} does not match the frozen contract`);
  }
  return [...value];
}

export function validateV2InfrastructureManifest(value: unknown): V2InfrastructureManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new V2ValidationError("V2 infrastructure manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 2 || manifest.status !== "pending-independent-review") {
    throw new V2ValidationError("V2 infrastructure manifest is not at the pre-task review boundary");
  }
  if (manifest.concreteTasksSelected !== false)
    throw new V2ValidationError("concrete V2 tasks are forbidden before U5");
  if (!Array.isArray(manifest.taskIds) || manifest.taskIds.length > 0)
    throw new V2ValidationError("V2 task IDs are exposed");
  if (!Array.isArray(manifest.prompts) || manifest.prompts.length > 0)
    throw new V2ValidationError("V2 prompts are exposed");
  const categories = exactStrings(
    manifest.categories,
    V2_EVALUATION_CATEGORIES,
    "categories",
  ) as V2EvaluationCategory[];
  if (manifest.readTolerance !== V2_READ_TOLERANCE) throw new V2ValidationError("V2 read tolerance changed post hoc");
  if (manifest.minimumRunsPerCondition !== 3) throw new V2ValidationError("V2 requires three runs per condition");
  if (manifest.model !== "openai-codex/gpt-5.6-sol" || manifest.reasoning !== "high") {
    throw new V2ValidationError("V2 model and reasoning must be frozen");
  }
  if (manifest.contextBudget !== 8000 || manifest.resumeBudget !== 4000) {
    throw new V2ValidationError("V2 budgets must be frozen");
  }
  nonEmpty(manifest.pauseSemantics, "pauseSemantics");
  const rubricPolicy =
    "scenario-specific SHA-256 rubric digest fixed at task selection before trials and shared across conditions";
  if (manifest.rubricPolicy !== rubricPolicy) throw new V2ValidationError("V2 rubric policy must be frozen");
  const owner = manifest.ownerProtocol as Record<string, unknown> | undefined;
  if (!owner || owner.sameForBothConditions !== true) throw new V2ValidationError("owner protocol must be equal");
  const baselineActions = exactStrings(owner.baselineActions, V2_BASELINE_ACTIONS, "ownerProtocol.baselineActions");
  const requiredFields = exactStrings(owner.requiredFields, V2_OWNER_STATUS_FIELDS, "ownerProtocol.requiredFields");
  if (owner.maxBytes !== 4000 || owner.digest !== V2_OWNER_PROTOCOL_DIGEST) {
    throw new V2ValidationError("owner protocol byte limit and digest must be frozen");
  }
  const taxonomy = manifest.interventionTaxonomy as Record<string, unknown> | undefined;
  if (!taxonomy) throw new V2ValidationError("intervention taxonomy is required");
  const avoidable = exactStrings(taxonomy.avoidable, AVOIDABLE_MAINTENANCE_KINDS, "avoidable taxonomy");
  const necessarySafety = exactStrings(taxonomy.necessarySafety, NECESSARY_SAFETY_KINDS, "safety taxonomy");
  const safety = manifest.materialSafety as Record<string, unknown> | undefined;
  if (!safety || safety.detectionBeforeContinuationRequired !== true || safety.appendOnlyResolutionRequired !== true) {
    throw new V2ValidationError("material safety cannot be suppressed");
  }
  const provenance = manifest.provenance as Record<string, unknown> | undefined;
  if (
    !provenance ||
    provenance.rawToDerivedRequired !== true ||
    provenance.parityReceiptRequired !== true ||
    provenance.canonicalHarnessReceiptRequired !== true ||
    provenance.privateRawTraceRetainedUntilIndependentRecomputation !== true
  ) {
    throw new V2ValidationError("complete raw-to-derived harness provenance is required");
  }
  if (manifest.rawTracePolicy !== "private-ephemeral-delete-after-independent-recomputation") {
    throw new V2ValidationError("raw trace retention policy must be frozen");
  }
  const privacy = manifest.privacy as Record<string, unknown> | undefined;
  if (
    !privacy ||
    privacy.rawPromptsCommitted !== false ||
    privacy.rawToolBytesCommitted !== false ||
    privacy.absolutePathsCommitted !== false
  ) {
    throw new V2ValidationError("V2 privacy boundary is not frozen");
  }
  return {
    schemaVersion: 2,
    status: "pending-independent-review",
    concreteTasksSelected: false,
    taskIds: [],
    prompts: [],
    categories,
    readTolerance: 1,
    minimumRunsPerCondition: 3,
    model: manifest.model as string,
    reasoning: manifest.reasoning as string,
    contextBudget: manifest.contextBudget as number,
    resumeBudget: manifest.resumeBudget as number,
    pauseSemantics: manifest.pauseSemantics as string,
    rubricPolicy,
    ownerProtocol: {
      sameForBothConditions: true,
      baselineActions,
      requiredFields,
      maxBytes: 4000,
      digest: V2_OWNER_PROTOCOL_DIGEST,
    },
    interventionTaxonomy: { avoidable, necessarySafety },
    materialSafety: { detectionBeforeContinuationRequired: true, appendOnlyResolutionRequired: true },
    provenance: {
      rawToDerivedRequired: true,
      parityReceiptRequired: true,
      canonicalHarnessReceiptRequired: true,
      privateRawTraceRetainedUntilIndependentRecomputation: true,
    },
    rawTracePolicy: "private-ephemeral-delete-after-independent-recomputation",
    privacy: { rawPromptsCommitted: false, rawToolBytesCommitted: false, absolutePathsCommitted: false },
  };
}

function maintenanceCount(trace: V2RunTrace): number {
  return trace.interventions.filter((item) => AVOIDABLE_MAINTENANCE_KINDS.includes(item.kind as never)).length;
}

function safe(trace: V2RunTrace, expectedCaseIds: string[]): boolean {
  const actual = [...new Set(trace.materialCases.map((item) => item.id))].sort();
  const expected = [...expectedCaseIds].sort();
  return (
    trace.materialTaskCorrect &&
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index]) &&
    (expected.length === 0 ||
      trace.interventions.some(
        (item) => item.kind === "material_stale_resolution" || item.kind === "material_conflict_resolution",
      )) &&
    trace.materialCases.every(
      (item) => item.detectedBeforeContinuation && item.resolvedAppendOnly && item.falsePositive === false,
    )
  );
}

export function evaluateV2ReleaseGate(input: V2EvaluationScenario[]): {
  passed: boolean;
  maintenanceImprovementScenarios: number;
  taskCorrectnessPassed: boolean;
  repositoryReadParityPassed: boolean;
  materialSafetyPassed: boolean;
  restatementParityPassed: boolean;
  scenarios: V2ScenarioResult[];
} {
  if (!Array.isArray(input) || input.length !== V2_EVALUATION_CATEGORIES.length) {
    throw new V2ValidationError("V2 requires exactly three scenarios");
  }
  const globalRunIds = new Set<string>();
  const results = input.map((candidate, scenarioIndex) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new V2ValidationError("V2 scenario must be an object");
    }
    const value = candidate as unknown as Record<string, unknown>;
    if ("passed" in value || "maintenanceImprovementScenarios" in value) {
      throw new V2ValidationError("V2 pass values must be derived from traces");
    }
    if (value.schemaVersion !== 2) throw new V2ValidationError("unsupported V2 scenario schema");
    if (!V2_EVALUATION_CATEGORIES.includes(value.category as never)) {
      throw new V2ValidationError("V2 requires frozen categories");
    }
    const taskId = nonEmpty(value.taskId, "scenario.taskId");
    if (taskId.startsWith("v1-")) throw new V2ValidationError("V1 task IDs cannot be reused");
    if (value.selectedAfterInfrastructureFreeze !== true || value.exposedDuringImplementation !== false) {
      throw new V2ValidationError("V2 tasks must be held out and selected after infrastructure freeze");
    }
    const expectedMaterialCaseIds = Array.isArray(value.expectedMaterialCaseIds)
      ? value.expectedMaterialCaseIds.map((item) => nonEmpty(item, "expectedMaterialCaseIds"))
      : (() => {
          throw new V2ValidationError("expected material case IDs are required");
        })();
    if (new Set(expectedMaterialCaseIds).size !== expectedMaterialCaseIds.length) {
      throw new V2ValidationError("expected material case IDs must be unique");
    }
    if (value.category !== "automated-multi-file-continuation" && expectedMaterialCaseIds.length === 0) {
      throw new V2ValidationError("material scenarios require planted case IDs");
    }
    const baselineParity = validateParity(value.baselineParity, "baselineParity");
    const journalParity = validateParity(value.journalParity, "journalParity");
    if (JSON.stringify(baselineParity) !== JSON.stringify(journalParity)) {
      throw new V2ValidationError("V2 conditions require exact parity");
    }
    if (!Array.isArray(value.baselineTraces) || !Array.isArray(value.journalTraces)) {
      throw new V2ValidationError("V2 trace arrays are required");
    }
    if (value.baselineTraces.length < 3 || value.journalTraces.length < 3) {
      throw new V2ValidationError("V2 requires at least three traces per condition");
    }
    if (value.baselineTraces.length !== value.journalTraces.length) {
      throw new V2ValidationError("V2 conditions require equal trace counts");
    }
    const expectedParityDigest = computeV2ParityDigest(baselineParity);
    const baseline = value.baselineTraces.map((trace, index) =>
      validateTrace(trace, `scenario[${scenarioIndex}].baseline[${index}]`, taskId, expectedParityDigest, globalRunIds),
    );
    const journal = value.journalTraces.map((trace, index) =>
      validateTrace(trace, `scenario[${scenarioIndex}].journal[${index}]`, taskId, expectedParityDigest, globalRunIds),
    );
    const baselineMedianTaskScore = median(baseline.map((trace) => trace.taskScore));
    const journalMedianTaskScore = median(journal.map((trace) => trace.taskScore));
    const baselineMedianReads = median(baseline.map((trace) => trace.repositoryReads));
    const journalMedianReads = median(journal.map((trace) => trace.repositoryReads));
    const baselineMedianMaintenance = median(baseline.map(maintenanceCount));
    const journalMedianMaintenance = median(journal.map(maintenanceCount));
    return {
      category: value.category as V2EvaluationCategory,
      baselineMedianTaskScore,
      journalMedianTaskScore,
      baselineMedianReads,
      journalMedianReads,
      baselineMedianMaintenance,
      journalMedianMaintenance,
      taskCorrectnessPassed:
        journalMedianTaskScore >= baselineMedianTaskScore && journal.every((trace) => trace.materialTaskCorrect),
      repositoryReadParityPassed: journalMedianReads <= baselineMedianReads + V2_READ_TOLERANCE,
      maintenanceImproved: journalMedianMaintenance < baselineMedianMaintenance,
      materialSafetyPassed: journal.every((trace) => safe(trace, expectedMaterialCaseIds)),
      restatementParityPassed:
        Number(majority(journal.map((trace) => trace.resumedWithoutRestatement))) >=
        Number(majority(baseline.map((trace) => trace.resumedWithoutRestatement))),
    };
  });
  const categories = new Set(results.map((result) => result.category));
  if (V2_EVALUATION_CATEGORIES.some((category) => !categories.has(category))) {
    throw new V2ValidationError("V2 requires the exact frozen categories");
  }
  const maintenanceImprovementScenarios = results.filter((result) => result.maintenanceImproved).length;
  const taskCorrectnessPassed = results.every((result) => result.taskCorrectnessPassed);
  const repositoryReadParityPassed = results.every((result) => result.repositoryReadParityPassed);
  const materialSafetyPassed = results.every((result) => result.materialSafetyPassed);
  const restatementParityPassed = results.every((result) => result.restatementParityPassed);
  return {
    passed:
      taskCorrectnessPassed &&
      repositoryReadParityPassed &&
      maintenanceImprovementScenarios >= 2 &&
      materialSafetyPassed &&
      restatementParityPassed,
    maintenanceImprovementScenarios,
    taskCorrectnessPassed,
    repositoryReadParityPassed,
    materialSafetyPassed,
    restatementParityPassed,
    scenarios: results,
  };
}

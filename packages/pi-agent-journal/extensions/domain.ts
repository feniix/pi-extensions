import { randomUUID } from "node:crypto";

export const JOURNAL_SCHEMA_VERSION = 1;
export const MAX_ENTRY_BYTES = 20_000;
export const MAX_ENTRY_ID_BYTES = 256;
export const MAX_CHECKPOINT_BYTES = 16_000;
export const MAX_CHECKPOINT_ITEMS = 100;
export const ENTRY_TYPES = [
  "observation",
  "evidence",
  "assumption",
  "decision",
  "rejected_alternative",
  "validation",
  "next_action",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export type RelationshipType = "supersedes" | "alternative-to";

export interface Relationship {
  type: RelationshipType;
  targetEntryId: string;
}

export interface FileDependency {
  kind: "file";
  path: string;
  workspaceId: string;
  observedHash: string;
  observedAt: string;
  originatingEntryId: string;
  material: boolean;
}

export interface RepositoryDependency {
  kind: "repository_state";
  value: string;
  observedAt: string;
  originatingEntryId: string;
  material: boolean;
}

export interface ToolVersionDependency {
  kind: "tool_version";
  tool: string;
  version: string;
  observedAt: string;
  originatingEntryId: string;
  material: boolean;
}

export interface ExternalDependency {
  kind: "external";
  source: string;
  revalidateAfter: string;
  observedAt: string;
  originatingEntryId: string;
  material: boolean;
}

export type FreshnessDependency = FileDependency | RepositoryDependency | ToolVersionDependency | ExternalDependency;

export interface JournalEntry {
  id: string;
  type: EntryType;
  content: string;
  relationships: Relationship[];
  dependencies: FreshnessDependency[];
  timestamp: string;
}

export interface Checkpoint {
  id: string;
  objective: string;
  status: string;
  settledDecisionEntryIds: string[];
  openQuestions: string[];
  evidenceEntryIds: string[];
  artifactDependencies: FreshnessDependency[];
  nextActionEntryId: string | null;
  supportEntryIds: string[];
  createdAt: string;
}

export interface ConflictNotice {
  id: string;
  category: "stale" | "missing" | "unverifiable" | "conflict" | "credential" | "ambiguity";
  safeSummary: string;
  affectedIds: string[];
  requiresJudgment: boolean;
  createdAt: string;
}

export interface NoticeResolution {
  id: string;
  noticeId: string;
  affectedIds: string[];
  createdAt: string;
}

export interface JournalSession {
  schemaVersion: number;
  sessionId: string;
  entries: JournalEntry[];
  checkpoints: Checkpoint[];
  notices: ConflictNotice[];
  noticeResolutions: NoticeResolution[];
  activeCheckpointId: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fingerprint: string;
}

export interface FileObservationInput {
  path: string;
  material: boolean;
}

export interface EntryInput {
  id?: string;
  type: EntryType;
  content: string;
  relationships?: Relationship[];
  dependencies?: FreshnessDependency[];
  /** Safe service-computed file dependencies; never persisted as a separate field. */
  observeFiles?: FileObservationInput[];
}

export const EVALUATION_SCENARIO_CATEGORIES = [
  "partial-multi-file-investigation",
  "material-dependency-change",
  "settled-competing-alternative",
] as const;
export type EvaluationScenarioCategory = (typeof EVALUATION_SCENARIO_CATEGORIES)[number];

export interface EvaluationRunTrace {
  runId: string;
  resumedWithoutRestatement: boolean;
  repeatedRepositoryReads: number;
}

export interface EvaluationScenario {
  category: EvaluationScenarioCategory;
  baselineTraces: EvaluationRunTrace[];
  journalTraces: EvaluationRunTrace[];
  equalContextBudget: boolean;
  equalStatusBudget: boolean;
  exposedDuringImplementation?: boolean;
}

export interface EvaluationScenarioResult {
  category: EvaluationScenarioCategory;
  baselineMedianReads: number;
  journalMedianReads: number;
  resumedWithoutRestatement: boolean;
  reducedRepeatedReads: boolean;
}

export class JournalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalValidationError";
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new JournalValidationError(`${field} must be non-empty`);
  return value.trim();
}

function boundedText(value: unknown, field: string, maxBytes: number): string {
  const normalized = requireNonEmpty(value, field);
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw new JournalValidationError(`${field} exceeds byte limit`);
  }
  return normalized;
}

function uniqueStrings(values: unknown, field: string, maxBytes?: number): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new JournalValidationError(`${field} must be an array of non-empty strings`);
  }
  const normalized = values.map((value) =>
    maxBytes === undefined ? value.trim() : boundedText(value, field, maxBytes),
  );
  if (new Set(normalized).size !== normalized.length) throw new JournalValidationError(`${field} contains duplicates`);
  return normalized;
}

function validateFreshnessDependency(value: unknown): FreshnessDependency {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JournalValidationError("dependency must be an object");
  }
  const dependency = value as Record<string, unknown>;
  if (typeof dependency.material !== "boolean") {
    throw new JournalValidationError("dependency.material must be boolean");
  }
  const common = {
    observedAt: requireNonEmpty(dependency.observedAt, "dependency.observedAt"),
    originatingEntryId: boundedText(dependency.originatingEntryId, "dependency.originatingEntryId", MAX_ENTRY_ID_BYTES),
    material: dependency.material,
  };
  switch (dependency.kind) {
    case "file":
      return {
        kind: "file",
        path: requireNonEmpty(dependency.path, "dependency.path"),
        workspaceId: requireNonEmpty(dependency.workspaceId, "dependency.workspaceId"),
        observedHash: requireNonEmpty(dependency.observedHash, "dependency.observedHash"),
        ...common,
      };
    case "repository_state":
      return {
        kind: "repository_state",
        value: requireNonEmpty(dependency.value, "dependency.value"),
        ...common,
      };
    case "tool_version":
      return {
        kind: "tool_version",
        tool: requireNonEmpty(dependency.tool, "dependency.tool"),
        version: requireNonEmpty(dependency.version, "dependency.version"),
        ...common,
      };
    case "external":
      return {
        kind: "external",
        source: requireNonEmpty(dependency.source, "dependency.source"),
        revalidateAfter: requireNonEmpty(dependency.revalidateAfter, "dependency.revalidateAfter"),
        ...common,
      };
    default:
      throw new JournalValidationError("invalid dependency kind");
  }
}

export function normalizeEntryInput(
  input: EntryInput,
  options: { id?: string; timestamp?: string; maxEntryBytes?: number } = {},
): JournalEntry {
  if (!ENTRY_TYPES.includes(input.type)) throw new JournalValidationError("invalid entry type");
  const id = boundedText(options.id ?? input.id ?? randomUUID(), "id", MAX_ENTRY_ID_BYTES);
  const relationships = input.relationships ?? [];
  const seen = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.type !== "supersedes" && relationship.type !== "alternative-to") {
      throw new JournalValidationError("invalid relationship type");
    }
    boundedText(relationship.targetEntryId, "targetEntryId", MAX_ENTRY_ID_BYTES);
    if (relationship.targetEntryId === id) throw new JournalValidationError("entry cannot relate to itself");
    const key = `${relationship.type}:${relationship.targetEntryId}`;
    if (seen.has(key)) throw new JournalValidationError("duplicate relationship");
    seen.add(key);
  }
  return {
    id,
    type: input.type,
    content: boundedText(input.content, "content", options.maxEntryBytes ?? MAX_ENTRY_BYTES),
    relationships: relationships.map((relationship) => ({
      ...relationship,
      targetEntryId: boundedText(relationship.targetEntryId, "targetEntryId", MAX_ENTRY_ID_BYTES),
    })),
    dependencies: (input.dependencies ?? []).map(validateFreshnessDependency),
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}

export function validateCheckpointShape(value: unknown): Checkpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JournalValidationError("checkpoint must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    id: requireNonEmpty(record.id, "checkpoint.id"),
    objective: requireNonEmpty(record.objective, "checkpoint.objective"),
    status: requireNonEmpty(record.status, "checkpoint.status"),
    settledDecisionEntryIds: uniqueStrings(
      record.settledDecisionEntryIds,
      "settledDecisionEntryIds",
      MAX_ENTRY_ID_BYTES,
    ),
    openQuestions: uniqueStrings(record.openQuestions, "openQuestions"),
    evidenceEntryIds: uniqueStrings(record.evidenceEntryIds, "evidenceEntryIds", MAX_ENTRY_ID_BYTES),
    artifactDependencies: Array.isArray(record.artifactDependencies)
      ? record.artifactDependencies.map(validateFreshnessDependency)
      : (() => {
          throw new JournalValidationError("artifactDependencies must be an array");
        })(),
    nextActionEntryId:
      record.nextActionEntryId === null
        ? null
        : boundedText(record.nextActionEntryId, "nextActionEntryId", MAX_ENTRY_ID_BYTES),
    supportEntryIds: uniqueStrings(record.supportEntryIds, "supportEntryIds", MAX_ENTRY_ID_BYTES),
    createdAt: requireNonEmpty(record.createdAt, "createdAt"),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function validateEvaluationTraces(value: unknown, field: string): EvaluationRunTrace[] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new JournalValidationError(`evaluation ${field} requires at least three per-run traces`);
  }
  const runIds = new Set<string>();
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new JournalValidationError(`evaluation ${field} trace must be an object`);
    }
    const trace = candidate as Record<string, unknown>;
    const runId = requireNonEmpty(trace.runId, `evaluation ${field} runId`);
    if (runIds.has(runId)) throw new JournalValidationError(`evaluation ${field} runIds must be unique`);
    runIds.add(runId);
    if (typeof trace.resumedWithoutRestatement !== "boolean") {
      throw new JournalValidationError(`evaluation ${field} resumedWithoutRestatement must be boolean`);
    }
    if (!Number.isInteger(trace.repeatedRepositoryReads) || (trace.repeatedRepositoryReads as number) < 0) {
      throw new JournalValidationError(`evaluation ${field} repeatedRepositoryReads must be a non-negative integer`);
    }
    return {
      runId,
      resumedWithoutRestatement: trace.resumedWithoutRestatement,
      repeatedRepositoryReads: trace.repeatedRepositoryReads as number,
    };
  });
}

export function evaluateReleaseGate(scenarios: EvaluationScenario[]): {
  passed: boolean;
  resumePasses: number;
  repeatedReadPasses: number;
  scenarios: EvaluationScenarioResult[];
} {
  if (!Array.isArray(scenarios)) throw new JournalValidationError("evaluation scenarios must be an array");
  if (scenarios.length !== EVALUATION_SCENARIO_CATEGORIES.length) {
    throw new JournalValidationError("evaluation requires exactly three held-out scenarios");
  }
  const results = scenarios.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new JournalValidationError("evaluation scenario must be an object");
    }
    const record = candidate as unknown as Record<string, unknown>;
    if (!EVALUATION_SCENARIO_CATEGORIES.includes(record.category as EvaluationScenarioCategory)) {
      throw new JournalValidationError("evaluation requires the exact frozen scenario categories");
    }
    if ("resumedWithoutRestatement" in record || "reducedRepeatedReads" in record) {
      throw new JournalValidationError("evaluation results must be derived from per-run traces");
    }
    if (record.exposedDuringImplementation !== undefined && typeof record.exposedDuringImplementation !== "boolean") {
      throw new JournalValidationError("evaluation exposedDuringImplementation must be boolean");
    }
    if (record.exposedDuringImplementation === true) {
      throw new JournalValidationError("evaluation requires held-out scenarios");
    }
    if (record.equalContextBudget !== true || record.equalStatusBudget !== true) {
      throw new JournalValidationError("evaluation requires equal budgets between conditions");
    }
    const baselineTraces = validateEvaluationTraces(record.baselineTraces, "baselineTraces");
    const journalTraces = validateEvaluationTraces(record.journalTraces, "journalTraces");
    if (baselineTraces.length !== journalTraces.length) {
      throw new JournalValidationError("evaluation conditions require equal run counts");
    }
    const baselineMedianReads = median(baselineTraces.map((trace) => trace.repeatedRepositoryReads));
    const journalMedianReads = median(journalTraces.map((trace) => trace.repeatedRepositoryReads));
    const resumedWithoutRestatement =
      journalTraces.filter((trace) => trace.resumedWithoutRestatement).length > journalTraces.length / 2;
    return {
      category: record.category as EvaluationScenarioCategory,
      baselineMedianReads,
      journalMedianReads,
      resumedWithoutRestatement,
      reducedRepeatedReads: journalMedianReads < baselineMedianReads,
    };
  });
  const actualCategories = new Set(results.map((scenario) => scenario.category));
  if (EVALUATION_SCENARIO_CATEGORIES.some((category) => !actualCategories.has(category))) {
    throw new JournalValidationError("evaluation requires the exact frozen scenario categories");
  }
  const resumePasses = results.filter((scenario) => scenario.resumedWithoutRestatement).length;
  const repeatedReadPasses = results.filter((scenario) => scenario.reducedRepeatedReads).length;
  return {
    passed: resumePasses >= 2 && repeatedReadPasses >= 2,
    resumePasses,
    repeatedReadPasses,
    scenarios: results,
  };
}

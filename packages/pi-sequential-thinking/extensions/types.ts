/**
 * Types and normalization helpers for Sequential Thinking extension
 */

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_SESSION_LABEL = "default";
export const SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const STATUS_ENUMERATION_SESSION_THRESHOLD = 100;
export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 100;
const MAX_SESSION_ID_LENGTH = 80;
const MAX_THOUGHT_COUNT = 1000;

// =============================================================================
// ThoughtStage Enum
// =============================================================================

export enum ThoughtStage {
  PROBLEM_DEFINITION = "Problem Definition",
  RESEARCH = "Research",
  ANALYSIS = "Analysis",
  SYNTHESIS = "Synthesis",
  CONCLUSION = "Conclusion",
}

const THOUGHT_STAGE_VALUES = Object.values(ThoughtStage);

export function parseThoughtStage(value: string): ThoughtStage {
  const normalized = value.toLowerCase().trim();
  for (const stage of THOUGHT_STAGE_VALUES) {
    if (stage.toLowerCase() === normalized) {
      return stage;
    }
  }
  const validStages = THOUGHT_STAGE_VALUES.join(", ");
  throw new Error(`Invalid thinking stage: '${value}'. Valid stages are: ${validStages}`);
}

// =============================================================================
// ThoughtData Interface
// =============================================================================

export interface ThoughtData {
  thought: string;
  thought_number: number;
  total_thoughts: number;
  next_thought_needed: boolean;
  stage: ThoughtStage;
  tags: string[];
  axioms_used: string[];
  assumptions_challenged: string[];
  timestamp: string;
  id: string;
}

export interface SessionInfo {
  sessionId: string | null;
  sessionLabel: string;
}

export interface TotalThoughtsAdjustment {
  from: number;
  to: number;
}

export interface ThoughtInputAdjustments {
  totalThoughtsAdjusted?: TotalThoughtsAdjustment;
}

export interface NormalizedThoughtInput {
  thought: ThoughtData;
  session: SessionInfo;
  adjustments: ThoughtInputAdjustments;
}

export interface NormalizeThoughtOptions {
  id?: string;
  timestamp?: string;
}

// =============================================================================
// Validation
// =============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

function createError(field: string, message: string): ValidationError {
  return { field, message };
}

export class ThoughtValidationError extends Error {
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(errors.map((error) => `${error.field}: ${error.message}`).join("; "));
    this.name = "ThoughtValidationError";
    this.errors = errors;
    Object.setPrototypeOf(this, ThoughtValidationError.prototype);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRequiredString(field: string, value: unknown): { value?: string; error?: ValidationError } {
  if (typeof value !== "string") {
    return { error: createError(field, `${field} must be a string`) };
  }
  if (!value.trim()) {
    return {
      error: createError(field, field === "thought" ? "Thought content cannot be empty" : `${field} cannot be empty`),
    };
  }
  return { value };
}

function normalizeRequiredInteger(field: string, value: unknown): { value?: number; error?: ValidationError } {
  if (isPositiveInteger(value)) {
    if ((field === "thought_number" || field === "total_thoughts") && value > MAX_THOUGHT_COUNT) {
      return {
        error: createError(field, `${field} must be ${MAX_THOUGHT_COUNT} or fewer (received ${value})`),
      };
    }
    return { value };
  }
  const message =
    field === "thought_number"
      ? "Thought number must be a positive integer"
      : field === "total_thoughts"
        ? "Total thoughts must be a positive integer"
        : `${field} must be a positive integer`;
  return { error: createError(field, message) };
}

function normalizeRequiredBoolean(field: string, value: unknown): { value?: boolean; error?: ValidationError } {
  if (typeof value === "boolean") {
    return { value };
  }
  return { error: createError(field, `${field} must be a boolean`) };
}

function normalizeOptionalStringArray(field: string, value: unknown): { value?: string[]; error?: ValidationError } {
  if (value === undefined) {
    return { value: [] };
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { error: createError(field, `${field} must be an array of strings`) };
  }
  return { value };
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

function readAliasedField<T>(
  args: Record<string, unknown>,
  field: string,
  alias: string,
  normalizer: (field: string, value: unknown) => { value?: T; error?: ValidationError },
  options: { required: true } | { required: false; defaultValue: T },
): FieldResult<T> {
  const hasField = hasOwn(args, field);
  const hasAlias = hasOwn(args, alias);

  if (!hasField && !hasAlias) {
    if (options.required) {
      return { ok: false, errors: [createError(field, `${field} is required`)] };
    }
    return { ok: true, value: options.defaultValue };
  }

  const normalizedField = hasField ? normalizer(field, args[field]) : undefined;
  const normalizedAlias = hasAlias ? normalizer(field, args[alias]) : undefined;

  const errors: ValidationError[] = [];
  if (normalizedField?.error) errors.push(normalizedField.error);
  if (normalizedAlias?.error) errors.push(normalizedAlias.error);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (hasField && hasAlias) {
    if (!valuesEqual(normalizedField?.value, normalizedAlias?.value)) {
      return { ok: false, errors: [createError(field, `Conflicting aliases for ${field}`)] };
    }
    return { ok: true, value: normalizedField?.value as T };
  }

  return { ok: true, value: (hasField ? normalizedField?.value : normalizedAlias?.value) as T };
}

function pushErrors(target: ValidationError[], result: FieldResult<unknown>): void {
  if (!result.ok) target.push(...result.errors);
}

export function normalizeSessionId(value: unknown): SessionInfo {
  if (value === undefined || value === null) {
    return { sessionId: null, sessionLabel: DEFAULT_SESSION_LABEL };
  }
  if (typeof value !== "string") {
    throw new ThoughtValidationError([createError("session_id", "session_id must be a string")]);
  }

  const sessionId = value.trim();
  const errors: ValidationError[] = [];
  if (!sessionId) {
    errors.push(createError("session_id", "session_id cannot be empty"));
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    errors.push(createError("session_id", `session_id must be ${MAX_SESSION_ID_LENGTH} characters or fewer`));
  }
  if (sessionId.toLowerCase() === DEFAULT_SESSION_LABEL) {
    errors.push(createError("session_id", "session_id 'default' is reserved"));
  }
  if (sessionId === "." || sessionId === ".." || !/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    errors.push(createError("session_id", "session_id may contain only letters, numbers, dot, underscore, and hyphen"));
  }

  if (errors.length > 0) {
    throw new ThoughtValidationError(errors);
  }

  return { sessionId, sessionLabel: sessionId };
}

function readSession(args: Record<string, unknown>): { session?: SessionInfo; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const hasSnake = hasOwn(args, "session_id");
  const hasCamel = hasOwn(args, "sessionId");

  if (!hasSnake && !hasCamel) {
    return { session: normalizeSessionId(undefined), errors };
  }

  try {
    const snakeSession = hasSnake ? normalizeSessionId(args.session_id) : undefined;
    const camelSession = hasCamel ? normalizeSessionId(args.sessionId) : undefined;

    if (snakeSession && camelSession && !valuesEqual(snakeSession, camelSession)) {
      errors.push(createError("session_id", "Conflicting aliases for session_id"));
      return { errors };
    }

    return { session: snakeSession ?? camelSession, errors };
  } catch (error) {
    if (error instanceof ThoughtValidationError) {
      return { errors: error.errors };
    }
    throw error;
  }
}

export function normalizeThoughtInput(
  args: Record<string, unknown>,
  options: NormalizeThoughtOptions = {},
): NormalizedThoughtInput {
  if (!isRecord(args)) {
    throw new ThoughtValidationError([createError("input", "input must be an object")]);
  }

  const errors: ValidationError[] = [];

  const thoughtResult = normalizeRequiredString("thought", args.thought);
  if (thoughtResult.error) errors.push(thoughtResult.error);

  const thoughtNumberResult = readAliasedField(args, "thought_number", "thoughtNumber", normalizeRequiredInteger, {
    required: true,
  });
  pushErrors(errors, thoughtNumberResult);

  const totalThoughtsResult = readAliasedField(args, "total_thoughts", "totalThoughts", normalizeRequiredInteger, {
    required: true,
  });
  pushErrors(errors, totalThoughtsResult);

  const nextThoughtNeededResult = readAliasedField(
    args,
    "next_thought_needed",
    "nextThoughtNeeded",
    normalizeRequiredBoolean,
    { required: true },
  );
  pushErrors(errors, nextThoughtNeededResult);

  let stage: ThoughtStage | undefined;
  if (typeof args.stage !== "string") {
    errors.push(createError("stage", "stage must be a string"));
  } else {
    try {
      stage = parseThoughtStage(args.stage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(createError("stage", message));
    }
  }

  const tagsResult = normalizeOptionalStringArray("tags", args.tags);
  if (tagsResult.error) errors.push(tagsResult.error);

  const axiomsResult = readAliasedField(args, "axioms_used", "axiomsUsed", normalizeOptionalStringArray, {
    required: false,
    defaultValue: [],
  });
  pushErrors(errors, axiomsResult);

  const assumptionsResult = readAliasedField(
    args,
    "assumptions_challenged",
    "assumptionsChallenged",
    normalizeOptionalStringArray,
    { required: false, defaultValue: [] },
  );
  pushErrors(errors, assumptionsResult);

  const sessionResult = readSession(args);
  errors.push(...sessionResult.errors);

  if (errors.length > 0) {
    throw new ThoughtValidationError(errors);
  }

  // Past the error gate, all field results must be ok. Narrow them explicitly
  // so we do not rely on unchecked `as` casts.
  if (
    !thoughtResult.value ||
    !thoughtNumberResult.ok ||
    !totalThoughtsResult.ok ||
    !nextThoughtNeededResult.ok ||
    !axiomsResult.ok ||
    !assumptionsResult.ok ||
    stage === undefined
  ) {
    throw new ThoughtValidationError([createError("input", "internal invariant violation after validation gate")]);
  }

  const thoughtNumber = thoughtNumberResult.value;
  const originalTotalThoughts = totalThoughtsResult.value;
  const totalThoughts = Math.max(originalTotalThoughts, thoughtNumber);
  const adjustments: ThoughtInputAdjustments = {};
  if (totalThoughts !== originalTotalThoughts) {
    adjustments.totalThoughtsAdjusted = { from: originalTotalThoughts, to: totalThoughts };
  }

  return {
    thought: {
      thought: thoughtResult.value,
      thought_number: thoughtNumber,
      total_thoughts: totalThoughts,
      next_thought_needed: nextThoughtNeededResult.value,
      stage,
      tags: tagsResult.value ?? [],
      axioms_used: axiomsResult.value,
      assumptions_challenged: assumptionsResult.value,
      timestamp: options.timestamp ?? new Date().toISOString(),
      id: options.id ?? generateUuid(),
    },
    session: sessionResult.session ?? normalizeSessionId(undefined),
    adjustments,
  };
}

export function validateThoughtData(data: Partial<ThoughtData>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.thought?.trim()) {
    errors.push({ field: "thought", message: "Thought content cannot be empty" });
  }

  if (data.thought_number === undefined || !isPositiveInteger(data.thought_number)) {
    errors.push({ field: "thought_number", message: "Thought number must be a positive integer" });
  }

  if (data.total_thoughts === undefined || !isPositiveInteger(data.total_thoughts)) {
    errors.push({ field: "total_thoughts", message: "Total thoughts must be a positive integer" });
  }

  if (data.next_thought_needed !== undefined && typeof data.next_thought_needed !== "boolean") {
    errors.push({ field: "next_thought_needed", message: "next_thought_needed must be a boolean" });
  }

  if (data.stage !== undefined && !THOUGHT_STAGE_VALUES.includes(data.stage)) {
    errors.push({ field: "stage", message: "stage must be a valid ThoughtStage" });
  }

  for (const field of ["tags", "axioms_used", "assumptions_challenged"] as const) {
    const value = data[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
      errors.push({ field, message: `${field} must be an array of strings` });
    }
  }

  return errors;
}

export function isValidThoughtData(data: Partial<ThoughtData>): boolean {
  return validateThoughtData(data).length === 0;
}

// =============================================================================
// Serialization Helpers
// =============================================================================

export interface ThoughtDataSerialized extends Omit<ThoughtData, "stage"> {
  stage: string;
}

export function thoughtToDict(data: ThoughtData, includeId = false): Record<string, unknown> {
  const result: Record<string, unknown> = {
    thought: data.thought,
    thoughtNumber: data.thought_number,
    totalThoughts: data.total_thoughts,
    nextThoughtNeeded: data.next_thought_needed,
    stage: data.stage,
    tags: data.tags,
    axiomsUsed: data.axioms_used,
    assumptionsChallenged: data.assumptions_challenged,
    timestamp: data.timestamp,
  };

  if (includeId) {
    result.id = data.id;
  }

  return result;
}

export interface ThoughtRecordNormalizationResult {
  thought: ThoughtData;
  warnings: string[];
}

export function normalizeThoughtRecord(dict: Record<string, unknown>): ThoughtRecordNormalizationResult {
  const warnings: string[] = [];
  if (typeof dict.id !== "string" || !dict.id.trim()) {
    warnings.push("Imported thought missing id; generated a new id.");
  }
  if (typeof dict.timestamp !== "string" || !dict.timestamp.trim()) {
    warnings.push("Imported thought missing timestamp; generated an import-time timestamp.");
  }

  const normalized = normalizeThoughtInput(dict, {
    id: typeof dict.id === "string" && dict.id.trim() ? dict.id : generateUuid(),
    timestamp: typeof dict.timestamp === "string" && dict.timestamp.trim() ? dict.timestamp : new Date().toISOString(),
  });

  return { thought: normalized.thought, warnings };
}

// =============================================================================
// UUID Generation
// =============================================================================

export function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

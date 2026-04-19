/**
 * Types for Code Reasoning extension
 */

// =============================================================================
// Thought Data Types
// =============================================================================

export interface ThoughtData {
  thought: string;
  thought_number: number;
  total_thoughts: number;
  next_thought_needed: boolean;
  is_revision?: boolean;
  revises_thought?: number;
  branch_from_thought?: number;
  branch_id?: string;
  needs_more_thoughts?: boolean;
}

export interface ValidatedThoughtData extends ThoughtData {
  is_revision: boolean;
  branch_from_thought: number | undefined;
  branch_id: string | undefined;
  needs_more_thoughts: boolean;
}

// =============================================================================
// Validation
// =============================================================================

const MAX_THOUGHT_LENGTH = 20000;
const MAX_THOUGHTS = 20;

export interface ValidationError {
  field: string;
  message: string;
}

function createError(field: string, message: string): ValidationError {
  return { field, message };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function validateThoughtField(thought: Partial<ThoughtData>["thought"]): ValidationError[] {
  if (!thought?.trim()) {
    return [createError("thought", "Thought cannot be empty.")];
  }

  if (thought.length > MAX_THOUGHT_LENGTH) {
    return [createError("thought", `Thought exceeds ${MAX_THOUGHT_LENGTH} characters.`)];
  }

  return [];
}

function validateRequiredPositiveInteger(
  field: "thought_number" | "total_thoughts",
  value: Partial<ThoughtData>[typeof field],
): ValidationError[] {
  if (isPositiveInteger(value)) {
    return [];
  }

  return [createError(field, `${field} must be a positive integer.`)];
}

function validateOptionalPositiveInteger(
  field: "revises_thought" | "branch_from_thought",
  value: Partial<ThoughtData>[typeof field],
): ValidationError[] {
  if (value === undefined || isPositiveInteger(value)) {
    return [];
  }

  return [createError(field, `${field} must be a positive integer.`)];
}

function validateOptionalBoolean(field: "is_revision", value: Partial<ThoughtData>[typeof field]): ValidationError[] {
  if (value === undefined || typeof value === "boolean") {
    return [];
  }

  return [createError(field, `${field} must be a boolean.`)];
}

function validateRequiredBoolean(
  field: "next_thought_needed",
  value: Partial<ThoughtData>[typeof field],
): ValidationError[] {
  if (typeof value === "boolean") {
    return [];
  }

  return [createError(field, `${field} must be a boolean.`)];
}

function validateBranchId(branchId: Partial<ThoughtData>["branch_id"]): ValidationError[] {
  if (branchId === undefined) {
    return [];
  }

  if (typeof branchId === "string" && branchId.trim()) {
    return [];
  }

  return [createError("branch_id", "branch_id must be a non-empty string.")];
}

export function validateThoughtData(data: Partial<ThoughtData>): ValidationError[] {
  return [
    ...validateThoughtField(data.thought),
    ...validateRequiredPositiveInteger("thought_number", data.thought_number),
    ...validateRequiredPositiveInteger("total_thoughts", data.total_thoughts),
    ...validateRequiredBoolean("next_thought_needed", data.next_thought_needed),
    ...validateOptionalBoolean("is_revision", data.is_revision),
    ...validateOptionalPositiveInteger("revises_thought", data.revises_thought),
    ...validateOptionalPositiveInteger("branch_from_thought", data.branch_from_thought),
    ...validateBranchId(data.branch_id),
  ];
}

export function isValidThoughtData(data: Partial<ThoughtData>): boolean {
  return validateThoughtData(data).length === 0;
}

// =============================================================================
// Cross-field Validation
// =============================================================================

export interface CrossFieldValidationError {
  message: string;
}

export function enforceCrossFieldRules(data: ThoughtData): CrossFieldValidationError[] {
  const errors: CrossFieldValidationError[] = [];

  if (data.is_revision) {
    if (typeof data.revises_thought !== "number" || data.branch_id || data.branch_from_thought) {
      errors.push({
        message: "If is_revision=true, provide revises_thought and omit branch_* fields.",
      });
    }
  } else if (data.revises_thought !== undefined) {
    errors.push({
      message: "revises_thought only allowed when is_revision=true.",
    });
  }

  const hasBranchFields = data.branch_id !== undefined || data.branch_from_thought !== undefined;
  if (hasBranchFields) {
    if (data.branch_id === undefined || data.branch_from_thought === undefined || data.is_revision) {
      errors.push({
        message: "branch_id and branch_from_thought required together and not with revision.",
      });
    }
  }

  return errors;
}

export function isValidCrossField(data: ThoughtData): boolean {
  return enforceCrossFieldRules(data).length === 0;
}

// =============================================================================
// Constants
// =============================================================================

export const MAX_THOUGHT_COUNT = MAX_THOUGHTS;
export { MAX_THOUGHT_LENGTH };

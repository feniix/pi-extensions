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

export function validateThoughtData(data: Partial<ThoughtData>): ValidationError[] {
	const errors: ValidationError[] = [];

	// thought: non-empty string with max length
	if (!data.thought?.trim()) {
		errors.push({ field: "thought", message: "Thought cannot be empty." });
	} else if (data.thought.length > MAX_THOUGHT_LENGTH) {
		errors.push({
			field: "thought",
			message: `Thought exceeds ${MAX_THOUGHT_LENGTH} characters.`,
		});
	}

	// thought_number: positive integer
	if (typeof data.thought_number !== "number" || !Number.isInteger(data.thought_number) || data.thought_number < 1) {
		errors.push({
			field: "thought_number",
			message: "thought_number must be a positive integer.",
		});
	}

	// total_thoughts: positive integer
	if (typeof data.total_thoughts !== "number" || !Number.isInteger(data.total_thoughts) || data.total_thoughts < 1) {
		errors.push({
			field: "total_thoughts",
			message: "total_thoughts must be a positive integer.",
		});
	}

	// next_thought_needed: boolean
	if (typeof data.next_thought_needed !== "boolean") {
		errors.push({
			field: "next_thought_needed",
			message: "next_thought_needed must be a boolean.",
		});
	}

	// is_revision: boolean (optional)
	if (data.is_revision !== undefined && typeof data.is_revision !== "boolean") {
		errors.push({ field: "is_revision", message: "is_revision must be a boolean." });
	}

	// revises_thought: positive integer (optional)
	if (
		data.revises_thought !== undefined &&
		(typeof data.revises_thought !== "number" || !Number.isInteger(data.revises_thought) || data.revises_thought < 1)
	) {
		errors.push({
			field: "revises_thought",
			message: "revises_thought must be a positive integer.",
		});
	}

	// branch_from_thought: positive integer (optional)
	if (
		data.branch_from_thought !== undefined &&
		(typeof data.branch_from_thought !== "number" ||
			!Number.isInteger(data.branch_from_thought) ||
			data.branch_from_thought < 1)
	) {
		errors.push({
			field: "branch_from_thought",
			message: "branch_from_thought must be a positive integer.",
		});
	}

	// branch_id: non-empty string (optional)
	if (data.branch_id !== undefined && (typeof data.branch_id !== "string" || !data.branch_id.trim())) {
		errors.push({ field: "branch_id", message: "branch_id must be a non-empty string." });
	}

	return errors;
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

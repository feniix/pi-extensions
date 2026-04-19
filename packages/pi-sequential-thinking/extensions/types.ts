/**
 * Types for Sequential Thinking extension
 */

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

// =============================================================================
// Validation
// =============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export function validateThoughtData(data: Partial<ThoughtData>): ValidationError[] {
  const errors: ValidationError[] = [];

  // thought: non-empty
  if (!data.thought?.trim()) {
    errors.push({ field: "thought", message: "Thought content cannot be empty" });
  }

  // thought_number: positive integer
  if (data.thought_number === undefined || data.thought_number < 1) {
    errors.push({
      field: "thought_number",
      message: "Thought number must be a positive integer",
    });
  }

  // total_thoughts: >= thought_number
  if (data.total_thoughts !== undefined && data.thought_number !== undefined) {
    if (data.total_thoughts < data.thought_number) {
      errors.push({
        field: "total_thoughts",
        message: "Total thoughts must be greater or equal to current thought number",
      });
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

export function thoughtFromDict(dict: Record<string, unknown>): ThoughtData {
  const stageValue = typeof dict.stage === "string" ? parseThoughtStage(dict.stage) : ThoughtStage.ANALYSIS;

  const id = typeof dict.id === "string" ? dict.id : generateUuid();

  return {
    thought: typeof dict.thought === "string" ? dict.thought : "",
    thought_number: typeof dict.thoughtNumber === "number" ? dict.thoughtNumber : 1,
    total_thoughts: typeof dict.totalThoughts === "number" ? dict.totalThoughts : 1,
    next_thought_needed: typeof dict.nextThoughtNeeded === "boolean" ? dict.nextThoughtNeeded : false,
    stage: stageValue,
    tags: Array.isArray(dict.tags) ? dict.tags.filter((t): t is string => typeof t === "string") : [],
    axioms_used: Array.isArray(dict.axiomsUsed)
      ? dict.axiomsUsed.filter((a): a is string => typeof a === "string")
      : Array.isArray(dict.axioms_used)
        ? dict.axioms_used.filter((a): a is string => typeof a === "string")
        : [],
    assumptions_challenged: Array.isArray(dict.assumptionsChallenged)
      ? dict.assumptionsChallenged.filter((a): a is string => typeof a === "string")
      : Array.isArray(dict.assumptions_challenged)
        ? dict.assumptions_challenged.filter((a): a is string => typeof a === "string")
        : [],
    timestamp: typeof dict.timestamp === "string" ? dict.timestamp : new Date().toISOString(),
    id,
  };
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

import { buildSuccess } from "./responses.js";
import type { ThoughtTracker } from "./tracker.js";
import {
  enforceCrossFieldRules,
  MAX_THOUGHT_COUNT,
  type ThoughtData,
  type ValidatedThoughtData,
  validateThoughtData,
} from "./types.js";

export function toThoughtData(args: Record<string, unknown>): ThoughtData {
  return {
    thought: args.thought as string,
    thought_number: args.thought_number as number,
    total_thoughts: args.total_thoughts as number,
    next_thought_needed: args.next_thought_needed as boolean,
    is_revision: args.is_revision as boolean | undefined,
    revises_thought: args.revises_thought as number | undefined,
    branch_from_thought: args.branch_from_thought as number | undefined,
    branch_id: args.branch_id as string | undefined,
    needs_more_thoughts: args.needs_more_thoughts as boolean | undefined,
  };
}

export function applyThoughtDefaults(data: ThoughtData): ValidatedThoughtData {
  return {
    thought: data.thought,
    thought_number: data.thought_number,
    total_thoughts: data.total_thoughts,
    next_thought_needed: data.next_thought_needed,
    is_revision: data.is_revision ?? false,
    branch_from_thought: data.branch_from_thought,
    branch_id: data.branch_id,
    needs_more_thoughts: data.needs_more_thoughts ?? data.next_thought_needed,
  };
}

function validateThoughtSequence(data: ThoughtData): void {
  const fieldErrors = validateThoughtData(data);
  if (fieldErrors.length > 0) {
    throw new Error(fieldErrors[0].message);
  }

  if (data.thought_number > MAX_THOUGHT_COUNT || data.total_thoughts > MAX_THOUGHT_COUNT) {
    throw new Error(`Max thought_number exceeded (${MAX_THOUGHT_COUNT}).`);
  }
  if (data.thought_number > data.total_thoughts) {
    throw new Error("thought_number cannot exceed total_thoughts.");
  }

  const crossErrors = enforceCrossFieldRules(data);
  if (crossErrors.length > 0) {
    throw new Error(crossErrors[0].message);
  }
}

export function processThought(args: Record<string, unknown>, tracker: ThoughtTracker): Record<string, unknown> {
  const data = toThoughtData(args);

  validateThoughtSequence(data);
  tracker.ensureBranchIsValid(data.branch_from_thought);
  tracker.ensureRevisionIsValid(data.revises_thought);

  const validated = applyThoughtDefaults(data);
  tracker.add(validated);

  return buildSuccess(validated, tracker);
}

import type { ThoughtTracker } from "./tracker.js";
import { MAX_THOUGHT_COUNT, MAX_THOUGHT_LENGTH, type ThoughtData, type ValidatedThoughtData } from "./types.js";

export function getExampleThought(errorMsg: string): Partial<ThoughtData> {
  if (errorMsg.includes("branch")) {
    return {
      thought: "Exploring alternative: Consider algorithm X.",
      thought_number: 3,
      total_thoughts: 7,
      next_thought_needed: true,
      branch_from_thought: 2,
      branch_id: "alternative-algo-x",
    };
  }
  if (errorMsg.includes("revis")) {
    return {
      thought: "Revisiting earlier point: Assumption Y was flawed.",
      thought_number: 4,
      total_thoughts: 6,
      next_thought_needed: true,
      is_revision: true,
      revises_thought: 2,
    };
  }
  if (errorMsg.includes("length") || errorMsg.includes("empty")) {
    return {
      thought: "Breaking down the thought into smaller parts...",
      thought_number: 2,
      total_thoughts: 5,
      next_thought_needed: true,
    };
  }
  return {
    thought: "Initial exploration of the problem.",
    thought_number: 1,
    total_thoughts: 5,
    next_thought_needed: true,
  };
}

export function buildSuccess(t: ValidatedThoughtData, tracker: ThoughtTracker): Record<string, unknown> {
  return {
    status: "processed",
    thought_number: t.thought_number,
    total_thoughts: t.total_thoughts,
    next_thought_needed: t.next_thought_needed,
    branches: tracker.branches(),
    thought_history_length: tracker.count(),
  };
}

export function buildError(error: Error): Record<string, unknown> {
  const errorMessage = error.message;
  let guidance = "Check the tool description and schema for correct usage.";
  const example = getExampleThought(errorMessage);

  if (errorMessage.includes("branch")) {
    guidance =
      "When branching, provide both branch_from_thought (number) and branch_id (string), and do not combine with revision.";
  } else if (errorMessage.includes("revision")) {
    guidance =
      "When revising, set is_revision=true and provide revises_thought (positive number). Do not combine with branching.";
  } else if (errorMessage.includes("length")) {
    guidance = `The thought is too long. Keep it under ${MAX_THOUGHT_LENGTH} characters.`;
  } else if (errorMessage.includes("Max thought")) {
    guidance = `The maximum thought limit (${MAX_THOUGHT_COUNT}) was reached.`;
  }

  return {
    status: "failed",
    error: errorMessage,
    guidance,
    example,
  };
}

import { MAX_THOUGHT_COUNT, type ValidatedThoughtData } from "./types.js";

export interface ThoughtTracker {
  add: (thought: ValidatedThoughtData) => void;
  reset: () => void;
  ensureBranchIsValid: (branchFromThought?: number) => void;
  ensureRevisionIsValid: (revisesThought?: number) => void;
  branches: () => string[];
  count: () => number;
}

function ensureReferenceExists(
  field: "branch_from_thought" | "revises_thought",
  value: number | undefined,
  count: number,
): void {
  if (value && value > count) {
    throw new Error(`Invalid ${field} ${value}.`);
  }
}

export function createThoughtTracker(): ThoughtTracker {
  const thoughtHistory: ValidatedThoughtData[] = [];
  const branches = new Set<string>();

  return {
    add: (thought) => {
      if (thoughtHistory.length >= MAX_THOUGHT_COUNT) {
        throw new Error(`Max thought limit reached (${MAX_THOUGHT_COUNT}).`);
      }

      thoughtHistory.push(thought);
      if (thought.branch_id) {
        branches.add(thought.branch_id);
      }
    },
    ensureBranchIsValid: (branchFromThought) => {
      ensureReferenceExists("branch_from_thought", branchFromThought, thoughtHistory.length);
    },
    ensureRevisionIsValid: (revisesThought) => {
      ensureReferenceExists("revises_thought", revisesThought, thoughtHistory.length);
    },
    branches: () => Array.from(branches),
    count: () => thoughtHistory.length,
    reset: () => {
      thoughtHistory.length = 0;
      branches.clear();
    },
  };
}

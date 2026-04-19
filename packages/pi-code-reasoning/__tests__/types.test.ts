import { describe, expect, it } from "vitest";
import {
  enforceCrossFieldRules,
  isValidCrossField,
  isValidThoughtData,
  type ThoughtData,
  validateThoughtData,
} from "../extensions/types.js";

describe("validateThoughtData", () => {
  it("returns no errors for valid data", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toEqual([]);
  });

  it("returns error for empty thought", () => {
    const data = {
      thought: "",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought",
      message: "Thought cannot be empty.",
    });
  });

  it("returns error for whitespace-only thought", () => {
    const data = {
      thought: "   ",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought",
      message: "Thought cannot be empty.",
    });
  });

  it("returns error for negative thought_number", () => {
    const data = {
      thought: "My thought",
      thought_number: 0,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought_number",
      message: "thought_number must be a positive integer.",
    });
  });

  it("returns error for negative thought_number", () => {
    const data = {
      thought: "My thought",
      thought_number: -5,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought_number",
      message: "thought_number must be a positive integer.",
    });
  });

  it("returns error for non-integer thought_number", () => {
    const data = {
      thought: "My thought",
      thought_number: 1.5,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought_number",
      message: "thought_number must be a positive integer.",
    });
  });

  it("returns error for negative total_thoughts", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 0,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "total_thoughts",
      message: "total_thoughts must be a positive integer.",
    });
  });

  it("returns error for missing next_thought_needed", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: undefined,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "next_thought_needed",
      message: "next_thought_needed must be a boolean.",
    });
  });

  it("returns error for invalid is_revision type", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      is_revision: "yes",
    } as unknown as Partial<ThoughtData>;
    expect(validateThoughtData(data)).toContainEqual({
      field: "is_revision",
      message: "is_revision must be a boolean.",
    });
  });

  it("returns error for invalid revises_thought", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      revises_thought: -1,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "revises_thought",
      message: "revises_thought must be a positive integer.",
    });
  });

  it("returns error for non-integer revises_thought", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      revises_thought: 1.5,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "revises_thought",
      message: "revises_thought must be a positive integer.",
    });
  });

  it("returns error for invalid branch_from_thought", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      branch_from_thought: 0,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "branch_from_thought",
      message: "branch_from_thought must be a positive integer.",
    });
  });

  it("returns error for empty branch_id", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      branch_id: "   ",
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "branch_id",
      message: "branch_id must be a non-empty string.",
    });
  });

  it("returns error for non-string branch_id", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      branch_id: 123,
    } as unknown as Partial<ThoughtData>;
    expect(validateThoughtData(data)).toContainEqual({
      field: "branch_id",
      message: "branch_id must be a non-empty string.",
    });
  });

  it("returns multiple errors", () => {
    const data = {
      thought: "",
      thought_number: -1,
      total_thoughts: 0,
      next_thought_needed: "yes",
    } as unknown as Partial<ThoughtData>;
    const errors = validateThoughtData(data);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts valid optional fields", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      is_revision: true,
      revises_thought: 1,
      branch_from_thought: 2,
      branch_id: "test-branch",
    };
    expect(validateThoughtData(data)).toEqual([]);
  });

  it("accepts thought at max length", () => {
    const longThought = "a".repeat(20000);
    const data = {
      thought: longThought,
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toEqual([]);
  });

  it("returns error for thought exceeding max length", () => {
    const longThought = "a".repeat(20001);
    const data = {
      thought: longThought,
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought",
      message: expect.stringContaining("exceeds"),
    });
  });
});

describe("isValidThoughtData", () => {
  it("returns true for valid data", () => {
    expect(
      isValidThoughtData({
        thought: "My thought",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
      }),
    ).toBe(true);
  });

  it("returns false for invalid data", () => {
    expect(
      isValidThoughtData({
        thought: "",
        thought_number: 0,
        total_thoughts: 0,
        next_thought_needed: true,
      }),
    ).toBe(false);
  });
});

describe("enforceCrossFieldRules", () => {
  it("accepts regular thought", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    };
    expect(enforceCrossFieldRules(data)).toEqual([]);
  });

  it("accepts valid revision", () => {
    const data = {
      thought: "Revising earlier point",
      thought_number: 4,
      total_thoughts: 5,
      next_thought_needed: true,
      is_revision: true,
      revises_thought: 2,
    };
    expect(enforceCrossFieldRules(data)).toEqual([]);
  });

  it("rejects revision without revises_thought", () => {
    const data = {
      thought: "Revising",
      thought_number: 4,
      total_thoughts: 5,
      next_thought_needed: true,
      is_revision: true,
    };
    const errors = enforceCrossFieldRules(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("revises_thought");
  });

  it("accepts valid branch", () => {
    const data = {
      thought: "Exploring alternative",
      thought_number: 3,
      total_thoughts: 5,
      next_thought_needed: true,
      branch_from_thought: 2,
      branch_id: "alt-approach",
    };
    expect(enforceCrossFieldRules(data)).toEqual([]);
  });

  it("rejects branch with only branch_from_thought", () => {
    const data = {
      thought: "Exploring",
      thought_number: 3,
      total_thoughts: 5,
      next_thought_needed: true,
      branch_from_thought: 2,
    };
    const errors = enforceCrossFieldRules(data);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("branch_id");
  });

  it("rejects branch with revision", () => {
    const data = {
      thought: "Invalid",
      thought_number: 3,
      total_thoughts: 5,
      next_thought_needed: true,
      is_revision: true,
      revises_thought: 1,
      branch_from_thought: 2,
      branch_id: "branch",
    };
    const errors = enforceCrossFieldRules(data);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("isValidCrossField", () => {
  it("returns true for valid regular thought", () => {
    expect(
      isValidCrossField({
        thought: "Test",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
      }),
    ).toBe(true);
  });

  it("returns true for valid revision", () => {
    expect(
      isValidCrossField({
        thought: "Test",
        thought_number: 2,
        total_thoughts: 3,
        next_thought_needed: true,
        is_revision: true,
        revises_thought: 1,
      }),
    ).toBe(true);
  });

  it("returns true for valid branch", () => {
    expect(
      isValidCrossField({
        thought: "Test",
        thought_number: 3,
        total_thoughts: 5,
        next_thought_needed: true,
        branch_from_thought: 1,
        branch_id: "branch-1",
      }),
    ).toBe(true);
  });

  it("returns false for invalid combination", () => {
    expect(
      isValidCrossField({
        thought: "Test",
        thought_number: 3,
        total_thoughts: 5,
        next_thought_needed: true,
        is_revision: true,
        revises_thought: 1,
        branch_from_thought: 2,
        branch_id: "branch",
      }),
    ).toBe(false);
  });
});

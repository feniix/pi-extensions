import { describe, expect, it } from "vitest";
import {
  generateUuid,
  isValidThoughtData,
  parseThoughtStage,
  ThoughtStage,
  thoughtFromDict,
  thoughtToDict,
  validateThoughtData,
} from "../extensions/types.js";

describe("ThoughtStage", () => {
  it("parses valid stages case-insensitively", () => {
    expect(parseThoughtStage("Problem Definition")).toBe(ThoughtStage.PROBLEM_DEFINITION);
    expect(parseThoughtStage("problem definition")).toBe(ThoughtStage.PROBLEM_DEFINITION);
    expect(parseThoughtStage("PROBLEM DEFINITION")).toBe(ThoughtStage.PROBLEM_DEFINITION);
    expect(parseThoughtStage("Research")).toBe(ThoughtStage.RESEARCH);
    expect(parseThoughtStage("Analysis")).toBe(ThoughtStage.ANALYSIS);
    expect(parseThoughtStage("Synthesis")).toBe(ThoughtStage.SYNTHESIS);
    expect(parseThoughtStage("Conclusion")).toBe(ThoughtStage.CONCLUSION);
  });

  it("throws on invalid stage", () => {
    expect(() => parseThoughtStage("Invalid Stage")).toThrow("Invalid thinking stage");
  });
});

describe("validateThoughtData", () => {
  it("returns no errors for valid data", () => {
    const data = {
      thought: "My thought",
      thought_number: 1,
      total_thoughts: 3,
    };
    expect(validateThoughtData(data)).toEqual([]);
  });

  it("returns error for empty thought", () => {
    const data = {
      thought: "",
      thought_number: 1,
      total_thoughts: 3,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought",
      message: "Thought content cannot be empty",
    });
  });

  it("returns error for whitespace-only thought", () => {
    const data = {
      thought: "   ",
      thought_number: 1,
      total_thoughts: 3,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought",
      message: "Thought content cannot be empty",
    });
  });

  it("returns error for non-positive thought_number", () => {
    const data = {
      thought: "My thought",
      thought_number: 0,
      total_thoughts: 3,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "thought_number",
      message: "Thought number must be a positive integer",
    });
  });

  it("returns error when total_thoughts < thought_number", () => {
    const data = {
      thought: "My thought",
      thought_number: 5,
      total_thoughts: 3,
    };
    expect(validateThoughtData(data)).toContainEqual({
      field: "total_thoughts",
      message: "Total thoughts must be greater or equal to current thought number",
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
      }),
    ).toBe(true);
  });

  it("returns false for invalid data", () => {
    expect(isValidThoughtData({ thought: "", thought_number: 0, total_thoughts: 0 })).toBe(false);
  });
});

describe("thoughtToDict", () => {
  it("converts thought to dict without id by default", () => {
    const thought = {
      thought: "Test thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: ThoughtStage.RESEARCH,
      tags: ["test"],
      axioms_used: [],
      assumptions_challenged: [],
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "test-id",
    };
    const dict = thoughtToDict(thought);
    expect(dict.thought).toBe("Test thought");
    expect(dict.thoughtNumber).toBe(1);
    expect(dict.totalThoughts).toBe(3);
    expect(dict.nextThoughtNeeded).toBe(true);
    expect(dict.stage).toBe(ThoughtStage.RESEARCH);
    expect(dict.tags).toEqual(["test"]);
    expect(dict.axiomsUsed).toEqual([]);
    expect(dict.assumptionsChallenged).toEqual([]);
    expect(dict.timestamp).toBe("2024-01-01T00:00:00.000Z");
    expect(dict.id).toBeUndefined();
  });

  it("includes id when requested", () => {
    const thought = {
      thought: "Test thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: ThoughtStage.ANALYSIS,
      tags: [],
      axioms_used: [],
      assumptions_challenged: [],
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "test-id",
    };
    const dict = thoughtToDict(thought, true);
    expect(dict.id).toBe("test-id");
  });
});

describe("thoughtFromDict", () => {
  it("parses dict with camelCase keys", () => {
    const dict = {
      thought: "Test thought",
      thoughtNumber: 2,
      totalThoughts: 5,
      nextThoughtNeeded: false,
      stage: "Synthesis",
      tags: ["tag1", "tag2"],
      axiomsUsed: ["axiom1"],
      assumptionsChallenged: [],
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "parsed-id",
    };
    const thought = thoughtFromDict(dict);
    expect(thought.thought).toBe("Test thought");
    expect(thought.thought_number).toBe(2);
    expect(thought.total_thoughts).toBe(5);
    expect(thought.next_thought_needed).toBe(false);
    expect(thought.stage).toBe(ThoughtStage.SYNTHESIS);
    expect(thought.tags).toEqual(["tag1", "tag2"]);
    expect(thought.axioms_used).toEqual(["axiom1"]);
    expect(thought.id).toBe("parsed-id");
  });

  it("parses dict with snake_case keys", () => {
    const dict = {
      thought: "Test thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: "Conclusion",
      tags: [],
      axioms_used: [],
      assumptions_challenged: [],
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "snake-id",
    };
    const thought = thoughtFromDict(dict);
    expect(thought.thought_number).toBe(1);
    expect(thought.stage).toBe(ThoughtStage.CONCLUSION);
  });

  it("generates id when not provided", () => {
    const dict = {
      thought: "Test thought",
      thoughtNumber: 1,
      totalThoughts: 1,
      nextThoughtNeeded: false,
      stage: "Analysis",
    };
    const thought = thoughtFromDict(dict);
    expect(thought.id).toBeDefined();
    expect(thought.id).toMatch(/^[0-9a-f-]+$/);
  });
});

describe("generateUuid", () => {
  it("generates valid UUID format", () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuid()));
    expect(ids.size).toBe(100);
  });
});

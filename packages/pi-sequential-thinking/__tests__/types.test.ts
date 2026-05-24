import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_LABEL,
  generateUuid,
  isValidThoughtData,
  normalizeSessionId,
  normalizeThoughtInput,
  parseThoughtStage,
  pickAliasedArg,
  ThoughtStage,
  ThoughtValidationError,
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

describe("normalizeSessionId", () => {
  it("normalizes omitted sessions to the default label", () => {
    expect(normalizeSessionId(undefined)).toEqual({ sessionId: null, sessionLabel: DEFAULT_SESSION_LABEL });
  });

  it("trims and accepts path-safe named sessions", () => {
    expect(normalizeSessionId("  architecture.review-1  ")).toEqual({
      sessionId: "architecture.review-1",
      sessionLabel: "architecture.review-1",
    });
  });

  it("rejects empty, traversal, separator, long, and reserved default session ids", () => {
    for (const sessionId of ["", "   ", "bad/session", "bad\\session", "../bad", ".", "..", "default", "DEFAULT"]) {
      expect(() => normalizeSessionId(sessionId)).toThrow(ThoughtValidationError);
    }

    expect(() => normalizeSessionId("a".repeat(81))).toThrow(ThoughtValidationError);
  });
});

describe("normalizeThoughtInput", () => {
  it("normalizes snake_case thought input", () => {
    const result = normalizeThoughtInput({
      thought: "Use snake case",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: "Analysis",
      tags: ["compat"],
      axioms_used: ["Preserve old calls"],
      assumptions_challenged: ["Only camelCase matters"],
    });

    expect(result.thought).toMatchObject({
      thought: "Use snake case",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: ThoughtStage.ANALYSIS,
      tags: ["compat"],
      axioms_used: ["Preserve old calls"],
      assumptions_challenged: ["Only camelCase matters"],
    });
    expect(result.session).toEqual({ sessionId: null, sessionLabel: DEFAULT_SESSION_LABEL });
    expect(result.adjustments).toEqual({});
  });

  it("normalizes camelCase aliases and named sessions", () => {
    const result = normalizeThoughtInput({
      thought: "Use aliases",
      thoughtNumber: 2,
      totalThoughts: 4,
      nextThoughtNeeded: false,
      stage: "Synthesis",
      axiomsUsed: ["Boundary compatibility"],
      assumptionsChallenged: ["Schemas must stay snake-only"],
      sessionId: "review",
    });

    expect(result.thought.thought_number).toBe(2);
    expect(result.thought.total_thoughts).toBe(4);
    expect(result.thought.next_thought_needed).toBe(false);
    expect(result.thought.stage).toBe(ThoughtStage.SYNTHESIS);
    expect(result.thought.axioms_used).toEqual(["Boundary compatibility"]);
    expect(result.thought.assumptions_challenged).toEqual(["Schemas must stay snake-only"]);
    expect(result.session).toEqual({ sessionId: "review", sessionLabel: "review" });
  });

  it("allows matching snake_case and camelCase aliases after normalization", () => {
    const result = normalizeThoughtInput({
      thought: "Both aliases agree",
      thought_number: 1,
      thoughtNumber: 1,
      total_thoughts: 2,
      totalThoughts: 2,
      next_thought_needed: true,
      nextThoughtNeeded: true,
      stage: "Research",
      axioms_used: ["a", "b"],
      axiomsUsed: ["a", "b"],
      session_id: "  aliases  ",
      sessionId: "aliases",
    });

    expect(result.thought.thought_number).toBe(1);
    expect(result.thought.axioms_used).toEqual(["a", "b"]);
    expect(result.session.sessionId).toBe("aliases");
  });

  it("fails on conflicting aliases", () => {
    expect(() =>
      normalizeThoughtInput({
        thought: "Conflict",
        thought_number: 1,
        thoughtNumber: 2,
        total_thoughts: 2,
        next_thought_needed: false,
        stage: "Analysis",
      }),
    ).toThrow(/conflicting aliases.*thought_number/i);

    expect(() =>
      normalizeThoughtInput({
        thought: "Array conflict",
        thought_number: 1,
        total_thoughts: 2,
        next_thought_needed: false,
        stage: "Analysis",
        axioms_used: ["a", "b"],
        axiomsUsed: ["b", "a"],
      }),
    ).toThrow(/conflicting aliases.*axioms_used/i);
  });

  it("rejects thought_number and total_thoughts beyond the upper bound", () => {
    expect(() =>
      normalizeThoughtInput({
        thought: "Way too big",
        thought_number: Number.MAX_SAFE_INTEGER,
        total_thoughts: 3,
        next_thought_needed: false,
        stage: "Analysis",
      }),
    ).toThrow(/thought_number/);

    expect(() =>
      normalizeThoughtInput({
        thought: "Way too big total",
        thought_number: 1,
        total_thoughts: 1_000_001,
        next_thought_needed: false,
        stage: "Analysis",
      }),
    ).toThrow(/total_thoughts/);
  });

  it("dynamically raises total_thoughts for the incoming thought only", () => {
    const result = normalizeThoughtInput({
      thought: "Need more steps",
      thought_number: 5,
      total_thoughts: 3,
      next_thought_needed: true,
      stage: "Analysis",
    });

    expect(result.thought.total_thoughts).toBe(5);
    expect(result.adjustments.totalThoughtsAdjusted).toEqual({ from: 3, to: 5 });
  });

  it("returns field-specific validation errors", () => {
    try {
      normalizeThoughtInput({
        thought: "   ",
        thought_number: 0,
        total_thoughts: 0,
        next_thought_needed: "nope",
        stage: "Unknown",
        tags: ["ok", 123],
      });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThoughtValidationError);
      const validationError = error as ThoughtValidationError;
      expect(validationError.errors.map((e) => e.field)).toEqual(
        expect.arrayContaining(["thought", "thought_number", "total_thoughts", "next_thought_needed", "stage", "tags"]),
      );
    }
  });
});

describe("validateThoughtData", () => {
  it("returns no errors for valid data", () => {
    expect(
      validateThoughtData({
        thought: "My thought",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
        stage: ThoughtStage.ANALYSIS,
        tags: [],
        axioms_used: [],
        assumptions_challenged: [],
      }),
    ).toEqual([]);
  });

  it("does not reject total_thoughts below thought_number because normalization adjusts it", () => {
    expect(
      validateThoughtData({
        thought: "My thought",
        thought_number: 5,
        total_thoughts: 3,
        next_thought_needed: true,
        stage: ThoughtStage.ANALYSIS,
        tags: [],
        axioms_used: [],
        assumptions_challenged: [],
      }),
    ).toEqual([]);
  });

  it("returns error for empty thought", () => {
    expect(validateThoughtData({ thought: "", thought_number: 1, total_thoughts: 3 })).toContainEqual({
      field: "thought",
      message: "Thought content cannot be empty",
    });
  });
});

describe("isValidThoughtData", () => {
  it("returns true for valid data", () => {
    expect(isValidThoughtData({ thought: "My thought", thought_number: 1, total_thoughts: 3 })).toBe(true);
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
    expect(thoughtToDict(thought, true).id).toBe("test-id");
  });
});

describe("pickAliasedArg", () => {
  const identity = (value: unknown) => value;

  it("returns undefined when neither alias is present", () => {
    expect(pickAliasedArg({}, "foo", "fooBar", identity)).toBeUndefined();
  });

  it("returns the snake_case value when only snake_case is present", () => {
    expect(pickAliasedArg({ foo: "snake" }, "foo", "fooBar", identity)).toBe("snake");
  });

  it("returns the camelCase value when only camelCase is present", () => {
    expect(pickAliasedArg({ fooBar: "camel" }, "foo", "fooBar", identity)).toBe("camel");
  });

  it("returns the value when both aliases normalize to the same value", () => {
    const normalize = (value: unknown) => String(value).trim();
    expect(pickAliasedArg({ foo: " same ", fooBar: "same" }, "foo", "fooBar", normalize)).toBe("same");
  });

  it("throws ThoughtValidationError when aliases conflict after validation", () => {
    expect(() => pickAliasedArg({ foo: "a", fooBar: "b" }, "foo", "fooBar", identity)).toThrow(ThoughtValidationError);
    try {
      pickAliasedArg({ foo: "a", fooBar: "b" }, "foo", "fooBar", identity);
    } catch (error) {
      expect(error).toBeInstanceOf(ThoughtValidationError);
      expect((error as ThoughtValidationError).errors).toContainEqual({
        field: "foo",
        message: "Conflicting aliases for foo",
      });
    }
  });

  it("propagates ThoughtValidationError thrown by the validator", () => {
    const strict = (value: unknown) => {
      if (typeof value !== "boolean") {
        throw new ThoughtValidationError([{ field: "flag", message: "flag must be a boolean" }]);
      }
      return value;
    };
    expect(() => pickAliasedArg({ flag: "not-bool" }, "flag", "flagAlias", strict)).toThrow(ThoughtValidationError);
  });

  it("treats explicit-undefined as absent for both aliases", () => {
    // Programmatic callers using object spread can produce { foo: undefined, fooBar: 'x' };
    // treat that as absent rather than throwing a spurious alias-conflict.
    expect(pickAliasedArg({ foo: undefined, fooBar: "x" }, "foo", "fooBar", identity)).toBe("x");
    expect(pickAliasedArg({ foo: "x", fooBar: undefined }, "foo", "fooBar", identity)).toBe("x");
    expect(pickAliasedArg({ foo: undefined, fooBar: undefined }, "foo", "fooBar", identity)).toBeUndefined();
  });
});

describe("generateUuid", () => {
  it("generates valid UUID format", () => {
    expect(generateUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuid()));
    expect(ids.size).toBe(100);
  });
});

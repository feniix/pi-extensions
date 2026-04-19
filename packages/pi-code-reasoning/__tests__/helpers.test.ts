import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildError,
  buildSuccess,
  createThoughtTracker,
  DEFAULT_CONFIG_FILE,
  formatToolOutput,
  getExampleThought,
  isRecord,
  normalizeNumber,
  parseConfig,
  resolveConfigPath,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
} from "../extensions/index.js";

describe("pi-code-reasoning helpers", () => {
  it("splits params and clamps limits", () => {
    const { toolArgs, requestedLimits } = splitParams({
      piMaxBytes: "100",
      piMaxLines: 5,
      thought: "hello",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    });
    expect(toolArgs).toEqual({
      thought: "hello",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
    });
    expect(requestedLimits).toEqual({ maxBytes: 100, maxLines: 5 });

    const effective = resolveEffectiveLimits({ maxBytes: 200, maxLines: 2 }, { maxBytes: 120, maxLines: 10 });
    expect(effective).toEqual({ maxBytes: 120, maxLines: 2 });
  });

  it("resolves effective limits using defaults when not requested", () => {
    const effective = resolveEffectiveLimits({}, { maxBytes: 51200, maxLines: 2000 });
    expect(effective).toEqual({ maxBytes: 51200, maxLines: 2000 });
  });

  it("normalizes numbers from strings and numbers", () => {
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber("123")).toBe(123);
    expect(normalizeNumber("abc")).toBeUndefined();
    expect(normalizeNumber(null)).toBeUndefined();
    expect(normalizeNumber(undefined)).toBeUndefined();
    expect(normalizeNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("returns DEFAULT_CONFIG_FILE", () => {
    expect(DEFAULT_CONFIG_FILE).toHaveProperty("maxBytes");
    expect(DEFAULT_CONFIG_FILE).toHaveProperty("maxLines");
  });
});

describe("pi-code-reasoning type guards", () => {
  it("isRecord returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("isRecord returns false for non-objects", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord([])).toBe(false);
  });
});

describe("pi-code-reasoning toJsonString", () => {
  it("returns strings as-is", () => {
    expect(toJsonString("hello")).toBe("hello");
    expect(toJsonString("")).toBe("");
  });

  it("stringifies objects", () => {
    const result = toJsonString({ a: 1, b: 2 });
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it("converts primitives", () => {
    expect(toJsonString(42)).toBe("42");
    expect(toJsonString(true)).toBe("true");
    expect(toJsonString(null)).toBe("null");
  });
});

describe("pi-code-reasoning resolveConfigPath", () => {
  it("resolves paths starting with ~/", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(homedir());
    expect(result).toContain(".pi/config.json");
  });

  it("resolves paths starting with ~", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(".pi/config.json");
  });

  it("returns absolute paths as-is", () => {
    const absolute = "/absolute/path/to/config.json";
    expect(resolveConfigPath(absolute)).toBe(absolute);
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveConfigPath("relative/path.json");
    expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
  });
});

describe("pi-code-reasoning parseConfig", () => {
  it("parses valid config", () => {
    const raw = {
      maxBytes: 1024,
      maxLines: 500,
    };
    const result = parseConfig(raw, "/path/to/config.json");
    expect(result).toEqual({
      maxBytes: 1024,
      maxLines: 500,
    });
  });

  it("ignores null/undefined values", () => {
    const raw = { maxBytes: undefined, maxLines: NaN };
    const result = parseConfig(raw, "/path");
    expect(result.maxBytes).toBeUndefined();
    expect(result.maxLines).toBeUndefined();
  });

  it("throws for non-object config", () => {
    expect(() => parseConfig(null, "/path")).toThrow("Invalid Code Reasoning config");
    expect(() => parseConfig("string", "/path")).toThrow("Invalid Code Reasoning config");
    expect(() => parseConfig(123, "/path")).toThrow("Invalid Code Reasoning config");
  });
});

describe("pi-code-reasoning formatToolOutput", () => {
  it("formats simple result", () => {
    const result = formatToolOutput("test_tool", { message: "Hello" }, { maxBytes: 50000, maxLines: 2000 });
    expect(result.text).toContain("Hello");
    expect(result.details.truncated).toBe(false);
  });

  it("handles object result", () => {
    const result = formatToolOutput("test_tool", { data: 123 }, {});
    expect(result.text).toContain("data");
    expect(result.text).toContain("123");
  });
});

describe("pi-code-reasoning writeTempFile", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    import("node:fs").then(({ unlinkSync }) => {
      tempFiles.forEach((f) => {
        try {
          unlinkSync(f);
        } catch {
          // ignore cleanup errors
        }
      });
    });
  });

  it("writes temp file and returns path", () => {
    const path = writeTempFile("test_tool", "content here");
    tempFiles.push(path);
    expect(path).toContain("pi-code-reasoning-test_tool");
    expect(path).toContain(".txt");
    expect(existsSync(path)).toBe(true);
  });

  it("sanitizes tool name", () => {
    const path = writeTempFile("my-tool!@#", "content");
    tempFiles.push(path);
    expect(path).toContain("my-tool__");
  });
});

describe("pi-code-reasoning createThoughtTracker", () => {
  it("creates a tracker with zero count", () => {
    const tracker = createThoughtTracker();
    expect(tracker.count()).toBe(0);
  });

  it("adds thoughts to tracker", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "First thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: undefined,
      needs_more_thoughts: false,
    });
    expect(tracker.count()).toBe(1);
  });

  it("tracks multiple thoughts", () => {
    const tracker = createThoughtTracker();
    for (let i = 1; i <= 5; i++) {
      tracker.add({
        thought: `Thought ${i}`,
        thought_number: i,
        total_thoughts: 5,
        next_thought_needed: i < 5,
        is_revision: false,
        branch_from_thought: undefined,
        branch_id: undefined,
        needs_more_thoughts: false,
      });
    }
    expect(tracker.count()).toBe(5);
  });

  it("tracks branches", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "Main thought",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: undefined,
      needs_more_thoughts: false,
    });
    tracker.add({
      thought: "Branch thought",
      thought_number: 2,
      total_thoughts: 3,
      next_thought_needed: false,
      is_revision: false,
      branch_from_thought: 1,
      branch_id: "alt-1",
      needs_more_thoughts: false,
    });
    expect(tracker.branches()).toContain("alt-1");
  });

  it("resets tracker", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "Thought",
      thought_number: 1,
      total_thoughts: 1,
      next_thought_needed: false,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: "branch-1",
      needs_more_thoughts: false,
    });
    tracker.reset();
    expect(tracker.count()).toBe(0);
    expect(tracker.branches()).toEqual([]);
  });

  it("validates branch_from_thought", () => {
    const tracker = createThoughtTracker();
    // Add a thought first so position 1 is valid
    tracker.add({
      thought: "First",
      thought_number: 1,
      total_thoughts: 5,
      next_thought_needed: true,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: undefined,
      needs_more_thoughts: false,
    });
    // Should not throw for valid branch
    expect(() => tracker.ensureBranchIsValid(1)).not.toThrow();
    // Should throw for invalid branch
    expect(() => tracker.ensureBranchIsValid(100)).toThrow("Invalid branch_from_thought");
  });

  it("validates revises_thought", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "First",
      thought_number: 1,
      total_thoughts: 5,
      next_thought_needed: true,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: undefined,
      needs_more_thoughts: false,
    });
    expect(() => tracker.ensureRevisionIsValid(1)).not.toThrow();
    expect(() => tracker.ensureRevisionIsValid(100)).toThrow("Invalid revises_thought");
  });

  it("handles multiple branches", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "Branch 1",
      thought_number: 2,
      total_thoughts: 3,
      next_thought_needed: false,
      is_revision: false,
      branch_from_thought: 1,
      branch_id: "branch-a",
      needs_more_thoughts: false,
    });
    tracker.add({
      thought: "Branch 2",
      thought_number: 3,
      total_thoughts: 3,
      next_thought_needed: false,
      is_revision: false,
      branch_from_thought: 1,
      branch_id: "branch-b",
      needs_more_thoughts: false,
    });
    expect(tracker.branches()).toContain("branch-a");
    expect(tracker.branches()).toContain("branch-b");
    expect(tracker.branches()).toHaveLength(2);
  });
});

describe("pi-code-reasoning getExampleThought", () => {
  it("returns branch example for branch error", () => {
    const example = getExampleThought("branch error");
    expect(example.branch_from_thought).toBe(2);
    expect(example.branch_id).toBe("alternative-algo-x");
  });

  it("returns revision example for revision error", () => {
    const example = getExampleThought("revis");
    expect(example.is_revision).toBe(true);
    expect(example.revises_thought).toBe(2);
  });

  it("returns length example for length error", () => {
    const example = getExampleThought("length");
    expect(example.thought).toContain("Breaking down");
  });

  it("returns default example", () => {
    const example = getExampleThought("unknown error");
    expect(example.thought_number).toBe(1);
    expect(example.total_thoughts).toBe(5);
  });
});

describe("pi-code-reasoning buildSuccess", () => {
  it("builds success response", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "Test",
      thought_number: 1,
      total_thoughts: 3,
      next_thought_needed: true,
      is_revision: false,
      branch_from_thought: undefined,
      branch_id: undefined,
      needs_more_thoughts: false,
    });
    const result = buildSuccess(
      {
        thought: "Test",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
        is_revision: false,
        branch_from_thought: undefined,
        branch_id: undefined,
        needs_more_thoughts: false,
      },
      tracker,
    );
    expect(result.status).toBe("processed");
    expect(result.thought_number).toBe(1);
    expect(result.total_thoughts).toBe(3);
    expect(result.next_thought_needed).toBe(true);
    expect(result.thought_history_length).toBe(1);
  });

  it("includes branches in response", () => {
    const tracker = createThoughtTracker();
    tracker.add({
      thought: "Branch",
      thought_number: 2,
      total_thoughts: 3,
      next_thought_needed: false,
      is_revision: false,
      branch_from_thought: 1,
      branch_id: "my-branch",
      needs_more_thoughts: false,
    });
    const result = buildSuccess(
      {
        thought: "Branch",
        thought_number: 2,
        total_thoughts: 3,
        next_thought_needed: false,
        is_revision: false,
        branch_from_thought: 1,
        branch_id: "my-branch",
        needs_more_thoughts: false,
      },
      tracker,
    );
    expect(result.branches as string[]).toContain("my-branch");
  });
});

describe("pi-code-reasoning buildError", () => {
  it("builds error response", () => {
    const error = new Error("Test error");
    const result = buildError(error);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Test error");
  });

  it("provides branch guidance", () => {
    const error = new Error("branch error");
    const result = buildError(error);
    const guidance = result.guidance as string;
    expect(guidance).toContain("branch_from_thought");
    expect(guidance).toContain("branch_id");
  });

  it("provides revision guidance", () => {
    const error = new Error("revision error");
    const result = buildError(error);
    const guidance = result.guidance as string;
    expect(guidance).toContain("is_revision");
    expect(guidance).toContain("revises_thought");
  });

  it("provides length guidance", () => {
    const error = new Error("length exceeded");
    const result = buildError(error);
    const guidance = result.guidance as string;
    expect(guidance).toContain("characters");
  });

  it("provides max thoughts guidance", () => {
    const error = new Error("Max thought limit exceeded");
    const result = buildError(error);
    const guidance = result.guidance as string;
    expect(guidance).toContain("maximum thought limit");
  });

  it("includes example in error", () => {
    const error = new Error("branch error");
    const result = buildError(error);
    expect(result.example).toBeDefined();
  });

  it("provides default guidance", () => {
    const error = new Error("unknown error");
    const result = buildError(error);
    const guidance = result.guidance as string;
    expect(guidance).toContain("Check the tool description");
  });
});

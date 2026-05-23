import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import codeReasoning from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn((_flagName: string): string | undefined => undefined),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

const getRegisteredTool = (mockPi: ReturnType<typeof createMockPi>, name: string) => {
  const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
  const tool = tools.find((registeredTool) => registeredTool.name === name);
  expect(tool).toBeDefined();
  return tool;
};

const baseThought = (overrides: Record<string, unknown> = {}) => ({
  thought: "A thought about the problem",
  thought_number: 1,
  total_thoughts: 1,
  next_thought_needed: false,
  ...overrides,
});

const expectStructuredError = (
  result: Awaited<ReturnType<NonNullable<ReturnType<typeof getRegisteredTool>>["execute"]>>,
  message: string,
) => {
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain(message);
  expect(result.details.error).toContain(message);
};

describe("pi-code-reasoning", () => {
  it("registers tools", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["code_reasoning", "code_reasoning_status", "code_reasoning_reset"]),
    );
  });

  it("registers flags", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toEqual(
      expect.arrayContaining([
        "--code-reasoning-config-file",
        "--code-reasoning-config",
        "--code-reasoning-max-bytes",
        "--code-reasoning-max-lines",
      ]),
    );
  });

  it("registers exactly 3 tools", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toHaveLength(3);
  });

  it("registers exactly 4 flags", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toHaveLength(4);
  });

  it("registers tools with execute functions", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    tools.forEach((tool) => {
      expect(tool.execute).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    });
  });

  it("registers tools with parameters schema", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");
    expect(mainTool?.parameters).toBeDefined();
  });

  it("registers tools with descriptions", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    tools.forEach((tool) => {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });

  it("registers tools with labels", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");
    expect(mainTool?.label).toBe("Code Reasoning");
  });

  it("registers flags with string type", () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const flags = mockPi.registerFlag.mock.calls.map(([name, opts]) => ({ name, ...opts }));
    flags.forEach((flag) => {
      expect(flag.type).toBe("string");
    });
  });

  it("can be called multiple times with separate state", () => {
    const mockPi1 = createMockPi();
    const mockPi2 = createMockPi();

    codeReasoning(mockPi1 as unknown as ExtensionAPI);
    codeReasoning(mockPi2 as unknown as ExtensionAPI);

    expect(mockPi1.registerTool).toHaveBeenCalledTimes(3);
    expect(mockPi2.registerTool).toHaveBeenCalledTimes(3);
  });

  it("executes code_reasoning tool and returns result", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      {
        thought: "First thought about the problem",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
      },
      undefined,
      undefined,
      undefined,
    );

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].text).toContain("processed");
  });

  it("executes code_reasoning_status tool", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const statusTool = getRegisteredTool(mockPi, "code_reasoning_status");

    const result = await statusTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("executes code_reasoning_reset tool", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const resetTool = getRegisteredTool(mockPi, "code_reasoning_reset");

    const result = await resetTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result).toBeDefined();
    expect(result.content[0].text).toContain("reset");
  });

  it("returns structured isError results for schema validation failures", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      {
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
      },
      undefined,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments for code_reasoning");
    expect(result.details.validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("thought") })]),
    );
  });

  it("validates thought parameters", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      {
        thought: "",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
      },
      undefined,
      undefined,
      undefined,
    );

    expectStructuredError(result, "Thought cannot be empty");
  });

  it("handles non-Error exceptions from tool setup", async () => {
    const mockPi = createMockPi();
    mockPi.getFlag.mockImplementation(() => {
      throw "flag failed";
    });
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const statusTool = getRegisteredTool(mockPi, "code_reasoning_status");

    const result = await statusTool?.execute("call-123", {}, undefined, undefined, undefined);

    expectStructuredError(result, "flag failed");
  });

  it("tracks multiple thoughts", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    await mainTool?.execute(
      "call-1",
      {
        thought: "First thought",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
      },
      undefined,
      undefined,
      undefined,
    );

    const result2 = await mainTool?.execute(
      "call-2",
      {
        thought: "Second thought",
        thought_number: 2,
        total_thoughts: 3,
        next_thought_needed: true,
      },
      undefined,
      undefined,
      undefined,
    );

    expect(result2.content[0].text).toContain("2");
  });

  it("rejects thought_number greater than total_thoughts", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      baseThought({
        thought: "Invalid ordering",
        thought_number: 4,
        total_thoughts: 3,
        next_thought_needed: true,
      }),
      undefined,
      undefined,
      undefined,
    );

    expectStructuredError(result, "thought_number cannot exceed total_thoughts");
  });

  it("rejects thoughts above the configured thought number limit", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      baseThought({ thought_number: 21, total_thoughts: 21 }),
      undefined,
      undefined,
      undefined,
    );

    expectStructuredError(result, "Max thought_number exceeded");
  });

  it("rejects invalid branch field combinations", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      baseThought({ branch_id: "missing-source" }),
      undefined,
      undefined,
      undefined,
    );

    expectStructuredError(result, "branch_id and branch_from_thought required together");
  });

  it("applies config-file and output-limit flags", async () => {
    const mockPi = createMockPi();
    mockPi.getFlag.mockImplementation((flagName) => {
      const flags: Record<string, string> = {
        "--code-reasoning-config-file": "/tmp/missing-code-reasoning-config.json",
        "--code-reasoning-max-bytes": "99999",
        "--code-reasoning-max-lines": "999",
      };
      return flags[String(flagName)];
    });
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const statusTool = getRegisteredTool(mockPi, "code_reasoning_status");
    const result = await statusTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result.content[0].text).toContain("thought_count");
    expect(result.details.truncated).toBe(false);
  });

  it("supports the deprecated config flag with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mockPi = createMockPi();
    mockPi.getFlag.mockImplementation((flagName) =>
      flagName === "--code-reasoning-config" ? "/tmp/missing-code-reasoning-legacy-config.json" : undefined,
    );
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const statusTool = getRegisteredTool(mockPi, "code_reasoning_status");
    const result = await statusTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result.content[0].text).toContain("thought_count");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("--code-reasoning-config is deprecated"));
  });

  it("caps the in-memory thought history", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const mainTool = getRegisteredTool(mockPi, "code_reasoning");

    for (let call = 1; call <= 20; call += 1) {
      const result = await mainTool?.execute(
        `call-${call}`,
        baseThought({ thought: `Thought ${call}` }),
        undefined,
        undefined,
        undefined,
      );
      expect(result.content[0].text).toContain("processed");
    }

    const result = await mainTool?.execute(
      "call-21",
      baseThought({ thought: "One thought too many" }),
      undefined,
      undefined,
      undefined,
    );

    expectStructuredError(result, "Max thought limit reached");
  });
});

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import codeReasoning from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

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

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");
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

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");
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

    // Each should register its own tools
    expect(mockPi1.registerTool).toHaveBeenCalledTimes(3);
    expect(mockPi2.registerTool).toHaveBeenCalledTimes(3);
  });

  it("executes code_reasoning tool and returns result", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");

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

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const statusTool = tools.find((t) => t.name === "code_reasoning_status");

    const result = await statusTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("executes code_reasoning_reset tool", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const resetTool = tools.find((t) => t.name === "code_reasoning_reset");

    const result = await resetTool?.execute("call-123", {}, undefined, undefined, undefined);

    expect(result).toBeDefined();
    expect(result.content[0].text).toContain("reset");
  });

  it("validates thought parameters", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");

    // Missing required parameter should fail
    const result = await mainTool?.execute("call-123", { thought: "" }, undefined, undefined, undefined);

    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Thought cannot be empty");
  });

  it("tracks multiple thoughts", async () => {
    const mockPi = createMockPi();
    codeReasoning(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");

    // Add first thought
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

    // Add second thought
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

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const mainTool = tools.find((t) => t.name === "code_reasoning");

    const result = await mainTool?.execute(
      "call-123",
      {
        thought: "Invalid ordering",
        thought_number: 4,
        total_thoughts: 3,
        next_thought_needed: true,
      },
      undefined,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("thought_number cannot exceed total_thoughts");
  });
});

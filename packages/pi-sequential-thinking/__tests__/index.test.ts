import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import sequentialThinking from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

describe("pi-sequential-thinking", () => {
  it("registers tools", () => {
    const mockPi = createMockPi();
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "process_thought",
        "generate_summary",
        "clear_history",
        "export_session",
        "import_session",
        "get_thinking_history",
        "get_thinking_status",
        "sequential_think",
      ]),
    );
  });

  it("registers process_thought schema without requiring snake_case aliases only", () => {
    const mockPi = createMockPi();
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = mockPi.registerTool.mock.calls
      .map(([tool]) => tool)
      .find((tool) => tool.name === "process_thought");
    const required = (processTool?.parameters as { required?: string[] }).required ?? [];

    expect(required).toContain("thought");
    expect(required).toContain("stage");
    expect(required).not.toContain("thought_number");
    expect(required).not.toContain("total_thoughts");
    expect(required).not.toContain("next_thought_needed");
  });

  it("registers flags", () => {
    const mockPi = createMockPi();
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toEqual(
      expect.arrayContaining([
        "--seq-think-storage-dir",
        "--seq-think-config-file",
        "--seq-think-config",
        "--seq-think-max-bytes",
        "--seq-think-max-lines",
      ]),
    );
  });

  it("does not register command/args flags (native implementation)", () => {
    const mockPi = createMockPi();
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).not.toContain("--seq-think-command");
    expect(flagNames).not.toContain("--seq-think-args");
  });
});

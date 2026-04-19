import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
      ]),
    );
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

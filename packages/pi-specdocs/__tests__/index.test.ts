import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import specdocs from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

describe("pi-specdocs", () => {
  it("registers session_start handler", () => {
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);

    const events = mockPi.on.mock.calls.map(([event]) => event);
    expect(events).toContain("session_start");
  });

  it("registers tool_result handler", () => {
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);

    const events = mockPi.on.mock.calls.map(([event]) => event);
    expect(events).toContain("tool_result");
  });

  it("registers specdocs-validate command", () => {
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);

    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "specdocs-validate",
      expect.objectContaining({
        description: expect.stringContaining("specdocs"),
      }),
    );
  });

  it("registers specdocs-format command", () => {
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);

    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "specdocs-format",
      expect.objectContaining({
        description: expect.stringContaining("format"),
      }),
    );
  });

  it("does not register any tools", () => {
    const mockPi = createMockPi();
    specdocs(mockPi as unknown as ExtensionAPI);

    expect(mockPi.registerTool).not.toHaveBeenCalled();
  });
});

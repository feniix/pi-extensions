import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import notion from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

const getEventHandler = (mockPi: ReturnType<typeof createMockPi>, eventName: string) => {
  const entry = mockPi.on.mock.calls.find(([event]) => event === eventName);
  return entry?.[1];
};

describe("pi-notion extension runtime", () => {
  it("registers config-file flags", () => {
    const mockPi = createMockPi();
    notion(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toContain("--notion-config-file");
    expect(flagNames).toContain("--notion-config");
  });

  it("supports deprecated notion config flag alias with warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const original = process.env.NOTION_CONFIG_FILE;
    const mockPi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn((flag: string) => (flag === "--notion-config" ? "~/legacy-notion-config.json" : undefined)),
      registerTool: vi.fn(),
      on: vi.fn(),
    } satisfies Partial<ExtensionAPI>;

    try {
      notion(mockPi as unknown as ExtensionAPI);
      expect(process.env.NOTION_CONFIG_FILE).toBe("~/legacy-notion-config.json");
      expect(warnSpy).toHaveBeenCalledWith("[pi-notion] --notion-config is deprecated; use --notion-config-file.");
    } finally {
      warnSpy.mockRestore();
      if (original) process.env.NOTION_CONFIG_FILE = original;
      else delete process.env.NOTION_CONFIG_FILE;
    }
  });
  it("warns for incorrect notion-search inputs", async () => {
    const mockPi = createMockPi();
    notion(mockPi as unknown as ExtensionAPI);
    const toolCall = getEventHandler(mockPi, "tool_call");
    const notify = vi.fn();

    await toolCall?.({ toolName: "mcp__notion-search", input: { query: "meeting notes" } }, { ui: { notify } });

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("content_search_mode is not 'workspace_search'"),
      "warning",
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("'filters' key is missing"), "warning");
  });

  it("warns for raw fetch ids and empty meeting note filters", async () => {
    const mockPi = createMockPi();
    notion(mockPi as unknown as ExtensionAPI);
    const toolCall = getEventHandler(mockPi, "tool_call");
    const notify = vi.fn();

    await toolCall?.({ toolName: "mcp__notion-fetch", input: { id: "12345" } }, { ui: { notify } });
    await toolCall?.({ toolName: "mcp__notion-query-meeting-notes", input: { filter: {} } }, { ui: { notify } });

    expect(notify).toHaveBeenNthCalledWith(1, expect.stringContaining("Prefer the 'url' field"), "warning");
    expect(notify).toHaveBeenNthCalledWith(2, expect.stringContaining("Empty filter {} will fail"), "warning");
  });
});

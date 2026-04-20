import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import refTools from "../extensions/index.js";

const createMockPi = () =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

const getRegisteredTool = (mockPi: ReturnType<typeof createMockPi>, name: string) => {
  const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
  return tools.find((tool) => tool.name === name);
};

describe("pi-ref-tools tool execution", () => {
  it("returns cancelled response for ref_search_documentation when aborted", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "ref_search_documentation");
    const result = await searchTool?.execute(
      "call-123",
      { query: "test" },
      { aborted: true } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.content[0].text).toContain("Cancelled");
    expect(result.details.cancelled).toBe(true);
  });

  it("returns cancelled response for ref_read_url when aborted", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const readTool = getRegisteredTool(mockPi, "ref_read_url");
    const result = await readTool?.execute(
      "call-123",
      { url: "https://example.com" },
      { aborted: true } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.content[0].text).toContain("Cancelled");
    expect(result.details.cancelled).toBe(true);
  });

  it("emits a pending update before executing", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "ref_search_documentation");
    const onUpdate = vi.fn();

    try {
      await searchTool?.execute("call-123", { query: "test" }, { aborted: false } as AbortSignal, onUpdate, undefined);
    } catch {
      // Expected to fail without a real MCP server.
    }

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Searching Ref documentation..." }],
      details: { status: "pending" },
    });
  });
});

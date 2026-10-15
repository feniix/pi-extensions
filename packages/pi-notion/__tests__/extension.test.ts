import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import notion, { NOTION_MCP_SERVER, NOTION_MCP_URL } from "../extensions/index.js";

interface MockPi {
  registerMcpServer: ReturnType<typeof vi.fn> | undefined;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const createMockPi = (overrides: Partial<MockPi> = {}): MockPi => ({
  registerMcpServer: vi.fn(),
  registerCommand: vi.fn(),
  on: vi.fn(),
  ...overrides,
});

function load(mockPi: MockPi = createMockPi()) {
  notion(mockPi as unknown as ExtensionAPI);
  return { mockPi };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pi-notion extension", () => {
  it("registers Notion's hosted MCP server with pi's built-in MCP support, deferred", () => {
    const { mockPi } = load();

    expect(mockPi.registerMcpServer).toHaveBeenCalledWith(
      NOTION_MCP_SERVER,
      expect.objectContaining({ url: NOTION_MCP_URL, exposure: "deferred", description: expect.any(String) }),
    );
    expect(NOTION_MCP_SERVER).toBe("notion");
    expect(NOTION_MCP_URL).toBe("https://mcp.notion.com/mcp");
  });

  it("warns instead of failing when the server cannot be registered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mockPi = createMockPi({
      registerMcpServer: vi.fn(() => {
        throw new Error('MCP server "notion" is already registered by another extension');
      }),
    });

    expect(() => load(mockPi)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already registered by another extension"));
    expect(mockPi.registerCommand).toHaveBeenCalledWith("notion", expect.any(Object));
  });

  it("warns on a pi without built-in MCP support", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mockPi = createMockPi({ registerMcpServer: undefined });

    expect(() => load(mockPi)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("needs pi 1.1.0 or later"));
  });

  it("points /notion at the built-in sign-in", async () => {
    const { mockPi } = load();
    const [name, command] = mockPi.registerCommand.mock.calls[0] ?? [];
    const notify = vi.fn();

    await command.handler("", { ui: { notify } });

    expect(name).toBe("notion");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("/mcp login notion"), "info");
  });

  it("leaves Notion tool calls alone", () => {
    // Live, every guardrail warning was wrong or repeated pi's own schema error, and coercion
    // stored numbers sent to text properties as empty values
    const { mockPi } = load();

    expect(mockPi.on).not.toHaveBeenCalled();
  });
});

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import notion, {
  coerceNumericProperties,
  NOTION_MCP_SERVER,
  NOTION_MCP_URL,
  notionToolName,
} from "../extensions/index.js";

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
  const toolCall = mockPi.on.mock.calls.find(([event]) => event === "tool_call")?.[1];
  const notify = vi.fn();
  return {
    mockPi,
    notify,
    call: (toolName: string, input: Record<string, unknown>, parentToolCallId?: string) =>
      toolCall({ type: "tool_call", toolName, toolCallId: "call-1", parentToolCallId, input }, { ui: { notify } }),
  };
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
    expect(mockPi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
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
});

describe("notionToolName", () => {
  it.each([
    ["mcp__notion__notion_search", "notion-search"],
    ["mcp__notion__notion_query_meeting_notes", "notion-query-meeting-notes"],
    // a server configured under another name in mcp.json
    ["mcp__work_notion__notion_fetch", "notion-fetch"],
  ])("maps %s to %s", (toolName, expected) => {
    expect(notionToolName(toolName)).toBe(expected);
  });

  it.each(["bash", "mcp__github__search_code", "notion_search", "mcp__notion__"])("ignores %s", (toolName) => {
    expect(notionToolName(toolName)).toBeUndefined();
  });
});

describe("guardrails", () => {
  it("does not warn about notion-search's default mode or a missing filters key", async () => {
    // Live, the default ai_search returned workspace pages (plus connected sources), and
    // workspace_search worked without filters, so neither is a mistake.
    const { call, notify } = load();

    await call("mcp__notion__notion_search", { query: "meeting notes" });
    await call("mcp__notion__notion_search", { query: "roadmap", content_search_mode: "workspace_search" });

    expect(notify).not.toHaveBeenCalled();
  });

  it("warns for raw fetch ids and empty meeting note filters, including calls from codemode scripts", async () => {
    const { call, notify } = load();

    await call("mcp__notion__notion_fetch", { id: "12345" }, "codemode-1");
    await call("mcp__notion__notion_query_meeting_notes", { filter: {} });

    expect(notify).toHaveBeenNthCalledWith(1, expect.stringContaining("Prefer the 'url' field"), "warning");
    expect(notify).toHaveBeenNthCalledWith(2, expect.stringContaining("Empty filter {} will fail"), "warning");
  });

  it("stays quiet for correct inputs and other tools", async () => {
    const { call, notify } = load();

    await call("mcp__notion__notion_search", { query: "q", content_search_mode: "workspace_search", filters: {} });
    await call("mcp__notion__notion_fetch", { id: "https://www.notion.so/page-123" });
    await call("mcp__github__search_code", { query: "notion" });
    await call("bash", { command: "echo notion" });

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("numeric property coercion", () => {
  it("rewrites numeric strings in page properties in place, so pi sends the coerced arguments", async () => {
    const { call } = load();
    const input = {
      pages: [{ properties: { Count: "5", Price: " 2.50 ", Name: "Q3 plan", Year: "" } }],
      query: "2024",
    };

    await call("mcp__notion__notion_create_pages", input);

    expect(input).toEqual({
      pages: [{ properties: { Count: 5, Price: 2.5, Name: "Q3 plan", Year: "" } }],
      query: "2024",
    });
  });

  it("leaves non-Notion tool inputs untouched", async () => {
    const { call } = load();
    const input = { properties: { Count: "5" } };

    await call("mcp__other__create", input);

    expect(input).toEqual({ properties: { Count: "5" } });
  });

  it("coerces nested property maps without touching other values", () => {
    expect(
      coerceNumericProperties({
        data: { properties: { Score: "10", Tags: ["1", "2"] } },
        properties: { Nested: { properties: { Depth: "3" } } },
        id: "42",
      }),
    ).toEqual({
      data: { properties: { Score: 10, Tags: ["1", "2"] } },
      properties: { Nested: { properties: { Depth: 3 } } },
      id: "42",
    });
  });
});

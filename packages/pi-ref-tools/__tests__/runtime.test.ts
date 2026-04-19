import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import refTools from "../extensions/index.js";

const createMockPi = (flags: Record<string, string | boolean | undefined> = {}) =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn<(name: string) => string | boolean | undefined>((name: string) => flags[name]),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

const getRegisteredTool = (mockPi: ReturnType<typeof createMockPi>, name: string) => {
  const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
  return tools.find((tool) => tool.name === name);
};

const getEventHandler = (mockPi: ReturnType<typeof createMockPi>, eventName: string) => {
  const entry = mockPi.on.mock.calls.find(([event]) => event === eventName);
  return entry?.[1];
};

describe("pi-ref-tools runtime", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.REF_API_KEY;
  const originalUrl = process.env.REF_MCP_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.REF_API_KEY;
    delete process.env.REF_MCP_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.REF_API_KEY;
    else process.env.REF_API_KEY = originalApiKey;
    if (originalUrl === undefined) delete process.env.REF_MCP_URL;
    else process.env.REF_MCP_URL = originalUrl;
  });

  it("logs connected session status from config", async () => {
    const base = mkdtempSync(join(tmpdir(), "pi-ref-runtime-"));
    const configPath = join(base, "ref-tools.json");
    writeFileSync(configPath, JSON.stringify({ url: "https://docs.example.test/mcp", apiKey: "config-key" }), "utf-8");

    const mockPi = createMockPi({ "--ref-mcp-config": configPath });
    refTools(mockPi as unknown as ExtensionAPI);

    const sessionStart = getEventHandler(mockPi, "session_start");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sessionStart?.();

    expect(logSpy).toHaveBeenCalledWith(
      "[ref-tools] Connected to https://docs.example.test/mcp (API key: config file)",
    );
  });

  it("executes ref_search_documentation successfully", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: "ref-mcp-1", result: {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "session-123" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "ref-mcp-2",
            result: { content: [{ type: "text", text: "React documentation result" }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const mockPi = createMockPi({
      "--ref-mcp-url": "https://docs.example.test/mcp",
      "--ref-mcp-api-key": "flag-api-key",
    });
    refTools(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "ref_search_documentation");
    const onUpdate = vi.fn();
    const result = await searchTool?.execute(
      "call-1",
      { query: "React hooks", piMaxBytes: 2000, piMaxLines: 100 },
      new AbortController().signal,
      onUpdate,
      undefined,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Searching Ref documentation..." }],
      details: { status: "pending" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://docs.example.test/mcp",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-ref-api-key": "flag-api-key",
          "mcp-session-id": "session-123",
        }),
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("React documentation result");
    expect(result.details.endpoint).toBe("https://docs.example.test/mcp");
  });

  it("returns a formatted MCP error for ref_read_url failures", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: "ref-mcp-1", result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500, statusText: "Server Error" })) as typeof fetch;

    const mockPi = createMockPi({ "--ref-mcp-url": "https://docs.example.test/mcp" });
    refTools(mockPi as unknown as ExtensionAPI);

    const readTool = getRegisteredTool(mockPi, "ref_read_url");
    const result = await readTool?.execute(
      "call-2",
      { url: "https://example.com/docs" },
      new AbortController().signal,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Ref MCP error: MCP HTTP 500: boom");
    expect(result.details).toEqual({
      tool: "ref_read_url",
      endpoint: "https://docs.example.test/mcp",
      error: "MCP HTTP 500: boom",
    });
  });
});

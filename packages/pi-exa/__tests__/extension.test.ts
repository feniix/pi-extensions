import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequest = vi.fn();

vi.mock("exa-js", () => ({
  Exa: class {
    request = mockRequest;
  },
}));

import exaExtension from "../extensions/index.js";

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

const writeTempConfig = (config: Record<string, unknown>) => {
  const base = mkdtempSync(join(tmpdir(), "pi-exa-extension-"));
  const configPath = join(base, "exa.json");
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, "utf-8");
  return configPath;
};

describe("pi-exa extension", () => {
  const originalApiKey = process.env.EXA_API_KEY;

  beforeEach(() => {
    mockRequest.mockReset();
    if (originalApiKey === undefined) {
      delete process.env.EXA_API_KEY;
    } else {
      process.env.EXA_API_KEY = originalApiKey;
    }
  });

  it("registers flags", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toContain("--exa-api-key");
    expect(flagNames).toContain("--exa-enable-advanced");
    expect(flagNames).toContain("--exa-config");
  });

  it("registers exactly 3 flags", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toHaveLength(3);
  });

  it("registers web_search_exa by default", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    expect(searchTool).toBeDefined();
  });

  it("registers web_fetch_exa by default", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(mockPi, "web_fetch_exa");
    expect(fetchTool).toBeDefined();
  });

  it("does not register web_search_advanced_exa by default", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).not.toContain("web_search_advanced_exa");
  });

  it("registers web_search_advanced_exa when config enables it", () => {
    const configPath = writeTempConfig({
      apiKey: "config-api-key",
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"],
    });
    const mockPi = createMockPi({ "--exa-config": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const advancedTool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    expect(advancedTool).toBeDefined();
  });

  it("registers tools with execute functions", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    expect(tools.length).toBeGreaterThan(0);
    tools.forEach((tool) => {
      expect(tool.execute).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    });
  });

  it("registers tools with labels", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    expect(searchTool?.label).toBe("Exa Web Search");
  });

  it("registers tools with descriptions", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    tools.forEach((tool) => {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });

  it("registers tools with parameters", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    tools.forEach((tool) => {
      expect(tool.parameters).toBeDefined();
    });
  });

  it("registers flags with string type for api-key", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const flags = mockPi.registerFlag.mock.calls.map(([name, opts]) => ({ name, ...opts }));
    const apiKeyFlag = flags.find((f) => f.name === "--exa-api-key");
    expect(apiKeyFlag?.type).toBe("string");
  });

  it("handles missing API key gracefully", async () => {
    delete process.env.EXA_API_KEY;

    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    const result = await searchTool?.execute("call-123", { query: "test" }, undefined, undefined, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API key not configured");
  });

  it("handles aborted signal for web_search_exa", async () => {
    const mockPi = createMockPi({ "--exa-api-key": "flag-api-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    const abortedSignal = { aborted: true } as AbortSignal;
    const result = await searchTool?.execute("call-123", { query: "test" }, abortedSignal, undefined, undefined);

    expect(result.details.cancelled).toBe(true);
  });

  it("calls onUpdate callback for web_search_exa before executing", async () => {
    mockRequest.mockResolvedValue({
      results: [{ title: "Result", url: "https://example.com", text: "Search content" }],
    });

    const mockPi = createMockPi({ "--exa-api-key": "flag-api-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    const onUpdate = vi.fn();
    const result = await searchTool?.execute(
      "call-123",
      { query: "test" },
      { aborted: false } as AbortSignal,
      onUpdate,
      undefined,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Searching the web via Exa..." }],
      details: { status: "pending" },
    });
    expect(result.content[0].text).toContain("https://example.com");
  });

  it("handles multiple extension instances", () => {
    const mockPi1 = createMockPi();
    const mockPi2 = createMockPi();

    exaExtension(mockPi1 as unknown as ExtensionAPI);
    exaExtension(mockPi2 as unknown as ExtensionAPI);

    expect(mockPi1.registerTool).toHaveBeenCalled();
    expect(mockPi2.registerTool).toHaveBeenCalled();
  });

  it("web_fetch_exa handles missing API key", async () => {
    delete process.env.EXA_API_KEY;

    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(mockPi, "web_fetch_exa");
    const result = await fetchTool?.execute(
      "call-123",
      { urls: ["https://example.com"] },
      undefined,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API key not configured");
  });

  it("web_fetch_exa handles aborted signal", async () => {
    const mockPi = createMockPi({ "--exa-api-key": "flag-api-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(mockPi, "web_fetch_exa");
    const result = await fetchTool?.execute(
      "call-123",
      { urls: ["https://example.com"] },
      { aborted: true } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.details.cancelled).toBe(true);
  });

  it("web_fetch_exa returns formatted content and uses the relative contents endpoint", async () => {
    mockRequest.mockResolvedValue({
      results: [
        {
          title: "Fetched Page",
          url: "https://example.com",
          text: "Fetched content",
          publishedDate: "2025-01-15T10:30:00Z",
          author: "Jane Doe",
        },
      ],
    });

    const mockPi = createMockPi({ "--exa-api-key": "flag-api-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(mockPi, "web_fetch_exa");
    const onUpdate = vi.fn();
    const result = await fetchTool?.execute(
      "call-123",
      { urls: ["https://example.com"], maxCharacters: 1234 },
      { aborted: false } as AbortSignal,
      onUpdate,
      undefined,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Fetching content via Exa..." }],
      details: { status: "pending" },
    });
    expect(mockRequest).toHaveBeenCalledWith(
      "/contents",
      "POST",
      expect.objectContaining({
        ids: ["https://example.com"],
        contents: { text: { maxCharacters: 1234 } },
      }),
    );
    expect(result.details.tool).toBe("web_fetch_exa");
    expect(result.content[0].text).toContain("Fetched Page");
    expect(result.content[0].text).toContain("Fetched content");
  });

  it("web_fetch_exa returns an error result when the Exa request fails", async () => {
    mockRequest.mockRejectedValue(new Error("fetch exploded"));

    const mockPi = createMockPi({ "--exa-api-key": "flag-api-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const fetchTool = getRegisteredTool(mockPi, "web_fetch_exa");
    const result = await fetchTool?.execute(
      "call-123",
      { urls: ["https://example.com"] },
      { aborted: false } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa fetch error: fetch exploded");
    expect(result.details).toEqual({ tool: "web_fetch_exa", error: "fetch exploded" });
  });

  it("web_search_advanced_exa handles missing API key", async () => {
    delete process.env.EXA_API_KEY;
    const configPath = writeTempConfig({
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"],
    });
    const mockPi = createMockPi({ "--exa-config": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const advancedTool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await advancedTool?.execute("call-123", { query: "test" }, undefined, undefined, undefined);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API key not configured");
  });

  it("web_search_advanced_exa handles aborted signal", async () => {
    const configPath = writeTempConfig({
      apiKey: "config-api-key",
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"],
    });
    const mockPi = createMockPi({ "--exa-config": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const advancedTool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await advancedTool?.execute(
      "call-123",
      { query: "test" },
      { aborted: true } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.details.cancelled).toBe(true);
  });

  it("web_search_advanced_exa forwards advanced options to Exa and formats the response", async () => {
    mockRequest.mockResolvedValue({
      results: [{ title: "Advanced Result", url: "https://example.com/advanced", text: "Advanced content" }],
    });
    const configPath = writeTempConfig({
      apiKey: "config-api-key",
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"],
    });
    const mockPi = createMockPi({ "--exa-config": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const advancedTool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const onUpdate = vi.fn();
    const result = await advancedTool?.execute(
      "call-123",
      {
        query: "latest ai tools",
        numResults: 7,
        category: "news",
        type: "deep",
        startPublishedDate: "2025-01-01",
        endPublishedDate: "2025-02-01",
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        textMaxCharacters: 1200,
        enableHighlights: true,
        highlightsNumSentences: 5,
      },
      { aborted: false } as AbortSignal,
      onUpdate,
      undefined,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Performing advanced search via Exa..." }],
      details: { status: "pending" },
    });
    expect(mockRequest).toHaveBeenCalledWith(
      "/search",
      "POST",
      expect.objectContaining({
        query: "latest ai tools",
        numResults: 7,
        category: "news",
        type: "deep",
        startPublishedDate: "2025-01-01",
        endPublishedDate: "2025-02-01",
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        contents: {
          text: { maxCharacters: 1200 },
          highlights: { highlightsPerUrl: 5 },
        },
      }),
    );
    expect(result.details.tool).toBe("web_search_advanced_exa");
    expect(result.content[0].text).toContain("Advanced Result");
  });

  it("web_search_advanced_exa returns an error result when the Exa request fails", async () => {
    mockRequest.mockRejectedValue(new Error("advanced exploded"));
    const configPath = writeTempConfig({
      apiKey: "config-api-key",
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_search_advanced_exa"],
    });
    const mockPi = createMockPi({ "--exa-config": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const advancedTool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await advancedTool?.execute(
      "call-123",
      { query: "test" },
      { aborted: false } as AbortSignal,
      undefined,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa advanced search error: advanced exploded");
    expect(result.details).toEqual({ tool: "web_search_advanced_exa", error: "advanced exploded" });
  });
});

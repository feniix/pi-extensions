/**
 * Extension behavior tests for pi-exa.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockSearch = vi.fn();
const mockGetContents = vi.fn();
const mockAnswer = vi.fn();
const mockFindSimilar = vi.fn();
const mockExaConstructor = vi.fn();

vi.mock("exa-js", () => ({
  Exa: class {
    constructor(apiKey: string) {
      mockExaConstructor(apiKey);
    }

    search = mockSearch;
    getContents = mockGetContents;
    answer = mockAnswer;
    findSimilar = mockFindSimilar;
  },
}));

import { resetExaClientCache } from "../extensions/exa-client.js";
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

const defaultSearchResponse = {
  requestId: "req-1",
  costDollars: { total: 0.005 },
  searchTime: 1200,
  results: [
    {
      title: "Example Result",
      url: "https://example.com/result",
      text: "Result content",
      publishedDate: "2025-01-15T10:30:00Z",
      author: "Jane",
    },
  ],
};

describe("pi-exa extension", () => {
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const originalApiKey = process.env.EXA_API_KEY;

  let sandboxHome: string;
  let sandboxProject: string;

  beforeAll(() => {
    sandboxHome = mkdtempSync(join(tmpdir(), "pi-exa-test-home-"));
    sandboxProject = mkdtempSync(join(tmpdir(), "pi-exa-test-project-"));
    process.env.HOME = sandboxHome;
    process.chdir(sandboxProject);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalApiKey !== undefined) {
      process.env.EXA_API_KEY = originalApiKey;
    } else {
      delete process.env.EXA_API_KEY;
    }
  });

  beforeEach(() => {
    mockSearch.mockReset();
    mockGetContents.mockReset();
    mockAnswer.mockReset();
    mockFindSimilar.mockReset();
    mockExaConstructor.mockReset();
    resetExaClientCache();

    delete process.env.EXA_API_KEY;
  });

  it("registers all expected flags", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toEqual(
      expect.arrayContaining([
        "--exa-api-key",
        "--exa-enable-advanced",
        "--exa-enable-research",
        "--exa-config-file",
        "--exa-config",
      ]),
    );
    expect(flagNames).toHaveLength(5);
  });

  it("registers default tools by default", () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toContain("web_search_exa");
    expect(toolNames).toContain("web_fetch_exa");
    expect(toolNames).toContain("web_answer_exa");
    expect(toolNames).toContain("web_find_similar_exa");
    expect(toolNames).not.toContain("web_search_advanced_exa");
    expect(toolNames).not.toContain("web_research_exa");
  });

  it("registers web_search_advanced_exa when config enables it", () => {
    const configPath = writeTempConfig({
      enabledTools: [
        "web_search_exa",
        "web_fetch_exa",
        "web_search_advanced_exa",
        "web_answer_exa",
        "web_find_similar_exa",
      ],
    });
    const mockPi = createMockPi({ "--exa-config-file": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    expect(getRegisteredTool(mockPi, "web_search_advanced_exa")).toBeDefined();
    expect(getRegisteredTool(mockPi, "web_research_exa")).toBeUndefined();
  });

  it("registers web_research_exa when researchEnabled is true in config", () => {
    const configPath = writeTempConfig({
      enabledTools: ["web_search_exa", "web_fetch_exa", "web_research_exa", "web_answer_exa", "web_find_similar_exa"],
      researchEnabled: true,
    });
    const mockPi = createMockPi({ "--exa-config-file": configPath });
    exaExtension(mockPi as unknown as ExtensionAPI);

    expect(getRegisteredTool(mockPi, "web_research_exa")).toBeDefined();
  });

  it("registers web_research_exa when --exa-enable-research flag is set", () => {
    const mockPi = createMockPi({ "--exa-enable-research": true });
    exaExtension(mockPi as unknown as ExtensionAPI);

    expect(getRegisteredTool(mockPi, "web_research_exa")).toBeDefined();
  });

  it("executes web_search_exa using typed SDK and reports metadata", async () => {
    mockSearch.mockResolvedValue(defaultSearchResponse);

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_exa");
    const onUpdate = vi.fn();
    const result = await tool?.execute(
      "call-1",
      { query: "test query", numResults: 3 },
      { aborted: false } as AbortSignal,
      onUpdate,
      undefined as never,
    );

    expect(mockSearch).toHaveBeenCalledWith(
      "test query",
      expect.objectContaining({
        type: "auto",
        numResults: 3,
        contents: {
          text: { maxCharacters: 500 },
          highlights: expect.objectContaining({
            query: "test query",
            numSentences: 3,
          }),
        },
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Searching the web via Exa..." }],
      details: { status: "pending" },
    });
    expect(result.content[0].text).toContain("Example Result");
    expect(result.details.costDollars?.total).toBe(0.005);
    expect(result.details.searchTime).toBe(1200);
  });

  it("executes web_fetch_exa with typed getContents args and returns formatted content", async () => {
    mockGetContents.mockResolvedValue(defaultSearchResponse);
    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_fetch_exa");
    const onUpdate = vi.fn();
    const result = await tool?.execute(
      "call-1",
      {
        urls: ["https://example.com/a"],
        maxCharacters: 2500,
        highlights: true,
        summary: { query: "quick" },
        maxAgeHours: 6,
      },
      { aborted: false } as AbortSignal,
      onUpdate,
      undefined as never,
    );

    expect(mockGetContents).toHaveBeenCalledWith(
      ["https://example.com/a"],
      expect.objectContaining({
        text: { maxCharacters: 2500 },
        highlights: true,
        summary: { query: "quick" },
        maxAgeHours: 6,
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Fetching content via Exa..." }],
      details: { status: "pending" },
    });
    expect(result.content[0].text).toContain("Example Result");
  });

  it("executes web_search_advanced_exa with typed search args", async () => {
    const configPath = writeTempConfig({
      enabledTools: [
        "web_search_exa",
        "web_fetch_exa",
        "web_search_advanced_exa",
        "web_answer_exa",
        "web_find_similar_exa",
      ],
    });
    mockSearch.mockResolvedValue({
      ...defaultSearchResponse,
      results: [
        {
          ...defaultSearchResponse.results[0],
          highlights: ["h1", "h2"],
        },
      ],
    });

    const mockPi = createMockPi({ "--exa-config-file": configPath, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    await tool?.execute(
      "call-1",
      {
        query: "advanced query",
        type: "neural",
        category: "news",
        numResults: 7,
        includeDomains: ["example.com"],
        textMaxCharacters: 900,
        enableHighlights: true,
      },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(mockSearch).toHaveBeenCalledWith(
      "advanced query",
      expect.objectContaining({
        type: "neural",
        numResults: 7,
        category: "news",
        includeDomains: ["example.com"],
        contents: expect.objectContaining({
          text: { maxCharacters: 900 },
          highlights: expect.objectContaining({ numSentences: 3 }),
        }),
      }),
    );
  });

  it("rejects deep search types in web_search_advanced_exa", async () => {
    const configPath = writeTempConfig({
      enabledTools: [
        "web_search_exa",
        "web_search_advanced_exa",
        "web_fetch_exa",
        "web_answer_exa",
        "web_find_similar_exa",
      ],
    });
    mockSearch.mockResolvedValue(defaultSearchResponse);

    const mockPi = createMockPi({ "--exa-config-file": configPath, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool?.execute(
      "call-1",
      { query: "advanced query", type: "deep" },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not support deep types");
  });

  it("executes web_research_exa and forwards deep search options", async () => {
    mockSearch.mockResolvedValue({
      requestId: "req-r",
      costDollars: { total: 0.1 },
      searchTime: 1800,
      output: {
        content: {
          summary: "research summary",
        },
        grounding: [{ field: "Overview", citations: [{ url: "https://example.com", title: "Source" }] }],
      },
      results: [
        {
          title: "Research result",
          url: "https://example.com/research",
          text: "research text",
        },
      ],
    });

    const mockPi = createMockPi({ "--exa-enable-research": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_research_exa");
    const result = await tool?.execute(
      "call-1",
      {
        query: "what is future AI",
        type: "deep-reasoning",
        systemPrompt: "Use only primary sources",
        outputSchema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
            },
          },
        },
        additionalQueries: ["future models", "AI roadmap"],
      },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(mockSearch).toHaveBeenCalledWith(
      "what is future AI",
      expect.objectContaining({
        type: "deep-reasoning",
        additionalQueries: ["future models", "AI roadmap"],
        systemPrompt: "Use only primary sources",
      }),
    );
    expect(result.content[0].text).toContain('"summary": "research summary"');
    expect(result.details.parsedOutput).toEqual({ summary: "research summary" });
  });

  it("reuses a cached Exa client across tool calls for the same API key", async () => {
    mockSearch.mockResolvedValue(defaultSearchResponse);
    mockAnswer.mockResolvedValue({
      answer: "A clear answer",
      requestId: "answer-1",
      citations: [],
    });

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const searchTool = getRegisteredTool(mockPi, "web_search_exa");
    const answerTool = getRegisteredTool(mockPi, "web_answer_exa");

    await searchTool?.execute(
      "call-1",
      { query: "test query" },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );
    await answerTool?.execute(
      "call-2",
      { query: "who invented TS" },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(mockExaConstructor).toHaveBeenCalledTimes(1);
    expect(mockExaConstructor).toHaveBeenCalledWith("flag-key");
  });

  it("executes web_answer_exa and formats answer with citations", async () => {
    mockAnswer.mockResolvedValue({
      answer: "A clear answer",
      requestId: "answer-1",
      citations: [
        { url: "https://example.com", title: "Source", publishedDate: "2025-01-01T00:00:00Z", author: "Jane" },
      ],
      costDollars: { total: 0.007 },
    });

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_answer_exa");
    const result = await tool?.execute(
      "call-1",
      { query: "who invented TS", systemPrompt: "Be concise" },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(mockAnswer).toHaveBeenCalledWith(
      "who invented TS",
      expect.objectContaining({
        text: undefined,
        systemPrompt: "Be concise",
      }),
    );
    expect(result.content[0].text).toContain("A clear answer");
    expect(result.details.costDollars).toEqual({ total: 0.007 });
  });

  it("executes web_find_similar_exa with findSimilar options", async () => {
    mockFindSimilar.mockResolvedValue({
      requestId: "sim-1",
      results: [
        {
          title: "Similar 1",
          url: "https://example.com/similar",
          text: "similar content",
        },
      ],
    });

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_find_similar_exa");
    const result = await tool?.execute(
      "call-1",
      {
        url: "https://example.com/source",
        numResults: 2,
        excludeSourceDomain: true,
        includeDomains: ["example.com"],
      },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(mockFindSimilar).toHaveBeenCalledWith(
      "https://example.com/source",
      expect.objectContaining({
        numResults: 2,
        excludeSourceDomain: true,
        includeDomains: ["example.com"],
      }),
    );
    expect(result.content[0].text).toContain("Similar 1");
  });

  it("returns an error when advanced search receives an invalid category", async () => {
    const configPath = writeTempConfig({
      enabledTools: [
        "web_search_exa",
        "web_fetch_exa",
        "web_search_advanced_exa",
        "web_answer_exa",
        "web_find_similar_exa",
      ],
    });

    const mockPi = createMockPi({ "--exa-config-file": configPath, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool?.execute(
      "call-1",
      { query: "advanced query", category: "companey" },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid category "companey"');
  });

  it("returns an error when search SDK calls fail", async () => {
    mockSearch.mockRejectedValue(new Error("search down"));

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_exa");
    const result = await tool.execute("call", { query: "test" }, undefined, undefined, undefined as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa search error: search down");
  });

  it("returns an error when advanced search SDK calls fail", async () => {
    mockSearch.mockRejectedValue(new Error("advanced down"));

    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute("call", { query: "test" }, undefined, undefined, undefined as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa advanced search error: advanced down");
  });

  it("returns an error when fetch SDK calls fail", async () => {
    mockGetContents.mockRejectedValue(new Error("fetch down"));

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_fetch_exa");
    const result = await tool.execute(
      "call",
      { urls: ["https://example.com"] },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa fetch error: fetch down");
  });

  it("returns an error when find-similar SDK calls fail", async () => {
    mockFindSimilar.mockRejectedValue(new Error("similar down"));

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_find_similar_exa");
    const result = await tool.execute("call", { url: "https://example.com" }, undefined, undefined, undefined as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa similar search error: similar down");
  });

  it("returns an error when research SDK calls fail", async () => {
    mockSearch.mockRejectedValue(new Error("research down"));

    const mockPi = createMockPi({ "--exa-enable-research": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_research_exa");
    const result = await tool.execute("call", { query: "test" }, undefined, undefined, undefined as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa research error: research down");
  });

  it("returns an error when answer SDK calls fail", async () => {
    mockAnswer.mockRejectedValue(new Error("answer down"));

    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_answer_exa");
    const result = await tool.execute("call", { query: "test" }, undefined, undefined, undefined as never);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Exa answer error: answer down");
  });

  it("returns an error when company category is combined with startPublishedDate", async () => {
    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute(
      "call",
      { query: "acme corp", category: "company", startPublishedDate: "2024-01-01" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Category "company" does not support: startPublishedDate');
  });

  it("returns an error when company category is combined with excludeDomains", async () => {
    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute(
      "call",
      { query: "acme corp", category: "company", excludeDomains: ["crunchbase.com"] },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Category "company" does not support: excludeDomains');
  });

  it("returns an error when people category is combined with endPublishedDate", async () => {
    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute(
      "call",
      { query: "John Doe engineer", category: "people", endPublishedDate: "2024-12-31" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Category "people" does not support: endPublishedDate');
  });

  it("returns an error when people category is combined with non-LinkedIn includeDomains", async () => {
    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute(
      "call",
      { query: "John Doe engineer", category: "people", includeDomains: ["twitter.com", "example.com"] },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Category "people" only accepts LinkedIn domains');
    expect(result.content[0].text).toContain("twitter.com");
  });

  it("allows people category with LinkedIn includeDomains", async () => {
    mockSearch.mockResolvedValue(defaultSearchResponse);

    const mockPi = createMockPi({ "--exa-enable-advanced": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_advanced_exa");
    const result = await tool.execute(
      "call",
      { query: "John Doe engineer", category: "people", includeDomains: ["linkedin.com"] },
      { aborted: false } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(result.isError).toBeFalsy();
    expect(mockSearch).toHaveBeenCalledWith(
      "John Doe engineer",
      expect.objectContaining({ category: "people", includeDomains: ["linkedin.com"] }),
    );
  });

  it("returns an error when research receives an invalid outputSchema type", async () => {
    const mockPi = createMockPi({ "--exa-enable-research": true, "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_research_exa");
    const result = await tool.execute(
      "call",
      { query: "AI trends", outputSchema: { type: "array", items: { type: "string" } } },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('outputSchema.type must be either "object" or "text"');
  });

  it("returns cancelled result when signal is aborted", async () => {
    const mockPi = createMockPi({ "--exa-api-key": "flag-key" });
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_exa");
    expect(tool).toBeDefined();
    const result = await tool.execute(
      "call",
      { query: "test" },
      { aborted: true } as AbortSignal,
      vi.fn(),
      undefined as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({ cancelled: true }),
      }),
    );
  });

  it("returns missing key errors when authentication is absent", async () => {
    const mockPi = createMockPi();
    exaExtension(mockPi as unknown as ExtensionAPI);

    const tool = getRegisteredTool(mockPi, "web_search_exa");
    expect(tool).toBeDefined();
    const result = await tool.execute("call", { query: "test" }, undefined, undefined, undefined as never);

    expect(result).toEqual(
      expect.objectContaining({
        isError: true,
        details: expect.objectContaining({ error: "missing_api_key" }),
      }),
    );
    expect(result.content[0].text).toContain("API key not configured");
  });
});

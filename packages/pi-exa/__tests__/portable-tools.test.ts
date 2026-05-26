/**
 * Host-neutral portable-tool behavior tests for pi-exa.
 *
 * These tests exercise tools produced by `createExaTools(...)` directly via
 * `executePortableTool`, without going through the Pi or MCP adapters. They
 * pin the contract that both adapters must preserve.
 */

import { executePortableTool } from "@feniix/bridgekit";
import type { Exa } from "exa-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSearch = vi.fn();
const mockGetContents = vi.fn();
const mockAnswer = vi.fn();
const mockFindSimilar = vi.fn();

// Structurally typing the mock against the real Exa surface means a future
// exa-js rename of search/getContents/answer/findSimilar surfaces as a
// compile error here instead of a silent test bypass.
type ExaMockShape = Pick<Exa, "search" | "getContents" | "answer" | "findSimilar">;

vi.mock("exa-js", () => ({
  Exa: class implements ExaMockShape {
    search = mockSearch as unknown as ExaMockShape["search"];
    getContents = mockGetContents as unknown as ExaMockShape["getContents"];
    answer = mockAnswer as unknown as ExaMockShape["answer"];
    findSimilar = mockFindSimilar as unknown as ExaMockShape["findSimilar"];
  },
}));

import { resetExaClientCache } from "../extensions/exa-client.js";
import { createExaTools } from "../extensions/tools.js";

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

function findTool<T extends { name: string }>(tools: readonly T[], name: string): T {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool;
}

describe("portable Exa tools", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockGetContents.mockReset();
    mockAnswer.mockReset();
    mockFindSimilar.mockReset();
    resetExaClientCache();
  });

  describe("web_search_exa", () => {
    it("returns formatted search text and structured metadata for a successful search", async () => {
      mockSearch.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");
      expect(tool, "web_search_exa should be exposed by default").toBeDefined();

      const result = await executePortableTool(tool, { query: "test query", numResults: 3 }, { host: "test" });

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Example Result");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        costDollars: { total: 0.005 },
        searchTime: 1200,
      });
      expect(mockSearch).toHaveBeenCalledWith(
        "test query",
        expect.objectContaining({
          type: "auto",
          numResults: 3,
          contents: expect.objectContaining({
            text: { maxCharacters: 500 },
          }),
        }),
      );
    });

    it("returns isError:true with the configured missing-key text when no API key is resolvable", async () => {
      const tools = createExaTools({ resolveApiKey: () => undefined });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(tool, { query: "test query" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa API key not configured");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        error: "missing_api_key",
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("returns a non-error cancelled result when the abort signal is already aborted", async () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(
        tool,
        { query: "test query" },
        {
          host: "test",
          signal: AbortSignal.abort(),
        },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toBe("Cancelled.");
      expect(result.structuredContent).toMatchObject({ tool: "web_search_exa", cancelled: true });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("emits a single pending progress update before invoking Exa", async () => {
      mockSearch.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");
      const progress = vi.fn();

      await executePortableTool(tool, { query: "test query" }, { host: "test", progress });

      expect(progress).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Searching the web via Exa...",
          structuredContent: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("returns isError:true with the prefixed message when the SDK throws", async () => {
      mockSearch.mockRejectedValue(new Error("network down"));
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(tool, { query: "test query" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa search error: network down");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        error: "network down",
      });
    });
  });

  describe("web_fetch_exa", () => {
    it("returns formatted crawl text and structured metadata for a successful fetch", async () => {
      mockGetContents.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_fetch_exa");

      const result = await executePortableTool(
        tool,
        {
          urls: ["https://example.com/result"],
          maxCharacters: 1500,
          highlights: true,
          summary: { query: "what is this" },
          maxAgeHours: 24,
        },
        { host: "test" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Example Result");
      expect(result.structuredContent).toMatchObject({
        tool: "web_fetch_exa",
        costDollars: { total: 0.005 },
        searchTime: 1200,
      });
      expect(mockGetContents).toHaveBeenCalledWith(
        ["https://example.com/result"],
        expect.objectContaining({
          text: { maxCharacters: 1500 },
          highlights: true,
          summary: { query: "what is this" },
          maxAgeHours: 24,
        }),
      );
    });

    it("returns isError:true with the missing-key message when no API key is resolvable", async () => {
      const tools = createExaTools({ resolveApiKey: () => undefined });
      const tool = findTool(tools, "web_fetch_exa");

      const result = await executePortableTool(tool, { urls: ["https://example.com"] }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa API key not configured");
      expect(result.structuredContent).toMatchObject({ tool: "web_fetch_exa", error: "missing_api_key" });
      expect(mockGetContents).not.toHaveBeenCalled();
    });

    it("emits a fetch-specific pending progress update", async () => {
      mockGetContents.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_fetch_exa");
      const progress = vi.fn();

      await executePortableTool(tool, { urls: ["https://example.com"] }, { host: "test", progress });

      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Fetching content via Exa...",
          structuredContent: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("returns isError:true with the fetch-prefixed message when the SDK throws", async () => {
      mockGetContents.mockRejectedValue(new Error("403"));
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_fetch_exa");

      const result = await executePortableTool(tool, { urls: ["https://example.com"] }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa fetch error: 403");
      expect(result.structuredContent).toMatchObject({ tool: "web_fetch_exa", error: "403" });
    });
  });

  describe("web_answer_exa", () => {
    it("formats answer text with citations and forwards systemPrompt + outputSchema", async () => {
      mockAnswer.mockResolvedValue({
        answer: "Example domain is reserved for documentation.",
        citations: [{ url: "https://example.com", title: "Example Domain", publishedDate: "2024-01-01T00:00:00Z" }],
        costDollars: { total: 0.01 },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_answer_exa");

      const result = await executePortableTool(
        tool,
        {
          query: "what is example.com",
          systemPrompt: "Be concise.",
          text: true,
          outputSchema: { type: "object" },
        },
        { host: "test" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Example domain is reserved");
      expect(result.text).toContain("https://example.com");
      expect(result.structuredContent).toMatchObject({
        tool: "web_answer_exa",
        costDollars: { total: 0.01 },
      });
      expect(mockAnswer).toHaveBeenCalledWith(
        "what is example.com",
        expect.objectContaining({
          systemPrompt: "Be concise.",
          text: true,
          outputSchema: { type: "object" },
        }),
      );
    });

    it("returns isError:true with the answer-prefixed message when the SDK throws", async () => {
      mockAnswer.mockRejectedValue(new Error("rate limited"));
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_answer_exa");

      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa answer error: rate limited");
      expect(result.structuredContent).toMatchObject({ tool: "web_answer_exa", error: "rate limited" });
    });

    it("emits an answer-specific pending progress update", async () => {
      mockAnswer.mockResolvedValue({ answer: "ok", citations: [], costDollars: { total: 0 } });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_answer_exa");
      const progress = vi.fn();

      await executePortableTool(tool, { query: "anything" }, { host: "test", progress });

      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ text: "Fetching answer from Exa..." }));
    });
  });

  describe("web_find_similar_exa", () => {
    it("forwards findSimilar options and formats results", async () => {
      mockFindSimilar.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_find_similar_exa");

      const result = await executePortableTool(
        tool,
        {
          url: "https://seed.example.com",
          numResults: 4,
          textMaxCharacters: 1234,
          excludeSourceDomain: true,
          includeDomains: ["news.example.com"],
        },
        { host: "test" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Example Result");
      expect(result.structuredContent).toMatchObject({
        tool: "web_find_similar_exa",
        costDollars: { total: 0.005 },
      });
      expect(mockFindSimilar).toHaveBeenCalledWith(
        "https://seed.example.com",
        expect.objectContaining({
          numResults: 4,
          excludeSourceDomain: true,
          includeDomains: ["news.example.com"],
          contents: expect.objectContaining({ text: { maxCharacters: 1234 } }),
        }),
      );
    });

    it("returns isError:true with the find-similar-prefixed message on SDK failure", async () => {
      mockFindSimilar.mockRejectedValue(new Error("unreachable"));
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_find_similar_exa");

      const result = await executePortableTool(tool, { url: "https://example.com" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa similar search error: unreachable");
      expect(result.structuredContent).toMatchObject({ tool: "web_find_similar_exa", error: "unreachable" });
    });
  });

  describe("web_search_advanced_exa", () => {
    it("forwards the full advanced-search option surface and formats results", async () => {
      mockSearch.mockResolvedValue(defaultSearchResponse);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_advanced_exa");

      const result = await executePortableTool(
        tool,
        {
          query: "rust async runtime",
          numResults: 5,
          category: "research paper",
          type: "auto",
          startPublishedDate: "2024-01-01",
          includeDomains: ["arxiv.org"],
          includeText: ["rust"],
          excludeText: ["python"],
          userLocation: "US",
          moderation: true,
          additionalQueries: ["tokio runtime"],
          textMaxCharacters: 1500,
          contextMaxCharacters: 1000,
          enableSummary: true,
          summaryQuery: "what is described",
          highlightsMaxCharacters: 480,
          maxAgeHours: 24,
          livecrawlTimeout: 4000,
          subpages: 2,
          subpageTarget: ["about"],
        },
        { host: "test" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Example Result");
      expect(result.structuredContent).toMatchObject({ tool: "web_search_advanced_exa" });
      expect(mockSearch).toHaveBeenCalledWith(
        "rust async runtime",
        expect.objectContaining({
          numResults: 5,
          category: "research paper",
          type: "auto",
          startPublishedDate: "2024-01-01",
          includeDomains: ["arxiv.org"],
          includeText: ["rust"],
          excludeText: ["python"],
          userLocation: "US",
          moderation: true,
          additionalQueries: ["tokio runtime"],
          contents: expect.objectContaining({
            text: { maxCharacters: 1500 },
            summary: { query: "what is described" },
            context: { maxCharacters: 1000 },
            maxAgeHours: 24,
            livecrawlTimeout: 4000,
            subpages: 2,
            subpageTarget: ["about"],
          }),
        }),
      );
    });

    it("surfaces validation throws as isError:true with the advanced-search prefix", async () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_advanced_exa");

      const result = await executePortableTool(
        tool,
        { query: "anything", category: "company", excludeDomains: ["blocked.com"] },
        { host: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Exa advanced search error");
      expect(result.text).toContain("excludeDomains");
      expect(result.structuredContent).toMatchObject({ tool: "web_search_advanced_exa" });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("is hidden when isToolEnabled returns false for web_search_advanced_exa", () => {
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        isToolEnabled: (name) => name !== "web_search_advanced_exa",
      });
      expect(tools.find((t) => t.name === "web_search_advanced_exa")).toBeUndefined();
    });
  });

  describe("web_research_exa", () => {
    it("forwards deep-search options and returns synthesized text", async () => {
      mockSearch.mockResolvedValue({
        requestId: "req-2",
        costDollars: { total: 0.12 },
        searchTime: 4500,
        output: { content: "Synthesized research summary about example.com.", grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        {
          query: "What is example.com?",
          type: "deep-lite",
          systemPrompt: "Be concise.",
          textMaxCharacters: 4000,
          additionalQueries: ["example domain"],
          numResults: 3,
          includeDomains: ["example.com"],
          startPublishedDate: "2024-01-01",
        },
        { host: "test" },
      );

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Synthesized research summary");
      expect(result.structuredContent).toMatchObject({
        tool: "web_research_exa",
        costDollars: { total: 0.12 },
        searchTime: 4500,
      });
      expect(mockSearch).toHaveBeenCalledWith(
        "What is example.com?",
        expect.objectContaining({
          type: "deep-lite",
          systemPrompt: "Be concise.",
          additionalQueries: ["example domain"],
          numResults: 3,
          includeDomains: ["example.com"],
          startPublishedDate: "2024-01-01",
          contents: expect.objectContaining({ text: { maxCharacters: 4000 } }),
        }),
      );
    });

    it("rejects outputSchema.type other than object|text at the validation layer", async () => {
      // The TypeBox schema constrains outputSchema.type to "object" | "text".
      // Under bridgekit the rejection happens at validation time (before
      // execute), so the result carries the validation shape rather than the
      // performResearch-throws shape we get on today's Pi adapter. This is a
      // deliberate improvement: invalid inputs are caught earlier with a
      // clearer message.
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      // Avoid `as unknown as "object"`: define a wider-typed value the schema
      // would still reject so the cast doesn't lie about the input shape.
      const badSchema: { type?: string } = { type: "bogus" };
      const result = await executePortableTool(tool, { query: "anything", outputSchema: badSchema }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Invalid arguments");
      expect(result.structuredContent).toMatchObject({
        kind: "validation",
        tool: "web_research_exa",
      });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("is hidden when isToolEnabled returns false for web_research_exa", () => {
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        isToolEnabled: (name) => name !== "web_research_exa",
      });
      expect(tools.find((t) => t.name === "web_research_exa")).toBeUndefined();
    });
  });

  describe("planner tools", () => {
    const stepInput = {
      topic: "isolated planner",
      stage: "framing",
      note: "Frame an isolated planner test.",
      thought_number: 1,
      total_thoughts: 2,
      next_step_needed: true,
    };

    it("registers all four planner tools by default and they never call the Exa SDK", async () => {
      const tools = createExaTools();
      const stepTool = findTool(tools, "exa_research_step");
      const statusTool = findTool(tools, "exa_research_status");
      const summaryTool = findTool(tools, "exa_research_summary");
      const resetTool = findTool(tools, "exa_research_reset");

      await executePortableTool(stepTool, stepInput, { host: "test" });
      await executePortableTool(statusTool, {}, { host: "test" });
      await executePortableTool(summaryTool, { mode: "brief" }, { host: "test" });
      await executePortableTool(resetTool, {}, { host: "test" });

      expect(mockSearch).not.toHaveBeenCalled();
      expect(mockGetContents).not.toHaveBeenCalled();
      expect(mockAnswer).not.toHaveBeenCalled();
      expect(mockFindSimilar).not.toHaveBeenCalled();
    });

    it("step records state and surfaces it via JSON text and structuredContent", async () => {
      const tools = createExaTools();
      const stepTool = findTool(tools, "exa_research_step");

      const result = await executePortableTool(stepTool, stepInput, { host: "test" });

      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("isolated planner");
      expect(result.structuredContent).toMatchObject({ tool: "exa_research_step", topic: "isolated planner" });
    });

    it("status reflects the most recent step recorded through the same factory's planner", async () => {
      const tools = createExaTools();
      const stepTool = findTool(tools, "exa_research_step");
      const statusTool = findTool(tools, "exa_research_status");

      await executePortableTool(stepTool, stepInput, { host: "test" });
      const status = await executePortableTool(statusTool, {}, { host: "test" });

      expect(status.text).toContain("isolated planner");
      expect(status.structuredContent).toMatchObject({ tool: "exa_research_status", topic: "isolated planner" });
    });

    it("summary returns the execution-plan string for mode='execution_plan'", async () => {
      const tools = createExaTools();
      await executePortableTool(findTool(tools, "exa_research_step"), stepInput, { host: "test" });

      const summary = await executePortableTool(
        findTool(tools, "exa_research_summary"),
        { mode: "execution_plan" },
        { host: "test" },
      );

      expect(summary.isError).toBeUndefined();
      expect(summary.text).toContain("# Research Execution Plan");
      expect(summary.text).toContain("isolated planner");
    });

    it("reset clears planner state and reports an empty status", async () => {
      const tools = createExaTools();
      const stepTool = findTool(tools, "exa_research_step");
      const statusTool = findTool(tools, "exa_research_status");
      const resetTool = findTool(tools, "exa_research_reset");

      await executePortableTool(stepTool, stepInput, { host: "test" });
      await executePortableTool(resetTool, {}, { host: "test" });
      const status = await executePortableTool(statusTool, {}, { host: "test" });

      expect(status.text).not.toContain("isolated planner");
      expect(status.structuredContent).toMatchObject({ tool: "exa_research_status", stepCount: 0 });
    });

    it("isolates planner state across separately constructed createExaTools() factories", async () => {
      const toolsA = createExaTools();
      const toolsB = createExaTools();

      await executePortableTool(findTool(toolsA, "exa_research_step"), stepInput, { host: "test" });
      const statusB = await executePortableTool(findTool(toolsB, "exa_research_status"), {}, { host: "test" });

      expect(statusB.text).not.toContain("isolated planner");
      expect(statusB.structuredContent).toMatchObject({ tool: "exa_research_status", stepCount: 0 });
    });
  });
});

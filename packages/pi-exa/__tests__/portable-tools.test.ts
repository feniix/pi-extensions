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
const mockAgentCreate = vi.fn();
const mockAgentGet = vi.fn();
const mockAgentCancel = vi.fn();
const mockBetaAgentCreate = vi.fn();

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
    agent = {
      runs: {
        create: mockAgentCreate,
        get: mockAgentGet,
        cancel: mockAgentCancel,
      },
    };
    beta = {
      agent: {
        runs: {
          create: mockBetaAgentCreate,
        },
      },
    };
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
    mockAgentCreate.mockReset();
    mockAgentGet.mockReset();
    mockAgentCancel.mockReset();
    mockBetaAgentCreate.mockReset();
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

    it("declares the pre-execute pendingMessage via hostExtras.pi", () => {
      // Bridgekit 0.9.0's pi adapter fires hostExtras.pi.pendingMessage as
      // an onUpdate(...) before TypeBox validation runs. The portable
      // executePortableTool path no longer emits this signal — that's a
      // pi-host-level lifecycle hook, not portable execution state.
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");
      expect(tool.hostExtras?.pi?.pendingMessage).toBe("Searching the web via Exa...");
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

    it("declares a fetch-specific pendingMessage via hostExtras.pi", () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_fetch_exa");
      expect(tool.hostExtras?.pi?.pendingMessage).toBe("Fetching content via Exa...");
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

    it("declares an answer-specific pendingMessage via hostExtras.pi", () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_answer_exa");
      expect(tool.hostExtras?.pi?.pendingMessage).toBe("Fetching answer from Exa...");
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
          category: "publication",
          type: "deep-lite",
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
          category: "publication",
          type: "deep-lite",
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

    it("supports deep-reasoning search with synthesized structured output", async () => {
      mockSearch.mockResolvedValue({
        ...defaultSearchResponse,
        output: {
          content: { conclusion: "Deep Search conclusion" },
          grounding: [],
        },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_advanced_exa");
      const outputSchema = {
        type: "object",
        properties: {
          conclusion: { type: "string" },
        },
      };

      const result = await executePortableTool(
        tool,
        {
          query: "compare the leading approaches",
          type: "deep-reasoning",
          additionalQueries: ["approach tradeoffs", "primary evidence"],
          systemPrompt: "Prefer primary sources.",
          outputSchema,
        },
        { host: "test" },
      );

      expect(mockSearch).toHaveBeenCalledWith(
        "compare the leading approaches",
        expect.objectContaining({
          type: "deep-reasoning",
          additionalQueries: ["approach tradeoffs", "primary evidence"],
          systemPrompt: "Prefer primary sources.",
          outputSchema,
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.text).toContain('"conclusion": "Deep Search conclusion"');
      expect(result.text).toContain("Example Result");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_advanced_exa",
        parsedOutput: { conclusion: "Deep Search conclusion" },
      });
    });

    it("rejects additionalQueries for non-deep search modes", async () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_advanced_exa");

      const result = await executePortableTool(
        tool,
        {
          query: "rust async runtime",
          type: "auto",
          additionalQueries: ["tokio runtime"],
        },
        { host: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.text).toContain("additionalQueries is only supported");
      expect(mockSearch).not.toHaveBeenCalled();
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
    it("submits an Agent run, polls it to completion, and returns the grounded synthesis", async () => {
      mockAgentCreate.mockResolvedValue({
        id: "agent_run_1",
        status: "queued",
        createdAt: "2026-08-13T22:52:08.000Z",
      });
      mockAgentGet.mockResolvedValue({
        id: "agent_run_1",
        status: "completed",
        stopReason: "schema_satisfied",
        createdAt: "2026-08-13T22:52:08.000Z",
        completedAt: "2026-08-13T22:52:10.500Z",
        output: {
          text: "Agent research synthesis.",
          structured: null,
          grounding: [
            {
              field: "text",
              citations: [{ url: "https://example.com/source", title: "Primary source" }],
              confidence: "high",
            },
          ],
        },
        costDollars: { total: 0.1 },
        usage: { searches: 3 },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        {
          query: "What is the future of AI?",
          systemPrompt: "Prefer primary sources.",
          effort: "high",
          metadata: { requestId: "pi-call-1" },
        },
        { host: "test" },
      );

      expect(mockAgentCreate).toHaveBeenCalledWith({
        query: "What is the future of AI?",
        systemPrompt: "Prefer primary sources.",
        effort: "high",
        metadata: { requestId: "pi-call-1" },
      });
      expect(mockAgentGet).toHaveBeenCalledWith("agent_run_1");
      expect(mockSearch).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.text).toContain("Agent research synthesis.");
      expect(result.text).toContain("https://example.com/source");
      expect(result.structuredContent).toMatchObject({
        tool: "web_research_exa",
        runId: "agent_run_1",
        status: "completed",
        stopReason: "schema_satisfied",
        searchTime: 2500,
        costDollars: { total: 0.1 },
        usage: { searches: 3 },
      });
    });

    it("retries a transient poll failure instead of abandoning the Agent run", async () => {
      vi.useFakeTimers();
      try {
        mockAgentCreate.mockResolvedValue({ id: "agent_run_retry", status: "queued" });
        mockAgentGet.mockRejectedValueOnce(new Error("temporary connection reset")).mockResolvedValueOnce({
          id: "agent_run_retry",
          status: "completed",
          output: { text: "Recovered result.", grounding: [] },
        });
        const tools = createExaTools({
          resolveApiKey: () => "test-key",
          timeouts: { web_research_exa: 5_000 },
        });
        const tool = findTool(tools, "web_research_exa");

        const resultPromise = executePortableTool(tool, { query: "Retry transient polls" }, { host: "test" });
        await vi.waitFor(() => expect(mockAgentGet).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(1_000);
        const result = await resultPromise;

        expect(mockAgentGet).toHaveBeenCalledTimes(2);
        expect(mockAgentCancel).not.toHaveBeenCalled();
        expect(result.text).toBe("Recovered result.");
      } finally {
        vi.useRealTimers();
      }
    });

    it("cancels the remote Agent run when the host aborts during polling", async () => {
      mockAgentCreate.mockResolvedValue({ id: "agent_run_abort", status: "queued" });
      mockAgentGet.mockResolvedValue({ id: "agent_run_abort", status: "running" });
      mockAgentCancel.mockResolvedValue({ id: "agent_run_abort", status: "cancelled" });
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { web_research_exa: 10_000 },
      });
      const tool = findTool(tools, "web_research_exa");
      const controller = new AbortController();

      const resultPromise = executePortableTool(
        tool,
        { query: "Long-running research" },
        { host: "test", signal: controller.signal },
      );
      await vi.waitFor(() => expect(mockAgentGet).toHaveBeenCalledWith("agent_run_abort"));
      controller.abort();
      const result = await resultPromise;

      expect(mockAgentCancel).toHaveBeenCalledWith("agent_run_abort");
      expect(result.isError).toBeUndefined();
      expect(result.text).toBe("Cancelled.");
      expect(result.structuredContent).toMatchObject({
        tool: "web_research_exa",
        cancelled: true,
        runId: "agent_run_abort",
      });
    });

    it("cancels the remote Agent run when the research timeout expires", async () => {
      mockAgentCreate.mockResolvedValue({ id: "agent_run_timeout", status: "queued" });
      mockAgentGet.mockResolvedValue({ id: "agent_run_timeout", status: "running" });
      mockAgentCancel.mockResolvedValue({ id: "agent_run_timeout", status: "cancelled" });
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { web_research_exa: 40 },
      });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "Bounded research" }, { host: "test" });

      expect(mockAgentCancel).toHaveBeenCalledWith("agent_run_timeout");
      expect(result.isError).toBe(true);
      expect(result.text).toContain("timed out after 40ms");
      expect(result.structuredContent).toMatchObject({
        kind: "domain",
        tool: "web_research_exa",
        error: "timeout",
        timeoutMs: 40,
        runId: "agent_run_timeout",
      });
    });

    it("cancels the remote Agent run when an in-flight poll stalls past the deadline", { timeout: 500 }, async () => {
      mockAgentCreate.mockResolvedValue({ id: "agent_run_stalled", status: "queued" });
      mockAgentGet.mockReturnValue(new Promise(() => {}));
      mockAgentCancel.mockResolvedValue({ id: "agent_run_stalled", status: "cancelled" });
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { web_research_exa: 40 },
      });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "Stalled research" }, { host: "test" });

      expect(mockAgentCancel).toHaveBeenCalledWith("agent_run_stalled");
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: "timeout",
        runId: "agent_run_stalled",
      });
    });

    it("returns a bounded timeout when Exa never returns a run ID", { timeout: 500 }, async () => {
      mockAgentCreate.mockReturnValue(new Promise(() => {}));
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { web_research_exa: 40 },
      });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "Stalled submit" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("before Exa returned a run ID");
      expect(result.structuredContent).toMatchObject({ error: "timeout", timeoutMs: 40 });
      expect(result.structuredContent).not.toHaveProperty("runId");
      expect(mockAgentCancel).not.toHaveBeenCalled();
    });

    it("uses medium effort and text output by default without sending an output schema", async () => {
      mockAgentCreate.mockResolvedValue({
        id: "agent_run_text",
        status: "completed",
        output: { text: "Default text answer.", structured: null, grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "default behavior test" }, { host: "test" });

      expect(mockAgentCreate).toHaveBeenCalledWith({
        query: "default behavior test",
        effort: "medium",
      });
      expect(result.text).toBe("Default text answer.");
    });

    it("forwards Agent-native input, continuation, data-source, and budget fields", async () => {
      mockAgentCreate.mockResolvedValue({
        id: "agent_run_native",
        status: "completed",
        output: { text: "Native Agent answer.", grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      await executePortableTool(
        tool,
        {
          query: "Enrich these companies",
          effort: "auto",
          input: {
            data: [{ company: "Acme" }],
            exclusion: [{ company: "Example" }],
          },
          previousRunId: "agent_run_previous",
          metadata: { callId: "call-1" },
          dataSources: [{ provider: "similarweb" }],
          budget: { maxCostDollars: 3 },
        },
        { host: "test" },
      );

      expect(mockAgentCreate).toHaveBeenCalledWith({
        query: "Enrich these companies",
        effort: "auto",
        input: {
          data: [{ company: "Acme" }],
          exclusion: [{ company: "Example" }],
        },
        previousRunId: "agent_run_previous",
        metadata: { callId: "call-1" },
        dataSources: [{ provider: "similarweb" }],
        budget: { maxCostDollars: 3 },
      });
    });

    it("rejects a metered budget on fixed-price effort before submitting a run", async () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        { query: "Invalid budget combination", effort: "high", budget: { maxCostDollars: 3 } },
        { host: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.text).toContain("budget.maxCostDollars is only supported with auto or max effort");
      expect(mockAgentCreate).not.toHaveBeenCalled();
    });

    it("opts into the required beta when max effort is requested", async () => {
      mockBetaAgentCreate.mockResolvedValue({
        id: "agent_run_max",
        status: "completed",
        output: { text: "Maximum-effort answer.", grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        { query: "Research this thoroughly", effort: "max", budget: { maxCostDollars: 10 } },
        { host: "test" },
      );

      expect(mockBetaAgentCreate).toHaveBeenCalledWith({
        query: "Research this thoroughly",
        effort: "max",
        budget: { maxCostDollars: 10 },
        betas: ["agent-max-effort-2026-07-27"],
      });
      expect(mockAgentCreate).not.toHaveBeenCalled();
      expect(result.text).toBe("Maximum-effort answer.");
    });

    it("passes object outputSchema to the Agent API and renders output.structured", async () => {
      const explicitSchema = {
        type: "object" as const,
        properties: {
          summary: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
        },
        required: ["summary"],
      };
      mockAgentCreate.mockResolvedValue({
        id: "agent_run_structured",
        status: "completed",
        output: {
          text: "Structured answer",
          structured: { summary: "Structured answer", risks: ["risk-1"] },
          grounding: [],
        },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        { query: "structured please", outputSchema: explicitSchema },
        { host: "test" },
      );

      expect(mockAgentCreate).toHaveBeenCalledWith({
        query: "structured please",
        effort: "medium",
        outputSchema: explicitSchema,
      });
      expect(result.structuredContent).toMatchObject({
        tool: "web_research_exa",
        parsedOutput: { summary: "Structured answer", risks: ["risk-1"] },
      });
    });

    it.each(["failed", "cancelled"] as const)("returns an error when the Agent run ends as %s", async (status) => {
      mockAgentCreate.mockResolvedValue({
        id: `agent_run_${status}`,
        status,
        error: { message: "upstream verdict" },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "terminal failure" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain(`ended with status ${status}`);
      expect(result.text).toContain("upstream verdict");
      expect(mockAgentCancel).not.toHaveBeenCalled();
    });

    it("returns an error when a completed Agent run has no requested output", async () => {
      mockAgentCreate.mockResolvedValue({
        id: "agent_run_empty",
        status: "completed",
        output: { text: "", structured: null, grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "empty output" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("completed without synthesized output");
      expect(result.text).toContain("agent_run_empty");
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
      expect(mockAgentCreate).not.toHaveBeenCalled();
    });

    it("rejects retired Deep Search parameters at the validation layer", async () => {
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(
        tool,
        { query: "old payload", type: "deep-reasoning", numResults: 10 } as never,
        { host: "test" },
      );

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Invalid arguments");
      expect(mockAgentCreate).not.toHaveBeenCalled();
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

  describe("timeout and mid-flight cancellation", () => {
    // exa-js does not accept AbortSignal in its public surface (issue
    // exa-labs/exa-js#158). Until upstream support lands, we race the SDK
    // promise against ctx.signal and a per-call timer. The underlying HTTP
    // request continues until exa-js resolves it (and Exa still bills) — the
    // helper bounds the JS-side wait, nothing else.

    it("fires the per-tool timeout when the SDK call hangs longer than the configured budget", async () => {
      // Mock search to hang forever — only the timeout can settle it.
      mockSearch.mockReturnValue(new Promise(() => {}));
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { default: 50 },
      });
      const tool = findTool(tools, "web_search_exa");

      const start = Date.now();
      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });
      const elapsed = Date.now() - start;

      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/timed out after 50ms/);
      expect(result.text).toContain("exa-labs/exa-js");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        error: "timeout",
        timeoutMs: 50,
      });
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(500);
    });

    it("returns the soft cancelled shape when ctx.signal aborts mid-flight", async () => {
      mockSearch.mockReturnValue(new Promise(() => {}));
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { default: 10_000 },
      });
      const tool = findTool(tools, "web_search_exa");

      const controller = new AbortController();
      const resultPromise = executePortableTool(
        tool,
        { query: "anything" },
        {
          host: "test",
          signal: controller.signal,
        },
      );
      // Let exaTool pass the pre-flight check and enter the perform await.
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort();
      const result = await resultPromise;

      expect(result.isError).toBeUndefined();
      expect(result.text).toBe("Cancelled.");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        cancelled: true,
      });
    });

    it("uses the per-tool override over the default when both are provided", async () => {
      mockSearch.mockReturnValue(new Promise(() => {}));
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { default: 10_000, web_search_exa: 60 },
      });
      const tool = findTool(tools, "web_search_exa");

      const start = Date.now();
      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });
      const elapsed = Date.now() - start;

      expect(result.structuredContent).toMatchObject({ timeoutMs: 60 });
      expect(elapsed).toBeLessThan(500);
    });

    it("honors per-tool web_research_exa override even when generic default would be shorter", async () => {
      mockAgentCreate.mockResolvedValue({ id: "agent_run_override", status: "queued" });
      mockAgentGet.mockResolvedValue({ id: "agent_run_override", status: "running" });
      mockAgentCancel.mockResolvedValue({ id: "agent_run_override", status: "cancelled" });
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        isToolEnabled: () => true,
        timeouts: { default: 30, web_research_exa: 60 },
      });
      const tool = findTool(tools, "web_research_exa");

      const start = Date.now();
      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });
      const elapsed = Date.now() - start;

      expect(result.structuredContent).toMatchObject({ tool: "web_research_exa", timeoutMs: 60 });
      // Tool-specific budget wins, so we wait at least 60ms but never 30ms.
      expect(elapsed).toBeGreaterThanOrEqual(55);
      expect(elapsed).toBeLessThan(500);
    });

    it("the pre-flight signal check still wins when the signal is already aborted at entry", async () => {
      mockSearch.mockReturnValue(new Promise(() => {}));
      const tools = createExaTools({
        resolveApiKey: () => "test-key",
        timeouts: { default: 50 },
      });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(
        tool,
        { query: "anything" },
        {
          host: "test",
          signal: AbortSignal.abort(),
        },
      );

      // Soft cancelled shape from the pre-flight gate — not the timeout error
      // shape — and the SDK was never called.
      expect(result.isError).toBeUndefined();
      expect(result.text).toBe("Cancelled.");
      expect(mockSearch).not.toHaveBeenCalled();
    });
  });

  describe("non-Error rejection handling", () => {
    // Pre-existing behavior: toErrorMessage used `String(error)` for non-Error
    // throws, producing the useless `[object Object]` when an SDK rejects with
    // a plain object that has its own `message` field. The fix tries object
    // `.message` before falling back to String coercion.

    it("extracts .message from plain-object rejections instead of returning [object Object]", async () => {
      mockSearch.mockRejectedValue({ message: "rate limited", code: 429 });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });

      expect(result.isError).toBe(true);
      expect(result.text).toBe("Exa search error: rate limited");
      expect(result.text).not.toContain("[object Object]");
      expect(result.structuredContent).toMatchObject({
        tool: "web_search_exa",
        error: "rate limited",
      });
    });

    it("falls back to String() for objects without a string message", async () => {
      // Object whose `message` is not a string — fall through to String(error).
      mockSearch.mockRejectedValue({ message: 42, code: "X" });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });

      expect(result.isError).toBe(true);
      // String({message:42,code:"X"}) → "[object Object]"; we accept this for
      // truly unstructured rejections because there's no better signal to use.
      expect(result.text).toContain("Exa search error:");
    });

    it("preserves the string when the SDK rejects with a bare string", async () => {
      mockSearch.mockRejectedValue("naked-string-rejection");
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_search_exa");

      const result = await executePortableTool(tool, { query: "anything" }, { host: "test" });

      expect(result.text).toBe("Exa search error: naked-string-rejection");
      expect(result.structuredContent).toMatchObject({ error: "naked-string-rejection" });
    });
  });
});

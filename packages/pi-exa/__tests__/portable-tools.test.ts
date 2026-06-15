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
          // Issue #115: omitting outputSchema must default to text-mode
          // synthesis so the backend actually runs synthesis and returns
          // an `output` field. The Exa API only synthesizes when an
          // outputSchema is provided; without a default, callers always
          // hit the canned "no synthesized output" fallback.
          outputSchema: { type: "text" },
          contents: expect.objectContaining({ text: { maxCharacters: 4000 } }),
        }),
      );
    });

    it("defaults outputSchema to text-mode synthesis when the caller omits it (issue #115)", async () => {
      // Regression pin for issue #115: web_research_exa returned the
      // canned "no synthesized output was returned" message for every
      // call because the implementation passed `undefined` to
      // exa.search(...), and the backend only returns an `output` field
      // when an outputSchema is provided. The fix is to default to
      // text-mode synthesis when the caller doesn't pass an explicit
      // outputSchema.
      mockSearch.mockResolvedValue({
        requestId: "req-default-text",
        output: { content: "Synthesized prose answer.", grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      await executePortableTool(tool, { query: "default behavior test" }, { host: "test" });

      expect(mockSearch).toHaveBeenCalledWith(
        "default behavior test",
        expect.objectContaining({
          outputSchema: { type: "text" },
        }),
      );
    });

    it("defaults to text-mode when outputSchema is an object without a type field", async () => {
      // The schema layer accepts { properties: {...} } without a top-level
      // type (Type.Object + additionalProperties: true). parseOutputSchema
      // must treat that as "no type provided" and default to text mode,
      // matching the omitted-outputSchema path.
      mockSearch.mockResolvedValue({
        requestId: "req-no-type",
        output: { content: "Defaulted to text.", grounding: [] },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      await executePortableTool(
        tool,
        {
          query: "no-type test",
          outputSchema: { properties: { summary: { type: "string" } } } as never,
        },
        { host: "test" },
      );

      expect(mockSearch).toHaveBeenCalledWith(
        "no-type test",
        expect.objectContaining({
          outputSchema: { type: "text" },
        }),
      );
    });

    it("passes explicit object-mode outputSchema through unchanged and renders parsedOutput", async () => {
      // The default-to-text fix must not override an explicit object
      // schema the caller passes. Object mode is the LLM's escape hatch
      // for structured extraction, and the formatter should still set
      // `details.parsedOutput` so the caller can consume the structured
      // result without re-parsing `result.text`.
      mockSearch.mockResolvedValue({
        requestId: "req-obj",
        output: {
          content: { summary: "Structured answer", risks: ["risk-1", "risk-2"] },
          grounding: [
            { field: "summary", citations: [{ url: "https://example.com", title: "src" }], confidence: "high" },
          ],
        },
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const explicitSchema = {
        type: "object" as const,
        properties: {
          summary: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
        },
        required: ["summary"],
      };

      const result = await executePortableTool(
        tool,
        { query: "structured please", outputSchema: explicitSchema },
        { host: "test" },
      );

      expect(mockSearch).toHaveBeenCalledWith(
        "structured please",
        expect.objectContaining({ outputSchema: explicitSchema }),
      );
      expect(result.structuredContent).toMatchObject({
        tool: "web_research_exa",
        parsedOutput: { summary: "Structured answer", risks: ["risk-1", "risk-2"] },
      });
    });

    it("surfaces diagnostic context when the response omits output (issue #115 fallback)", async () => {
      // When the backend returns no `output` field, the tool must
      // surface *why* (synthesis was expected but the response lacked
      // the field) and *what shape* it got, not the generic "try a
      // different query" message. This pins the diagnostic contract:
      // requestId, resultsCount, what schema was sent, and the
      // top-level response keys (which lack `output` is the proof of
      // the contract issue).
      mockSearch.mockResolvedValue({
        requestId: "req-no-output",
        resolvedSearchType: "deep",
        results: [
          { title: "Hit 1", url: "https://example.com/1" },
          { title: "Hit 2", url: "https://example.com/2" },
        ],
        searchTime: 1234,
        costDollars: { total: 0.015 },
        // No `output` key — matches the bug scenario from issue #115.
      });
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "synthesis will not run" }, { host: "test" });

      // Not flagged as an error — this is a contract gotcha, not a
      // transport failure. The model gets a readable text and structured
      // details to act on.
      expect(result.isError).toBeFalsy();
      // User-facing text is honest about what happened: a schema was
      // sent, the response lacked the field.
      expect(result.text).toMatch(/outputSchema was sent/i);
      expect(result.text).toMatch(/outputSchema/);
      // Diagnostic details pin the failure shape.
      const details = result.structuredContent as Record<string, unknown>;
      expect(details).toMatchObject({
        tool: "web_research_exa",
        kind: "domain",
        error: "no_synthesized_output",
        requestId: "req-no-output",
        resultsCount: 2,
        outputSchemaSent: { type: "text" },
        costDollars: { total: 0.015 },
        searchTime: 1234,
      });
      // responseKeys is the diagnostic surface: assert semantically (the
      // useful keys are present, `output` is absent) rather than pinning
      // exact insertion order — Object.keys order is stable per the
      // JS spec, but the value of the diagnostic is the set membership.
      const responseKeys = details.responseKeys as string[];
      expect(responseKeys).toEqual(expect.arrayContaining(["requestId", "results", "searchTime", "costDollars"]));
      expect(responseKeys).not.toContain("output");
    });

    it("surfaces diagnostic context even when exa.search resolves to null or undefined", async () => {
      // Defensive coverage: if the SDK ever resolves to a nullish
      // response (unusual but documented in the exa-js types as
      // possible during cancellation/timeout edges), the diagnostic
      // path must not throw. Without the null guard, toMetadata would
      // dereference response.costDollars on a null value and the
      // fallback would crash before the model-visible diagnostic is
      // returned.
      mockSearch.mockResolvedValueOnce(null);
      const tools = createExaTools({ resolveApiKey: () => "test-key" });
      const tool = findTool(tools, "web_research_exa");

      const result = await executePortableTool(tool, { query: "null response test" }, { host: "test" });

      expect(result.isError).toBeFalsy();
      const details = result.structuredContent as Record<string, unknown>;
      expect(details).toMatchObject({
        tool: "web_research_exa",
        kind: "domain",
        error: "no_synthesized_output",
        requestId: "unknown",
        resultsCount: 0,
        outputSchemaSent: { type: "text" },
        responseKeys: [],
      });
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
      mockSearch.mockReturnValue(new Promise(() => {}));
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

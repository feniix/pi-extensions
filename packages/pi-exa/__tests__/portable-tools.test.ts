/**
 * Host-neutral portable-tool behavior tests for pi-exa.
 *
 * These tests exercise tools produced by `createExaTools(...)` directly via
 * `executePortableTool`, without going through the Pi or MCP adapters. They
 * pin the contract that both adapters must preserve.
 */

import { executePortableTool } from "@feniix/bridgekit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSearch = vi.fn();
const mockGetContents = vi.fn();
const mockAnswer = vi.fn();
const mockFindSimilar = vi.fn();

vi.mock("exa-js", () => ({
  Exa: class {
    search = mockSearch;
    getContents = mockGetContents;
    answer = mockAnswer;
    findSimilar = mockFindSimilar;
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// SDK Mock Helpers
// =============================================================================

type MockSearchResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  title: string | null;
  url: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  id: string;
  text?: string;
  highlights?: string[];
} & T;

type MockSearchResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
  results: MockSearchResult<T>[];
  requestId: string;
  costDollars?: { search?: { total?: number }; contents?: { total?: number } };
  searchTime?: number;
  resolvedSearchType?: string;
};

type MockAnswerResponse = {
  answer: string | Record<string, unknown>;
  citations: Array<{ id: string; url: string; title?: string }>;
  requestId?: string;
  costDollars?: { search?: { total?: number } };
};

type MockResearchResponse = {
  status: "pending" | "running" | "completed" | "failed" | "canceled";
  output?: {
    content: string | Record<string, unknown>;
    grounding?: Array<{
      field: string;
      citations: Array<{ url: string; title: string }>;
      confidence: "low" | "medium" | "high";
    }>;
  };
  costDollars?: { total?: number; numSearches?: number; numPages?: number; reasoningTokens?: number };
  results?: Array<{ url: string; title?: string }>;
};

// Shared mocks object — vi.mock factory and tests share the SAME reference.
const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  getContents: vi.fn(),
  answer: vi.fn(),
  findSimilar: vi.fn(),
  researchPollUntilFinished: vi.fn(),
  researchCreate: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: class {
    search = mocks.search;
    getContents = mocks.getContents;
    answer = mocks.answer;
    findSimilar = mocks.findSimilar;
    research = {
      create: mocks.researchCreate,
      pollUntilFinished: mocks.researchPollUntilFinished,
    };
  },
}));

// =============================================================================
// Extension Module Setup
// =============================================================================

// Per-test: vi.clearAllMocks() clears call history and queued return values.
// We MUST NOT use mockReset() here — it clears the mock implementation!
beforeEach(() => {
  // Clear call history manually (does NOT clear queued return values like mockResolvedValueOnce)
  mocks.search.mock.calls.length = 0;
  mocks.getContents.mock.calls.length = 0;
  mocks.answer.mock.calls.length = 0;
  mocks.findSimilar.mock.calls.length = 0;
  mocks.researchCreate.mock.calls.length = 0;
  mocks.researchPollUntilFinished.mock.calls.length = 0;
});

// =============================================================================
// Extension Loader
// =============================================================================

async function loadExtension(pi: Partial<ExtensionAPI> = {}) {
  const { default: exaExtension } = await import("../extensions/index.ts");
  exaExtension({
    on: vi.fn(),
    registerTool: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: (flag: string) => {
      if (typeof pi.getFlag === "function") {
        const result = pi.getFlag(flag);
        if (result !== undefined) return result;
      }
      return undefined;
    },
    ...pi,
  } as unknown as ExtensionAPI);
}

// =============================================================================
// C1: maxCharacters bump (performWebSearch uses 500 not 300)
// =============================================================================
describe("C1: maxCharacters bump in performWebSearch", () => {
  it("performWebSearch passes maxCharacters: 500 to highlights", async () => {
    mocks.search.mockResolvedValueOnce({
      results: [],
      requestId: "r1",
    } as MockSearchResponse);

    const { performWebSearch } = await import("../extensions/index.ts");
    await performWebSearch("test-key", "test query", 5);

    const searchCall = mocks.search.mock.calls[0];
    const options = searchCall[1] as Record<string, unknown>;
    const contents = options.contents as Record<string, unknown>;

    expect(contents).toBeDefined();
    expect((contents.highlights as Record<string, unknown>)?.maxCharacters).toBe(500);
    expect((contents.text as Record<string, unknown>)?.maxCharacters).toBe(500);
  });
});

// =============================================================================
// C2: SDK migration — existing tools use typed SDK methods
// =============================================================================
describe("C2: SDK migration — typed SDK methods", () => {
  it("web_search_exa calls exa.search() not exa.request()", async () => {
    mocks.search.mockResolvedValueOnce({
      results: [{ title: "Test", url: "https://example.com", id: "1", score: 1, publishedDate: "2024-01-01", text: "Hello" }],
      requestId: "r1",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.search.mock.calls.length).toBe(1);
    expect(mocks.getContents).not.toHaveBeenCalled();
  });

  it("web_search_advanced_exa calls exa.search() not exa.request()", async () => {
    mocks.search.mockResolvedValueOnce({
      results: [{ title: "Test", url: "https://example.com", id: "1", score: 1 }],
      requestId: "r1",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-advanced") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_advanced_exa") {
          t.execute("call-2", { query: "test", type: "neural" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(mocks.search).toHaveBeenCalled();
    expect(mocks.getContents).not.toHaveBeenCalled();
  });

  it("web_search_advanced_exa details include observability fields", async () => {
    mocks.search.mockResolvedValueOnce({
      results: [],
      requestId: "r1",
      costDollars: { search: { total: 0.005 } },
      searchTime: 0.3,
      resolvedSearchType: "neural",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-advanced") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_advanced_exa") {
          t.execute("call-3", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { details?: Record<string, unknown> };
    expect(r.details?.searchTime).toBeCloseTo(0.3, 1);
    expect(r.details?.resolvedSearchType).toBe("neural");
  });

  it("web_search_exa has promptSnippet and promptGuidelines", async () => {
    let tool: Record<string, unknown> | null = null;
    await loadExtension({
      registerTool: (t: unknown) => {
        const tt = t as Record<string, unknown>;
        if (tt.name === "web_search_exa") tool = tt;
      },
    });

    expect(tool?.promptSnippet).toBeDefined();
    expect(tool?.promptGuidelines).toBeDefined();
    expect(Array.isArray(tool?.promptGuidelines)).toBe(true);
    expect((tool?.promptGuidelines as string[]).length).toBeGreaterThan(0);
  });

  it("web_fetch_exa has promptSnippet and promptGuidelines", async () => {
    let tool: Record<string, unknown> | null = null;
    await loadExtension({
      registerTool: (t: unknown) => {
        const tt = t as Record<string, unknown>;
        if (tt.name === "web_fetch_exa") tool = tt;
      },
    });

    expect(tool?.promptSnippet).toBeDefined();
    expect(Array.isArray(tool?.promptGuidelines)).toBe(true);
  });

  it("web_search_advanced_exa has promptSnippet and promptGuidelines", async () => {
    mocks.search.mockResolvedValueOnce({ results: [], requestId: "r1" } as MockSearchResponse);
    let tool: Record<string, unknown> | null = null;
    await loadExtension({
      getFlag: () => true,
      registerTool: (t: unknown) => {
        const tt = t as Record<string, unknown>;
        if (tt.name === "web_search_advanced_exa") tool = tt;
      },
    });

    expect(tool).not.toBeNull();
    expect(tool?.promptSnippet).toBeDefined();
    expect(Array.isArray(tool?.promptGuidelines)).toBe(true);
  });

  it("web_answer_exa has promptSnippet and promptGuidelines", async () => {
    mocks.answer.mockResolvedValueOnce({ answer: "Test answer", citations: [] } as MockAnswerResponse);
    let tool: Record<string, unknown> | null = null;
    await loadExtension({
      registerTool: (t: unknown) => {
        const tt = t as Record<string, unknown>;
        if (tt.name === "web_answer_exa") tool = tt;
      },
    });

    expect(tool?.promptSnippet).toBeDefined();
    expect(Array.isArray(tool?.promptGuidelines)).toBe(true);
  });

  it("web_find_similar_exa has promptSnippet and promptGuidelines", async () => {
    mocks.findSimilar.mockResolvedValueOnce({ results: [], requestId: "r1" } as MockSearchResponse);
    let tool: Record<string, unknown> | null = null;
    await loadExtension({
      registerTool: (t: unknown) => {
        const tt = t as Record<string, unknown>;
        if (tt.name === "web_find_similar_exa") tool = tt;
      },
    });

    expect(tool?.promptSnippet).toBeDefined();
    expect(Array.isArray(tool?.promptGuidelines)).toBe(true);
  });
});

// =============================================================================
// C3: web_research_exa — deep research tool
// =============================================================================
describe("C3: web_research_exa — deep research tool", () => {
  it("is disabled by default (no --exa-enable-research flag)", async () => {
    const toolNames: string[] = [];
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string };
        toolNames.push(t.name);
      },
    });

    expect(toolNames).not.toContain("web_research_exa");
  });

  it("is registered when --exa-enable-research is true", async () => {
    const toolNames: string[] = [];
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string };
        toolNames.push(t.name);
      },
    });

    expect(toolNames).toContain("web_research_exa");
  });

  it("returns error when API key is missing", async () => {
    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    // Result fires in a microtask
    await new Promise(r => setTimeout(r, 0));
    expect(result).toBeDefined();
    const r = result as { isError?: boolean; details?: Record<string, unknown> };
    expect(r.isError).toBe(true);
    expect(r.details?.error).toBe("missing_api_key");
  });

  it("calls exa.research.create and exa.research.pollUntilFinished", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({
      status: "completed",
      output: { content: "Research output about AI safety." },
      results: [{ url: "https://example.com", title: "AI Safety Paper" }],
    } as MockResearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", { query: "AI safety" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(mocks.researchCreate).toHaveBeenCalled();
    expect(mocks.researchPollUntilFinished).toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns formatted output with grounding citations", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({
      status: "completed",
      output: {
        content: "Synthesized research output about AI safety.",
        grounding: [
          {
            field: "Overview",
            citations: [{ url: "https://example.com/1", title: "AI Safety Paper" }],
            confidence: "high",
          },
        ],
      },
      results: [{ url: "https://example.com/1", title: "AI Safety Paper" }],
      costDollars: { total: 0.05, numSearches: 5, numPages: 10, reasoningTokens: 1000 },
    } as MockResearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", { query: "AI safety" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(false);
    expect(r.content[0]?.text).toContain("AI safety");
    expect(r.content[0]?.text).toContain("grounding");
    expect(r.content[0]?.text).toContain("Example");
  });

  it("fires onUpdate callback", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({ status: "completed", output: { content: "Done" } } as MockResearchResponse);

    const onUpdate = vi.fn();
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-r1", { query: "test" }, undefined, onUpdate);
        }
      },
    });

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalled();
  });

  it("returns error when research fails", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({ status: "failed" } as MockResearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { isError: boolean; details?: Record<string, unknown> };
    expect(r.isError).toBe(true);
    expect(r.details?.error).toBe("research_failed");
  });

  it("returns cancelled when research is canceled", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({ status: "canceled" } as MockResearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { details?: Record<string, unknown> };
    expect(r.details?.cancelled).toBe(true);
  });
});

// =============================================================================
// C4: web_answer_exa — grounded answer tool
// =============================================================================
describe("C4: web_answer_exa — grounded answer tool", () => {
  it("calls exa.answer not exa.request", async () => {
    mocks.answer.mockResolvedValueOnce({
      answer: "The capital of France is Paris.",
      citations: [{ id: "1", url: "https://example.com/france", title: "France Info" }],
    } as MockAnswerResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_answer_exa") {
          t.execute("call-1", { query: "capital of France" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(mocks.answer).toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("formats answer with citations", async () => {
    mocks.answer.mockResolvedValueOnce({
      answer: "Paris is the capital of France.",
      citations: [
        { id: "1", url: "https://example.com/france", title: "France Wikipedia" },
      ],
      costDollars: { search: { total: 0.001 } },
    } as MockAnswerResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_answer_exa") {
          t.execute("call-1", { query: "capital of France" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(false);
    expect(r.content[0]?.text).toContain("Paris");
    expect(r.content[0]?.text).toContain("example.com");
  });

  it("fires onUpdate callback", async () => {
    mocks.answer.mockResolvedValueOnce({ answer: "Test answer", citations: [] } as MockAnswerResponse);

    const onUpdate = vi.fn();
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_answer_exa") {
          t.execute("call-a1", { query: "test" }, undefined, onUpdate);
        }
      },
    });

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalled();
  });

  it("returns error when API key missing", async () => {
    mocks.answer.mockResolvedValueOnce({ answer: "answer", citations: [] } as MockAnswerResponse);

    let result: unknown;
    await loadExtension({
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_answer_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 0));
    expect(result).toBeDefined();
    const r = result as { isError: boolean; details?: Record<string, unknown> };
    expect(r.isError).toBe(true);
    expect(r.details?.error).toBe("missing_api_key");
  });
});

// =============================================================================
// C5: web_find_similar_exa — find similar pages tool
// =============================================================================
describe("C5: web_find_similar_exa — find similar pages tool", () => {
  it("calls exa.findSimilar not exa.request", async () => {
    mocks.findSimilar.mockResolvedValueOnce({
      results: [{ title: "Similar Page", url: "https://similar.com", id: "2", score: 0.9 }],
      requestId: "r2",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_find_similar_exa") {
          t.execute("call-1", { url: "https://example.com/article" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(mocks.findSimilar).toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("formats results like search results", async () => {
    mocks.findSimilar.mockResolvedValueOnce({
      results: [
        { title: "React Tutorial", url: "https://example.com/react", id: "1", score: 0.95 },
        { title: "Vue Tutorial", url: "https://example.com/vue", id: "2", score: 0.90 },
      ],
      requestId: "r2",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_find_similar_exa") {
          t.execute("call-1", { url: "https://example.com/article" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(false);
    expect(r.content[0]?.text).toContain("React");
    expect(r.content[0]?.text).toContain("example.com");
  });

  it("fires onUpdate callback", async () => {
    mocks.findSimilar.mockResolvedValueOnce({ results: [], requestId: "r2" } as MockSearchResponse);

    const onUpdate = vi.fn();
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_find_similar_exa") {
          t.execute("call-f1", { url: "https://example.com" }, undefined, onUpdate);
        }
      },
    });

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalled();
  });

  it("returns error when API key missing", async () => {
    let result: unknown;
    await loadExtension({
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_find_similar_exa") {
          t.execute("call-1", { url: "https://example.com" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 0));
    expect(result).toBeDefined();
    const r = result as { isError: boolean; details?: Record<string, unknown> };
    expect(r.isError).toBe(true);
    expect(r.details?.error).toBe("missing_api_key");
  });
});

// =============================================================================
// C6: Advanced type enforcement + content enrichment
// =============================================================================
describe("C6: Advanced type enforcement + content enrichment", () => {
  it("rejects deep-reasoning type with error directing to web_research_exa", async () => {
    mocks.search.mockResolvedValueOnce({ results: [], requestId: "r1" } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-advanced") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_advanced_exa") {
          t.execute("call-1", { query: "test", type: "deep-reasoning" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 0));
    expect(result).toBeDefined();
    const r = result as { isError: boolean; details?: Record<string, unknown> };
    expect(r.isError).toBe(true);
    expect(r.details?.error).toBe("unsupported_type");
    expect((r as { content?: Array<{ text: string }> }).content?.[0]?.text).toContain("web_research_exa");
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("rejects deep type with helpful error", async () => {
    mocks.search.mockResolvedValueOnce({ results: [], requestId: "r1" } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-advanced") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_advanced_exa") {
          t.execute("call-1", { query: "test", type: "deep" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 0));
    expect(result).toBeDefined();
    const r = result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("web_research_exa");
  });

  it("accepts auto, fast, neural, keyword, hybrid, instant types", async () => {
    const types = ["auto", "fast", "neural", "keyword", "hybrid", "instant"] as const;

    for (const type of types) {
      // Clear call history manually (does NOT clear queued return values like mockResolvedValueOnce)
  mocks.search.mock.calls.length = 0;
  mocks.getContents.mock.calls.length = 0;
  mocks.answer.mock.calls.length = 0;
  mocks.findSimilar.mock.calls.length = 0;
  mocks.researchCreate.mock.calls.length = 0;
  mocks.researchPollUntilFinished.mock.calls.length = 0;
      mocks.search.mockResolvedValueOnce({ results: [], requestId: `r-${type}` } as MockSearchResponse);

      let result: unknown;
      await loadExtension({
        getFlag: (flag: string) => {
          if (flag === "--exa-api-key") return "test-key";
          if (flag === "--exa-enable-advanced") return true;
          return undefined;
        },
        registerTool: (tool: unknown) => {
          const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
          if (t.name === "web_search_advanced_exa") {
            t.execute(`call-${type}`, { query: "test", type }, undefined, vi.fn()).then(r => { result = r; });
          }
        },
      });

      await new Promise(r => setTimeout(r, 10));
      const r = result as { isError: boolean };
      expect(r.isError).toBe(false);
    }
  });

  it("details include costDollars and searchTime", async () => {
    mocks.search.mockResolvedValueOnce({
      results: [],
      requestId: "r1",
      costDollars: { search: { total: 0.007 } },
      searchTime: 0.45,
      resolvedSearchType: "neural",
    } as MockSearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-advanced") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_search_advanced_exa") {
          t.execute("call-1", { query: "test" }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { details?: Record<string, unknown> };
    expect(r.details?.searchTime).toBeCloseTo(0.45, 1);
    expect(r.details?.resolvedSearchType).toBe("neural");
  });

  it("supports outputSchema and formats as JSON code block", async () => {
    mocks.researchCreate.mockResolvedValueOnce({ researchId: "r-id" });
    mocks.researchPollUntilFinished.mockResolvedValueOnce({
      status: "completed",
      output: {
        content: { companies: [{ name: "Acme Corp", revenue: "$1B" }] },
      },
    } as MockResearchResponse);

    let result: unknown;
    await loadExtension({
      getFlag: (flag: string) => {
        if (flag === "--exa-api-key") return "test-key";
        if (flag === "--exa-enable-research") return true;
        return undefined;
      },
      registerTool: (tool: unknown) => {
        const t = tool as { name: string; execute: (...args: unknown[]) => Promise<unknown> };
        if (t.name === "web_research_exa") {
          t.execute("call-1", {
            query: "top companies by revenue",
            outputSchema: { type: "object", properties: { companies: { type: "array" } } },
          }, undefined, vi.fn()).then(r => { result = r; });
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    const r = result as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(false);
    expect(r.content[0]?.text).toContain("```json");
    expect(r.content[0]?.text).toContain("Acme Corp");
  });
});

// =============================================================================
// C7: Skill rewrite — pi-native skills
// =============================================================================
describe("C7: Skill rewrite — pi-native skills", () => {
  const skillNames = [
    "code-search",
    "company-research",
    "financial-report-search",
    "people-research",
    "personal-site-search",
    "research-paper-search",
  ] as const;

  for (const skillName of skillNames) {
    it(`should have ${skillName} skill`, () => {
      const { readFileSync, existsSync } = require("node:fs");
      const { join } = require("node:path");
      const skillPath = join(__dirname, "..", "skills", skillName, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    });

    it(`${skillName}: has Tool Selection section`, () => {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const content = readFileSync(join(__dirname, "..", "skills", skillName, "SKILL.md"), "utf-8");
      expect(content).toContain("Tool Selection");
      // At least one Exa tool should be referenced in Tool Selection
      const hasTool = content.includes("web_search_exa") ||
        content.includes("web_search_advanced_exa") ||
        content.includes("web_fetch_exa") ||
        content.includes("web_find_similar_exa") ||
        content.includes("web_research_exa");
      expect(hasTool).toBe(true);
    });

    it(`${skillName}: has Recommended Settings section`, () => {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const content = readFileSync(join(__dirname, "..", "skills", skillName, "SKILL.md"), "utf-8");
      expect(content).toContain("Recommended Settings");
    });

    it(`${skillName}: does not use ONLY use uppercase pattern`, () => {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const content = readFileSync(join(__dirname, "..", "skills", skillName, "SKILL.md"), "utf-8");
      expect(content).not.toMatch(/\bonly\b.*use/i);
    });

    it(`${skillName}: has Query Writing Patterns or Query Variation section`, () => {
      const { readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const content = readFileSync(join(__dirname, "..", "skills", skillName, "SKILL.md"), "utf-8");
      const hasSection = content.includes("## Query Writing Patterns") || content.includes("## Query Variation");
      expect(hasSection).toBe(true);
    });
  }
});

// =============================================================================
// C8: Version bump — 3.0.0
// =============================================================================
describe("C8: Version bump — 3.0.0", () => {
  it("package.json version is 3.0.0", () => {
    const { readFileSync } = require("node:fs");
    const pkg = JSON.parse(readFileSync(require.resolve("../package.json"), "utf-8"));
    expect(pkg.version).toBe("3.0.0");
  });
});

// =============================================================================
// Unit helpers tests
// =============================================================================
describe("Unit: helper functions", () => {
  it("formatSearchResults returns formatted output", async () => {
    const { formatSearchResults } = await import("../extensions/index.ts");
    const results = [
      {
        title: "Test Article",
        url: "https://example.com",
        id: "1",
        score: 0.95,
        publishedDate: "2024-01-15T12:00:00Z",
        author: "John Doe",
        text: "Article content here",
      },
    ];
    const output = formatSearchResults(results);
    expect(output).toContain("Test Article");
    expect(output).toContain("example.com");
    expect(output).toContain("John Doe");
    expect(output).toContain("2024-01-15");
  });

  it("formatCrawlResults returns formatted output", async () => {
    const { formatCrawlResults } = await import("../extensions/index.ts");
    const results = [
      {
        title: "My Blog Post",
        url: "https://blog.com/post",
        publishedDate: "2024-02-01",
        author: "Jane Smith",
        text: "Blog content",
        highlights: ["Key point 1", "Key point 2"],
      },
    ];
    const output = formatCrawlResults(results);
    expect(output).toContain("My Blog Post");
    expect(output).toContain("Key point 1");
    expect(output).toContain("Key point 2");
    expect(output).toContain("Blog content");
  });

  it("formatResearchOutput handles string content with grounding", async () => {
    const { formatResearchOutput } = await import("../extensions/index.ts");
    const response = {
      output: {
        content: "Synthesized research on AI.",
        grounding: [
          {
            field: "Summary",
            citations: [{ url: "https://example.com/1", title: "Source 1" }],
            confidence: "high",
          },
        ],
      },
      results: [{ url: "https://example.com/2", title: "Source 2" }],
    };
    const output = formatResearchOutput(response);
    expect(output).toContain("Synthesized research on AI");
    expect(output).toContain("Grounding Citations");
    expect(output).toContain("Source 1");
    expect(output).toContain("Source 2");
    expect(output).toContain("high");
  });

  it("formatResearchOutput handles JSON content", async () => {
    const { formatResearchOutput } = await import("../extensions/index.ts");
    const response = {
      output: {
        content: { companies: [{ name: "Acme", revenue: "$1B" }] },
      },
    };
    const output = formatResearchOutput(response);
    expect(output).toContain("```json");
    expect(output).toContain("Acme");
  });

  it("formatAnswerResult formats string answer with citations", async () => {
    const { formatAnswerResult } = await import("../extensions/index.ts");
    const response = {
      answer: "The answer is 42.",
      citations: [
        { id: "1", url: "https://source.com", title: "Source Doc", text: "Relevant excerpt" },
      ],
    };
    const output = formatAnswerResult(response);
    expect(output).toContain("42");
    expect(output).toContain("Source Doc");
    expect(output).toContain("Relevant excerpt");
    expect(output).toContain("Sources");
  });

  it("extractCost returns costDollars object", async () => {
    const { extractCost } = await import("../extensions/index.ts");
    const result = extractCost({ search: { total: 0.05 } });
    expect(result).toEqual({ costDollars: { search: { total: 0.05 } } });
  });

  it("extractCost returns undefined when no cost", async () => {
    const { extractCost } = await import("../extensions/index.ts");
    const result = extractCost(undefined);
    expect(result).toBeUndefined();
  });

  it("parseConfig handles valid config", async () => {
    const { parseConfig } = await import("../extensions/index.ts");
    const result = parseConfig({ apiKey: "test-key", advancedEnabled: true });
    expect(result.apiKey).toBe("test-key");
    expect(result.advancedEnabled).toBe(true);
    expect(result.researchEnabled).toBe(false);
  });

  it("parseConfig handles invalid config gracefully", async () => {
    const { parseConfig } = await import("../extensions/index.ts");
    const result = parseConfig(null);
    expect(result).toEqual({});
    const result2 = parseConfig("invalid");
    expect(result2).toEqual({});
    const result3 = parseConfig({ apiKey: "  " });
    expect(result3.apiKey).toBeUndefined();
  });

  it("resolveConfigPath resolves tilde paths", async () => {
    const { resolveConfigPath } = await import("../extensions/index.ts");
    const result = resolveConfigPath("~/config.json");
    expect(result).toContain("config.json");
    expect(result.startsWith("/")).toBe(true);
  });

  it("resolveConfigPath resolves absolute paths", async () => {
    const { resolveConfigPath } = await import("../extensions/index.ts");
    const result = resolveConfigPath("/absolute/path.json");
    expect(result).toBe("/absolute/path.json");
  });

  it("PROMPT_SNIPPETS has entries for all 6 tools", async () => {
    const { PROMPT_SNIPPETS } = await import("../extensions/index.ts");
    const tools = [
      "web_search_exa",
      "web_fetch_exa",
      "web_search_advanced_exa",
      "web_research_exa",
      "web_answer_exa",
      "web_find_similar_exa",
    ];
    for (const tool of tools) {
      expect(PROMPT_SNIPPETS[tool]).toBeDefined();
      expect(PROMPT_SNIPPETS[tool].length).toBeGreaterThan(0);
    }
  });

  it("PROMPT_GUIDELINES has entries for all 6 tools", async () => {
    const { PROMPT_GUIDELINES } = await import("../extensions/index.ts");
    const tools = [
      "web_search_exa",
      "web_fetch_exa",
      "web_search_advanced_exa",
      "web_research_exa",
      "web_answer_exa",
      "web_find_similar_exa",
    ];
    for (const tool of tools) {
      expect(PROMPT_GUIDELINES[tool]).toBeDefined();
      expect(Array.isArray(PROMPT_GUIDELINES[tool])).toBe(true);
      expect(PROMPT_GUIDELINES[tool].length).toBeGreaterThan(0);
    }
  });

  it("VALID_ADVANCED_TYPES contains expected values", async () => {
    const { VALID_ADVANCED_TYPES } = await import("../extensions/index.ts");
    expect(VALID_ADVANCED_TYPES).toContain("auto");
    expect(VALID_ADVANCED_TYPES).toContain("fast");
    expect(VALID_ADVANCED_TYPES).toContain("neural");
    expect(VALID_ADVANCED_TYPES).toContain("keyword");
    expect(VALID_ADVANCED_TYPES).toContain("hybrid");
    expect(VALID_ADVANCED_TYPES).toContain("instant");
    expect(VALID_ADVANCED_TYPES).not.toContain("deep");
    expect(VALID_ADVANCED_TYPES).not.toContain("deep-reasoning");
  });

  it("DEFAULT constants are correct", async () => {
    const { DEFAULT_MAX_CHARACTERS, DEFAULT_NUM_RESULTS } = await import("../extensions/index.ts");
    expect(DEFAULT_MAX_CHARACTERS).toBe(3000);
    expect(DEFAULT_NUM_RESULTS).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { performWebFetch } from "../extensions/web-fetch.js";
import { performResearch } from "../extensions/web-research.js";
import { performWebSearch } from "../extensions/web-search.js";

const hasManualFlag = process.argv.includes("--exa-live") || process.env.PI_EXA_LIVE === "1";
const hasApiKey = typeof process.env.EXA_API_KEY === "string" && process.env.EXA_API_KEY.trim().length > 0;
const shouldRunLiveTests = hasManualFlag && hasApiKey && !process.env.CI;
const describeLive = shouldRunLiveTests ? describe : describe.skip;
const apiKey = process.env.EXA_API_KEY?.trim() || "";

describeLive("pi-exa live integration", () => {
  it("performs a real web search against Exa", { timeout: 30_000 }, async () => {
    const result = await performWebSearch(apiKey, "OpenAI official website", 3);

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.details.tool).toBe("web_search_exa");
  });

  it("fetches a real page through Exa", { timeout: 30_000 }, async () => {
    const result = await performWebFetch(apiKey, ["https://example.com"], {
      maxCharacters: 1500,
      summary: { query: "What is this page for?" },
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("example.com");
    expect(result.details.tool).toBe("web_fetch_exa");
  });

  it("runs a real deep research request through Exa", { timeout: 60_000 }, async () => {
    const result = await performResearch(apiKey, {
      query: "What is the purpose of the Example Domain page?",
      type: "deep-lite",
      systemPrompt: "Use concise wording and rely on the most relevant public web sources.",
      numResults: 3,
      textMaxCharacters: 4000,
      outputSchema: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
      },
      includeDomains: ["example.com", "iana.org"],
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.details.tool).toBe("web_research_exa");
  });
});

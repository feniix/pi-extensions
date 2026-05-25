import { describe, expect, it } from "vitest";
import { performWebFetch } from "../extensions/web-fetch.js";
import { performResearch } from "../extensions/web-research.js";
import { performWebSearch } from "../extensions/web-search.js";
import { performAdvancedSearch } from "../extensions/web-search-advanced.js";

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

  it("accepts the post-4.1.0 advanced-search schema fields end-to-end", { timeout: 30_000 }, async () => {
    // Regression net for the 14 fields added in 4.1.0. Asserts only that Exa
    // accepts the payload and returns a non-empty result — content shape is
    // best-effort because Exa rankings drift. The point is to catch the day
    // Exa renames or drops one of these fields, not to spec their behavior.
    const result = await performAdvancedSearch(apiKey, "rust async runtime tokio", {
      numResults: 2,
      type: "auto",
      userLocation: "US",
      includeText: ["rust"],
      additionalQueries: ["tokio runtime"],
      moderation: true,
      enableSummary: true,
      summaryQuery: "what does this page describe",
      enableHighlights: true,
      highlightsMaxCharacters: 480,
      highlightsQuery: "async executor",
      contextMaxCharacters: 1000,
      maxAgeHours: 24,
      livecrawlTimeout: 4000,
      subpages: 2,
      subpageTarget: ["about"],
      textMaxCharacters: 500,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.details.tool).toBe("web_search_advanced_exa");
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

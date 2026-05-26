import { Exa } from "exa-js";
import { describe, expect, it } from "vitest";
import { performWebFetch } from "../extensions/web-fetch.js";
import { performResearch } from "../extensions/web-research.js";
import { performWebSearch } from "../extensions/web-search.js";
import { performAdvancedSearch } from "../extensions/web-search-advanced.js";

const hasManualFlag = process.argv.includes("--exa-live") || process.env.PI_EXA_LIVE === "1";
const hasApiKey = typeof process.env.EXA_API_KEY === "string" && process.env.EXA_API_KEY.trim().length > 0;
const shouldRunLiveTests = hasManualFlag && hasApiKey && !process.env.CI;
const describeLive = shouldRunLiveTests ? describe : describe.skip;
// The auth-failure probe deliberately does NOT use the real API key; gate it
// on the live-mode flag alone (plus the CI guard, so we don't make outbound
// calls in CI). Probe stays opt-in alongside the rest of the live suite.
const shouldRunAuthProbe = hasManualFlag && !process.env.CI;
const describeAuthProbe = shouldRunAuthProbe ? describe : describe.skip;
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
    // Confirm we hit the real search path and got back real Exa results, not
    // the empty-results fallback string. costDollars proves the request
    // reached Exa's billing layer, and the URL match proves results were
    // serialized into the formatted text.
    expect(result.details.costDollars).toBeDefined();
    expect(result.text).toMatch(/https?:\/\//);
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

/**
 * Regression pin for code-review finding #19. The concern was that
 * PortableToolExecutionError might echo API-key fragments from exa-js auth
 * failures. Empirical probing (2026-05-26, exa-js 2.11.0) shows Exa's 401
 * body is `{error: "Invalid API key"}` and exa-js's ExaError only carries
 * server-provided message + statusCode + timestamp + path — the submitted
 * credential never enters the error envelope.
 *
 * This test hits the live Exa endpoint with a deliberately-fake key on each
 * SDK method and asserts the resulting error does not echo the key. If a
 * future exa-js release starts including request details in errors, this
 * test catches it.
 */
describeAuthProbe("pi-exa auth-failure shape — exa-js does not leak the supplied API key", () => {
  for (const [method, call] of [
    ["search", (key: string) => new Exa(key).search("test", { numResults: 1 })],
    [
      "getContents",
      (key: string) => new Exa(key).getContents(["https://example.com"], { text: { maxCharacters: 100 } }),
    ],
    ["answer", (key: string) => new Exa(key).answer("test")],
    ["findSimilar", (key: string) => new Exa(key).findSimilar("https://example.com", { numResults: 1 })],
  ] as const) {
    it(`${method} returns ExaError(401) without echoing the supplied key`, { timeout: 30_000 }, async () => {
      // Build a distinctive fake key per case so any echo would stand out and
      // collisions across simultaneous test runs are impossible.
      const fakeKey = `exa-FAKE-PROBE-KEY-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}-do-not-use`;

      let caught: unknown;
      try {
        await call(fakeKey);
      } catch (error) {
        caught = error;
      }

      expect(caught, `${method} must throw on auth failure`).toBeDefined();
      const error = caught as Error & { statusCode?: number };
      expect(error.name).toBe("ExaError");
      expect(error.statusCode).toBe(401);

      // Serialize every own property so the assertion catches future fields
      // (e.g., a hypothetical `error.request` echoing the URL with the key).
      const envelope = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(envelope, `${method} error envelope must not contain the fake key`).not.toContain(fakeKey);
      // Partial-leak guard: even a recognizable prefix should not appear.
      expect(envelope).not.toContain(fakeKey.slice(0, 20));
    });
  }
});

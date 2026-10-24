import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig, resolveRuntimeSettings } from "../extensions/config.js";

const keys = ["timeoutMs", "researchTimeoutMs", "submitTimeoutMs", "monitorIntervalMs"] as const;
const config = { timeoutMs: 100, researchTimeoutMs: 200, submitTimeoutMs: 300, monitorIntervalMs: 400 };
const pi = (flags: Record<string, string | boolean> = {}) =>
  ({ getFlag: (name: string) => flags[name] }) as ExtensionAPI;

afterEach(() => vi.unstubAllEnvs());

describe("Exa runtime configuration", () => {
  it("parses all four millisecond settings", () => {
    expect(parseConfig(config)).toMatchObject(config);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, "100", null, true])(
    "ignores invalid config duration %s",
    (value) => {
      const parsed = parseConfig(Object.fromEntries(keys.map((key) => [key, value])));
      for (const key of keys) expect(parsed[key]).toBeUndefined();
    },
  );

  it("uses config when flags and environment are absent", () => {
    vi.stubEnv("EXA_TIMEOUT_MS", "");
    vi.stubEnv("EXA_RESEARCH_TIMEOUT_MS", "");
    expect(resolveRuntimeSettings(pi(), config)).toEqual({
      timeouts: { default: 100, web_research_exa: 200 },
      submitTimeoutMs: 300,
      monitorIntervalMs: 400,
    });
  });

  it("prefers CLI over environment over config", () => {
    vi.stubEnv("EXA_TIMEOUT_MS", "500");
    vi.stubEnv("EXA_RESEARCH_TIMEOUT_MS", "600");
    expect(resolveRuntimeSettings(pi(), config).timeouts).toEqual({ default: 500, web_research_exa: 600 });
    expect(
      resolveRuntimeSettings(
        pi({
          "exa-timeout-ms": "700",
          "exa-research-timeout-ms": "800",
          "exa-submit-timeout-ms": "900",
          "exa-monitor-interval-ms": "1000",
        }),
        config,
      ),
    ).toEqual({
      timeouts: { default: 700, web_research_exa: 800 },
      submitTimeoutMs: 900,
      monitorIntervalMs: 1000,
    });
  });

  it.each(["0", "-1", "1.5", "123junk", "Infinity", "2147483648"])("rejects CLI/env duration %s", (value) => {
    vi.stubEnv("EXA_TIMEOUT_MS", value);
    vi.stubEnv("EXA_RESEARCH_TIMEOUT_MS", value);
    expect(
      resolveRuntimeSettings(
        pi({
          "exa-timeout-ms": value,
          "exa-research-timeout-ms": value,
          "exa-submit-timeout-ms": value,
          "exa-monitor-interval-ms": value,
        }),
        config,
      ),
    ).toEqual({
      timeouts: { default: 100, web_research_exa: 200 },
      submitTimeoutMs: 300,
      monitorIntervalMs: 400,
    });
  });

  it("leaves built-in defaults to the runtime when nothing is configured", () => {
    vi.stubEnv("EXA_TIMEOUT_MS", "");
    vi.stubEnv("EXA_RESEARCH_TIMEOUT_MS", "");
    expect(resolveRuntimeSettings(pi(), null)).toEqual({
      timeouts: undefined,
      submitTimeoutMs: undefined,
      monitorIntervalMs: undefined,
    });
  });
});

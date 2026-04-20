import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_CHARACTERS,
  DEFAULT_NUM_RESULTS,
  formatCrawlResults,
  formatSearchResults,
  getAuthStatusMessage,
  isToolEnabledForConfig,
  loadConfig,
  parseConfig,
  resolveAuth,
  resolveConfigPath,
} from "../extensions/index.js";

describe("pi-exa resolveConfigPath", () => {
  it("resolves paths starting with ~/", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(homedir());
    expect(result).toContain(".pi/config.json");
  });

  it("resolves paths starting with ~", () => {
    const result = resolveConfigPath("~/.pi/config.json");
    expect(result).toContain(".pi/config.json");
  });

  it("returns absolute paths as-is", () => {
    const absolute = "/absolute/path/to/config.json";
    expect(resolveConfigPath(absolute)).toBe(absolute);
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveConfigPath("relative/path.json");
    expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
  });
});

describe("pi-exa parseConfig", () => {
  it("parses valid config", () => {
    const raw = {
      apiKey: "test-key",
      enabledTools: ["web_search_exa", "web_fetch_exa"],
      advancedEnabled: true,
      researchEnabled: true,
    };
    const result = parseConfig(raw);
    expect(result).toEqual({
      apiKey: "test-key",
      enabledTools: ["web_search_exa", "web_fetch_exa"],
      advancedEnabled: true,
      researchEnabled: true,
    });
  });

  it("returns defaults for invalid input", () => {
    expect(parseConfig(null)).toEqual({});
    expect(parseConfig(undefined)).toEqual({});
    expect(parseConfig("string")).toEqual({});
    expect(parseConfig(123)).toEqual({});
  });

  it("filters out non-string/empty tools", () => {
    const raw = { enabledTools: ["web_search_exa", 123, "web_fetch_exa", null, "  "] };
    const result = parseConfig(raw);
    expect(result.enabledTools).toEqual(["web_search_exa", "web_fetch_exa"]);
  });

  it("defaults advancedEnabled and researchEnabled to false", () => {
    const result = parseConfig({ advancedEnabled: "not-a-boolean" });
    expect(result.advancedEnabled).toBe(false);
    expect(result.researchEnabled).toBe(false);
  });

  it("trims api key", () => {
    const result = parseConfig({ apiKey: "  test-key  " });
    expect(result.apiKey).toBe("test-key");
  });
});

describe("pi-exa formatSearchResults", () => {
  it("formats search results", () => {
    const results = [
      {
        title: "Test Article",
        url: "https://example.com/article",
        publishedDate: "2025-01-01",
        highlights: ["This is a highlight", "Another highlight"],
      },
    ];
    const result = formatSearchResults(results);
    expect(result).toContain("Test Article");
    expect(result).toContain("https://example.com/article");
    expect(result).toContain("2025-01-01");
    expect(result).toContain("This is a highlight");
  });

  it("handles results without optional fields", () => {
    const results = [{ url: "https://example.com" }];
    const result = formatSearchResults(results);
    expect(result).toContain("https://example.com");
  });

  it("handles empty results", () => {
    const result = formatSearchResults([]);
    expect(result).toContain("No search results found");
  });

  it("handles results with author", () => {
    const results = [
      {
        url: "https://example.com",
        author: "John Doe",
      },
    ];
    const result = formatSearchResults(results);
    expect(result).toContain("John Doe");
  });

  it("shows N/A for missing title", () => {
    const results = [{ url: "https://example.com" }];
    const result = formatSearchResults(results);
    expect(result).toContain("N/A");
  });

  it("uses text when no highlights", () => {
    const results = [
      {
        url: "https://example.com",
        text: "Fallback text content",
      },
    ];
    const result = formatSearchResults(results);
    expect(result).toContain("Fallback text content");
  });
});

describe("pi-exa formatCrawlResults", () => {
  it("formats crawl results with text", () => {
    const results = [
      {
        url: "https://example.com",
        text: "This is the page content",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("https://example.com");
    expect(result).toContain("This is the page content");
  });

  it("handles empty results", () => {
    const result = formatCrawlResults([]);
    expect(result).toContain("No content");
  });

  it("handles results with author and publishedDate", () => {
    const results = [
      {
        url: "https://example.com/article",
        text: "Content here",
        author: "John Doe",
        publishedDate: "2025-01-15",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("John Doe");
    expect(result).toContain("2025-01-15");
  });

  it("handles results with title", () => {
    const results = [
      {
        url: "https://example.com",
        text: "Content",
        title: "Page Title",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("Page Title");
  });

  it("handles results without title", () => {
    const results = [
      {
        url: "https://example.com",
        text: "Content",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("(no title)");
  });

  it("handles results with full datetime in publishedDate", () => {
    const results = [
      {
        url: "https://example.com",
        text: "Content",
        publishedDate: "2025-01-15T10:30:00Z",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("2025-01-15");
  });

  it("handles results without text", () => {
    const results = [
      {
        url: "https://example.com",
      },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("https://example.com");
  });

  it("handles multiple results", () => {
    const results = [
      { url: "https://example.com/1", text: "First page" },
      { url: "https://example.com/2", text: "Second page" },
    ];
    const result = formatCrawlResults(results);
    expect(result).toContain("First page");
    expect(result).toContain("Second page");
  });
});

describe("pi-exa constants", () => {
  it("has correct DEFAULT_MAX_CHARACTERS", () => {
    expect(DEFAULT_MAX_CHARACTERS).toBe(3000);
  });

  it("has correct DEFAULT_NUM_RESULTS", () => {
    expect(DEFAULT_NUM_RESULTS).toBe(5);
  });
});

describe("pi-exa settings config", () => {
  it("loads settings from standard pi settings files", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-exa-settings-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-exa-settings-project-"));

    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tempProject, ".pi"), { recursive: true });

    writeFileSync(
      join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({ "pi-exa": { enabledTools: ["web_search_exa"] } }),
      "utf-8",
    );
    writeFileSync(
      join(tempProject, ".pi", "settings.json"),
      JSON.stringify({ "pi-exa": { advancedEnabled: true } }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();

    try {
      const mod = await import("../extensions/index.js");
      const result = mod.loadConfig(undefined);
      expect(result?.apiKey).toBeUndefined();
      expect(result?.enabledTools).toEqual(["web_search_exa"]);
      expect(result?.advancedEnabled).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });
});
describe("pi-exa auth helpers", () => {
  it("prefers CLI flag over config and environment", () => {
    const pi = {
      getFlag(flag: string) {
        if (flag === "--exa-api-key") {
          return " cli-key ";
        }
        return undefined;
      },
    } as { getFlag: (flag: string) => unknown };

    process.env.EXA_API_KEY = "env-key";
    expect(resolveAuth(pi as never)).toEqual({ apiKey: "cli-key", source: "CLI flag" });
  });

  it("uses config when CLI flag is absent", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-exa-auth-config-"));
    const configPath = join(base, "exa.json");
    writeFileSync(configPath, JSON.stringify({ apiKey: "config-key" }), "utf-8");

    const pi = {
      getFlag(flag: string) {
        if (flag === "--exa-config-file") {
          return configPath;
        }
        return undefined;
      },
    } as { getFlag: (flag: string) => unknown };

    delete process.env.EXA_API_KEY;
    expect(resolveAuth(pi as never)).toEqual({ apiKey: "config-key", source: "config file" });
  });

  it("builds unauthenticated status message", () => {
    const pi = { getFlag: () => undefined } as { getFlag: (flag: string) => unknown };
    delete process.env.EXA_API_KEY;
    expect(getAuthStatusMessage(pi as never)).toContain("Not authenticated");
  });
});

describe("pi-exa tool enablement helpers", () => {
  it("enables default tools without config", () => {
    const pi = { getFlag: () => undefined } as { getFlag: (flag: string) => unknown };
    expect(isToolEnabledForConfig(pi as never, null, "web_search_exa")).toBe(true);
    expect(isToolEnabledForConfig(pi as never, null, "web_fetch_exa")).toBe(true);
  });

  it("respects advanced tool flag override", () => {
    const pi = {
      getFlag(flag: string) {
        return flag === "--exa-enable-advanced" ? true : undefined;
      },
    } as { getFlag: (flag: string) => unknown };
    const config = { advancedEnabled: false };
    expect(isToolEnabledForConfig(pi as never, config, "web_search_advanced_exa")).toBe(true);
  });

  it("respects explicit enabled tools list", () => {
    const pi = { getFlag: () => undefined } as { getFlag: (flag: string) => unknown };
    const config = { enabledTools: ["web_search_advanced_exa"] };
    expect(isToolEnabledForConfig(pi as never, config, "web_search_exa")).toBe(false);
    expect(isToolEnabledForConfig(pi as never, config, "web_search_advanced_exa")).toBe(true);
  });
});

describe("pi-exa loadConfig", () => {
  it("returns null when no config exists", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-exa-load-"));
    const configPath = join(base, "nonexistent.json");
    const result = loadConfig(configPath);
    expect(result).toBeNull();
  });

  it("loads valid config file", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-exa-load-valid-"));
    const configPath = join(base, "exa.json");
    const config = {
      apiKey: "test-api-key",
      enabledTools: ["web_search_exa"],
      advancedEnabled: true,
      researchEnabled: true,
    };
    writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const result = loadConfig(configPath);
    expect(result?.apiKey).toBe("test-api-key");
    expect(result?.enabledTools).toContain("web_search_exa");
    expect(result?.advancedEnabled).toBe(true);
    expect(result?.researchEnabled).toBe(true);
  });

  it("returns null on invalid JSON", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-exa-load-invalid-"));
    const configPath = join(base, "invalid.json");
    writeFileSync(configPath, "not valid json", "utf-8");

    expect(loadConfig(configPath)).toBeNull();
  });

  it("loads from environment config path", () => {
    const base = mkdtempSync(join(tmpdir(), "pi-exa-load-env-"));
    const configPath = join(base, "env-config.json");
    const config = { apiKey: "env-api-key" };
    writeFileSync(configPath, JSON.stringify(config), "utf-8");

    const result = loadConfig(configPath);
    expect(result?.apiKey).toBe("env-api-key");
  });

  it("warns when a legacy config file exists but is ignored", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-exa-legacy-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-exa-legacy-project-"));

    mkdirSync(join(tempHome, ".pi", "agent", "extensions"), { recursive: true });
    writeFileSync(
      join(tempHome, ".pi", "agent", "extensions", "exa.json"),
      JSON.stringify({ apiKey: "legacy-key" }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const mod = await import("../extensions/index.js");
      expect(mod.loadConfig(undefined)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Ignoring legacy config file"));
    } finally {
      warnSpy.mockRestore();
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });

  it("loads researchEnabled from settings files", async () => {
    const originalHome = process.env.HOME;
    const originalCwd = process.cwd();
    const tempHome = mkdtempSync(join(tmpdir(), "pi-exa-research-home-"));
    const tempProject = mkdtempSync(join(tmpdir(), "pi-exa-research-project-"));

    mkdirSync(join(tempHome, ".pi", "agent"), { recursive: true });
    mkdirSync(join(tempProject, ".pi"), { recursive: true });

    writeFileSync(
      join(tempHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        "pi-exa": {
          researchEnabled: true,
        },
      }),
      "utf-8",
    );

    process.env.HOME = tempHome;
    process.chdir(tempProject);
    vi.resetModules();

    try {
      const mod = await import("../extensions/index.js");
      expect(mod.loadConfig(undefined)?.researchEnabled).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });
});

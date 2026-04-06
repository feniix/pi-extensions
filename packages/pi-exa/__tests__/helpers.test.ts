import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_CHARACTERS,
	DEFAULT_NUM_RESULTS,
	ensureDefaultConfigFile,
	formatCrawlResults,
	formatSearchResults,
	loadConfig,
	parseConfig,
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
		};
		const result = parseConfig(raw);
		expect(result).toEqual({
			apiKey: "test-key",
			enabledTools: ["web_search_exa", "web_fetch_exa"],
			advancedEnabled: true,
		});
	});

	it("returns defaults for invalid input", () => {
		expect(parseConfig(null)).toEqual({});
		expect(parseConfig(undefined)).toEqual({});
		expect(parseConfig("string")).toEqual({});
		expect(parseConfig(123)).toEqual({});
	});

	it("filters out non-string tools", () => {
		const raw = { enabledTools: ["web_search_exa", 123, "web_fetch_exa", null] };
		const result = parseConfig(raw);
		expect(result.enabledTools).toEqual(["web_search_exa", "web_fetch_exa"]);
	});

	it("defaults advancedEnabled to false", () => {
		const result = parseConfig({ advancedEnabled: "not-a-boolean" });
		expect(result.advancedEnabled).toBe(false);
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
});

describe("pi-exa constants", () => {
	it("has correct DEFAULT_MAX_CHARACTERS", () => {
		expect(DEFAULT_MAX_CHARACTERS).toBe(3000);
	});

	it("has correct DEFAULT_NUM_RESULTS", () => {
		expect(DEFAULT_NUM_RESULTS).toBe(5);
	});
});

describe("pi-exa ensureDefaultConfigFile", () => {
	it("writes default config when none exists", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-exa-config-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "exa.json");
		const globalConfigPath = join(base, "global", "extensions", "exa.json");

		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);

		expect(existsSync(globalConfigPath)).toBe(true);
		const raw = readFileSync(globalConfigPath, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed).toHaveProperty("apiKey");
		expect(parsed).toHaveProperty("enabledTools");
	});

	it("does not overwrite existing config", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-exa-config-exists-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "exa.json");
		const globalConfigPath = join(base, "global", "extensions", "exa.json");

		// First call creates the file
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const firstContent = readFileSync(globalConfigPath, "utf-8");

		// Second call should not overwrite
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const secondContent = readFileSync(globalConfigPath, "utf-8");

		expect(firstContent).toBe(secondContent);
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
		const config = { apiKey: "test-api-key", enabledTools: ["web_search_exa"] };
		writeFileSync(configPath, JSON.stringify(config), "utf-8");

		const result = loadConfig(configPath);
		expect(result?.apiKey).toBe("test-api-key");
		expect(result?.enabledTools).toContain("web_search_exa");
	});

	it("throws on invalid JSON", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-exa-load-invalid-"));
		const configPath = join(base, "invalid.json");
		writeFileSync(configPath, "not valid json", "utf-8");

		// loadConfig throws on invalid JSON
		expect(() => loadConfig(configPath)).toThrow();
	});

	it("loads from environment config path", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-exa-load-env-"));
		const configPath = join(base, "env-config.json");
		const config = { apiKey: "env-api-key" };
		writeFileSync(configPath, JSON.stringify(config), "utf-8");

		const result = loadConfig(configPath);
		expect(result?.apiKey).toBe("env-api-key");
	});

	it("returns default config for empty config path", () => {
		const result = loadConfig(undefined);
		// Creates default config and returns it
		expect(result).not.toBeNull();
		expect(result).toHaveProperty("enabledTools");
		expect(result?.enabledTools).toContain("web_search_exa");
	});
});

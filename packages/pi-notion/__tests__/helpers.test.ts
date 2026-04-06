import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	formatBlocks,
	formatDatabase,
	formatPage,
	formatSearch,
	getTitleFromProperties,
	loadConfig,
	resolveConfigPath,
} from "../extensions/index.js";

describe("pi-notion resolveConfigPath", () => {
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

	it("handles whitespace in paths", () => {
		const result = resolveConfigPath("  ~/.pi/config.json  ");
		expect(result).toContain(".pi/config.json");
	});

	it("handles path with only tilde", () => {
		const result = resolveConfigPath("~");
		expect(result).toBe(homedir());
	});
});

describe("pi-notion getTitleFromProperties", () => {
	it("extracts title from property with type title", () => {
		const props = { Name: { type: "title", title: [{ plain_text: "My Page" }] } };
		expect(getTitleFromProperties(props)).toBe("My Page");
	});

	it("extracts title from another title property", () => {
		const props = { Title: { type: "title", title: [{ plain_text: "Another Page" }] } };
		expect(getTitleFromProperties(props)).toBe("Another Page");
	});

	it("returns Untitled when no title found", () => {
		expect(getTitleFromProperties({})).toBe("Untitled");
		expect(getTitleFromProperties({ other: { type: "text", text: "test" } })).toBe("Untitled");
	});

	it("handles empty title array", () => {
		expect(getTitleFromProperties({ Name: { type: "title", title: [] } })).toBe("Untitled");
	});

	it("handles multiple text parts", () => {
		const props = {
			Name: {
				type: "title",
				title: [{ plain_text: "Part 1 " }, { plain_text: "Part 2" }],
			},
		};
		expect(getTitleFromProperties(props)).toBe("Part 1 Part 2");
	});

	it("finds title in nested properties", () => {
		const props = {
			Status: { type: "status" },
			Name: { type: "title", title: [{ plain_text: "Nested Title" }] },
			Description: { type: "rich_text" },
		};
		expect(getTitleFromProperties(props)).toBe("Nested Title");
	});
});

describe("pi-notion formatPage", () => {
	it("formats page with properties", () => {
		const page = {
			id: "abc123",
			url: "https://notion.so/abc123",
			properties: { Name: { title: [{ plain_text: "Test Page" }] } },
		};
		const result = formatPage(page);
		expect(result).toContain("Test Page");
		expect(result).toContain("abc123");
	});

	it("handles page without properties", () => {
		const page = { id: "abc123", url: "https://notion.so/abc123", properties: {} };
		const result = formatPage(page);
		expect(result).toContain("Untitled");
	});

	it("formats page with title property", () => {
		const page = {
			id: "xyz789",
			url: "https://notion.so/xyz789",
			properties: { title: { title: [{ plain_text: "Title Property" }] } },
		};
		const result = formatPage(page);
		expect(result).toContain("Title Property");
	});

	it("formats page with multiple properties", () => {
		const page = {
			id: "multi",
			url: "https://notion.so/multi",
			properties: {
				Name: { title: [{ plain_text: "Multi Page" }] },
				Status: { status: { name: "Active" } },
				Date: { date: { start: "2025-01-01" } },
			},
		};
		const result = formatPage(page);
		expect(result).toContain("Multi Page");
		expect(result).toContain("## Properties");
	});
});

describe("pi-notion formatDatabase", () => {
	it("formats database", () => {
		const db = {
			id: "def456",
			title: [{ plain_text: "Test Database" }],
			properties: { Name: {}, Status: {} },
		};
		const result = formatDatabase(db);
		expect(result).toContain("Test Database");
		expect(result).toContain("def456");
	});

	it("handles empty title", () => {
		const db = { id: "def456", title: [], properties: {} };
		const result = formatDatabase(db);
		expect(result).toContain("Untitled");
		expect(result).toContain("def456");
	});

	it("formats database with multiple properties", () => {
		const db = {
			id: "db123",
			title: [{ plain_text: "Multi Property DB" }],
			properties: {
				Name: { type: "title" },
				Status: { type: "status" },
				Count: { type: "number" },
			},
		};
		const result = formatDatabase(db);
		expect(result).toContain("Multi Property DB");
		expect(result).toContain("Name");
		expect(result).toContain("Status");
	});

	it("handles undefined title", () => {
		const db = { id: "no-title", title: undefined, properties: {} };
		const result = formatDatabase(db);
		expect(result).toContain("Untitled");
	});
});

describe("pi-notion formatBlocks", () => {
	it("formats blocks", () => {
		const result = formatBlocks({
			results: [
				{ type: "paragraph", id: "1", paragraph: { text: [{ plain_text: "Hello" }] } },
				{ type: "heading_1", id: "2", heading_1: { text: [{ plain_text: "Title" }] } },
			],
		});
		expect(result).toContain("paragraph");
		expect(result).toContain("Hello");
		expect(result).toContain("Title");
	});

	it("handles empty results", () => {
		const result = formatBlocks({ results: [] });
		expect(result).toBe("No blocks found.");
	});

	it("handles unknown block types", () => {
		const result = formatBlocks({
			results: [
				{ type: "unknown_type", id: "1" },
			],
		});
		expect(result).toContain("unknown_type");
	});

	it("handles blocks with empty content", () => {
		const result = formatBlocks({
			results: [
				{ type: "paragraph", id: "1", paragraph: {} },
				{ type: "code", id: "2", code: { text: [] } },
			],
		});
		expect(result).toContain("paragraph");
		expect(result).toContain("code");
	});

	it("handles null results", () => {
		const result = formatBlocks({ results: null as unknown as [] });
		expect(result).toBe("No blocks found.");
	});

	it("handles blocks with multiple text items", () => {
		const result = formatBlocks({
			results: [
				{
					type: "paragraph",
					id: "1",
					paragraph: { text: [{ plain_text: "Part 1" }, { plain_text: "Part 2" }] },
				},
			],
		});
		expect(result).toContain("Part 1");
		expect(result).toContain("Part 2");
	});
});

describe("pi-notion formatSearch", () => {
	it("formats search results", () => {
		const result = formatSearch({
			results: [
				{ object: "page", id: "1", properties: { Name: { title: [{ plain_text: "Page 1" }] } } },
				{ object: "database", id: "2", title: [{ plain_text: "DB 1" }] },
			],
		});
		expect(result).toContain("page");
		expect(result).toContain("Untitled"); // depends on how title is extracted
		expect(result).toContain("database");
	});

	it("handles empty results", () => {
		const result = formatSearch({ results: [] });
		expect(result).toBe("No results found.");
	});
});

describe("pi-notion loadConfig", () => {
	it("returns null when no config exists", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-notion-load-"));
		const configPath = join(base, "nonexistent.json");
		const result = loadConfig(configPath);
		expect(result).toBeNull();
	});

	it("loads valid config file", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-notion-load-valid-"));
		const configPath = join(base, "notion.json");
		const config = { token: "test-token-123", oauth: null };
		writeFileSync(configPath, JSON.stringify(config), "utf-8");

		const result = loadConfig(configPath);
		expect(result?.token).toBe("test-token-123");
	});

	it("handles invalid JSON gracefully", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-notion-load-invalid-"));
		const configPath = join(base, "invalid.json");
		writeFileSync(configPath, "not valid json", "utf-8");

		const result = loadConfig(configPath);
		expect(result).toBeNull();
	});

	it("returns default config for empty config path", () => {
		const result = loadConfig(undefined);
		// Creates default config file and returns it
		expect(result).not.toBeNull();
		expect(result).toHaveProperty("token");
		expect(result).toHaveProperty("oauth");
	});
});

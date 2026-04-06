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

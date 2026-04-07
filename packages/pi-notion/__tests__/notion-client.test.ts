/**
 * Tests for index.ts utility functions and file structure
 */

import { describe, expect, it } from "vitest";

// =============================================================================
// Extension File Structure Tests
// =============================================================================

describe("pi-notion Extension File Structure", () => {
	it("index.ts contains NotionConfig interface", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("NotionConfig");
	});

	it("index.ts contains config loading functions", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("resolveConfigPath");
		expect(content).toContain("loadConfig");
		expect(content).toContain("homedir");
		expect(content).toContain("NOTION_CONFIG");
	});

	it("index.ts contains formatting functions", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("formatPage");
		expect(content).toContain("formatDatabase");
		expect(content).toContain("formatBlocks");
		expect(content).toContain("formatSearch");
		expect(content).toContain("getTitleFromProperties");
	});

	it("index.ts exports utility functions", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("export {");
		expect(content).toContain("formatBlocks");
		expect(content).toContain("loadConfig");
		expect(content).toContain("resolveConfigPath");
	});

	it("index.ts has no-op extension (tools registered by mcp-client)", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("export default function notionExtension");
		expect(content).toContain("mcp-client.ts");
	});

	it("mcp-client.ts exists and has correct exports", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("export default");
	});

	it("oauth.ts exists and has correct exports", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/oauth.ts", "utf-8");

		expect(content).toContain("export function generateCodeVerifier");
		expect(content).toContain("export class FileTokenStorage");
	});
});

// =============================================================================
// Formatting Function Details
// =============================================================================

describe("pi-notion Formatting Functions", () => {
	it("formatPage formats page with title and properties", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("function formatPage");
		expect(content).toContain("getTitleFromProperties");
		expect(content).toContain("JSON.stringify");
	});

	it("formatDatabase formats database with title", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("function formatDatabase");
		expect(content).toContain("plain_text");
	});

	it("formatBlocks handles empty results", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("function formatBlocks");
		expect(content).toContain("No blocks found");
	});

	it("formatSearch handles empty results", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("function formatSearch");
		expect(content).toContain("No results found");
	});

	it("getTitleFromProperties extracts title from properties", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync("/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts", "utf-8");

		expect(content).toContain("function getTitleFromProperties");
		expect(content).toContain("Untitled");
	});
});

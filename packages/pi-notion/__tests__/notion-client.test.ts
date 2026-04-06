/**
 * Tests for NotionClient class and extension functionality
 */

import { describe, expect, it } from "vitest";

// =============================================================================
// Extension File Structure Tests
// =============================================================================

describe("pi-notion Extension File Structure", () => {
	it("index.ts exports all page tools", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("notion_get_page");
		expect(content).toContain("notion_create_page");
		expect(content).toContain("notion_update_page");
		expect(content).toContain("notion_archive_page");
	});

	it("index.ts exports all database tools", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("notion_get_database");
		expect(content).toContain("notion_query_database");
		expect(content).toContain("notion_create_database");
	});

	it("index.ts exports block tools", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("notion_get_block_children");
		expect(content).toContain("notion_append_blocks");
	});

	it("index.ts exports search and user tools", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("notion_search");
		expect(content).toContain("notion_get_user");
		expect(content).toContain("notion_get_me");
	});

	it("index.ts exports OAuth tools", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("notion_oauth_setup");
		expect(content).toContain("notion_oauth_status");
		expect(content).toContain("notion_oauth_logout");
	});

	it("index.ts contains NotionClient class", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("class NotionClient");
		expect(content).toContain("axios.create");
	});

	it("index.ts contains API constants", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("NOTION_API_BASE");
		expect(content).toContain("NOTION_VERSION");
		expect(content).toContain("api.notion.com");
	});

	it("index.ts contains config loading functions", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("resolveConfigPath");
		expect(content).toContain("loadConfig");
		expect(content).toContain("homedir");
		expect(content).toContain("NOTION_CONFIG");
	});

	it("index.ts contains formatting functions", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("formatPage");
		expect(content).toContain("formatDatabase");
		expect(content).toContain("formatBlocks");
		expect(content).toContain("formatSearch");
		expect(content).toContain("getTitleFromProperties");
	});

	it("index.ts contains OAuth integration", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("executeOAuthFlow");
		expect(content).toContain("FileTokenStorage");
		expect(content).toContain("getValidAccessToken");
	});

	it("index.ts registers flags", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("registerFlag");
		expect(content).toContain("--notion-token");
		expect(content).toContain("--notion-config");
	});

	it("index.ts contains error handling", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("Notion error:");
		expect(content).toContain("isError: true");
	});

	it("index.ts contains token retrieval logic", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("getToken");
		expect(content).toContain("getOAuthConfig");
		expect(content).toContain("getClient");
	});

	it("index.ts handles multiple auth methods", async () => {
		const fs = await import("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("getFlag");
		expect(content).toContain("existsSync");
		expect(content).toContain("NOTION_TOKEN");
		expect(content).toContain("oauthConfig");
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
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/oauth.ts",
			"utf-8",
		);

		expect(content).toContain("export function generateCodeVerifier");
		expect(content).toContain("export class FileTokenStorage");
	});
});

// =============================================================================
// NotionClient Implementation Details
// =============================================================================

describe("pi-notion NotionClient Implementation", () => {
	it("has getPage method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async getPage");
		expect(content).toContain("/pages/");
	});

	it("has createPage method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async createPage");
		expect(content).toContain('parent: { [parentType]: parentId }');
	});

	it("has updatePage method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async updatePage");
		expect(content).toContain("this.client.patch");
	});

	it("has getDatabase method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async getDatabase");
		expect(content).toContain("/databases/");
	});

	it("has queryDatabase method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async queryDatabase");
		expect(content).toContain("/query");
		expect(content).toContain("filter");
		expect(content).toContain("sorts");
	});

	it("has createDatabase method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async createDatabase");
		expect(content).toContain('parent: { page_id:');
	});

	it("has getBlockChildren method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async getBlockChildren");
		expect(content).toContain("/blocks/");
		expect(content).toContain("/children");
	});

	it("has appendBlockChildren method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async appendBlockChildren");
	});

	it("has search method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async search(");
		expect(content).toContain('query: string');
	});

	it("has getUser method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async getUser");
		expect(content).toContain("/users/");
	});

	it("has getMe method", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("async getMe");
		expect(content).toContain("/users/me");
	});

	it("has Authorization header setup", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("Authorization");
		expect(content).toContain("Bearer");
		expect(content).toContain("Notion-Version");
	});

	it("has proper Notion API version header", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("NOTION_VERSION");
		expect(content).toContain("2025-09-03");
	});
});

// =============================================================================
// Extension Tool Registration Details
// =============================================================================

describe("pi-notion Tool Registration Details", () => {
	it("has correct tool parameters schemas", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("Type.Object");
		expect(content).toContain("Type.String");
		expect(content).toContain("Type.Optional");
	});

	it("returns content array in tool responses", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("content: [{");
		expect(content).toContain('type: "text"');
	});

	it("includes details in tool responses", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		expect(content).toContain("details: {");
		expect(content).toContain("tool:");
	});

	it("has execute function for each tool", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/index.ts",
			"utf-8",
		);

		const toolCount = (content.match(/async execute\(/g) || []).length;
		expect(toolCount).toBeGreaterThan(10);
	});
});

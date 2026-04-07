import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("pi-notion", () => {
	describe("package", () => {
		it("should have correct name", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.name).toBe("@feniix/pi-notion");
		});

		it("should have version", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.version).toBeTruthy();
		});

		it("should have pi extension entry point", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.pi).toBeDefined();
			expect(pkg.pi.extensions).toContain("./extensions/index.ts");
		});

		it("should have axios dependency", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.dependencies).toHaveProperty("axios");
		});

		it("should have skills declared", () => {
			const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
			expect(pkg.pi.skills).toBeDefined();
		});
	});

	describe("index.ts", () => {
		it("should export utility functions", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("formatPage");
			expect(extension).toContain("formatDatabase");
			expect(extension).toContain("formatBlocks");
			expect(extension).toContain("formatSearch");
			expect(extension).toContain("getTitleFromProperties");
			expect(extension).toContain("loadConfig");
			expect(extension).toContain("resolveConfigPath");
		});

		it("should have no-op extension (tools in mcp-client.ts)", () => {
			const extension = readFileSync(join(__dirname, "../extensions/index.ts"), "utf-8");
			expect(extension).toContain("export default function notionExtension");
			expect(extension).not.toContain("registerTool");
		});

		it("should register tools in mcp-client.ts", () => {
			const mcpClient = readFileSync(join(__dirname, "../extensions/mcp-client.ts"), "utf-8");
			expect(mcpClient).toContain("registerTool");
			expect(mcpClient).toContain("notion_mcp_connect");
			expect(mcpClient).toContain("notion_mcp_disconnect");
			expect(mcpClient).toContain("notion_mcp_status");
		});
	});
});

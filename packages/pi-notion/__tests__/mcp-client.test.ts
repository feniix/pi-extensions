/**
 * Tests for Notion MCP Client source structure.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mcpClientPath = join(__dirname, "../extensions/mcp-client.ts");

function readMcpClient(): string {
	return readFileSync(mcpClientPath, "utf-8");
}

describe("pi-notion MCP Client File Structure", () => {
	it("contains NotionMCPClient class", () => {
		const content = readMcpClient();
		expect(content).toContain("class NotionMCPClient");
	});

	it("contains OAuth callback handling", () => {
		const content = readMcpClient();
		expect(content).toContain("startOAuthCallbackServer");
		expect(content).toContain("openBrowser");
	});

	it("contains JSON-RPC protocol handling", () => {
		const content = readMcpClient();
		expect(content).toContain("jsonrpc");
		expect(content).toContain("tools/list");
		expect(content).toContain("tools/call");
	});

	it("contains extension and command registration", () => {
		const content = readMcpClient();
		expect(content).toContain("export default function notionMCPClientExtension");
		expect(content).toContain('registerCommand("notion"');
		expect(content).toContain("registerTool");
	});

	it("registers core MCP management tools", () => {
		const content = readMcpClient();
		expect(content).toContain("notion_mcp_connect");
		expect(content).toContain("notion_mcp_disconnect");
		expect(content).toContain("notion_mcp_status");
	});

	it("includes Notion MCP endpoint constants", () => {
		const content = readMcpClient();
		expect(content).toContain("NOTION_MCP_URL");
		expect(content).toContain("https://mcp.notion.com/mcp");
	});

	it("handles browser opening per platform", () => {
		const content = readMcpClient();
		expect(content).toContain("darwin");
		expect(content).toContain("win32");
		expect(content).toContain("xdg-open");
	});

	it("captures session and auth headers", () => {
		const content = readMcpClient();
		expect(content).toContain("mcp-session-id");
		expect(content).toContain("Authorization");
		expect(content).toContain("Bearer");
	});

	it("contains error handling for HTTP and JSON-RPC failures", () => {
		const content = readMcpClient();
		expect(content).toContain("response.ok");
		expect(content).toContain("HTTP");
		expect(content).toContain("MCP Error");
	});

	it("uses protocol version 2024-11-05", () => {
		const content = readMcpClient();
		expect(content).toContain("2024-11-05");
	});
});

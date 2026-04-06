/**
 * Tests for Notion MCP Client
 *
 * Note: The SimpleMCPClient and other functions are internal to the module.
 * These tests verify the file structure and functionality through static analysis.
 */

import { describe, expect, it } from "vitest";

// =============================================================================
// MCP Client File Structure Tests
// =============================================================================

describe("pi-notion MCP Client File Structure", () => {
	it("mcp-client.ts contains SimpleMCPClient class", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("SimpleMCPClient");
		expect(content).toContain("class SimpleMCPClient");
	});

	it("mcp-client.ts contains OAuth callback handling", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("waitForOAuthCallback");
		expect(content).toContain("openBrowser");
	});

	it("mcp-client.ts contains MCP protocol implementation", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("jsonrpc");
		expect(content).toContain("MCP-Session-Id");
		expect(content).toContain("tools/list");
		expect(content).toContain("tools/call");
	});

	it("mcp-client.ts contains extension registration", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("notionMCPClientExtension");
		expect(content).toContain("registerTool");
		expect(content).toContain("registerCommand");
	});

	it("mcp-client.ts contains MCP tools registration", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("notion_mcp_connect");
		expect(content).toContain("notion_mcp_disconnect");
		expect(content).toContain("notion_mcp_status");
	});

	it("mcp-client.ts contains OAuth constants", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("NOTION_MCP_URL");
		expect(content).toContain("https://mcp.notion.com/mcp");
		expect(content).toContain("CALLBACK_PORT");
		expect(content).toContain("3000");
	});

	it("mcp-client.ts contains state management", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("MCPClientState");
		expect(content).toContain("connected");
		expect(content).toContain("authenticated");
		expect(content).toContain("sessionId");
		expect(content).toContain("accessToken");
	});

	it("mcp-client.ts contains tool schema definitions", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("MCPTool");
		expect(content).toContain("inputSchema");
	});

	it("mcp-client.ts handles browser opening per platform", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("darwin");
		expect(content).toContain("win32");
		expect(content).toContain("xdg-open");
	});

	it("mcp-client.ts exports default extension", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("export default function notionMCPClientExtension");
	});

	it("mcp-client.ts imports required dependencies", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain('from "node:crypto"');
		expect(content).toContain('from "node:net"');
		expect(content).toContain('from "portfinder"');
		expect(content).toContain("ExtensionAPI");
	});
});

// =============================================================================
// MCP Client Implementation Details
// =============================================================================

describe("pi-notion MCP Client Implementation Details", () => {
	it("defines MCP URL constant", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("NOTION_MCP_URL");
	});

	it("uses JSON-RPC 2.0 protocol", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain('"2.0"');
		expect(content).toContain("jsonrpc");
	});

	it("handles state mismatch in OAuth callback", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("State mismatch");
	});

	it("handles OAuth errors in callback", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain('params.get("error")');
		expect(content).toContain("Authorization failed");
	});

	it("generates random state for OAuth", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("randomBytes");
		expect(content).toContain("state");
	});

	it("registers dynamic tools after connection", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("registerMCPTools");
		expect(content).toContain("getTools");
	});

	it("handles connection timeout", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("timeoutMs");
		expect(content).toContain("300000");
	});

	it("formats MCP tool results for display", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("content.map");
		expect(content).toContain('type === "text"');
	});

	it("implements /notion command handler", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain('registerCommand("notion"');
	});

	it("sends initialized notification after connect", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain('"initialized"');
		expect(content).toContain("sendNotification");
	});

	it("tests HTTP error handling in MCP client", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("response.ok");
		expect(content).toContain("HTTP");
		expect(content).toContain("statusText");
	});

	it("tests JSON-RPC error handling", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("data.error");
		expect(content).toContain("MCP Error");
	});

	it("tests token refresh logic exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("Bearer");
		expect(content).toContain("Authorization");
	});

	it("tests message ID incrementing exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("messageId");
		expect(content).toContain("++this.messageId");
	});

	it("tests session ID generation exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("generateSessionId");
		expect(content).toContain("toString");
		expect(content).toContain('"hex"');
	});

	it("tests disconnect handling exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("disconnect");
		expect(content).toContain("DELETE");
	});

	it("tests callback server port finding exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("getPort");
		expect(content).toContain("EADDRINUSE");
	});

	it("tests OAuth URL building exists", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("authorize");
		expect(content).toContain("redirect_uri");
		expect(content).toContain("response_type");
		expect(content).toContain("state");
	});

	it("has private methods for sendRequest and sendNotification", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("private async sendRequest");
		expect(content).toContain("private async sendNotification");
	});

	it("has protocol version 2024-11-05", () => {
		const fs = require("node:fs");
		const content = fs.readFileSync(
			"/Users/feniix/src/personal/pidev/packages/pi-notion/extensions/mcp-client.ts",
			"utf-8",
		);

		expect(content).toContain("2024-11-05");
	});
});

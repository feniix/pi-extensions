/**
 * Notion MCP Client Extension for pi
 *
 * Supports two ways to connect to Notion:
 *
 * 1. MCP Server (recommended for CLI): Uses the open-source notion-mcp-server
 *    with a Notion API token. Install with: npx notion-mcp-server
 *    Then configure pi to use it.
 *
 * 2. Official Notion MCP: https://mcp.notion.com/mcp - requires OAuth in browser
 *
 * Usage:
 *   /notion                    - Status, connect, or disconnect
 *   "Search my Notion for X"    - Natural language (tools auto-discovered after connect)
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Constants
// =============================================================================

const _NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const _NOTION_TOKEN_URL = "https://api.notion.com/v1";

// =============================================================================
// Types
// =============================================================================

interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface MCPClientState {
	connected: boolean;
	authenticated: boolean;
	sessionId: string | null;
	accessToken: string | null;
	mcpUrl: string | null;
}

// =============================================================================
// MCP Client
// =============================================================================

class NotionMCPClient {
	state: MCPClientState = {
		connected: false,
		authenticated: false,
		sessionId: null,
		accessToken: null,
		mcpUrl: null,
	};

	private messageId = 0;
	private sessionId: string | null = null;
	private _accessToken: string | null = null;
	private _tools: MCPTool[] = [];

	async connect(mcpUrl: string, accessToken: string): Promise<void> {
		this._accessToken = accessToken;
		this.state.accessToken = accessToken;
		this.state.mcpUrl = mcpUrl;
		this.state.authenticated = true;

		// Initialize MCP connection
		await this.sendRequest(mcpUrl, "initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-notion", version: "1.0.0" },
		});

		this.sessionId = randomBytes(16).toString("hex");
		this.state.sessionId = this.sessionId;
		this.state.connected = true;

		// Discover tools
		await this.discoverTools(mcpUrl);

		// Send initialized notification
		await this.sendNotification(mcpUrl, "initialized", {});
	}

	async disconnect(): Promise<void> {
		if (this.sessionId && this.state.mcpUrl) {
			try {
				await fetch(`${this.state.mcpUrl}/${this.sessionId}`, {
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						Authorization: this._accessToken ? `Bearer ${this._accessToken}` : "",
					},
				});
			} catch {
				// Ignore errors on disconnect
			}
		}
		this.state = {
			connected: false,
			authenticated: false,
			sessionId: null,
			accessToken: null,
			mcpUrl: null,
		};
		this.sessionId = null;
		this._accessToken = null;
		this._tools = [];
	}

	private getHeaders(_mcpUrl: string): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		};
		if (this.sessionId) {
			headers["MCP-Session-Id"] = this.sessionId;
		}
		if (this._accessToken) {
			headers.Authorization = `Bearer ${this._accessToken}`;
		}
		return headers;
	}

	private async sendRequest(mcpUrl: string, method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = ++this.messageId;
		const request = { jsonrpc: "2.0", id, method, params };

		const response = await fetch(mcpUrl, {
			method: "POST",
			headers: this.getHeaders(mcpUrl),
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		const data = await response.json();
		if (data.error) {
			throw new Error(`MCP Error: ${data.error.message}`);
		}
		return data.result;
	}

	private async sendNotification(mcpUrl: string, method: string, params: Record<string, unknown>): Promise<void> {
		const notification = { jsonrpc: "2.0", method, params };
		await fetch(mcpUrl, {
			method: "POST",
			headers: this.getHeaders(mcpUrl),
			body: JSON.stringify(notification),
		});
	}

	private async discoverTools(mcpUrl: string): Promise<void> {
		try {
			const result = await this.sendRequest(mcpUrl, "tools/list", {});
			const tools = (result as { tools?: MCPTool[] })?.tools || [];
			this._tools = tools.map((tool) => ({
				name: tool.name,
				description: tool.description || "",
				inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
			}));
		} catch {
			this._tools = [];
		}
	}

	async callTool(mcpUrl: string, name: string, args: Record<string, unknown>): Promise<string> {
		const result = await this.sendRequest(mcpUrl, "tools/call", { name, arguments: args });

		// Format result
		const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
		if (content && Array.isArray(content)) {
			return content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
		}
		return JSON.stringify(result);
	}

	getTools(): MCPTool[] {
		return this._tools;
	}
}

// =============================================================================
// Token Storage
// =============================================================================

interface StoredConfig {
	mcpUrl: string;
	accessToken: string;
}

class FileTokenStorage {
	private path: string;

	constructor() {
		const configDir = join(homedir(), ".pi", "agent", "extensions");
		this.path = join(configDir, "notion-mcp.json");
	}

	async save(config: StoredConfig): Promise<void> {
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, JSON.stringify(config, null, 2), "utf-8");
		} catch (error) {
			console.error("Failed to save config:", error);
		}
	}

	async load(): Promise<StoredConfig | null> {
		if (!existsSync(this.path)) {
			return null;
		}
		try {
			return JSON.parse(readFileSync(this.path, "utf-8")) as StoredConfig;
		} catch {
			return null;
		}
	}

	async clear(): Promise<void> {
		if (existsSync(this.path)) {
			try {
				const { unlinkSync } = await import("node:fs");
				unlinkSync(this.path);
			} catch {
				// Ignore
			}
		}
	}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

let mcpClient: NotionMCPClient | null = null;
const storage = new FileTokenStorage();

async function openBrowser(url: string): Promise<void> {
	const { exec } = await import("node:child_process");
	const platform = process.platform;
	const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
	exec(`${cmd} "${url}"`);
}

export default function notionMCPClientExtension(pi: ExtensionAPI) {
	mcpClient = new NotionMCPClient();

	const notify = (message: string) => {
		try {
			pi.events.emit("ui:notify", { message, type: "info" as const });
		} catch {
			console.log(`[pi-notion] ${message}`);
		}
	};

	// Register dynamic MCP tools after connection
	const registerMCPTools = () => {
		if (!mcpClient?.state.mcpUrl) return;

		const tools = mcpClient.getTools();
		const mcpUrl = mcpClient.state.mcpUrl;

		for (const tool of tools) {
			// Skip if already registered
			if (pi.getAllTools().find((t) => t.name === tool.name)) continue;

			const schema = Type.Object({}, { additionalProperties: true });

			pi.registerTool({
				name: tool.name,
				label: `Notion: ${tool.name.replace(/_/g, " ")}`,
				description: tool.description || `Notion MCP tool: ${tool.name}`,
				parameters: schema,
				async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
					if (!mcpClient?.state.connected) {
						return {
							content: [{ type: "text", text: "Not connected to Notion MCP. Run /notion to connect." }],
							isError: true,
							details: { tool: tool.name },
						};
					}

					try {
						const result = await mcpClient?.callTool(mcpUrl, tool.name, params as Record<string, unknown>);
						return {
							content: [{ type: "text", text: result }],
							details: { tool: tool.name },
						};
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return {
							content: [{ type: "text", text: `Error: ${message}` }],
							isError: true,
							details: { tool: tool.name, error: message },
						};
					}
				},
			});
		}

		if (tools.length > 0) {
			notify(`Registered ${tools.length} Notion MCP tools!`);
		}
	};

	// /notion command
	pi.registerCommand("notion", {
		description: "Connect to Notion MCP, show status, or disconnect",
		async handler(_args, ctx) {
			if (!mcpClient) {
				ctx.ui.notify("Notion MCP not initialized", "error");
				return;
			}

			const { connected, sessionId, mcpUrl } = mcpClient.state;

			if (!connected) {
				// Try to load saved config
				const savedConfig = await storage.load();

				if (savedConfig) {
					ctx.ui.notify("Connecting to saved Notion MCP...", "info");
					try {
						await mcpClient.connect(savedConfig.mcpUrl, savedConfig.accessToken);
						registerMCPTools();
						ctx.ui.notify(`Connected! Session: ${mcpClient.state.sessionId?.slice(0, 8)}...`, "info");
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Connection failed: ${message}`, "error");
						await storage.clear();
					}
					return;
				}

				// No saved config - show setup options
				const choice = await ctx.ui.select("Notion MCP Setup", [
					"Use MCP server URL + token",
					"Open Notion MCP OAuth (requires browser)",
					"Cancel",
				]);

				if (choice === "Cancel" || choice === null) {
					return;
				}

				if (choice === "Open Notion MCP OAuth (requires browser)") {
					// Open the MCP authorize URL
					const state = randomBytes(16).toString("hex");
					const callbackUrl = `http://localhost:3000/callback`;
					const authUrl = `https://mcp.notion.com/authorize?response_type=code&client_id=mcp-client&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;

					notify("Opening Notion MCP authorization page...");
					await openBrowser(authUrl);

					ctx.ui.notify("If browser didn't open, visit: https://mcp.notion.com", "info");
					ctx.ui.notify("After authorization, run /notion again with your MCP URL and token.", "info");
					return;
				}

				if (choice === "Use MCP server URL + token") {
					const mcpUrlInput = await ctx.ui.input("MCP Server URL", "https://mcp.notion.com/mcp");
					if (!mcpUrlInput) return;

					const tokenInput = await ctx.ui.input("Notion Token (secret_...) or API Key");
					if (!tokenInput) return;

					ctx.ui.notify("Connecting to Notion MCP...", "info");

					try {
						await mcpClient.connect(mcpUrlInput.trim(), tokenInput.trim());
						await storage.save({ mcpUrl: mcpUrlInput.trim(), accessToken: tokenInput.trim() });
						registerMCPTools();
						ctx.ui.notify(`Connected! Session: ${mcpClient.state.sessionId?.slice(0, 8)}...`, "info");
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Connection failed: ${message}`, "error");
					}
					return;
				}
			} else {
				// Connected - show status and offer disconnect
				const tools = mcpClient.getTools();
				const status = `Connected to Notion MCP
URL: ${mcpUrl}
Session: ${sessionId?.slice(0, 8)}...
Tools: ${tools.length} available`;

				const choice = await ctx.ui.select(status, ["Disconnect", "Cancel"]);

				if (choice === "Disconnect") {
					await mcpClient.disconnect();
					await storage.clear();
					ctx.ui.notify("Disconnected from Notion MCP", "info");
				}
			}
		},
	});

	// Connect tool
	pi.registerTool({
		name: "notion_mcp_connect",
		label: "Notion MCP Connect",
		description: "Connect to Notion MCP server with URL and token",
		parameters: Type.Object({
			mcpUrl: Type.Optional(Type.String({ description: "MCP server URL (default: https://mcp.notion.com/mcp)" })),
			token: Type.Optional(Type.String({ description: "Notion API token or access token" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const p = params as { mcpUrl?: string; token?: string };

			if (!mcpClient) {
				return {
					content: [{ type: "text", text: "MCP client not initialized" }],
					isError: true,
					details: { tool: "notion_mcp_connect" },
				};
			}

			if (mcpClient.state.connected) {
				const tools = mcpClient.getTools();
				return {
					content: [
						{
							type: "text",
							text: `Already connected to Notion MCP!\n\n${tools.length} tools available: ${tools.map((t) => t.name).join(", ")}`,
						},
					],
					details: { tool: "notion_mcp_connect" },
				};
			}

			const mcpUrl = p.mcpUrl?.trim() || "https://mcp.notion.com/mcp";
			const token = p.token?.trim();

			if (!token) {
				return {
					content: [
						{
							type: "text",
							text: `Notion MCP requires authentication.

For the official hosted MCP server (https://mcp.notion.com/mcp), OAuth is required which needs browser access.

Alternative: Use the open-source notion-mcp-server with a Notion API token:
1. Install: npx notion-mcp-server
2. Run it locally (default: http://localhost:8000/mcp)
3. Connect using that URL and your NOTION_TOKEN

Run /notion for interactive setup.`,
						},
					],
					details: { tool: "notion_mcp_connect" },
				};
			}

			try {
				notify("Connecting to Notion MCP...");
				await mcpClient.connect(mcpUrl, token);
				await storage.save({ mcpUrl, accessToken: token });
				registerMCPTools();

				const tools = mcpClient.getTools();
				return {
					content: [
						{
							type: "text",
							text: `Connected to Notion MCP!\n\n${tools.length} tools available.\n\nYou can now ask things like:\n- "Search my Notion for meeting notes"\n- "Get page abc123"\n- "Create a page in my workspace"`,
						},
					],
					details: { tool: "notion_mcp_connect" },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Connection failed: ${message}` }],
					isError: true,
					details: { tool: "notion_mcp_connect", error: message },
				};
			}
		},
	});

	// Disconnect tool
	pi.registerTool({
		name: "notion_mcp_disconnect",
		label: "Notion MCP Disconnect",
		description: "Disconnect from Notion MCP server and clear stored config",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			if (!mcpClient) {
				return {
					content: [{ type: "text", text: "MCP client not initialized" }],
					isError: true,
					details: { tool: "notion_mcp_disconnect" },
				};
			}

			await mcpClient.disconnect();
			await storage.clear();

			return {
				content: [{ type: "text", text: "Disconnected from Notion MCP and cleared config" }],
				details: { tool: "notion_mcp_disconnect" },
			};
		},
	});

	// Status tool
	pi.registerTool({
		name: "notion_mcp_status",
		label: "Notion MCP Status",
		description: "Check connection status to Notion MCP",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			if (!mcpClient) {
				return {
					content: [{ type: "text", text: "MCP client not initialized" }],
					isError: true,
					details: { tool: "notion_mcp_status" },
				};
			}

			const { connected, sessionId, mcpUrl } = mcpClient.state;
			const tools = mcpClient.getTools();

			return {
				content: [
					{
						type: "text",
						text: `Notion MCP Status:
- Connected: ${connected ? "Yes" : "No"}
- URL: ${mcpUrl || "None"}
- Session: ${sessionId ? `${sessionId.slice(0, 8)}...` : "None"}
- Tools: ${tools.length} available
${!connected ? "\nRun /notion to connect." : ""}`,
					},
				],
				details: { tool: "notion_mcp_status", connected, sessionId, mcpUrl },
			};
		},
	});
}

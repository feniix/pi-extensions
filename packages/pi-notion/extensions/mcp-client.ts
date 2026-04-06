/**
 * Notion MCP Client Extension for pi
 *
 * Connects to the official Notion MCP server at https://mcp.notion.com/mcp
 * using the MCP Streamable HTTP transport with OAuth authentication.
 *
 * This provides full access to Notion via the MCP protocol without requiring
 * a personal Notion integration.
 *
 * Usage:
 *   /notion                    - Status, connect, or disconnect
 *   "Search my Notion for X"    - Natural language (tools auto-discovered after connect)
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getPort as lookupPort } from "portfinder";

// =============================================================================
// Constants
// =============================================================================

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const CALLBACK_PORT = 3000;

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
}

// =============================================================================
// MCP JSON-RPC Client
// =============================================================================

class SimpleMCPClient {
	state: MCPClientState = {
		connected: false,
		authenticated: false,
		sessionId: null,
		accessToken: null,
	};

	private messageId = 0;
	private sessionId: string | null = null;
	private accessToken: string | null = null;
	private _tools: MCPTool[] = [];

	async connect(): Promise<void> {
		// Initialize session
		const _initResponse = await this.sendRequest("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-notion", version: "1.0.0" },
		});

		this.sessionId = this.generateSessionId();
		this.state.sessionId = this.sessionId;
		this.state.connected = true;

		// Discover tools
		await this.discoverTools();

		// Send initialized notification
		await this.sendNotification("initialized", {});
	}

	async disconnect(): Promise<void> {
		if (this.sessionId) {
			try {
				await fetch(NOTION_MCP_URL, {
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						"MCP-Session-Id": this.sessionId,
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
		};
		this.sessionId = null;
		this.accessToken = null;
		this._tools = [];
	}

	private generateSessionId(): string {
		return randomBytes(16).toString("hex");
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		};
		if (this.sessionId) {
			headers["MCP-Session-Id"] = this.sessionId;
		}
		if (this.accessToken) {
			headers.Authorization = `Bearer ${this.accessToken}`;
		}
		return headers;
	}

	private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = ++this.messageId;
		const request = { jsonrpc: "2.0", id, method, params };

		const response = await fetch(NOTION_MCP_URL, {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();
		if (data.error) {
			throw new Error(`MCP Error: ${data.error.message}`);
		}
		return data.result;
	}

	private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
		const notification = { jsonrpc: "2.0", method, params };
		await fetch(NOTION_MCP_URL, {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(notification),
		});
	}

	private async discoverTools(): Promise<void> {
		try {
			const result = await this.sendRequest("tools/list", {});
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

	async callTool(name: string, args: Record<string, unknown>): Promise<string> {
		const result = await this.sendRequest("tools/call", { name, arguments: args });

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
// OAuth Flow Handler
// =============================================================================

async function waitForOAuthCallback(
	port: number,
	expectedState: string,
	timeoutMs = 300000,
): Promise<{ code: string } | { error: string }> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			server.close();
			reject(new Error("OAuth callback timed out (5 minutes)"));
		}, timeoutMs);

		const server = createServer();

		server.on("connection", (socket) => {
			let buffer = "";

			socket.on("data", (chunk) => {
				buffer += chunk.toString();

				if (buffer.includes("\r\n\r\n")) {
					const requestMatch = buffer.match(/GET \/callback\?([^ ]+)/);
					if (requestMatch) {
						const queryString = requestMatch[1];
						const params = new URLSearchParams(queryString);

						if (params.get("state") !== expectedState) {
							const html = `<html><body><h1>State mismatch</h1><p>Please try again.</p></body></html>`;
							socket.write("HTTP/1.1 400 Bad Request\r\n");
							socket.write(`Content-Length: ${html.length}\r\n`);
							socket.write("Content-Type: text/html\r\n\r\n");
							socket.write(html);
							socket.end();
							clearTimeout(timeout);
							server.close();
							resolve({ error: "State mismatch" });
							return;
						}

						if (params.get("error")) {
							const html = `<html><body><h1>Authorization failed</h1><p>Error: ${params.get("error")}</p></body></html>`;
							socket.write("HTTP/1.1 400 Bad Request\r\n");
							socket.write(`Content-Length: ${html.length}\r\n`);
							socket.write("Content-Type: text/html\r\n\r\n");
							socket.write(html);
							socket.end();
							clearTimeout(timeout);
							server.close();
							resolve({ error: params.get("error") || "Unknown error" });
							return;
						}

						const code = params.get("code");
						if (code) {
							const html = `<html><body><h1>Authorized!</h1><p>You can close this window.</p><script>window.close();</script></body></html>`;
							socket.write("HTTP/1.1 200 OK\r\n");
							socket.write(`Content-Length: ${html.length}\r\n`);
							socket.write("Content-Type: text/html\r\n\r\n");
							socket.write(html);
							socket.end();
							clearTimeout(timeout);
							server.close();
							resolve({ code });
							return;
						}
					}
				}
			});

			socket.on("error", () => {});
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				lookupPort({ port: port + 1 })
					.then((newPort) => {
						server.close();
						reject(new Error(`Port ${newPort} already in use`));
					})
					.catch(reject);
			}
		});

		lookupPort({ port })
			.then((availablePort) => {
				server.listen(availablePort, "127.0.0.1", () => {});
			})
			.catch(reject);
	});
}

async function openBrowser(url: string): Promise<void> {
	const { exec } = await import("node:child_process");
	const platform = process.platform;
	const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
	exec(`${cmd} "${url}"`);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

let mcpClient: SimpleMCPClient | null = null;

export default function notionMCPClientExtension(pi: ExtensionAPI) {
	mcpClient = new SimpleMCPClient();

	const notify = (message: string) => {
		try {
			pi.events.emit("ui:notify", { message, type: "info" as const });
		} catch {
			console.log(`[pi-notion] ${message}`);
		}
	};

	// Register dynamic MCP tools after connection
	const registerMCPTools = () => {
		if (!mcpClient) return;

		const tools = mcpClient.getTools();
		for (const tool of tools) {
			// Skip if already registered
			if (pi.getAllTools().find((t) => t.name === tool.name)) continue;

			// Create a schema - use empty object with additionalProperties since
			// MCP tools have dynamic schemas that vary
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
						const result = await mcpClient.callTool(tool.name, params as Record<string, unknown>);
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

			const { connected, sessionId } = mcpClient.state;

			if (!connected) {
				ctx.ui.notify("Not connected to Notion", "info");

				// Start connection flow
				const state = randomBytes(16).toString("hex");
				const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;
				const authUrl = `${NOTION_MCP_URL}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}&response_type=code`;

				ctx.ui.notify("Opening Notion authorization page...", "info");

				// Start callback server
				waitForOAuthCallback(CALLBACK_PORT, state)
					.then(async (result) => {
						if ("error" in result) {
							ctx.ui.notify(`Authorization failed: ${result.error}`, "error");
							return;
						}

						ctx.ui.notify("Connecting to MCP server...", "info");
						try {
							await mcpClient?.connect();
							registerMCPTools();
							ctx.ui.notify(`Connected! Session: ${mcpClient?.state.sessionId?.slice(0, 8)}...`, "info");
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Connection failed: ${message}`, "error");
						}
					})
					.catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Connection failed: ${message}`, "error");
					});

				// Open browser
				await openBrowser(authUrl);
			} else {
				// Connected - show status and offer disconnect
				const tools = mcpClient.getTools();
				const status = `Connected to Notion MCP
Session: ${sessionId?.slice(0, 8)}...
Tools: ${tools.length} available`;

				const choice = await ctx.ui.select(status, ["Disconnect", "Cancel"]);

				if (choice === "Disconnect") {
					await mcpClient.disconnect();
					ctx.ui.notify("Disconnected from Notion MCP", "info");
				}
			}
		},
	});

	// Connect tool (for natural language)
	pi.registerTool({
		name: "notion_mcp_connect",
		label: "Notion MCP Connect",
		description: "Connect to Notion via the official MCP server. Opens browser for OAuth authorization.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
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

			try {
				notify("Initializing connection to Notion MCP...");

				const state = randomBytes(16).toString("hex");
				const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;
				const authUrl = `${NOTION_MCP_URL}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}&response_type=code`;

				const callbackPromise = waitForOAuthCallback(CALLBACK_PORT, state);

				notify("Opening Notion authorization page...");
				await openBrowser(authUrl);

				notify("Waiting for authorization...");
				const callbackResult = await callbackPromise;

				if ("error" in callbackResult) {
					return {
						content: [{ type: "text", text: `Authorization failed: ${callbackResult.error}` }],
						isError: true,
						details: { tool: "notion_mcp_connect" },
					};
				}

				notify("Connecting to MCP server...");
				await mcpClient.connect();
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
		description: "Disconnect from Notion MCP server",
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
			return {
				content: [{ type: "text", text: "Disconnected from Notion MCP" }],
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

			const { connected, sessionId } = mcpClient.state;
			const tools = mcpClient.getTools();

			return {
				content: [
					{
						type: "text",
						text: `Notion MCP Status:
- Connected: ${connected ? "Yes" : "No"}
- Session: ${sessionId ? `${sessionId.slice(0, 8)}...` : "None"}
- Tools: ${tools.length} available
${!connected ? "\nRun /notion or use notion_mcp_connect to connect." : ""}`,
					},
				],
				details: { tool: "notion_mcp_status", connected, sessionId },
			};
		},
	});
}

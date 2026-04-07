/**
 * Notion MCP Client Extension for pi
 *
 * Connects to the official Notion MCP server at https://mcp.notion.com/mcp
 * using OAuth authentication.
 *
 * Usage:
 *   /notion                    - Status, connect, or disconnect
 *   "Search my Notion for X"    - Natural language (tools auto-discovered after connect)
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getPort as lookupPort } from "portfinder";

// =============================================================================
// Constants
// =============================================================================

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";

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
// OAuth Callback Server
// =============================================================================

interface OAuthCallbackResult {
	code?: string;
	accessToken?: string;
	error?: string;
	errorDescription?: string;
}

interface OAuthCallbackServerResult {
	port: number;
	result: Promise<OAuthCallbackResult>;
}

async function startOAuthCallbackServer(
	preferredPort: number,
	state: string,
	timeoutMs = 300000,
): Promise<OAuthCallbackServerResult> {
	const port = await lookupPort({ port: preferredPort });

	const resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
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

						// Check state
						if (params.get("state") !== state) {
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

						// Check for error
						if (params.get("error")) {
							const html = `<html><body><h1>Authorization failed</h1><p>Error: ${params.get("error")}</p><p>${params.get("error_description") || ""}</p></body></html>`;
							socket.write("HTTP/1.1 400 Bad Request\r\n");
							socket.write(`Content-Length: ${html.length}\r\n`);
							socket.write("Content-Type: text/html\r\n\r\n");
							socket.write(html);
							socket.end();
							clearTimeout(timeout);
							server.close();
							resolve({
								error: params.get("error") || "Unknown error",
								errorDescription: params.get("error_description") || undefined,
							});
							return;
						}

						// Check for access token (MCP server may return it directly)
						const accessToken = params.get("access_token");
						const code = params.get("code");

						const html = `<html><body><h1>Authorized!</h1><p>You can close this window.</p><script>window.close();</script></body></html>`;
						socket.write("HTTP/1.1 200 OK\r\n");
						socket.write(`Content-Length: ${html.length}\r\n`);
						socket.write("Content-Type: text/html\r\n\r\n");
						socket.write(html);
						socket.end();
						clearTimeout(timeout);
						server.close();

						if (accessToken) {
							resolve({ accessToken });
						} else if (code) {
							resolve({ code });
						} else {
							resolve({ error: "No code or token in callback" });
						}
						return;
					}
				}
			});

			socket.on("error", () => {});
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			clearTimeout(timeout);
			reject(new Error(`Callback server error: ${err.message}`));
		});

		server.listen(port, "127.0.0.1", () => {});
	});

	return { port, result: resultPromise };
}

// =============================================================================
// Dynamic Client Registration (RFC 7591)
// =============================================================================

interface ClientRegistration {
	client_id: string;
	client_secret?: string;
}

async function registerClient(redirectUri: string): Promise<ClientRegistration> {
	const response = await fetch("https://mcp.notion.com/register", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: "client_secret_post",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			client_name: "pi-notion",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Client registration failed: ${response.status} - ${error}`);
	}

	return (await response.json()) as ClientRegistration;
}

// =============================================================================
// Token Exchange
// =============================================================================

async function exchangeCodeForToken(
	code: string,
	redirectUri: string,
	codeVerifier: string,
	clientId: string,
	clientSecret?: string,
): Promise<{ accessToken: string }> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		client_id: clientId,
		code,
		redirect_uri: redirectUri,
		code_verifier: codeVerifier,
	};
	if (clientSecret) {
		params.client_secret = clientSecret;
	}
	const body = new URLSearchParams(params);
	const response = await fetch("https://mcp.notion.com/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${response.status} - ${error}`);
	}

	const data = (await response.json()) as { access_token: string };
	return { accessToken: data.access_token };
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

		// Initialize MCP connection (session ID captured from response header in sendRequest)
		await this.sendRequest(mcpUrl, "initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-notion", version: "1.0.0" },
		});

		// If server didn't return a session ID, generate one locally
		if (!this.sessionId) {
			this.sessionId = randomBytes(16).toString("hex");
			this.state.sessionId = this.sessionId;
		}
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

	private getHeaders(): Record<string, string> {
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
			headers: this.getHeaders(),
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		// Capture session ID from response headers
		const sessionHeader = response.headers.get("mcp-session-id");
		if (sessionHeader) {
			this.sessionId = sessionHeader;
			this.state.sessionId = sessionHeader;
		}

		const contentType = response.headers.get("content-type") || "";
		let data: { result?: unknown; error?: { message: string } };

		if (contentType.includes("text/event-stream")) {
			data = await this.parseSSEResponse(response);
		} else {
			data = await response.json();
		}

		if (data.error) {
			throw new Error(`MCP Error: ${data.error.message}`);
		}
		return data.result;
	}

	private async parseSSEResponse(response: Response): Promise<{ result?: unknown; error?: { message: string } }> {
		const text = await response.text();
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data: ")) {
				const jsonStr = line.slice(6).trim();
				if (jsonStr) {
					return JSON.parse(jsonStr);
				}
			}
		}
		throw new Error("No data found in SSE response");
	}

	private async sendNotification(mcpUrl: string, method: string, params: Record<string, unknown>): Promise<void> {
		const notification = { jsonrpc: "2.0", method, params };
		await fetch(mcpUrl, {
			method: "POST",
			headers: this.getHeaders(),
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
	clientId?: string;
	clientSecret?: string;
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
							content: [{ type: "text", text: result || "" }],
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

				// Start OAuth flow
				const state = randomBytes(16).toString("hex");

				// Start callback server on an available port
				const callbackServer = await startOAuthCallbackServer(3000, state);
				const callbackUrl = `http://localhost:${callbackServer.port}/callback`;

				// Dynamic client registration
				ctx.ui.notify("Registering OAuth client...", "info");
				let registration: ClientRegistration;
				try {
					registration = await registerClient(callbackUrl);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Client registration failed: ${message}`, "error");
					return;
				}

				// Build authorization URL with PKCE
				const codeVerifier = randomBytes(32).toString("base64url");
				const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

				const authUrl = new URL("https://mcp.notion.com/authorize");
				authUrl.searchParams.set("response_type", "code");
				authUrl.searchParams.set("client_id", registration.client_id);
				authUrl.searchParams.set("redirect_uri", callbackUrl);
				authUrl.searchParams.set("code_challenge", codeChallenge);
				authUrl.searchParams.set("code_challenge_method", "S256");
				authUrl.searchParams.set("state", state);
				authUrl.searchParams.set("prompt", "consent");

				ctx.ui.notify("Opening Notion authorization page...", "info");

				// Open browser
				await openBrowser(authUrl.toString());

				ctx.ui.notify("Waiting for authorization callback...", "info");

				// Wait for callback
				try {
					const result = await callbackServer.result;

					if (result.error) {
						ctx.ui.notify(`Authorization failed: ${result.error}`, "error");
						return;
					}

					let accessToken: string;

					if (result.accessToken) {
						// MCP server returned token directly
						accessToken = result.accessToken;
					} else if (result.code) {
						// Exchange code for token
						ctx.ui.notify("Exchanging authorization code for token...", "info");
						try {
							const tokenResult = await exchangeCodeForToken(
								result.code,
								callbackUrl,
								codeVerifier,
								registration.client_id,
								registration.client_secret,
							);
							accessToken = tokenResult.accessToken;
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Token exchange failed: ${message}`, "error");
							return;
						}
					} else {
						ctx.ui.notify("No authorization code received", "error");
						return;
					}

					// Connect to MCP
					ctx.ui.notify("Connecting to MCP server...", "info");
					await mcpClient.connect(NOTION_MCP_URL, accessToken);

					// Save config
					await storage.save({
						mcpUrl: NOTION_MCP_URL,
						accessToken,
						clientId: registration.client_id,
						clientSecret: registration.client_secret,
					});

					// Register tools
					registerMCPTools();

					ctx.ui.notify(`Connected! Session: ${mcpClient.state.sessionId?.slice(0, 8)}...`, "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Connection failed: ${message}`, "error");
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
		description: "Connect to Notion via the official MCP server using OAuth",
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

			// Try saved config first
			const savedConfig = await storage.load();
			if (savedConfig) {
				try {
					notify("Connecting to saved Notion MCP...");
					await mcpClient.connect(savedConfig.mcpUrl, savedConfig.accessToken);
					registerMCPTools();
					const tools = mcpClient.getTools();
					return {
						content: [
							{
								type: "text",
								text: `Connected to Notion MCP!\n\n${tools.length} tools available.`,
							},
						],
						details: { tool: "notion_mcp_connect" },
					};
				} catch {
					await storage.clear();
				}
			}

			// Start OAuth flow
			notify("Starting OAuth flow...");

			const state = randomBytes(16).toString("hex");

			// Start callback server on an available port
			const callbackServer = await startOAuthCallbackServer(3000, state);
			const callbackUrl = `http://localhost:${callbackServer.port}/callback`;

			// Dynamic client registration
			notify("Registering OAuth client...");
			let registration: ClientRegistration;
			try {
				registration = await registerClient(callbackUrl);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Client registration failed: ${message}` }],
					isError: true,
					details: { tool: "notion_mcp_connect" },
				};
			}

			// Build authorization URL
			const codeVerifier = randomBytes(32).toString("base64url");
			const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

			const authUrl = new URL("https://mcp.notion.com/authorize");
			authUrl.searchParams.set("response_type", "code");
			authUrl.searchParams.set("client_id", registration.client_id);
			authUrl.searchParams.set("redirect_uri", callbackUrl);
			authUrl.searchParams.set("code_challenge", codeChallenge);
			authUrl.searchParams.set("code_challenge_method", "S256");
			authUrl.searchParams.set("state", state);
			authUrl.searchParams.set("prompt", "consent");

			notify("Opening Notion authorization page...");
			await openBrowser(authUrl.toString());

			notify("Waiting for authorization...");

			try {
				const result = await callbackServer.result;

				if (result.error) {
					return {
						content: [{ type: "text", text: `Authorization failed: ${result.error}` }],
						isError: true,
						details: { tool: "notion_mcp_connect" },
					};
				}

				let accessToken: string;

				if (result.accessToken) {
					accessToken = result.accessToken;
				} else if (result.code) {
					notify("Exchanging authorization code for token...");
					const tokenResult = await exchangeCodeForToken(
						result.code,
						callbackUrl,
						codeVerifier,
						registration.client_id,
						registration.client_secret,
					);
					accessToken = tokenResult.accessToken;
				} else {
					return {
						content: [{ type: "text", text: "No authorization code received" }],
						isError: true,
						details: { tool: "notion_mcp_connect" },
					};
				}

				notify("Connecting to MCP server...");
				await mcpClient.connect(NOTION_MCP_URL, accessToken);
				await storage.save({
					mcpUrl: NOTION_MCP_URL,
					accessToken,
					clientId: registration.client_id,
					clientSecret: registration.client_secret,
				});
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

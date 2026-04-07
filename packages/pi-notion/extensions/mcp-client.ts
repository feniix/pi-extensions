/**
 * Notion MCP Client Extension for pi
 *
 * Connects to the official Notion MCP server at https://mcp.notion.com/mcp
 * using the MCP Streamable HTTP transport with OAuth 2.0 + PKCE authentication.
 *
 * This provides full access to Notion via the MCP protocol without requiring
 * a personal Notion integration or manual OAuth setup.
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
const _NOTION_ORIGIN = "https://mcp.notion.com";

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
// Notion OAuth Configuration
// =============================================================================

interface OAuthMetadata {
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
}

/**
 * Get Notion OAuth metadata.
 * Uses the standard Notion OAuth endpoints since MCP discovery requires auth.
 */
async function getOAuthMetadata(): Promise<OAuthMetadata> {
	// Notion's OAuth endpoints (public)
	return {
		authorization_endpoint: "https://api.notion.com/v1/oauth/authorize",
		token_endpoint: "https://api.notion.com/v1/oauth/token",
		registration_endpoint: "https://api.notion.com/v1/oauth/register",
	};
}

// =============================================================================
// PKCE Utilities
// =============================================================================

function base64URLEncode(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
	return base64URLEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
	return base64URLEncode(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
	return randomBytes(16).toString("hex");
}

// =============================================================================
// Dynamic Client Registration (RFC 7591)
// =============================================================================

interface ClientCredentials {
	client_id: string;
	client_secret?: string;
}

async function registerClient(metadata: OAuthMetadata, redirectUri: string): Promise<ClientCredentials> {
	if (!metadata.registration_endpoint) {
		throw new Error("Server does not support dynamic client registration");
	}

	const registrationRequest = {
		client_name: "pi-notion",
		client_uri: "https://github.com/feniix/pi-packages",
		redirect_uris: [redirectUri],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
	};

	const response = await fetch(metadata.registration_endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify(registrationRequest),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Client registration failed: ${response.status} - ${errorBody}`);
	}

	return response.json() as Promise<ClientCredentials>;
}

// =============================================================================
// Token Storage
// =============================================================================

interface StoredTokens {
	clientId: string;
	clientSecret?: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	authMetadata?: OAuthMetadata;
}

interface TokenStorage {
	save(tokens: StoredTokens): Promise<void>;
	load(): Promise<StoredTokens | null>;
	clear(): Promise<void>;
}

class FileTokenStorage implements TokenStorage {
	private path: string;

	constructor() {
		const configDir = join(homedir(), ".pi", "agent", "extensions");
		this.path = join(configDir, "notion-mcp-tokens.json");
	}

	async save(tokens: StoredTokens): Promise<void> {
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			writeFileSync(this.path, JSON.stringify(tokens, null, 2), "utf-8");
		} catch (error) {
			console.error("Failed to save tokens:", error);
		}
	}

	async load(): Promise<StoredTokens | null> {
		if (!existsSync(this.path)) {
			return null;
		}
		try {
			return JSON.parse(readFileSync(this.path, "utf-8")) as StoredTokens;
		} catch {
			return null;
		}
	}

	async clear(): Promise<void> {
		if (existsSync(this.path)) {
			readFileSync(this.path); // Just to check it exists
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
// OAuth Token Exchange
// =============================================================================

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	token_type: string;
	expires_in?: number;
	scope?: string;
}

async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
	metadata: OAuthMetadata,
	clientId: string,
	clientSecret: string | undefined,
	redirectUri: string,
): Promise<TokenResponse> {
	const params = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		client_id: clientId,
		redirect_uri: redirectUri,
		code_verifier: codeVerifier,
	});

	if (clientSecret) {
		params.append("client_secret", clientSecret);
	}

	const response = await fetch(metadata.token_endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Token exchange failed: ${response.status} - ${errorBody}`);
	}

	return response.json() as Promise<TokenResponse>;
}

async function _refreshAccessToken(
	refreshToken: string,
	metadata: OAuthMetadata,
	clientId: string,
	clientSecret: string | undefined,
): Promise<TokenResponse> {
	const params = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: clientId,
	});

	if (clientSecret) {
		params.append("client_secret", clientSecret);
	}

	const response = await fetch(metadata.token_endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: params.toString(),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Token refresh failed: ${response.status} - ${errorBody}`);
	}

	return response.json() as Promise<TokenResponse>;
}

// =============================================================================
// OAuth Callback Handler
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
							resolve({ error: "State mismatch - possible CSRF attack" });
							return;
						}

						if (params.get("error")) {
							const html = `<html><body><h1>Authorization failed</h1><p>Error: ${params.get("error")}</p><p>${params.get("error_description") || ""}</p></body></html>`;
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

// =============================================================================
// MCP Client
// =============================================================================

class NotionMCPClient {
	state: MCPClientState = {
		connected: false,
		authenticated: false,
		sessionId: null,
		accessToken: null,
	};
	private messageId = 0;
	private sessionId: string | null = null;
	private _accessToken: string | null = null;
	private _tools: MCPTool[] = [];

	async initialize(): Promise<void> {
		// Get OAuth metadata (stored globally for use in OAuth flow)
		oauthMetadata = await getOAuthMetadata();
	}

	async connect(): Promise<void> {
		if (!this._accessToken) {
			throw new Error("No access token available. Complete OAuth flow first.");
		}

		// Initialize MCP connection
		await this.sendRequest("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-notion", version: "1.0.0" },
		});

		this.sessionId = randomBytes(16).toString("hex");
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
				await fetch(`${NOTION_MCP_URL}/${this.sessionId}`, {
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
		};
		this.sessionId = null;
		this._accessToken = null;
		this._tools = [];
	}

	setAccessToken(token: string): void {
		this._accessToken = token;
		this.state.accessToken = token;
		this.state.authenticated = true;
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
// Extension Entry Point
// =============================================================================

let mcpClient: NotionMCPClient | null = null;
let oauthMetadata: OAuthMetadata | null = null;

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
		if (!mcpClient) return;

		const tools = mcpClient.getTools();
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
				ctx.ui.notify("Connecting to Notion...", "info");

				try {
					// Initialize OAuth discovery
					notify("Discovering OAuth configuration...");
					oauthMetadata = await getOAuthMetadata();

					// Set up callback server
					const CALLBACK_PORT = 3000;
					const codeVerifier = generateCodeVerifier();
					const codeChallenge = generateCodeChallenge(codeVerifier);
					const state = generateState();
					const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;

					// Register client dynamically
					notify("Registering with Notion...");
					const credentials = await registerClient(oauthMetadata, callbackUrl);

					// Build authorization URL
					const authUrl = new URL(oauthMetadata.authorization_endpoint);
					authUrl.searchParams.set("response_type", "code");
					authUrl.searchParams.set("client_id", credentials.client_id);
					authUrl.searchParams.set("redirect_uri", callbackUrl);
					authUrl.searchParams.set("code_challenge", codeChallenge);
					authUrl.searchParams.set("code_challenge_method", "S256");
					authUrl.searchParams.set("state", state);
					authUrl.searchParams.set("prompt", "consent");

					notify("Opening Notion authorization page...");
					const callbackPromise = waitForOAuthCallback(CALLBACK_PORT, state);

					await openBrowser(authUrl.toString());

					// Wait for callback
					notify("Waiting for authorization...");
					const result = await callbackPromise;

					if ("error" in result) {
						ctx.ui.notify(`Authorization failed: ${result.error}`, "error");
						return;
					}

					// Exchange code for tokens
					notify("Exchanging authorization code for tokens...");
					const tokens = await exchangeCodeForTokens(
						result.code,
						codeVerifier,
						oauthMetadata,
						credentials.client_id,
						credentials.client_secret,
						callbackUrl,
					);

					// Store tokens
					const storage = new FileTokenStorage();
					await storage.save({
						clientId: credentials.client_id,
						clientSecret: credentials.client_secret,
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token || "",
						expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
						authMetadata: oauthMetadata,
					});

					// Connect to MCP
					mcpClient.setAccessToken(tokens.access_token);
					notify("Connecting to MCP server...");
					await mcpClient.connect();
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

	// Connect tool
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

				// Initialize OAuth discovery
				oauthMetadata = await getOAuthMetadata();

				// Set up callback server
				const CALLBACK_PORT = 3000;
				const codeVerifier = generateCodeVerifier();
				const codeChallenge = generateCodeChallenge(codeVerifier);
				const state = generateState();
				const callbackUrl = `http://localhost:${CALLBACK_PORT}/callback`;

				// Register client dynamically
				const credentials = await registerClient(oauthMetadata, callbackUrl);

				// Build authorization URL
				const authUrl = new URL(oauthMetadata.authorization_endpoint);
				authUrl.searchParams.set("response_type", "code");
				authUrl.searchParams.set("client_id", credentials.client_id);
				authUrl.searchParams.set("redirect_uri", callbackUrl);
				authUrl.searchParams.set("code_challenge", codeChallenge);
				authUrl.searchParams.set("code_challenge_method", "S256");
				authUrl.searchParams.set("state", state);
				authUrl.searchParams.set("prompt", "consent");

				notify("Opening Notion authorization page...");
				const callbackPromise = waitForOAuthCallback(CALLBACK_PORT, state);

				await openBrowser(authUrl.toString());

				// Wait for callback
				notify("Waiting for authorization...");
				const result = await callbackPromise;

				if ("error" in result) {
					return {
						content: [{ type: "text", text: `Authorization failed: ${result.error}` }],
						isError: true,
						details: { tool: "notion_mcp_connect" },
					};
				}

				// Exchange code for tokens
				notify("Exchanging authorization code for tokens...");
				const tokens = await exchangeCodeForTokens(
					result.code,
					codeVerifier,
					oauthMetadata,
					credentials.client_id,
					credentials.client_secret,
					callbackUrl,
				);

				// Store tokens
				const storage = new FileTokenStorage();
				await storage.save({
					clientId: credentials.client_id,
					clientSecret: credentials.client_secret,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token || "",
					expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
					authMetadata: oauthMetadata,
				});

				// Connect to MCP
				mcpClient.setAccessToken(tokens.access_token);
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
		description: "Disconnect from Notion MCP server and clear tokens",
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
			const storage = new FileTokenStorage();
			await storage.clear();

			return {
				content: [{ type: "text", text: "Disconnected from Notion MCP and cleared tokens" }],
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

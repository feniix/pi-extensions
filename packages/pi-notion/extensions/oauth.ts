/**
 * Notion OAuth utilities for pi-notion extension
 *
 * Implements OAuth 2.0 flow with PKCE for secure authorization.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import axios from "axios";
import { getPort as lookupPort } from "portfinder";

// =============================================================================
// Types
// =============================================================================

export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
	expiresAt: number;
}

export interface OAuthUserInfo {
	workspaceId: string;
	workspaceName: string;
	workspaceIcon?: string;
	botId: string;
	ownerEmail?: string;
	ownerName?: string;
}

// =============================================================================
// PKCE Utilities
// =============================================================================

/**
 * Generate a random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
	const hash = createHash("sha256").update(verifier).digest();
	return hash.toString("base64url");
}

/**
 * Generate random state parameter for CSRF protection
 */
export function generateState(): string {
	return randomBytes(16).toString("hex");
}

// =============================================================================
// OAuth URL Builder
// =============================================================================

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";

export function buildAuthorizationUrl(config: OAuthConfig, codeChallenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		owner: "user",
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
	});

	return `${NOTION_AUTH_URL}?${params.toString()}`;
}

// =============================================================================
// Token Exchange
// =============================================================================

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export async function exchangeCodeForTokens(
	config: OAuthConfig,
	code: string,
	codeVerifier: string,
): Promise<OAuthTokens & { owner?: OAuthUserInfo }> {
	const response = await axios.post(
		NOTION_TOKEN_URL,
		{
			grant_type: "authorization_code",
			code,
			redirect_uri: config.redirectUri,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code_verifier: codeVerifier,
		},
		{
			headers: {
				"Content-Type": "application/json",
			},
		},
	);

	const data = response.data;

	const tokens: OAuthTokens = {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		tokenType: data.token_type,
		expiresAt: Date.now() + 3600 * 1000, // Notion tokens typically last 1 hour
	};

	const result: OAuthTokens & { owner?: OAuthUserInfo } = { ...tokens };

	if (data.owner?.user) {
		result.owner = {
			workspaceId: data.workspace_id,
			workspaceName: data.workspace_name,
			workspaceIcon: data.workspace_icon,
			botId: data.bot_id,
			ownerEmail: data.owner.user.person?.email,
			ownerName: data.owner.user.name,
		};
	}

	return result;
}

export async function refreshTokens(config: OAuthConfig, refreshToken: string): Promise<OAuthTokens> {
	const response = await axios.post(
		NOTION_TOKEN_URL,
		{
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: config.clientId,
			client_secret: config.clientSecret,
		},
		{
			headers: {
				"Content-Type": "application/json",
			},
		},
	);

	const data = response.data;

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token || refreshToken, // Keep old if not provided
		tokenType: data.token_type,
		expiresAt: Date.now() + 3600 * 1000,
	};
}

// =============================================================================
// Callback Server
// =============================================================================

interface CallbackResult {
	code: string;
	state: string;
	error?: string;
}

function parseQueryParams(url: string): Record<string, string> {
	const urlObj = new URL(url);
	const params: Record<string, string> = {};
	urlObj.searchParams.forEach((value, key) => {
		params[key] = value;
	});
	return params;
}

/**
 * Start a local callback server and wait for the OAuth redirect
 */
export async function startCallbackServer(expectedState: string, timeoutMs = 120000): Promise<CallbackResult> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		const timeout = setTimeout(() => {
			server.close();
			reject(new Error("OAuth callback timed out"));
		}, timeoutMs);

		server.on("connection", async (socket) => {
			// Find an available port
			const port = await lookupPort({ port: 3000 });
			socket.destroy();
			server.close();

			// Restart server on the found port
			const callbackServer = createServer();

			callbackServer.on("connection", (clientSocket) => {
				let buffer = "";

				clientSocket.on("data", (chunk) => {
					buffer += chunk.toString();

					// Check if we have the full HTTP request
					if (buffer.includes("\r\n\r\n")) {
						const requestMatch = buffer.match(/GET \/callback\?([^ ]+)/);
						if (requestMatch) {
							const queryString = requestMatch[1];
							const params = parseQueryParams(`/?${queryString}`);

							// Validate state
							if (params.state !== expectedState) {
								const html = `<html><body><h1>State mismatch error</h1><p>The OAuth state does not match. Please try again.</p></body></html>`;
								clientSocket.write("HTTP/1.1 400 Bad Request\r\n");
								clientSocket.write(`Content-Length: ${html.length}\r\n`);
								clientSocket.write("Content-Type: text/html\r\n\r\n");
								clientSocket.write(html);
								clientSocket.end();
								clearTimeout(timeout);
								callbackServer.close();
								reject(new Error("State mismatch - possible CSRF attack"));
								return;
							}

							if (params.error) {
								const html = `<html><body><h1>Authorization failed</h1><p>Error: ${params.error}</p><p>${params.error_description || ""}</p></body></html>`;
								clientSocket.write("HTTP/1.1 400 Bad Request\r\n");
								clientSocket.write(`Content-Length: ${html.length}\r\n`);
								clientSocket.write("Content-Type: text/html\r\n\r\n");
								clientSocket.write(html);
								clientSocket.end();
								clearTimeout(timeout);
								callbackServer.close();
								resolve({ code: "", state: expectedState, error: params.error });
								return;
							}

							if (params.code) {
								const html = `<html><body><h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p><script>window.close();</script></body></html>`;
								clientSocket.write("HTTP/1.1 200 OK\r\n");
								clientSocket.write(`Content-Length: ${html.length}\r\n`);
								clientSocket.write("Content-Type: text/html\r\n\r\n");
								clientSocket.write(html);
								clientSocket.end();
								clearTimeout(timeout);
								callbackServer.close();
								resolve({ code: params.code, state: params.state });
								return;
							}
						}
					}
				});

				clientSocket.on("error", () => {
					// Ignore connection errors
				});
			});

			callbackServer.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					// Port in use, try next
					lookupPort({ port: 3001 }).then((newPort: number) => {
						callbackServer.close();
						// Could retry with new port, but for simplicity just reject
						reject(new Error(`Port ${newPort} already in use`));
					});
				}
			});

			callbackServer.listen(port, "127.0.0.1", () => {
				// Server started, will handle callback
			});
		});
	});
}

// =============================================================================
// Token Storage
// =============================================================================

export interface TokenStorage {
	save(tokens: OAuthTokens, userInfo?: OAuthUserInfo): Promise<void>;
	load(): Promise<OAuthTokens | null>;
	clear(): Promise<void>;
	getUserInfo(): Promise<OAuthUserInfo | null>;
}

export class FileTokenStorage implements TokenStorage {
	private path: string;
	private userInfoPath: string;

	constructor(basePath: string) {
		// Store tokens in same directory as config
		this.path = basePath.replace(/\.json$/, "-tokens.json");
		this.userInfoPath = basePath.replace(/\.json$/, "-user.json");
	}

	async save(tokens: OAuthTokens, userInfo?: OAuthUserInfo): Promise<void> {
		const { writeFileSync } = await import("node:fs");
		writeFileSync(this.path, JSON.stringify(tokens, null, 2), "utf-8");
		if (userInfo) {
			writeFileSync(this.userInfoPath, JSON.stringify(userInfo, null, 2), "utf-8");
		}
	}

	async load(): Promise<OAuthTokens | null> {
		const { existsSync, readFileSync } = await import("node:fs");
		if (!existsSync(this.path)) {
			return null;
		}
		return JSON.parse(readFileSync(this.path, "utf-8")) as OAuthTokens;
	}

	async clear(): Promise<void> {
		const { existsSync, unlinkSync } = await import("node:fs");
		if (existsSync(this.path)) {
			unlinkSync(this.path);
		}
		if (existsSync(this.userInfoPath)) {
			unlinkSync(this.userInfoPath);
		}
	}

	async getUserInfo(): Promise<OAuthUserInfo | null> {
		const { existsSync, readFileSync } = await import("node:fs");
		if (!existsSync(this.userInfoPath)) {
			return null;
		}
		return JSON.parse(readFileSync(this.userInfoPath, "utf-8")) as OAuthUserInfo;
	}
}

// =============================================================================
// Complete OAuth Flow
// =============================================================================

export interface OAuthFlowResult {
	tokens: OAuthTokens;
	userInfo: OAuthUserInfo;
}

/**
 * Execute the complete OAuth flow:
 * 1. Generate PKCE verifier/challenge
 * 2. Open browser for authorization
 * 3. Start callback server
 * 4. Exchange code for tokens
 * 5. Store tokens
 */
export async function executeOAuthFlow(
	config: OAuthConfig,
	storage: TokenStorage,
	openBrowserFn: (url: string) => void,
	notifyFn: (message: string, type: "info" | "success" | "error") => void,
): Promise<OAuthFlowResult> {
	// Generate PKCE parameters
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);
	const state = generateState();

	// Build authorization URL
	const authUrl = buildAuthorizationUrl(config, codeChallenge, state);

	// Start callback server (need to do this before opening browser)
	const callbackPromise = startCallbackServer(state);

	// Open browser
	notifyFn("Opening Notion authorization page in your browser...", "info");
	openBrowserFn(authUrl);

	// Wait for callback
	notifyFn("Waiting for authorization callback...", "info");

	let callbackResult: CallbackResult;
	try {
		callbackResult = await callbackPromise;
	} catch (error) {
		throw new Error(`OAuth callback failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (callbackResult.error) {
		throw new Error(`Authorization failed: ${callbackResult.error}`);
	}

	// Exchange code for tokens
	notifyFn("Exchanging authorization code for access token...", "info");

	try {
		const result = await exchangeCodeForTokens(config, callbackResult.code, codeVerifier);

		// Save tokens and user info
		await storage.save(result, result.owner || undefined);

		notifyFn("OAuth authorization successful!", "success");

		if (result.owner) {
			notifyFn(`Connected to workspace: ${result.owner.workspaceName}`, "info");
		}

		return {
			tokens: result,
			userInfo: result.owner ?? {
				workspaceId: "",
				workspaceName: "Unknown",
				botId: "",
			},
		};
	} catch (error) {
		throw new Error(`Token exchange failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(config: OAuthConfig, storage: TokenStorage): Promise<string | null> {
	const tokens = await storage.load();
	if (!tokens) {
		return null;
	}

	// Check if token needs refresh (refresh 5 minutes before expiry)
	const refreshThreshold = 5 * 60 * 1000;
	const needsRefresh = Date.now() > tokens.expiresAt - refreshThreshold;

	if (!needsRefresh) {
		return tokens.accessToken;
	}

	// Refresh the token
	try {
		const newTokens = await refreshTokens(config, tokens.refreshToken);
		const userInfo = await storage.getUserInfo();
		await storage.save(newTokens, userInfo || undefined);
		return newTokens.accessToken;
	} catch (error) {
		// Refresh failed, clear tokens
		await storage.clear();
		throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

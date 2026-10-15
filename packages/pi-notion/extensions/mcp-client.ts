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

import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPort as lookupPort } from "portfinder";
import { Type } from "typebox";
import { isNearExpiry } from "./token-expiry.js";

// =============================================================================
// Constants
// =============================================================================

const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const HTTP_REQUEST_COMPLETE_MARKER = "\r\n\r\n";
const CALLBACK_PATH_PREFIX = "GET /callback?";
const OAUTH_CALLBACK_HOST = "127.0.0.1";
const NOTION_MCP_AUTH_FILE_ENV = "NOTION_MCP_AUTH_FILE";
const NOTION_MCP_AUTH_FILE_LEGACY_ENV = "NOTION_MCP_AUTH";

function getHomeDir(): string {
  return process.env.HOME || homedir();
}

type NotifyLevel = "info" | "error";
type NotifyFn = (message: string, type?: NotifyLevel) => void;
type OAuthInputFn = (prompt: string, placeholder?: string) => Promise<string | undefined>;

type ToolExecutionResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  details: Record<string, unknown>;
};

const noopNotify: NotifyFn = () => {};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Base for errors matched by type; names each instance after its subclass. */
class NamedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The server rejected the access token (HTTP 401). */
class AuthenticationError extends NamedError {}

/** The server no longer knows our MCP session (HTTP 404); the token is fine, so reopen without refreshing. */
class SessionExpiredError extends NamedError {}

/** The refresh token or client is no longer valid; retrying cannot help, so saved credentials are dropped. */
class TokenRefreshRejectedError extends NamedError {}

/** There are no credentials to (re)connect with, or the client was disconnected mid-reconnect. */
class NotConnectedError extends NamedError {}

/** Writes an owner-only file atomically, so readers never see a partial file or a briefly wider mode. */
function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tempPath, contents, { encoding: "utf-8", mode: 0o600 });
    renameSync(tempPath, path);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file was never created or is already gone
    }
    throw error;
  }
}

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
  /** Stops listening and disarms the timeout; `result` then never settles. */
  cancel: () => void;
}

function buildHtmlResponse(statusLine: string, html: string): string {
  return `${statusLine}\r\nContent-Length: ${html.length}\r\nContent-Type: text/html\r\n\r\n${html}`;
}

function buildOAuthCallbackUrl(port: number): string {
  return `http://${OAUTH_CALLBACK_HOST}:${port}/callback`;
}

function writeHtmlResponse(socket: NodeJS.WritableStream, statusLine: string, html: string): void {
  socket.write(buildHtmlResponse(statusLine, html));
}

function extractCallbackParams(buffer: string): URLSearchParams | null {
  if (!buffer.includes(HTTP_REQUEST_COMPLETE_MARKER)) return null;

  const requestLine = buffer.split("\r\n", 1)[0] ?? "";
  if (!requestLine.startsWith(CALLBACK_PATH_PREFIX)) return null;

  const queryString = requestLine.slice(CALLBACK_PATH_PREFIX.length).split(" ", 1)[0] ?? "";
  return new URLSearchParams(queryString);
}

function resolveCallbackResult(
  params: URLSearchParams,
  expectedState: string,
): {
  response: { statusLine: string; html: string };
  result: OAuthCallbackResult;
} {
  if (params.get("state") !== expectedState) {
    return {
      response: {
        statusLine: "HTTP/1.1 400 Bad Request",
        html: `<html><body><h1>State mismatch</h1><p>Please try again.</p></body></html>`,
      },
      result: { error: "State mismatch" },
    };
  }

  const error = params.get("error");
  if (error) {
    return {
      response: {
        statusLine: "HTTP/1.1 400 Bad Request",
        html: `<html><body><h1>Authorization failed</h1><p>Error: ${error}</p><p>${params.get("error_description") || ""}</p></body></html>`,
      },
      result: {
        error,
        errorDescription: params.get("error_description") || undefined,
      },
    };
  }

  const accessToken = params.get("access_token");
  if (accessToken) {
    return {
      response: {
        statusLine: "HTTP/1.1 200 OK",
        html: `<html><body><h1>Authorized!</h1><p>You can close this window.</p><script>window.close();</script></body></html>`,
      },
      result: { accessToken },
    };
  }

  const code = params.get("code");
  if (code) {
    return {
      response: {
        statusLine: "HTTP/1.1 200 OK",
        html: `<html><body><h1>Authorized!</h1><p>You can close this window.</p><script>window.close();</script></body></html>`,
      },
      result: { code },
    };
  }

  return {
    response: {
      statusLine: "HTTP/1.1 400 Bad Request",
      html: `<html><body><h1>Authorization failed</h1><p>No code or token in callback.</p></body></html>`,
    },
    result: { error: "No code or token in callback" },
  };
}

/**
 * Parses what a headless user pasted: the failed loopback redirect URL or its query string.
 * A bare code is refused because it carries no state to check.
 */
function parseManualOAuthCallbackInput(input: string, expectedState: string): OAuthCallbackResult {
  const trimmed = input.trim();
  if (!trimmed) return { error: "No authorization code provided" };

  let params: URLSearchParams;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      params = new URL(trimmed).searchParams;
    } catch {
      return { error: "Could not read the pasted redirect URL; copy the whole address from the browser" };
    }
  } else if (trimmed.includes("=")) {
    // A query string, or a redirect URL whose scheme the browser hid ("127.0.0.1:51234/callback?code=...")
    const queryStart = trimmed.indexOf("?");
    params = new URLSearchParams(queryStart === -1 ? trimmed : trimmed.slice(queryStart + 1));
  } else {
    return { error: "Paste the full redirect URL (it carries the state check), not just the code" };
  }

  return resolveCallbackResult(params, expectedState).result;
}

async function startOAuthCallbackServer(
  preferredPort: number,
  state: string,
  timeoutMs = 300000,
): Promise<OAuthCallbackServerResult> {
  const port = await lookupPort({ port: preferredPort });
  let cancel = () => {};

  const resultPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    const server = createServer();
    const finish = (result: OAuthCallbackResult) => {
      clearTimeout(timeout);
      server.close();
      resolve(result);
    };
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out (5 minutes)"));
    }, timeoutMs);
    cancel = () => {
      clearTimeout(timeout);
      server.close();
    };

    server.on("connection", (socket) => {
      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const params = extractCallbackParams(buffer);
        if (!params) return;

        const { response, result } = resolveCallbackResult(params, state);
        writeHtmlResponse(socket, response.statusLine, response.html);
        socket.end();
        finish(result);
      });

      socket.on("error", () => {});
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(new Error(`Callback server error: ${err.message}`));
    });

    server.listen(port, OAUTH_CALLBACK_HOST, () => {});
  });

  return { port, result: resultPromise, cancel: () => cancel() };
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

const NOTION_TOKEN_URL = "https://mcp.notion.com/token";

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; undefined when the server did not report a lifetime, so only a 401 triggers refresh. */
  expiresAt?: number;
}

function tokenResponseFromJson(data: Record<string, unknown>, failurePrefix: string): TokenResponse {
  if (typeof data.access_token !== "string" || data.access_token === "") {
    throw new Error(`${failurePrefix}: response did not include an access_token`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

async function requestToken(params: Record<string, string>, failurePrefix: string): Promise<TokenResponse> {
  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    const message = `${failurePrefix}: ${response.status} - ${error}`;
    // RFC 6749 §5.2: 400 (invalid_grant etc.) and 401 (invalid_client) are definitive for a refresh grant
    if (params.grant_type === "refresh_token" && (response.status === 400 || response.status === 401)) {
      throw new TokenRefreshRejectedError(message);
    }
    throw new Error(message);
  }

  return tokenResponseFromJson((await response.json()) as Record<string, unknown>, failurePrefix);
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string | undefined,
  clientSecret?: string,
): Promise<TokenResponse> {
  if (!clientId) throw new TokenRefreshRejectedError("Cannot refresh Notion MCP token without a saved client id");

  const params: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  };
  if (clientSecret) {
    params.client_secret = clientSecret;
  }

  const refreshed = await requestToken(params, "Token refresh failed");
  return { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
  clientSecret?: string,
): Promise<TokenResponse> {
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
  return requestToken(params, "Token exchange failed");
}

function createPkceChallenge(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function buildAuthorizationUrl(
  registration: ClientRegistration,
  callbackUrl: string,
  codeChallenge: string,
  state: string,
): string {
  const authUrl = new URL("https://mcp.notion.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", registration.client_id);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent");
  return authUrl.toString();
}

async function resolveAccessToken(
  callbackResult: OAuthCallbackResult,
  callbackUrl: string,
  codeVerifier: string,
  registration: ClientRegistration,
  notify: NotifyFn,
): Promise<TokenResponse> {
  if (callbackResult.error) {
    throw new Error(`Authorization failed: ${callbackResult.error}`);
  }

  if (callbackResult.accessToken) {
    return { accessToken: callbackResult.accessToken };
  }

  if (!callbackResult.code) {
    throw new Error("No authorization code received");
  }

  notify("Exchanging authorization code for token...");
  return exchangeCodeForToken(
    callbackResult.code,
    callbackUrl,
    codeVerifier,
    registration.client_id,
    registration.client_secret,
  );
}

// =============================================================================
// MCP Client
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumericString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value));
}

function coercePropertyMap(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([propName, propValue]) => [
      propName,
      isNumericString(propValue) ? Number(propValue) : coerceNumericProperties(propValue),
    ]),
  );
}

function coerceNumericProperties(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(coerceNumericProperties);
  if (!isRecord(obj)) return obj;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      key === "properties" && isRecord(value) ? coercePropertyMap(value) : coerceNumericProperties(value),
    ]),
  );
}

function toolsFromListResult(result: unknown): MCPTool[] {
  const tools = (result as { tools?: MCPTool[] })?.tools || [];
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
  }));
}

/** After a failed reconnect, calls fail fast with that error for this long instead of retrying each time. */
const RECOVERY_RETRY_DELAY_MS = 15_000;

function canRefresh(config: StoredConfig): boolean {
  return Boolean(config.refreshToken && config.clientId);
}

/**
 * MCP client that owns its credentials and recovers from rejected tokens (401) and expired
 * sessions (404) on every request path: tool calls, liveness checks, and status.
 *
 * In-memory credentials are the source of truth; the auth file is for persistence and for
 * adopting tokens another pi process already refreshed. Each opened session bumps `generation`,
 * so a failure from a request sent on an older session retries instead of recovering again.
 * `lifecycle` bumps on new credentials and on disconnect, so a superseded recovery cannot
 * persist tokens or resurrect the client.
 */
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
  private credentials: StoredConfig | null = null;
  private generation = 0;
  private lifecycle = 0;
  private recovery: Promise<void> | null = null;
  private lastRecoveryFailure: { at: number; error: unknown } | null = null;

  /** Adopts credentials (e.g. freshly issued by OAuth) without connecting; supersedes any recovery. */
  useCredentials(config: StoredConfig): number {
    this.recovery = null;
    this.lastRecoveryFailure = null;
    this.credentials = config;
    return ++this.lifecycle;
  }

  /** Connects with saved credentials, refreshing near expiry or when the token is rejected. */
  async open(config: StoredConfig, notify: NotifyFn = noopNotify): Promise<void> {
    const lifecycle = this.useCredentials(config);
    let current = config;
    let refreshed = false;
    if (canRefresh(current) && isNearExpiry(current.expiresAt)) {
      try {
        current = await this.refresh(current, lifecycle, notify);
        refreshed = true;
      } catch (error) {
        if (error instanceof NotConnectedError) throw error;
        // The current token is still valid for a few minutes, so use it even if the refresh token is dead
        notify(`Notion MCP token refresh failed (${errorMessage(error)}); using the current token.`, "error");
      }
    }
    await this.openSession(current, lifecycle, notify, { endPrevious: true, refreshed });
  }

  /** Opens a new MCP session with this token, ending the current one first. */
  async connect(mcpUrl: string, accessToken: string): Promise<void> {
    await this.endSession();
    this.state.connected = false;
    if (this.credentials?.accessToken !== accessToken || this.credentials.mcpUrl !== mcpUrl) {
      this.credentials = { mcpUrl, accessToken };
    }
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
    this.generation++;
    this.state.connected = true;

    await this.discoverTools(mcpUrl);
    await this.sendNotification(mcpUrl, "notifications/initialized", {});
  }

  /** Best-effort MCP session termination: DELETE the endpoint with the session id header. */
  private async endSession(): Promise<void> {
    const { sessionId } = this;
    const mcpUrl = this.state.mcpUrl;
    const headers = this.getHeaders();
    this.sessionId = null;
    this.state.sessionId = null;
    if (!sessionId || !mcpUrl) return;

    try {
      await fetch(mcpUrl, { method: "DELETE", headers });
    } catch {
      // Ignore errors ending a session
    }
  }

  async disconnect(): Promise<void> {
    this.lifecycle++;
    this.recovery = null;
    this.lastRecoveryFailure = null;
    this.credentials = null;
    await this.endSession();
    this.state = {
      connected: false,
      authenticated: false,
      sessionId: null,
      accessToken: null,
      mcpUrl: null,
    };
    this._accessToken = null;
    this._tools = [];
  }

  private assertLifecycle(lifecycle: number): void {
    if (lifecycle !== this.lifecycle) {
      throw new NotConnectedError("Disconnected from Notion MCP while reconnecting");
    }
  }

  /** Spends the refresh token; persists the result but keeps working from memory if saving fails. */
  private async refresh(current: StoredConfig, lifecycle: number, notify: NotifyFn): Promise<StoredConfig> {
    if (!current.refreshToken) {
      // Credentials saved before 3.1 carry no refresh token: once rejected they are dead
      await storage.clearIfUnchanged({ accessToken: current.accessToken });
      throw new AuthenticationError("Notion rejected the saved access token and there is no refresh token");
    }

    let tokens: TokenResponse;
    try {
      tokens = await refreshAccessToken(current.refreshToken, current.clientId, current.clientSecret);
    } catch (error) {
      if (error instanceof TokenRefreshRejectedError) {
        await storage.clearIfUnchanged({ refreshToken: current.refreshToken });
      }
      throw error;
    }
    this.assertLifecycle(lifecycle);

    const next: StoredConfig = {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    this.credentials = next;
    try {
      await storage.save(next);
    } catch (error) {
      notify(
        `Refreshed Notion MCP token could not be saved: ${errorMessage(error)}. This session keeps working, but the next one may need /notion again.`,
        "error",
      );
    }
    return next;
  }

  /** Connects with `current`; on a rejected token, refreshes once (unless already refreshed) and retries. */
  private async openSession(
    current: StoredConfig,
    lifecycle: number,
    notify: NotifyFn,
    options: { endPrevious: boolean; refreshed: boolean },
  ): Promise<void> {
    try {
      await this.connectAs(current, lifecycle, options.endPrevious);
    } catch (error) {
      if (options.refreshed || !(error instanceof AuthenticationError)) throw error;
      await this.connectAs(await this.refresh(current, lifecycle, notify), lifecycle, false);
    }
  }

  private async connectAs(current: StoredConfig, lifecycle: number, endPrevious: boolean): Promise<void> {
    this.assertLifecycle(lifecycle);
    if (!endPrevious) {
      // A session being recovered is already dead (expired, or its token rejected): skip the doomed DELETE
      this.sessionId = null;
      this.state.sessionId = null;
    }
    this.credentials = current;
    await this.connect(current.mcpUrl, current.accessToken);
    if (lifecycle !== this.lifecycle) {
      this.credentials = null;
      await this.endSession();
      this.state.connected = false;
      throw new NotConnectedError("Disconnected from Notion MCP while reconnecting");
    }
  }

  /** Waits for, or starts, the reconnect a dropped client needs before it can send. */
  private async ensureReady(notify: NotifyFn): Promise<void> {
    if (this.state.connected) return;
    if (this.recovery) return this.recovery;
    if (!this.credentials) throw new NotConnectedError("Not connected to Notion MCP");
    const failure = this.lastRecoveryFailure;
    if (failure && Date.now() - failure.at < RECOVERY_RETRY_DELAY_MS) throw failure.error;
    return this.startRecovery(false, notify);
  }

  private recoverFrom(
    error: AuthenticationError | SessionExpiredError,
    failedGeneration: number,
    notify: NotifyFn,
  ): Promise<void> {
    // Another caller already replaced the session this request was sent on
    if (failedGeneration !== this.generation && this.state.connected) return Promise.resolve();
    return this.recovery ?? this.startRecovery(error instanceof AuthenticationError, notify);
  }

  private startRecovery(authFailed: boolean, notify: NotifyFn): Promise<void> {
    const recovery: Promise<void> = this.recover(authFailed, notify).finally(() => {
      if (this.recovery === recovery) this.recovery = null;
    });
    this.recovery = recovery;
    return recovery;
  }

  private async recover(authFailed: boolean, notify: NotifyFn): Promise<void> {
    const lifecycle = this.lifecycle;
    const current = this.credentials;
    this.state.connected = false;
    if (authFailed) this.state.authenticated = false;

    try {
      if (!current) throw new NotConnectedError("Not connected to Notion MCP");
      if (!authFailed) {
        await this.openSession(current, lifecycle, notify, { endPrevious: false, refreshed: false });
      } else {
        // Another pi process may already have refreshed (spending the shared refresh token): adopt its tokens
        const saved = await storage.load();
        const adopted =
          saved && saved.mcpUrl === current.mcpUrl && saved.accessToken !== current.accessToken ? saved : null;
        if (adopted) {
          await this.openSession(adopted, lifecycle, notify, { endPrevious: false, refreshed: false });
        } else {
          const refreshed = await this.refresh(current, lifecycle, notify);
          await this.openSession(refreshed, lifecycle, notify, { endPrevious: false, refreshed: true });
        }
      }
      this.lastRecoveryFailure = null;
    } catch (error) {
      if (lifecycle === this.lifecycle) this.lastRecoveryFailure = { at: Date.now(), error };
      throw error;
    }
  }

  /** Sends a request, recovering once from a rejected token or expired session. */
  private async request(
    mcpUrl: string,
    method: string,
    params: Record<string, unknown>,
    notify: NotifyFn,
  ): Promise<unknown> {
    await this.ensureReady(notify);
    const generation = this.generation;
    try {
      return await this.sendRequest(this.state.mcpUrl ?? mcpUrl, method, params);
    } catch (error) {
      if (!(error instanceof AuthenticationError || error instanceof SessionExpiredError)) throw error;
      await this.recoverFrom(error, generation, notify);
      return this.sendRequest(this.state.mcpUrl ?? mcpUrl, method, params);
    }
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
      if (response.status === 401) {
        throw new AuthenticationError(`HTTP ${response.status}: ${errorText}`);
      }
      if (response.status === 404 && this.sessionId) {
        throw new SessionExpiredError(`HTTP ${response.status}: ${errorText}`);
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Capture session ID from response headers
    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
      this.state.sessionId = sessionHeader;
    }

    const contentType = response.headers.get("content-type") || "";
    const data: { result?: unknown; error?: { message: string } } = contentType.includes("text/event-stream")
      ? await this.parseSSEResponse(response)
      : await response.json();

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
      this._tools = toolsFromListResult(await this.sendRequest(mcpUrl, "tools/list", {}));
    } catch {
      this._tools = [];
    }
  }

  async callTool(
    mcpUrl: string,
    name: string,
    args: Record<string, unknown>,
    notify: NotifyFn = noopNotify,
  ): Promise<string> {
    const coerced = coerceNumericProperties(args);
    const result = await this.request(mcpUrl, "tools/call", { name, arguments: coerced }, notify);

    // Format result
    const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
    if (content && Array.isArray(content)) {
      return content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    }
    return JSON.stringify(result);
  }

  /** Checks the session with tools/list, recovering like any request and refreshing the tool cache. */
  async checkConnection(mcpUrl: string, notify: NotifyFn = noopNotify): Promise<boolean> {
    try {
      this._tools = toolsFromListResult(await this.request(mcpUrl, "tools/list", {}, notify));
      return true;
    } catch {
      return false;
    }
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
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
}

function resolveAuthFilePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("~/")) {
    return join(getHomeDir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("~")) {
    return join(getHomeDir(), trimmed.slice(1));
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(process.cwd(), trimmed);
}

function getLegacyAuthFilePath(): string {
  const configDir = join(getHomeDir(), ".pi", "agent", "extensions");
  return join(configDir, "notion-mcp.json");
}

function getDefaultAuthFilePath(): string {
  const configuredPath = process.env[NOTION_MCP_AUTH_FILE_ENV];
  if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
    return resolveAuthFilePath(configuredPath);
  }

  const legacyConfiguredPath = process.env[NOTION_MCP_AUTH_FILE_LEGACY_ENV];
  if (typeof legacyConfiguredPath === "string" && legacyConfiguredPath.trim().length > 0) {
    console.warn("[pi-notion] NOTION_MCP_AUTH is deprecated; use NOTION_MCP_AUTH_FILE.");
    return resolveAuthFilePath(legacyConfiguredPath);
  }

  const agentDir = join(getHomeDir(), ".pi", "agent");
  const legacyDir = join(agentDir, "extensions");
  const nextPath = join(agentDir, "notion-mcp-auth.json");
  const legacyPaths = [join(legacyDir, "notion-mcp-auth.json"), getLegacyAuthFilePath()];

  for (const legacyPath of legacyPaths) {
    if (!existsSync(nextPath) && existsSync(legacyPath)) {
      try {
        mkdirSync(agentDir, { recursive: true });
        renameSync(legacyPath, nextPath);
        console.warn(`[pi-notion] Migrated legacy MCP auth file from ${legacyPath} to ${nextPath}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[pi-notion] Failed to migrate legacy MCP auth file ${legacyPath}: ${message}`);
      }
    }
  }

  return nextPath;
}

class FileTokenStorage {
  private resolvedPath: string | null = null;

  /** Resolved on first use, after the extension has copied --notion-mcp-auth-file into the environment. */
  get path(): string {
    this.resolvedPath ??= getDefaultAuthFilePath();
    return this.resolvedPath;
  }

  set path(value: string) {
    this.resolvedPath = value;
  }

  /** Throws on failure: callers decide whether a lost write (e.g. a rotated refresh token) matters. */
  async save(config: StoredConfig): Promise<void> {
    // Holds the refresh token and client secret
    writePrivateFile(this.path, JSON.stringify(config, null, 2));
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
        unlinkSync(this.path);
      } catch {
        // Ignore
      }
    }
  }

  /** Clears the file only if it still holds these values, so credentials another process just saved survive. */
  async clearIfUnchanged(expected: Partial<Pick<StoredConfig, "accessToken" | "refreshToken">>): Promise<void> {
    const saved = await this.load();
    if (!saved) return;
    const entries = Object.entries(expected) as Array<[keyof StoredConfig, string | undefined]>;
    if (entries.every(([key, value]) => saved[key] === value)) {
      await this.clear();
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
  if (platform === "win32") {
    exec(`start "" "${url}"`);
  } else if (platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function getAuthorizationUrlFilePath(): string {
  return join(getHomeDir(), ".pi", "agent", "notion-oauth-url.txt");
}

/**
 * The authorization URL is too long to copy reliably from a TUI notification,
 * so it is written to a file the user can `cat` (e.g. over SSH).
 */
function announceAuthorizationUrl(authUrl: string, notify: NotifyFn): string | null {
  const path = getAuthorizationUrlFilePath();
  try {
    writePrivateFile(path, `${authUrl}\n`);
  } catch {
    notify(`Open this Notion authorization URL if your browser did not open automatically:\n${authUrl}`);
    return null;
  }
  notify(`Notion OAuth URL saved to ${path}\nCopy it with: cat "${path}"`);
  return path;
}

function shouldUseManualOAuth(args: string | undefined): boolean {
  if (/\bbrowser\b/i.test(args ?? "")) return false;
  if (/\b(headless|manual)\b/i.test(args ?? "")) return true;
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
}

function createUiNotifier(pi: ExtensionAPI): NotifyFn {
  return (message, type = "info") => {
    try {
      pi.events.emit("ui:notify", { message, type });
    } catch {
      console.log(`[pi-notion] ${message}`);
    }
  };
}

function toolResult(tool: string, text: string, details: Record<string, unknown> = {}): ToolExecutionResult {
  return {
    content: [{ type: "text", text }],
    details: { tool, ...details },
  };
}

function toolError(tool: string, text: string, details: Record<string, unknown> = {}): ToolExecutionResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
    details: { tool, ...details },
  };
}

function getConnectionStatusText(client: NotionMCPClient): string {
  const { connected, sessionId, mcpUrl } = client.state;
  const tools = client.getTools();
  const toolList = tools.length > 0 ? `\n\nAvailable tools:\n${tools.map((t) => `- ${t.name}`).join("\n")}` : "";

  return `Notion MCP Status:
- Connected: ${connected ? "Yes" : "No"}
- URL: ${mcpUrl || "None"}
- Session: ${sessionId ? `${sessionId.slice(0, 8)}...` : "None"}
- Tools: ${tools.length} available${toolList}
${!connected ? "\nRun /notion to connect." : ""}`;
}

function getConnectedStatusMessage(client: NotionMCPClient): string {
  const { sessionId, mcpUrl } = client.state;
  const tools = client.getTools();
  return `Connected to Notion MCP
URL: ${mcpUrl}
Session: ${sessionId?.slice(0, 8)}...
Tools: ${tools.length} available`;
}

/** Notifies through the tool call's UI when it has one; pi has no listener for `ui:notify` events. */
function notifierFor(ctx: unknown, fallback: NotifyFn): NotifyFn {
  const uiContext = ctx as { hasUI?: boolean; ui?: { notify?: (message: string, type?: NotifyLevel) => void } };
  const notify = uiContext?.ui?.notify;
  if (!uiContext?.hasUI || typeof notify !== "function") return fallback;
  return (message, type = "info") => notify(message, type);
}

function createRegisteredToolExecutor(
  client: NotionMCPClient,
  mcpUrl: string,
  tool: MCPTool,
  notify: NotifyFn = noopNotify,
): (
  _toolCallId: string,
  params: unknown,
  _signal: AbortSignal,
  _onUpdate: unknown,
  ctx: unknown,
) => Promise<ToolExecutionResult> {
  return async (_toolCallId, params, _signal, _onUpdate, ctx) => {
    try {
      const result = await client.callTool(
        mcpUrl,
        tool.name,
        params as Record<string, unknown>,
        notifierFor(ctx, notify),
      );
      return toolResult(tool.name, result || "", { tool: tool.name });
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof NotConnectedError) {
        return toolError(tool.name, "Not connected to Notion MCP. Run /notion to connect.", {
          tool: tool.name,
          error: message,
        });
      }
      if (error instanceof AuthenticationError || error instanceof TokenRefreshRejectedError) {
        return toolError(
          tool.name,
          `Notion authentication expired or was rejected. Run /notion or notion_mcp_connect to reconnect. Error: ${message}`,
          { tool: tool.name, error: message, authExpired: true },
        );
      }
      return toolError(tool.name, `Error: ${message}`, { tool: tool.name, error: message });
    }
  };
}

interface OAuthConnectionData {
  tokens: TokenResponse;
  registration: ClientRegistration;
}

/**
 * Connects with the saved auth file. Resolves false when there is none or its credentials are
 * dead (the client already cleared them), so the caller starts OAuth. Any other failure is
 * transient: it is rethrown with the credentials kept, rather than sending the user through consent.
 */
async function connectWithSavedConfig(client: NotionMCPClient, notify: NotifyFn): Promise<boolean> {
  const savedConfig = await storage.load();
  if (!savedConfig) return false;

  notify("Connecting to saved Notion MCP...");
  try {
    await client.open(savedConfig, notify);
    return true;
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof TokenRefreshRejectedError) {
      notify(`Saved Notion login expired (${errorMessage(error)}). Signing in again...`, "info");
      return false;
    }
    notify(`Connection failed: ${errorMessage(error)}`, "error");
    throw error;
  }
}

// Headless redirects are never received on this host, so the port only has to avoid servers on the
// approving machine; a random ephemeral port avoids dev servers on common ports such as 3000.
const HEADLESS_REDIRECT_PORT_RANGE = [49152, 65536] as const;

/**
 * Runs OAuth with either the local callback server (browser on this host) or, when `manualInput`
 * is given, a pasted redirect: the user approves on any machine, the loopback redirect fails
 * there, and they paste that URL back.
 */
async function performOAuthConnection(notify: NotifyFn, manualInput?: OAuthInputFn): Promise<OAuthConnectionData> {
  const state = randomBytes(16).toString("hex");
  const callbackServer = manualInput ? null : await startOAuthCallbackServer(3000, state);
  const callbackUrl = buildOAuthCallbackUrl(callbackServer?.port ?? randomInt(...HEADLESS_REDIRECT_PORT_RANGE));

  try {
    notify("Registering OAuth client...");
    const registration = await registerClient(callbackUrl);
    const { codeVerifier, codeChallenge } = createPkceChallenge();
    const authUrl = buildAuthorizationUrl(registration, callbackUrl, codeChallenge, state);
    const savedUrlPath = announceAuthorizationUrl(authUrl, notify);

    let callbackResult: OAuthCallbackResult;
    if (callbackServer) {
      notify("Opening Notion authorization page...");
      await openBrowser(authUrl);
      notify("Waiting for authorization callback...");
      callbackResult = await callbackServer.result;
    } else {
      // pi shows only the latest info notice, so this one repeats the URL rather than pointing back at an earlier one
      notify(
        [
          `Open this URL in a browser on any machine:\n${authUrl}`,
          ...(savedUrlPath ? [`(also saved to ${savedUrlPath})`] : []),
          "After approving, the redirect page will fail to load; paste its full URL here.",
        ].join("\n\n"),
      );
      const pasted = await manualInput?.("Paste the Notion redirect URL", `${callbackUrl}?code=...&state=...`);
      callbackResult = parseManualOAuthCallbackInput(pasted ?? "", state);
    }

    const tokens = await resolveAccessToken(callbackResult, callbackUrl, codeVerifier, registration, notify);
    return { tokens, registration };
  } catch (error) {
    // Otherwise the server keeps the port and its timeout later rejects a promise nobody awaits
    callbackServer?.cancel();
    throw error;
  }
}

async function finalizeConnection(
  client: NotionMCPClient,
  registration: ClientRegistration | null,
  tokens: TokenResponse,
  registerMCPTools: () => void,
  notify: NotifyFn,
): Promise<void> {
  const config: StoredConfig = {
    mcpUrl: NOTION_MCP_URL,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    clientId: registration?.client_id,
    clientSecret: registration?.client_secret,
  };
  notify("Connecting to MCP server...");
  client.useCredentials(config);
  await client.connect(config.mcpUrl, config.accessToken);
  try {
    await storage.save(config);
  } catch (error) {
    notify(
      `Notion MCP credentials could not be saved: ${errorMessage(error)}. You will need /notion again next session.`,
      "error",
    );
  }
  registerMCPTools();
}

async function ensureConnected(
  client: NotionMCPClient,
  registerMCPTools: () => void,
  notify: NotifyFn,
  manualInput?: OAuthInputFn,
): Promise<{ reusedSavedConfig: boolean }> {
  const connectedFromSavedConfig = await connectWithSavedConfig(client, notify);
  if (connectedFromSavedConfig) {
    registerMCPTools();
    return { reusedSavedConfig: true };
  }

  const { tokens, registration } = await performOAuthConnection(notify, manualInput);
  await finalizeConnection(client, registration, tokens, registerMCPTools, notify);
  return { reusedSavedConfig: false };
}

async function disconnectClient(client: NotionMCPClient): Promise<void> {
  await client.disconnect();
  await storage.clear();
}

export {
  AuthenticationError,
  announceAuthorizationUrl,
  buildAuthorizationUrl,
  buildHtmlResponse,
  buildOAuthCallbackUrl,
  coerceNumericProperties,
  coercePropertyMap,
  connectWithSavedConfig,
  createPkceChallenge,
  createRegisteredToolExecutor,
  createUiNotifier,
  disconnectClient,
  ensureConnected,
  FileTokenStorage,
  finalizeConnection,
  getConnectedStatusMessage,
  getConnectionStatusText,
  getDefaultAuthFilePath,
  isNumericString,
  isRecord,
  NotConnectedError,
  NotionMCPClient,
  openBrowser,
  parseManualOAuthCallbackInput,
  refreshAccessToken,
  resolveAccessToken,
  resolveCallbackResult,
  SessionExpiredError,
  shouldUseManualOAuth,
  startOAuthCallbackServer,
  storage,
  TokenRefreshRejectedError,
  toolError,
  toolResult,
};

export default function notionMCPClientExtension(pi: ExtensionAPI) {
  pi.registerFlag("--notion-mcp-auth-file", {
    description: "Path to the persisted Notion MCP auth file.",
    type: "string",
  });
  pi.registerFlag("--notion-mcp-auth", {
    description: "Deprecated alias for --notion-mcp-auth-file.",
    type: "string",
  });

  const authFileFlag = pi.getFlag("--notion-mcp-auth-file");
  const legacyAuthFileFlag = pi.getFlag("--notion-mcp-auth");
  if (typeof authFileFlag === "string" && authFileFlag.trim().length > 0) {
    process.env.NOTION_MCP_AUTH_FILE = authFileFlag;
  } else if (typeof legacyAuthFileFlag === "string" && legacyAuthFileFlag.trim().length > 0) {
    console.warn("[pi-notion] --notion-mcp-auth is deprecated; use --notion-mcp-auth-file.");
    process.env.NOTION_MCP_AUTH_FILE = legacyAuthFileFlag;
  }

  mcpClient = new NotionMCPClient();
  const notify = createUiNotifier(pi);

  // Register dynamic MCP tools after connection
  const registerMCPTools = () => {
    if (!mcpClient?.state.mcpUrl) return;

    const tools = mcpClient.getTools();
    const mcpUrl = mcpClient.state.mcpUrl;
    let added = 0;

    for (const tool of tools) {
      if (pi.getAllTools().find((t) => t.name === tool.name)) continue;
      added++;

      pi.registerTool({
        name: tool.name,
        label: `Notion: ${tool.name.replace(/_/g, " ")}`,
        description: tool.description || `Notion MCP tool: ${tool.name}`,
        parameters: Type.Unsafe(tool.inputSchema),
        execute: createRegisteredToolExecutor(mcpClient, mcpUrl, tool, notify),
      });
    }

    if (added > 0) {
      notify(`Registered ${added} Notion MCP tools!`);
    }
  };

  // /notion command
  pi.registerCommand("notion", {
    description:
      "Connect to Notion MCP, show status, or disconnect. Use /notion headless to paste the OAuth redirect (default over SSH), /notion browser to force the local callback.",
    async handler(args, ctx) {
      if (!mcpClient) {
        ctx.ui.notify("Notion MCP not initialized", "error");
        return;
      }

      if (!mcpClient.state.connected) {
        const uiNotify: NotifyFn = (message, type = "info") => ctx.ui.notify(message, type);
        const manualInput: OAuthInputFn | undefined = shouldUseManualOAuth(args)
          ? (prompt, placeholder) => ctx.ui.input(prompt, placeholder)
          : undefined;
        try {
          await ensureConnected(mcpClient, registerMCPTools, uiNotify, manualInput);
          ctx.ui.notify(`Connected! Session: ${mcpClient.state.sessionId?.slice(0, 8)}...`, "info");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Connection failed: ${message}`, "error");
        }
        return;
      }

      const choice = await ctx.ui.select(getConnectedStatusMessage(mcpClient), ["Disconnect", "Cancel"]);
      if (choice === "Disconnect") {
        await disconnectClient(mcpClient);
        ctx.ui.notify("Disconnected from Notion MCP", "info");
      }
    },
  });

  // Connect tool
  pi.registerTool({
    name: "notion_mcp_connect",
    label: "Notion MCP Connect",
    description: "Connect to Notion via the official MCP server using OAuth",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!mcpClient) {
        return toolError("notion_mcp_connect", "MCP client not initialized");
      }

      const toolNotify = notifierFor(ctx, notify);
      if (mcpClient.state.connected && mcpClient.state.mcpUrl) {
        if (await mcpClient.checkConnection(mcpClient.state.mcpUrl, toolNotify)) {
          registerMCPTools();
          const tools = mcpClient.getTools();
          return toolResult(
            "notion_mcp_connect",
            `Already connected to Notion MCP!\n\n${tools.length} tools available: ${tools.map((t) => t.name).join(", ")}`,
          );
        }
      }

      // Over SSH the local callback can never be reached, so prompt for the pasted redirect when the UI can
      const manualInput: OAuthInputFn | undefined =
        ctx?.hasUI && shouldUseManualOAuth(undefined)
          ? (prompt, placeholder) => ctx.ui.input(prompt, placeholder)
          : undefined;
      try {
        await ensureConnected(mcpClient, registerMCPTools, toolNotify, manualInput);
        const tools = mcpClient.getTools();
        return toolResult(
          "notion_mcp_connect",
          `Connected to Notion MCP!\n\n${tools.length} tools available.\n\nYou can now ask things like:\n- "Search my Notion for meeting notes"\n- "Get page abc123"\n- "Create a page in my workspace"`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError("notion_mcp_connect", `Connection failed: ${message}`, { error: message });
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
        return toolError("notion_mcp_disconnect", "MCP client not initialized");
      }

      await disconnectClient(mcpClient);
      return toolResult("notion_mcp_disconnect", "Disconnected from Notion MCP and cleared config");
    },
  });

  // Status tool
  pi.registerTool({
    name: "notion_mcp_status",
    label: "Notion MCP Status",
    description: "Check connection status to Notion MCP",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!mcpClient) {
        return toolError("notion_mcp_status", "MCP client not initialized");
      }

      if (mcpClient.state.connected && mcpClient.state.mcpUrl) {
        if (await mcpClient.checkConnection(mcpClient.state.mcpUrl, notifierFor(ctx, notify))) {
          registerMCPTools();
        }
      }

      const { connected, sessionId, mcpUrl } = mcpClient.state;
      return toolResult("notion_mcp_status", getConnectionStatusText(mcpClient), {
        connected,
        sessionId,
        mcpUrl,
      });
    },
  });
}

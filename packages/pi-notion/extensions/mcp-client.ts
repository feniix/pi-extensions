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
const HTTP_REQUEST_COMPLETE_MARKER = "\r\n\r\n";
const CALLBACK_PATH_PREFIX = "GET /callback?";

type NotifyLevel = "info" | "error";
type NotifyFn = (message: string, type?: NotifyLevel) => void;

type ToolExecutionResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  details: Record<string, unknown>;
};

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

function buildHtmlResponse(statusLine: string, html: string): string {
  return `${statusLine}\r\nContent-Length: ${html.length}\r\nContent-Type: text/html\r\n\r\n${html}`;
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

async function startOAuthCallbackServer(
  preferredPort: number,
  state: string,
  timeoutMs = 300000,
): Promise<OAuthCallbackServerResult> {
  const port = await lookupPort({ port: preferredPort });

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
): Promise<string> {
  if (callbackResult.error) {
    throw new Error(`Authorization failed: ${callbackResult.error}`);
  }

  if (callbackResult.accessToken) {
    return callbackResult.accessToken;
  }

  if (!callbackResult.code) {
    throw new Error("No authorization code received");
  }

  notify("Exchanging authorization code for token...");
  const tokenResult = await exchangeCodeForToken(
    callbackResult.code,
    callbackUrl,
    codeVerifier,
    registration.client_id,
    registration.client_secret,
  );
  return tokenResult.accessToken;
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
    const coerced = coerceNumericProperties(args);
    const result = await this.sendRequest(mcpUrl, "tools/call", { name, arguments: coerced });

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

function createRegisteredToolExecutor(
  client: NotionMCPClient,
  mcpUrl: string,
  tool: MCPTool,
): (
  _toolCallId: string,
  params: unknown,
  _signal: AbortSignal,
  _onUpdate: unknown,
  _ctx: unknown,
) => Promise<ToolExecutionResult> {
  return async (_toolCallId, params) => {
    if (!client.state.connected) {
      return toolError(tool.name, "Not connected to Notion MCP. Run /notion to connect.", { tool: tool.name });
    }

    try {
      const result = await client.callTool(mcpUrl, tool.name, params as Record<string, unknown>);
      return toolResult(tool.name, result || "", { tool: tool.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(tool.name, `Error: ${message}`, { tool: tool.name, error: message });
    }
  };
}

interface OAuthConnectionData {
  accessToken: string;
  registration: ClientRegistration;
}

async function connectWithSavedConfig(client: NotionMCPClient, notify: NotifyFn): Promise<boolean> {
  const savedConfig = await storage.load();
  if (!savedConfig) return false;

  notify("Connecting to saved Notion MCP...");
  try {
    await client.connect(savedConfig.mcpUrl, savedConfig.accessToken);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(`Connection failed: ${message}`, "error");
    await storage.clear();
    return false;
  }
}

async function performOAuthConnection(notify: NotifyFn): Promise<OAuthConnectionData> {
  const state = randomBytes(16).toString("hex");
  const callbackServer = await startOAuthCallbackServer(3000, state);
  const callbackUrl = `http://localhost:${callbackServer.port}/callback`;

  notify("Registering OAuth client...");
  const registration = await registerClient(callbackUrl);
  const { codeVerifier, codeChallenge } = createPkceChallenge();
  const authUrl = buildAuthorizationUrl(registration, callbackUrl, codeChallenge, state);

  notify("Opening Notion authorization page...");
  await openBrowser(authUrl);
  notify("Waiting for authorization callback...");

  const callbackResult = await callbackServer.result;
  const accessToken = await resolveAccessToken(callbackResult, callbackUrl, codeVerifier, registration, notify);
  return { accessToken, registration };
}

async function finalizeConnection(
  client: NotionMCPClient,
  registration: ClientRegistration | null,
  accessToken: string,
  registerMCPTools: () => void,
  notify: NotifyFn,
): Promise<void> {
  notify("Connecting to MCP server...");
  await client.connect(NOTION_MCP_URL, accessToken);
  await storage.save({
    mcpUrl: NOTION_MCP_URL,
    accessToken,
    clientId: registration?.client_id,
    clientSecret: registration?.client_secret,
  });
  registerMCPTools();
}

async function ensureConnected(
  client: NotionMCPClient,
  registerMCPTools: () => void,
  notify: NotifyFn,
): Promise<{ reusedSavedConfig: boolean }> {
  const connectedFromSavedConfig = await connectWithSavedConfig(client, notify);
  if (connectedFromSavedConfig) {
    registerMCPTools();
    return { reusedSavedConfig: true };
  }

  const { accessToken, registration } = await performOAuthConnection(notify);
  await finalizeConnection(client, registration, accessToken, registerMCPTools, notify);
  return { reusedSavedConfig: false };
}

async function disconnectClient(client: NotionMCPClient): Promise<void> {
  await client.disconnect();
  await storage.clear();
}

export {
  buildAuthorizationUrl,
  buildHtmlResponse,
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
  isNumericString,
  isRecord,
  NotionMCPClient,
  resolveAccessToken,
  resolveCallbackResult,
  startOAuthCallbackServer,
  storage,
  toolError,
  toolResult,
};

export default function notionMCPClientExtension(pi: ExtensionAPI) {
  mcpClient = new NotionMCPClient();
  const notify = createUiNotifier(pi);

  // Register dynamic MCP tools after connection
  const registerMCPTools = () => {
    if (!mcpClient?.state.mcpUrl) return;

    const tools = mcpClient.getTools();
    const mcpUrl = mcpClient.state.mcpUrl;

    for (const tool of tools) {
      if (pi.getAllTools().find((t) => t.name === tool.name)) continue;

      pi.registerTool({
        name: tool.name,
        label: `Notion: ${tool.name.replace(/_/g, " ")}`,
        description: tool.description || `Notion MCP tool: ${tool.name}`,
        parameters: Type.Unsafe(tool.inputSchema),
        execute: createRegisteredToolExecutor(mcpClient, mcpUrl, tool),
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

      if (!mcpClient.state.connected) {
        const uiNotify: NotifyFn = (message, type = "info") => ctx.ui.notify(message, type);
        try {
          await ensureConnected(mcpClient, registerMCPTools, uiNotify);
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
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!mcpClient) {
        return toolError("notion_mcp_connect", "MCP client not initialized");
      }

      if (mcpClient.state.connected) {
        const tools = mcpClient.getTools();
        return toolResult(
          "notion_mcp_connect",
          `Already connected to Notion MCP!\n\n${tools.length} tools available: ${tools.map((t) => t.name).join(", ")}`,
        );
      }

      try {
        await ensureConnected(mcpClient, registerMCPTools, notify);
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
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      if (!mcpClient) {
        return toolError("notion_mcp_status", "MCP client not initialized");
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

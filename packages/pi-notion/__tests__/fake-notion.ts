import { vi } from "vitest";

export const MCP_URL = "https://mcp.notion.com/mcp";
const TOKEN_URL = "https://mcp.notion.com/token";
const REGISTER_URL = "https://mcp.notion.com/register";

interface IssuedTokens {
  access: string;
  refresh: string;
  expiresIn?: number;
}

interface JsonRpcMessage {
  id?: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/**
 * In-memory stand-in for Notion's MCP server and OAuth endpoints. Access tokens and
 * sessions can be invalidated to simulate expiry; refresh tokens rotate on use.
 */
export function createFakeNotion() {
  const state = {
    validAccessTokens: new Set<string>(),
    /** refresh token -> tokens issued when it is used (single use, like a rotating refresh token) */
    refreshGrants: new Map<string, IssuedTokens>(),
    sessions: new Set<string>(),
    tools: [{ name: "notion-search", description: "Search", inputSchema: {} }],
    /** Overrides the token endpoint, e.g. a 5xx outage */
    tokenEndpointFailure: null as { status: number; body: unknown } | null,
    /** Make MCP POSTs fail with a network error */
    mcpUnreachable: false,
    initializeFailure: null as { status: number } | null,
    tokenRequests: 0,
    registerRequests: 0,
    initializes: 0,
    deletes: [] as string[],
    notifications: [] as string[],
    toolCalls: [] as Array<{ name?: string; token: string }>,
    nextSession: 1,
  };

  const gates = new Map<string, Promise<void>>();
  /** Hold the next request matching `key` ("token" or a tools/call `query` value) until released. */
  function gate(key: string): () => void {
    let release = () => {};
    gates.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => release();
  }

  async function waitForGate(key: string) {
    const pending = gates.get(key);
    if (pending) {
      gates.delete(key);
      await pending;
    }
  }

  function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  async function handleToken(body: URLSearchParams): Promise<Response> {
    state.tokenRequests++;
    await waitForGate("token");
    if (state.tokenEndpointFailure) {
      return json(state.tokenEndpointFailure.body, state.tokenEndpointFailure.status);
    }
    const refreshToken = body.get("refresh_token") ?? "";
    const grant = state.refreshGrants.get(refreshToken);
    if (body.get("grant_type") !== "refresh_token" || !grant) return json({ error: "invalid_grant" }, 400);
    state.refreshGrants.delete(refreshToken);
    state.validAccessTokens.add(grant.access);
    return json({ access_token: grant.access, refresh_token: grant.refresh, expires_in: grant.expiresIn });
  }

  async function handleMcp(init: RequestInit): Promise<Response> {
    const headers = (init.headers ?? {}) as Record<string, string>;
    // Headers are captured when the request is sent, like a real in-flight request
    const token = (headers.Authorization ?? "").replace(/^Bearer /, "");
    const sessionId = headers["MCP-Session-Id"];

    if (init.method === "DELETE") {
      state.deletes.push(sessionId ?? "");
      if (sessionId) state.sessions.delete(sessionId);
      return json({});
    }

    const message = JSON.parse(String(init.body)) as JsonRpcMessage;
    if (message.method === "tools/call") {
      await waitForGate(String(message.params?.arguments?.query ?? ""));
    }
    if (state.mcpUnreachable) throw new TypeError("fetch failed");
    if (!state.validAccessTokens.has(token)) return json({ error: "invalid_token" }, 401);

    if (message.id === undefined) {
      state.notifications.push(message.method);
      return new Response(null, { status: 202 });
    }

    if (message.method === "initialize") {
      state.initializes++;
      if (state.initializeFailure) return json({ error: "unavailable" }, state.initializeFailure.status);
      const newSession = `session-${state.nextSession++}`;
      state.sessions.add(newSession);
      return json({ jsonrpc: "2.0", id: message.id, result: {} }, 200, { "mcp-session-id": newSession });
    }

    if (!sessionId || !state.sessions.has(sessionId)) return json({ error: "session not found" }, 404);

    if (message.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: message.id, result: { tools: state.tools } });
    }
    if (message.method === "tools/call") {
      state.toolCalls.push({ name: message.params?.name, token });
      return json({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "done" }] } });
    }
    return json({ jsonrpc: "2.0", id: message.id, error: { message: `unknown method ${message.method}` } });
  }

  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    if (url === TOKEN_URL) return handleToken(new URLSearchParams(String(init.body)));
    if (url === REGISTER_URL) {
      state.registerRequests++;
      return json({ client_id: "registered-client" });
    }
    if (url === MCP_URL) return handleMcp(init);
    throw new Error(`unexpected fetch ${url}`);
  });

  /** Issue an access token plus a refresh token that yields `next` when used. */
  function issue(access: string, refresh: string, next?: IssuedTokens) {
    state.validAccessTokens.add(access);
    if (next) state.refreshGrants.set(refresh, next);
  }

  function expire(access: string) {
    state.validAccessTokens.delete(access);
  }

  function dropSessions() {
    state.sessions.clear();
  }

  return { state, fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch, gate, issue, expire, dropSessions };
}

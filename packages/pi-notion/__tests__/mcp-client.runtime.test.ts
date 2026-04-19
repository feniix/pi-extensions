import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  buildHtmlResponse,
  coerceNumericProperties,
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
  NotionMCPClient,
  resolveAccessToken,
  resolveCallbackResult,
  startOAuthCallbackServer,
  storage,
  toolError,
  toolResult,
} from "../extensions/mcp-client.js";

describe("pi-notion mcp client runtime helpers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds an HTML response with headers", () => {
    const html = "<html>ok</html>";
    const response = buildHtmlResponse("HTTP/1.1 200 OK", html);
    expect(response).toContain("HTTP/1.1 200 OK");
    expect(response).toContain("Content-Length");
    expect(response).toContain(html);
  });

  it("resolves callback results for success and failure paths", () => {
    const mismatch = resolveCallbackResult(new URLSearchParams("state=bad"), "expected");
    expect(mismatch.result.error).toBe("State mismatch");

    const error = resolveCallbackResult(
      new URLSearchParams("state=expected&error=denied&error_description=nope"),
      "expected",
    );
    expect(error.result.error).toBe("denied");
    expect(error.result.errorDescription).toBe("nope");

    const token = resolveCallbackResult(new URLSearchParams("state=expected&access_token=token-123"), "expected");
    expect(token.result.accessToken).toBe("token-123");

    const code = resolveCallbackResult(new URLSearchParams("state=expected&code=code-123"), "expected");
    expect(code.result.code).toBe("code-123");
  });

  it("creates a PKCE challenge pair and authorization URL", () => {
    const { codeVerifier, codeChallenge } = createPkceChallenge();
    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();

    const url = buildAuthorizationUrl(
      { client_id: "client-1" },
      "http://localhost:3333/callback",
      codeChallenge,
      "state-1",
    );
    expect(url).toContain("client_id=client-1");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("prompt=consent");
  });

  it("coerces numeric properties recursively", () => {
    const coerced = coerceNumericProperties({
      properties: {
        limit: "5",
        nested: { value: "3" },
      },
      list: ["1", { properties: { count: "2" } }],
    }) as {
      properties: { limit: number; nested: { value: string } };
      list: Array<string | { properties: { count: number } }>;
    };

    expect(coerced.properties.limit).toBe(5);
    expect(coerced.properties.nested.value).toBe("3");
    expect(coerced.list[0]).toBe("1");
    expect((coerced.list[1] as { properties: { count: number } }).properties.count).toBe(2);
  });

  it("formats tool success and error results", () => {
    expect(toolResult("demo", "ok")).toEqual({
      content: [{ type: "text", text: "ok" }],
      details: { tool: "demo" },
    });
    expect(toolError("demo", "bad")).toEqual({
      content: [{ type: "text", text: "bad" }],
      isError: true,
      details: { tool: "demo" },
    });
  });

  it("connects, discovers tools, formats status, and calls tools", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json", "mcp-session-id": "session-12345678" }),
        json: async () => ({ result: { ok: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: { tools: [{ name: "notion-search", description: "Search", inputSchema: {} }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ result: { content: [{ type: "text", text: "hello" }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "",
      });

    global.fetch = fetchMock as typeof fetch;

    const client = new NotionMCPClient();
    await client.connect("https://mcp.notion.com/mcp", "token-123");

    expect(client.state.connected).toBe(true);
    expect(client.getTools()).toHaveLength(1);
    expect(getConnectionStatusText(client)).toContain("Connected: Yes");
    expect(getConnectedStatusMessage(client)).toContain("Connected to Notion MCP");

    const result = await client.callTool("https://mcp.notion.com/mcp", "notion-search", { properties: { count: "2" } });
    expect(result).toContain("hello");
    expect(fetchMock).toHaveBeenCalledWith("https://mcp.notion.com/mcp", expect.objectContaining({ method: "POST" }));

    await client.disconnect();
    expect(client.state.connected).toBe(false);
  });

  it("handles SSE responses and request errors", async () => {
    const client = new NotionMCPClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream", "mcp-session-id": "session-sse" }),
        text: async () => 'data: {"result":{"ok":true}}\n',
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: async () => 'data: {"result":{"tools":[]}}\n',
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: async () => 'data: {"result":{"content":[{"type":"text","text":"from sse"}]}}\n',
      });
    global.fetch = fetchMock as typeof fetch;

    await client.connect("https://mcp.notion.com/mcp", "token-123");
    const result = await client.callTool("https://mcp.notion.com/mcp", "demo", {});
    expect(result).toContain("from sse");

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "boom",
    }) as typeof fetch;
    await expect(client.callTool("https://mcp.notion.com/mcp", "demo", {})).rejects.toThrow("HTTP 500: boom");
  });

  it("resolves access tokens from direct callbacks and code exchanges", async () => {
    const notify = vi.fn();
    expect(
      await resolveAccessToken(
        { accessToken: "direct-token" },
        "http://localhost/callback",
        "verifier",
        { client_id: "client" },
        notify,
      ),
    ).toBe("direct-token");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ access_token: "exchanged-token" }),
    }) as typeof fetch;

    expect(
      await resolveAccessToken(
        { code: "code-123" },
        "http://localhost/callback",
        "verifier",
        { client_id: "client" },
        notify,
      ),
    ).toBe("exchanged-token");
    expect(notify).toHaveBeenCalledWith("Exchanging authorization code for token...");

    await expect(
      resolveAccessToken({ error: "denied" }, "http://localhost/callback", "verifier", { client_id: "client" }, notify),
    ).rejects.toThrow("Authorization failed: denied");
  });

  it("creates registered tool executors for connected and disconnected clients", async () => {
    const disconnectedClient = new NotionMCPClient();
    const disconnectedExecute = createRegisteredToolExecutor(disconnectedClient, "https://mcp.notion.com/mcp", {
      name: "notion-search",
      description: "Search",
      inputSchema: {},
    });
    const disconnectedResult = await disconnectedExecute("id", {}, new AbortController().signal, undefined, undefined);
    expect(disconnectedResult.isError).toBe(true);

    const connectedClient = new NotionMCPClient();
    connectedClient.state.connected = true;
    vi.spyOn(connectedClient, "callTool").mockResolvedValue("done");
    const execute = createRegisteredToolExecutor(connectedClient, "https://mcp.notion.com/mcp", {
      name: "notion-search",
      description: "Search",
      inputSchema: {},
    });
    const success = await execute("id", { query: "docs" }, new AbortController().signal, undefined, undefined);
    expect(success.content[0]?.text).toBe("done");
  });

  it("resolves auth file path from environment when configured", () => {
    const original = process.env.NOTION_MCP_AUTH_FILE;
    process.env.NOTION_MCP_AUTH_FILE = "~/custom-notion-auth.json";

    try {
      expect(getDefaultAuthFilePath()).toContain("custom-notion-auth.json");
    } finally {
      if (original) process.env.NOTION_MCP_AUTH_FILE = original;
      else delete process.env.NOTION_MCP_AUTH_FILE;
    }
  });

  it("saves and clears config files with file token storage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-notion-mcp-storage-"));
    const tokenStorage = new FileTokenStorage();
    (tokenStorage as unknown as { path: string }).path = join(dir, "notion-mcp-auth.json");

    await tokenStorage.save({ mcpUrl: "https://mcp.notion.com/mcp", accessToken: "token-123" });
    expect(existsSync(join(dir, "notion-mcp-auth.json"))).toBe(true);
    expect(await tokenStorage.load()).toMatchObject({ accessToken: "token-123" });
    await tokenStorage.clear();
    expect(await tokenStorage.load()).toBeNull();
  });

  it("creates UI notifiers and connection helpers", async () => {
    const emit = vi.fn();
    const notify = createUiNotifier({
      events: { emit },
    } as unknown as import("@mariozechner/pi-coding-agent").ExtensionAPI);
    notify("hello");
    expect(emit).toHaveBeenCalledWith("ui:notify", { message: "hello", type: "info" });

    const client = new NotionMCPClient();
    vi.spyOn(storage, "load").mockResolvedValueOnce({ mcpUrl: "https://mcp.notion.com/mcp", accessToken: "token-123" });
    vi.spyOn(client, "connect").mockResolvedValueOnce();
    expect(await connectWithSavedConfig(client, vi.fn())).toBe(true);

    const disconnected = new NotionMCPClient();
    disconnected.state.connected = true;
    vi.spyOn(disconnected, "disconnect").mockResolvedValueOnce();
    const clearSpy = vi.spyOn(storage, "clear").mockResolvedValueOnce();
    await disconnectClient(disconnected);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("finalizes and ensures connections", async () => {
    const client = new NotionMCPClient();
    vi.spyOn(client, "connect").mockResolvedValue();
    const saveSpy = vi.spyOn(storage, "save").mockResolvedValue();
    const registerTools = vi.fn();
    await finalizeConnection(
      client,
      { client_id: "client-1", client_secret: "secret-1" },
      "token-123",
      registerTools,
      vi.fn(),
    );
    expect(saveSpy).toHaveBeenCalled();
    expect(registerTools).toHaveBeenCalled();

    const reuseClient = new NotionMCPClient();
    const savedSpy = vi
      .spyOn(storage, "load")
      .mockResolvedValueOnce({ mcpUrl: "https://mcp.notion.com/mcp", accessToken: "token-123" });
    vi.spyOn(reuseClient, "connect").mockResolvedValueOnce();
    const reused = await ensureConnected(reuseClient, vi.fn(), vi.fn());
    expect(reused).toEqual({ reusedSavedConfig: true });
    expect(savedSpy).toHaveBeenCalled();
  });

  it("runs an OAuth callback server and resolves callback results", async () => {
    const state = "state-123";
    const server = await startOAuthCallbackServer(4300, state, 5000);

    await fetch(`http://127.0.0.1:${server.port}/callback?state=${state}&code=auth-code`);
    await expect(server.result).resolves.toEqual({ code: "auth-code" });
  });
});

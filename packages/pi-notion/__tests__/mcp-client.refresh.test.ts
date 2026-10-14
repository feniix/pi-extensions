import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import notionMCPClientExtension, {
  AuthenticationError,
  connectWithSavedConfig,
  createRegisteredToolExecutor,
  finalizeConnection,
  NotionMCPClient,
  refreshAccessToken,
  resolveAccessToken,
  storage,
} from "../extensions/mcp-client.js";

const MCP_URL = "https://mcp.notion.com/mcp";
const TOOL = { name: "notion-search", description: "Search", inputSchema: {} };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function runExecutor(client: NotionMCPClient) {
  const execute = createRegisteredToolExecutor(client, MCP_URL, TOOL);
  return execute("id", { query: "docs" }, new AbortController().signal, undefined, undefined);
}

describe("pi-notion MCP token refresh", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The module-level storage points at the real auth file; never write or delete it from tests
    vi.spyOn(storage, "save").mockResolvedValue();
    vi.spyOn(storage, "clear").mockResolvedValue();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps refresh token and expiry from the code exchange", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }),
      ) as typeof fetch;

    const tokens = await resolveAccessToken(
      { code: "code-1" },
      "http://127.0.0.1/callback",
      "verifier",
      { client_id: "client" },
      vi.fn(),
    );

    expect(tokens).toEqual({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1_000_000 + 3_600_000 });
  });

  it("leaves expiry unknown when the server omits expires_in", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "access-1" })) as typeof fetch;

    const tokens = await resolveAccessToken(
      { code: "code-1" },
      "http://127.0.0.1/callback",
      "verifier",
      { client_id: "client" },
      vi.fn(),
    );

    expect(tokens).toEqual({ accessToken: "access-1", refreshToken: undefined, expiresAt: undefined });
  });

  it("refreshes with the refresh_token grant and keeps the old refresh token when not rotated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "access-2" }));
    global.fetch = fetchMock as typeof fetch;

    const tokens = await refreshAccessToken("refresh-1", "client", "secret");

    expect(tokens).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-1" });
    const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("client");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("rejects refresh without a saved client id or on a failed response", async () => {
    await expect(refreshAccessToken("refresh-1", undefined)).rejects.toThrow("without a saved client id");

    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch;
    await expect(refreshAccessToken("refresh-1", "client")).rejects.toThrow("Token refresh failed: 400");
  });

  it("raises AuthenticationError for HTTP 401 responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_token" }, 401)) as typeof fetch;
    const client = new NotionMCPClient();

    await expect(client.callTool(MCP_URL, "demo", {})).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("saves refresh token and expiry when finalizing a connection", async () => {
    const client = new NotionMCPClient();
    vi.spyOn(client, "connect").mockResolvedValue();
    const saveSpy = vi.spyOn(storage, "save").mockResolvedValue();

    await finalizeConnection(
      client,
      { client_id: "client-1", client_secret: "secret-1" },
      { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 42 },
      vi.fn(),
      vi.fn(),
    );

    expect(saveSpy).toHaveBeenCalledWith({
      mcpUrl: MCP_URL,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: 42,
      clientId: "client-1",
      clientSecret: "secret-1",
    });
  });

  it("refreshes a saved token that is about to expire before connecting", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.spyOn(storage, "load").mockResolvedValueOnce({
      mcpUrl: MCP_URL,
      accessToken: "stale",
      refreshToken: "refresh-1",
      expiresAt: 1_000_000 + 60_000,
      clientId: "client",
    });
    const saveSpy = vi.spyOn(storage, "save").mockResolvedValue();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh", expires_in: 3600 })) as typeof fetch;
    const client = new NotionMCPClient();
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();

    expect(await connectWithSavedConfig(client, vi.fn())).toBe(true);
    expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "fresh");
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fresh", refreshToken: "refresh-1", expiresAt: 1_000_000 + 3_600_000 }),
    );
  });

  it("does not refresh a saved token that is still valid", async () => {
    vi.spyOn(storage, "load").mockResolvedValueOnce({
      mcpUrl: MCP_URL,
      accessToken: "valid",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
      clientId: "client",
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    const client = new NotionMCPClient();
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();

    expect(await connectWithSavedConfig(client, vi.fn())).toBe(true);
    expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces a refresh when the saved token is rejected and retries the connection", async () => {
    vi.spyOn(storage, "load").mockResolvedValue({
      mcpUrl: MCP_URL,
      accessToken: "revoked",
      refreshToken: "refresh-1",
      clientId: "client",
    });
    vi.spyOn(storage, "save").mockResolvedValue();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh" })) as typeof fetch;
    const client = new NotionMCPClient();
    const connectSpy = vi
      .spyOn(client, "connect")
      .mockRejectedValueOnce(new AuthenticationError("HTTP 401: invalid_token"))
      .mockResolvedValueOnce();

    expect(await connectWithSavedConfig(client, vi.fn())).toBe(true);
    expect(connectSpy).toHaveBeenLastCalledWith(MCP_URL, "fresh");
  });

  it("keeps saved credentials when connecting with them fails", async () => {
    vi.spyOn(storage, "load").mockResolvedValueOnce({ mcpUrl: MCP_URL, accessToken: "token" });
    const clearSpy = vi.spyOn(storage, "clear").mockResolvedValue();
    const notify = vi.fn();
    const client = new NotionMCPClient();
    vi.spyOn(client, "connect").mockRejectedValueOnce(new Error("network down"));

    expect(await connectWithSavedConfig(client, notify)).toBe(false);
    expect(notify).toHaveBeenCalledWith("Connection failed: network down", "error");
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("refreshes, reconnects, and retries a tool call rejected with 401", async () => {
    vi.spyOn(storage, "load").mockResolvedValue({
      mcpUrl: MCP_URL,
      accessToken: "expired",
      refreshToken: "refresh-1",
      clientId: "client",
    });
    vi.spyOn(storage, "save").mockResolvedValue();
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh" })) as typeof fetch;
    const client = new NotionMCPClient();
    client.state.connected = true;
    client.state.accessToken = "expired";
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();
    vi.spyOn(client, "callTool")
      .mockRejectedValueOnce(new AuthenticationError("HTTP 401: invalid_token"))
      .mockResolvedValueOnce("done");

    const result = await runExecutor(client);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("done");
    expect(result.details).toMatchObject({ retriedAfterRefresh: true });
    expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "fresh");
  });

  it("asks the user to reconnect when a 401 cannot be refreshed", async () => {
    vi.spyOn(storage, "load").mockResolvedValue({ mcpUrl: MCP_URL, accessToken: "expired" });
    const client = new NotionMCPClient();
    client.state.connected = true;
    client.state.accessToken = "expired";
    vi.spyOn(client, "callTool").mockRejectedValueOnce(new AuthenticationError("HTTP 401: invalid_token"));

    const result = await runExecutor(client);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Run /notion or notion_mcp_connect to reconnect");
    expect(result.details).toMatchObject({ authExpired: true });
    expect(client.state.connected).toBe(false);
  });

  it("reports both errors when the refresh itself fails", async () => {
    vi.spyOn(storage, "load").mockResolvedValue({
      mcpUrl: MCP_URL,
      accessToken: "expired",
      refreshToken: "refresh-1",
      clientId: "client",
    });
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch;
    const client = new NotionMCPClient();
    client.state.connected = true;
    client.state.accessToken = "expired";
    vi.spyOn(client, "callTool").mockRejectedValueOnce(new AuthenticationError("HTTP 401: invalid_token"));

    const result = await runExecutor(client);

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ authExpired: true });
    expect(String(result.details.refreshError)).toContain("Token refresh failed: 400");
  });

  it("marks the client disconnected when a liveness check is rejected with 401", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_token" }, 401)) as typeof fetch;
    const client = new NotionMCPClient();
    client.state.connected = true;
    client.state.authenticated = true;

    expect(await client.checkConnection(MCP_URL)).toBe(false);
    expect(client.state.connected).toBe(false);
    expect(client.state.authenticated).toBe(false);
  });

  it("keeps the client connected when a liveness check fails for a non-auth reason", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch;
    const client = new NotionMCPClient();
    client.state.connected = true;

    expect(await client.checkConnection(MCP_URL)).toBe(false);
    expect(client.state.connected).toBe(true);
  });

  it("reconnects through notion_mcp_connect when the existing session is no longer accepted", async () => {
    const mockPi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => undefined),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => []),
      events: { emit: vi.fn() },
    };
    notionMCPClientExtension(mockPi as never);
    const connectTool = mockPi.registerTool.mock.calls
      .map(([tool]) => tool)
      .find((tool) => tool.name === "notion_mcp_connect");

    vi.spyOn(NotionMCPClient.prototype, "checkConnection").mockImplementation(async function (this: NotionMCPClient) {
      this.state.connected = false;
      return false;
    });
    vi.spyOn(storage, "load").mockResolvedValue({ mcpUrl: MCP_URL, accessToken: "token" });
    const connectSpy = vi.spyOn(NotionMCPClient.prototype, "connect").mockImplementation(async function (
      this: NotionMCPClient,
      mcpUrl: string,
    ) {
      this.state.connected = true;
      this.state.mcpUrl = mcpUrl;
    });

    // First call establishes a connection; second call finds it stale and reconnects.
    await connectTool.execute("id", {}, new AbortController().signal, undefined, undefined);
    const result = await connectTool.execute("id", {}, new AbortController().signal, undefined, undefined);

    expect(result.content[0].text).toContain("Connected to Notion MCP!");
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });
});

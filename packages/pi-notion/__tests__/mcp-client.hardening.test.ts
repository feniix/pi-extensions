import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import notionMCPClientExtension, {
  AuthenticationError,
  connectWithSavedConfig,
  createRegisteredToolExecutor,
  ensureConnected,
  FileTokenStorage,
  NotionMCPClient,
  parseManualOAuthCallbackInput,
  refreshAccessToken,
  SessionExpiredError,
  storage,
  TokenRefreshRejectedError,
} from "../extensions/mcp-client.js";
import { isNearExpiry, TOKEN_REFRESH_SKEW_MS } from "../extensions/token-expiry.js";

vi.mock("node:child_process", () => ({ exec: vi.fn() }));

const MCP_URL = "https://mcp.notion.com/mcp";
const TOOL = { name: "notion-search", description: "Search", inputSchema: {} };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function runExecutor(client: NotionMCPClient, notify = vi.fn()) {
  const execute = createRegisteredToolExecutor(client, MCP_URL, TOOL, notify);
  return execute("id", { query: "docs" }, new AbortController().signal, undefined, undefined);
}

function connectedClient(accessToken = "expired"): NotionMCPClient {
  const client = new NotionMCPClient();
  client.state.connected = true;
  client.state.accessToken = accessToken;
  client.state.mcpUrl = MCP_URL;
  return client;
}

describe("pi-notion MCP auth hardening", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalSshConnection = process.env.SSH_CONNECTION;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The module-level storage points at the real auth file; never write or delete it from tests
    vi.spyOn(storage, "save").mockResolvedValue();
    vi.spyOn(storage, "clear").mockResolvedValue();
    process.env.HOME = mkdtempSync(join(tmpdir(), "pi-notion-hardening-"));
    delete process.env.SSH_CONNECTION;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
    if (originalSshConnection === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = originalSshConnection;
  });

  describe("tool executor", () => {
    it("restores a dropped session from saved config instead of failing as not connected", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({ mcpUrl: MCP_URL, accessToken: "saved" });
      const client = new NotionMCPClient();
      const connectSpy = vi.spyOn(client, "connect").mockImplementation(async function (this: NotionMCPClient) {
        this.state.connected = true;
      });
      vi.spyOn(client, "callTool").mockResolvedValue("done");

      const result = await runExecutor(client);

      expect(result.content[0]?.text).toBe("done");
      expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "saved");
    });

    it("still reports not connected when there is no saved config", async () => {
      vi.spyOn(storage, "load").mockResolvedValue(null);

      const result = await runExecutor(new NotionMCPClient());

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Not connected to Notion MCP");
    });

    it("reports the retried tool's own error after a successful refresh", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "expired",
        refreshToken: "refresh-1",
        clientId: "client",
      });
      vi.spyOn(storage, "save").mockResolvedValue();
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh" })) as typeof fetch;
      const client = connectedClient();
      vi.spyOn(client, "connect").mockResolvedValue();
      vi.spyOn(client, "callTool")
        .mockRejectedValueOnce(new AuthenticationError("HTTP 401"))
        .mockRejectedValueOnce(new Error("MCP Error: object not found"));

      const result = await runExecutor(client);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("Error: MCP Error: object not found");
      expect(result.details).toMatchObject({ retriedAfterRefresh: true });
      expect(result.details).not.toHaveProperty("authExpired");
    });

    it("reconnects once for concurrent 401s, and calls made meanwhile wait for it", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "expired",
        refreshToken: "refresh-1",
        clientId: "client",
      });
      vi.spyOn(storage, "save").mockResolvedValue();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh", refresh_token: "refresh-2" }));
      global.fetch = fetchMock as typeof fetch;
      const client = connectedClient();
      // Whichever call starts the shared reconnect, the expired token is refused and refreshed exactly once.
      const connectSpy = vi.spyOn(client, "connect").mockImplementation(async function (
        this: NotionMCPClient,
        _url: string,
        token: string,
      ) {
        if (token === "expired") throw new AuthenticationError("HTTP 401");
        this.state.accessToken = token;
        this.state.connected = true;
      });
      vi.spyOn(client, "callTool")
        .mockRejectedValueOnce(new AuthenticationError("HTTP 401"))
        .mockRejectedValueOnce(new AuthenticationError("HTTP 401"))
        .mockResolvedValue("done");

      const first = runExecutor(client);
      const second = runExecutor(client);
      await Promise.resolve();
      // A third call arriving while the session is down waits for the shared reconnect.
      const third = runExecutor(client);
      const results = await Promise.all([first, second, third]);

      expect(results.map((r) => r.content[0]?.text)).toEqual(["done", "done", "done"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(connectSpy.mock.calls.filter(([, token]) => token === "fresh")).toHaveLength(1);
    });

    it("reuses a token another pi process already refreshed instead of refreshing again", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "refreshed-elsewhere",
        refreshToken: "refresh-2",
        clientId: "client",
      });
      const fetchMock = vi.fn();
      global.fetch = fetchMock as typeof fetch;
      const client = connectedClient("stale-in-memory");
      const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();
      vi.spyOn(client, "callTool").mockRejectedValueOnce(new AuthenticationError("HTTP 401")).mockResolvedValue("done");

      const result = await runExecutor(client);

      expect(result.content[0]?.text).toBe("done");
      expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "refreshed-elsewhere");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reconnects with the same token when the server expired the MCP session", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "valid",
        refreshToken: "refresh-1",
        clientId: "client",
      });
      const fetchMock = vi.fn();
      global.fetch = fetchMock as typeof fetch;
      const client = connectedClient("valid");
      const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();
      vi.spyOn(client, "callTool").mockRejectedValueOnce(new SessionExpiredError("HTTP 404")).mockResolvedValue("done");

      const result = await runExecutor(client);

      expect(result.content[0]?.text).toBe("done");
      expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "valid");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("token responses and storage", () => {
    it("rejects a token response without an access token", async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ token_type: "bearer" })) as typeof fetch;

      await expect(refreshAccessToken("refresh-1", "client")).rejects.toThrow("did not include an access_token");
    });

    it("classifies invalid_grant as a definitive refresh rejection and 5xx as transient", async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch;
      await expect(refreshAccessToken("refresh-1", "client")).rejects.toBeInstanceOf(TokenRefreshRejectedError);

      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "server_error" }, 503)) as typeof fetch;
      const transient = await refreshAccessToken("refresh-1", "client").catch((error: unknown) => error);
      expect(transient).toBeInstanceOf(Error);
      expect(transient).not.toBeInstanceOf(TokenRefreshRejectedError);
    });

    it("writes the auth file readable only by the owner", async () => {
      const path = join(process.env.HOME as string, "auth.json");
      const tokenStorage = new FileTokenStorage();
      (tokenStorage as unknown as { path: string }).path = path;

      await tokenStorage.save({ mcpUrl: MCP_URL, accessToken: "a", refreshToken: "r" });

      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({ refreshToken: "r" });
    });

    it("fails the save instead of swallowing write errors", async () => {
      const tokenStorage = new FileTokenStorage();
      (tokenStorage as unknown as { path: string }).path = "/dev/null/auth.json";

      await expect(tokenStorage.save({ mcpUrl: MCP_URL, accessToken: "a" })).rejects.toThrow();
    });

    it("shares the near-expiry rule with the legacy OAuth helper", () => {
      expect(isNearExpiry(undefined, 0)).toBe(false);
      expect(isNearExpiry(10 * 60 * 1000, 0)).toBe(false);
      expect(isNearExpiry(TOKEN_REFRESH_SKEW_MS, 0)).toBe(true);
    });
  });

  describe("connectWithSavedConfig", () => {
    it("warns but keeps the new session when the refreshed token cannot be saved", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "stale",
        refreshToken: "refresh-1",
        expiresAt: Date.now(),
        clientId: "client",
      });
      vi.spyOn(storage, "save").mockRejectedValue(new Error("EACCES"));
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: "fresh" })) as typeof fetch;
      const client = new NotionMCPClient();
      const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();
      const notify = vi.fn();

      expect(await connectWithSavedConfig(client, notify)).toBe(true);
      expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "fresh");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("could not be saved: EACCES"), "error");
    });

    it("falls back to the still-valid token when a proactive refresh fails transiently", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "still-valid",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 60_000,
        clientId: "client",
      });
      const clearSpy = vi.spyOn(storage, "clear").mockResolvedValue();
      global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as typeof fetch;
      const client = new NotionMCPClient();
      const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();

      expect(await connectWithSavedConfig(client, vi.fn())).toBe(true);
      expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "still-valid");
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it("clears saved credentials when Notion rejects the refresh token", async () => {
      vi.spyOn(storage, "load").mockResolvedValue({
        mcpUrl: MCP_URL,
        accessToken: "revoked",
        refreshToken: "revoked-refresh",
        clientId: "client",
      });
      const clearSpy = vi.spyOn(storage, "clear").mockResolvedValue();
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch;
      const client = new NotionMCPClient();
      vi.spyOn(client, "connect").mockRejectedValue(new AuthenticationError("HTTP 401"));

      expect(await connectWithSavedConfig(client, vi.fn())).toBe(false);
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe("MCP client session handling", () => {
    it("ends the previous MCP session and clears its id before reconnecting", async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return jsonResponse({});
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.method === "initialize") return jsonResponse({ result: {} }, 200, { "mcp-session-id": "new-session" });
        return jsonResponse({ result: { tools: [] } });
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const client = new NotionMCPClient();
      (client as unknown as { sessionId: string }).sessionId = "old-session";
      client.state.sessionId = "old-session";
      client.state.mcpUrl = MCP_URL;

      await client.connect(MCP_URL, "token");

      const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(deleteCall?.[0]).toBe(MCP_URL);
      expect((deleteCall?.[1]?.headers as Record<string, string>)["MCP-Session-Id"]).toBe("old-session");
      const initCall = fetchMock.mock.calls.find(([, init]) => String(init?.body).includes('"initialize"'));
      expect((initCall?.[1]?.headers as Record<string, string>)["MCP-Session-Id"]).toBeUndefined();
      expect(client.state.sessionId).toBe("new-session");
    });

    it("treats HTTP 404 on an established session as an expired session", async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: "session not found" }, 404)) as typeof fetch;
      const client = connectedClient("valid");
      (client as unknown as { sessionId: string }).sessionId = "gone";

      await expect(client.callTool(MCP_URL, "demo", {})).rejects.toBeInstanceOf(SessionExpiredError);
      expect(await client.checkConnection(MCP_URL)).toBe(false);
      expect(client.state.connected).toBe(false);
    });

    it("refreshes the cached tool list from a successful liveness check", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ result: { tools: [{ name: "notion-fetch", description: "Fetch", inputSchema: {} }] } }),
        ) as typeof fetch;
      const client = connectedClient("valid");

      expect(await client.checkConnection(MCP_URL)).toBe(true);
      expect(client.getTools().map((t) => t.name)).toEqual(["notion-fetch"]);
    });
  });

  describe("headless OAuth", () => {
    it("rejects an unparseable pasted URL with a clear message", () => {
      expect(parseManualOAuthCallbackInput("http://", "s1").error).toMatch(/Could not read the pasted redirect URL/);
    });

    it("requires the redirect URL so the state check cannot be skipped", () => {
      expect(parseManualOAuthCallbackInput("raw-code", "s1").error).toMatch(/Paste the full redirect URL/);
    });

    it("uses a random high redirect port instead of the common dev-server port 3000", async () => {
      vi.spyOn(storage, "load").mockResolvedValue(null);
      vi.spyOn(storage, "save").mockResolvedValue();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ client_id: "client-1" }))
        .mockResolvedValueOnce(jsonResponse({ access_token: "access-1" }));
      global.fetch = fetchMock as typeof fetch;
      const client = new NotionMCPClient();
      vi.spyOn(client, "connect").mockResolvedValue();
      const input = vi.fn(async () => {
        const authUrl = new URL(
          readFileSync(join(process.env.HOME as string, ".pi", "agent", "notion-oauth-url.txt"), "utf-8").trim(),
        );
        return `${authUrl.searchParams.get("redirect_uri")}?code=c&state=${authUrl.searchParams.get("state")}`;
      });

      await ensureConnected(client, vi.fn(), vi.fn(), input);

      const redirect = new URL(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).redirect_uris[0]);
      expect(redirect.hostname).toBe("127.0.0.1");
      expect(Number(redirect.port)).toBeGreaterThanOrEqual(49152);
      expect(Number(redirect.port)).toBeLessThanOrEqual(65535);
    });

    it("lets notion_mcp_connect use the headless flow over SSH when the UI can prompt", async () => {
      process.env.SSH_CONNECTION = "10.0.0.1 5000 10.0.0.2 22";
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
      vi.spyOn(storage, "load").mockResolvedValue(null);
      global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ client_id: "client-1" })) as typeof fetch;
      const ctx = { hasUI: true, ui: { notify: vi.fn(), input: vi.fn(async () => undefined) } };

      const result = await connectTool.execute("id", {}, new AbortController().signal, undefined, ctx);

      expect(ctx.ui.input).toHaveBeenCalled();
      expect(result.isError).toBe(true);
    });
  });
});

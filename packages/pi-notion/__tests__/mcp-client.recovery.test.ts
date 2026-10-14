import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import notionMCPClientExtension, {
  connectWithSavedConfig,
  createRegisteredToolExecutor,
  ensureConnected,
  FileTokenStorage,
  NotionMCPClient,
  parseManualOAuthCallbackInput,
  refreshAccessToken,
  storage,
  TokenRefreshRejectedError,
} from "../extensions/mcp-client.js";
import { isNearExpiry, TOKEN_REFRESH_SKEW_MS } from "../extensions/token-expiry.js";
import { createFakeNotion, MCP_URL } from "./fake-notion.js";

vi.mock("node:child_process", () => ({ exec: vi.fn() }));

const TOOL = { name: "notion-search", description: "Search", inputSchema: {} };

const CONFIG = {
  mcpUrl: MCP_URL,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  clientId: "client",
};

function callSearch(client: NotionMCPClient, query = "docs", ctx: unknown = undefined) {
  const execute = createRegisteredToolExecutor(client, MCP_URL, TOOL);
  return execute("id", { query }, new AbortController().signal, undefined, ctx);
}

function mockPi() {
  const registered: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> = [];
  const pi = {
    registerFlag: vi.fn(),
    getFlag: vi.fn(() => undefined),
    registerTool: vi.fn((tool) => registered.push(tool)),
    registerCommand: vi.fn(),
    getAllTools: vi.fn(() => registered),
    events: { emit: vi.fn() },
  };
  const tool = (name: string) => registered.find((t) => t.name === name);
  return { pi, registered, tool };
}

describe("pi-notion MCP recovery", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalSshConnection = process.env.SSH_CONNECTION;
  let fake: ReturnType<typeof createFakeNotion>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // The module-level storage points at the real auth file; never touch it from tests
    vi.spyOn(storage, "save").mockResolvedValue();
    vi.spyOn(storage, "clear").mockResolvedValue();
    vi.spyOn(storage, "load").mockResolvedValue(null);
    process.env.HOME = mkdtempSync(join(tmpdir(), "pi-notion-recovery-"));
    delete process.env.SSH_CONNECTION;
    fake = createFakeNotion();
    global.fetch = fake.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
    if (originalSshConnection === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = originalSshConnection;
  });

  async function openClient(config = CONFIG) {
    const client = new NotionMCPClient();
    await client.open(config);
    return client;
  }

  describe("tool calls", () => {
    it("refreshes an expired token, retries once, persists the rotated tokens, and skips the doomed DELETE", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");

      const result = await callSearch(client);

      expect(result.content[0]?.text).toBe("done");
      expect(fake.state.tokenRequests).toBe(1);
      expect(fake.state.deletes).toEqual([]);
      expect(storage.save).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "access-2", refreshToken: "refresh-2" }),
      );
    });

    it("shares one refresh and one new session between concurrent 401s", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");

      const results = await Promise.all([callSearch(client, "a"), callSearch(client, "b"), callSearch(client, "c")]);

      expect(results.map((r) => r.content[0]?.text)).toEqual(["done", "done", "done"]);
      expect(fake.state.tokenRequests).toBe(1);
      expect(fake.state.initializes).toBe(2);
    });

    it("does not refresh again for a 401 that arrives after another call already recovered", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");
      const releaseSlow = fake.gate("slow");

      // The slow call is sent with access-1 but only answered after the fast call has recovered
      const slow = callSearch(client, "slow");
      const fast = await callSearch(client, "fast");
      releaseSlow();

      expect(fast.content[0]?.text).toBe("done");
      expect((await slow).content[0]?.text).toBe("done");
      expect(fake.state.tokenRequests).toBe(1);
      expect(fake.state.initializes).toBe(2);
    });

    it("reopens an expired MCP session with the same token, once, without refreshing", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();
      fake.dropSessions();
      const releaseSlow = fake.gate("slow");

      const slow = callSearch(client, "slow");
      const fast = await callSearch(client, "fast");
      releaseSlow();

      expect(fast.content[0]?.text).toBe("done");
      expect((await slow).content[0]?.text).toBe("done");
      expect(fake.state.tokenRequests).toBe(0);
      expect(fake.state.initializes).toBe(2);
    });

    it("adopts a token another pi process already refreshed instead of spending the refresh token", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");
      fake.issue("access-elsewhere", "refresh-elsewhere");
      vi.mocked(storage.load).mockResolvedValue({
        ...CONFIG,
        accessToken: "access-elsewhere",
        refreshToken: "refresh-elsewhere",
      });

      const result = await callSearch(client);

      expect(result.content[0]?.text).toBe("done");
      expect(fake.state.tokenRequests).toBe(0);
      expect(fake.state.toolCalls.at(-1)?.token).toBe("access-elsewhere");
    });

    it("keeps working from in-memory credentials when the refreshed tokens could not be saved", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");
      vi.mocked(storage.save).mockRejectedValue(new Error("EROFS"));
      const notify = vi.fn();
      const ctx = { hasUI: true, ui: { notify } };

      expect((await callSearch(client, "first", ctx)).content[0]?.text).toBe("done");
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("could not be saved: EROFS"), "error");

      // The auth file is gone (or stale); a later session expiry must still recover from memory
      fake.dropSessions();
      const result = await callSearch(client, "second");

      expect(result.content[0]?.text).toBe("done");
      expect(fake.state.toolCalls.at(-1)?.token).toBe("access-2");
    });

    it("does not resurrect a client that was disconnected during recovery", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      const client = await openClient();
      fake.expire("access-1");
      const releaseToken = fake.gate("token");

      const pending = callSearch(client);
      await vi.waitFor(() => expect(fake.state.tokenRequests).toBe(1));
      await client.disconnect();
      releaseToken();
      const result = await pending;

      expect(result.isError).toBe(true);
      expect(client.state.connected).toBe(false);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("reports a recovery failure with its cause and does not retry on every call", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();
      // The session expires and reopening it fails, e.g. during a Notion outage
      fake.dropSessions();
      fake.state.initializeFailure = { status: 503 };

      const first = await callSearch(client);
      const requestsAfterFirst = fake.mock.mock.calls.length;
      const second = await callSearch(client);

      expect(first.isError).toBe(true);
      expect(first.content[0]?.text).toContain("HTTP 503");
      expect(second.content[0]?.text).toContain("HTTP 503");
      expect(fake.mock.mock.calls.length).toBe(requestsAfterFirst);
    });

    it("asks the user to reconnect when the refresh token is rejected", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();
      fake.expire("access-1");
      vi.mocked(storage.load).mockResolvedValue(CONFIG);

      const result = await callSearch(client);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Run /notion or notion_mcp_connect to reconnect");
      expect(result.details).toMatchObject({ authExpired: true });
      expect(storage.clear).toHaveBeenCalled();
    });

    it("still reports not connected for a client that never connected", async () => {
      const result = await callSearch(new NotionMCPClient());

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Not connected to Notion MCP. Run /notion to connect.");
    });
  });

  describe("credential clearing", () => {
    it("leaves the auth file alone when another process saved a different refresh token", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();
      fake.expire("access-1");
      vi.mocked(storage.load).mockResolvedValue({ ...CONFIG, accessToken: "access-1", refreshToken: "refresh-new" });

      await callSearch(client);

      expect(storage.clear).not.toHaveBeenCalled();
    });

    it("clears legacy credentials without a refresh token once Notion rejects them", async () => {
      const legacy = { mcpUrl: MCP_URL, accessToken: "legacy-token" };
      vi.mocked(storage.load).mockResolvedValue(legacy);

      expect(await connectWithSavedConfig(new NotionMCPClient(), vi.fn())).toBe(false);
      expect(storage.clear).toHaveBeenCalled();
    });

    it("connects with the still-valid token when a near-expiry refresh is rejected", async () => {
      fake.issue("access-1", "refresh-1");
      vi.mocked(storage.load).mockResolvedValue(CONFIG);
      const client = new NotionMCPClient();

      await client.open({ ...CONFIG, expiresAt: Date.now() + 60_000 });

      expect(client.state.connected).toBe(true);
      expect(fake.state.tokenRequests).toBe(1);
      expect(storage.clear).toHaveBeenCalled();
    });
  });

  describe("connecting", () => {
    it("reports a transient failure with saved credentials instead of starting a new OAuth flow", async () => {
      fake.issue("access-1", "refresh-1");
      fake.state.initializeFailure = { status: 503 };
      vi.mocked(storage.load).mockResolvedValue(CONFIG);

      await expect(ensureConnected(new NotionMCPClient(), vi.fn(), vi.fn(), vi.fn())).rejects.toThrow("HTTP 503");
      expect(fake.state.registerRequests).toBe(0);
      expect(storage.clear).not.toHaveBeenCalled();
    });

    it("leaves the client disconnected when re-initializing fails", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();
      fake.state.initializeFailure = { status: 503 };

      await expect(client.connect(MCP_URL, "access-1")).rejects.toThrow("HTTP 503");
      expect(client.state.connected).toBe(false);
    });

    it("sends the spec notifications/initialized after initialize", async () => {
      fake.issue("access-1", "refresh-1");
      await openClient();

      expect(fake.state.notifications).toEqual(["notifications/initialized"]);
    });

    it("ends the previous session before an explicit reconnect", async () => {
      fake.issue("access-1", "refresh-1");
      const client = await openClient();

      await client.connect(MCP_URL, "access-1");

      expect(fake.state.deletes).toEqual(["session-1"]);
      expect(client.state.sessionId).toBe("session-2");
    });

    it("does not leave an unhandled rejection when client registration fails in browser mode", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as typeof fetch;

      try {
        await expect(ensureConnected(new NotionMCPClient(), vi.fn(), vi.fn())).rejects.toThrow("fetch failed");
        vi.advanceTimersByTime(300_000);
        await new Promise((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });
  });

  describe("extension tools", () => {
    it("refreshes transparently in notion_mcp_status and registers newly listed tools", async () => {
      fake.issue("access-1", "refresh-1", { access: "access-2", refresh: "refresh-2" });
      vi.mocked(storage.load).mockResolvedValue(CONFIG);
      const { pi, tool } = mockPi();
      notionMCPClientExtension(pi as never);
      await tool("notion_mcp_connect")?.execute("id", {}, new AbortController().signal, undefined, undefined);
      expect(tool("notion-search")).toBeDefined();

      fake.expire("access-1");
      fake.state.tools.push({ name: "notion-fetch", description: "Fetch", inputSchema: {} });
      const status = (await tool("notion_mcp_status")?.execute(
        "id",
        {},
        new AbortController().signal,
        undefined,
        undefined,
      )) as { content: Array<{ text: string }> };

      expect(status.content[0]?.text).toContain("Connected: Yes");
      expect(fake.state.tokenRequests).toBe(1);
      expect(tool("notion-fetch")).toBeDefined();
    });

    it("shows the headless instructions through ctx.ui.notify in notion_mcp_connect", async () => {
      process.env.SSH_CONNECTION = "10.0.0.1 5000 10.0.0.2 22";
      const { pi, tool } = mockPi();
      notionMCPClientExtension(pi as never);
      const ctx = { hasUI: true, ui: { notify: vi.fn(), input: vi.fn(async () => undefined) } };

      const result = (await tool("notion_mcp_connect")?.execute(
        "id",
        {},
        new AbortController().signal,
        undefined,
        ctx,
      )) as { isError?: boolean };

      expect(result.isError).toBe(true);
      expect(ctx.ui.input).toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("notion-oauth-url.txt"), "info");
    });
  });

  describe("token responses and storage", () => {
    it("rejects a token response without an access token", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ token_type: "bearer" }), { headers: { "content-type": "application/json" } }),
        ) as typeof fetch;

      await expect(refreshAccessToken("refresh-1", "client")).rejects.toThrow("did not include an access_token");
    });

    it("classifies invalid_grant as a definitive refresh rejection and 5xx as transient", async () => {
      await expect(refreshAccessToken("unknown-refresh", "client")).rejects.toBeInstanceOf(TokenRefreshRejectedError);

      fake.state.tokenEndpointFailure = { status: 503, body: { error: "server_error" } };
      const transient = await refreshAccessToken("refresh-1", "client").catch((error: unknown) => error);
      expect(transient).toBeInstanceOf(Error);
      expect(transient).not.toBeInstanceOf(TokenRefreshRejectedError);
    });

    it("replaces the auth file atomically as an owner-only file", async () => {
      const dir = process.env.HOME as string;
      const path = join(dir, "auth.json");
      writeFileSync(path, "{}");
      chmodSync(path, 0o644);
      const tokenStorage = new FileTokenStorage();
      tokenStorage.path = path;

      await tokenStorage.save({ mcpUrl: MCP_URL, accessToken: "a", refreshToken: "r" });

      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({ refreshToken: "r" });
      expect(readdirSync(dir)).toEqual(["auth.json"]);
    });

    it("fails the save instead of swallowing write errors", async () => {
      const tokenStorage = new FileTokenStorage();
      tokenStorage.path = "/dev/null/auth.json";

      await expect(tokenStorage.save({ mcpUrl: MCP_URL, accessToken: "a" })).rejects.toThrow();
    });

    it("resolves the auth file path on first use so the auth-file flag applies", () => {
      const original = process.env.NOTION_MCP_AUTH_FILE;
      try {
        delete process.env.NOTION_MCP_AUTH_FILE;
        const tokenStorage = new FileTokenStorage();
        process.env.NOTION_MCP_AUTH_FILE = "/tmp/flag-auth.json";

        expect(tokenStorage.path).toBe("/tmp/flag-auth.json");
      } finally {
        if (original === undefined) delete process.env.NOTION_MCP_AUTH_FILE;
        else process.env.NOTION_MCP_AUTH_FILE = original;
      }
    });

    it("shares the near-expiry rule with the legacy OAuth helper", () => {
      expect(isNearExpiry(undefined, 0)).toBe(false);
      expect(isNearExpiry(10 * 60 * 1000, 0)).toBe(false);
      expect(isNearExpiry(TOKEN_REFRESH_SKEW_MS, 0)).toBe(true);
    });
  });

  describe("headless OAuth", () => {
    it("rejects an unparseable pasted URL with a clear message", () => {
      expect(parseManualOAuthCallbackInput("http://", "s1").error).toMatch(/Could not read the pasted redirect URL/);
    });

    it("requires the redirect URL so the state check cannot be skipped", () => {
      expect(parseManualOAuthCallbackInput("raw-code", "s1").error).toMatch(/Paste the full redirect URL/);
    });

    it("accepts a pasted redirect URL whose scheme the browser hid", () => {
      expect(parseManualOAuthCallbackInput("127.0.0.1:51234/callback?code=abc&state=s1", "s1")).toEqual({
        code: "abc",
      });
    });

    it("uses a random high redirect port instead of the common dev-server port 3000", async () => {
      fake.issue("access-new", "refresh-new");
      global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/token")) {
          return new Response(JSON.stringify({ access_token: "access-new" }), {
            headers: { "content-type": "application/json" },
          });
        }
        return fake.fetch(input, init);
      }) as typeof fetch;
      const input = vi.fn(async () => {
        const authUrl = new URL(
          readFileSync(join(process.env.HOME as string, ".pi", "agent", "notion-oauth-url.txt"), "utf-8").trim(),
        );
        return `${authUrl.searchParams.get("redirect_uri")}?code=c&state=${authUrl.searchParams.get("state")}`;
      });

      await ensureConnected(new NotionMCPClient(), vi.fn(), vi.fn(), input);

      const registerCall = vi.mocked(global.fetch).mock.calls.find(([url]) => String(url).endsWith("/register"));
      const redirect = new URL(JSON.parse(String(registerCall?.[1]?.body)).redirect_uris[0]);
      expect(redirect.hostname).toBe("127.0.0.1");
      expect(Number(redirect.port)).toBeGreaterThanOrEqual(49152);
      expect(Number(redirect.port)).toBeLessThanOrEqual(65535);
    });
  });
});

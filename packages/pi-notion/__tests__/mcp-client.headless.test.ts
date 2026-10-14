import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import notionMCPClientExtension, {
  announceAuthorizationUrl,
  ensureConnected,
  NotionMCPClient,
  parseManualOAuthCallbackInput,
  shouldUseManualOAuth,
  storage,
} from "../extensions/mcp-client.js";

vi.mock("node:child_process", () => ({ exec: vi.fn() }));

const MCP_URL = "https://mcp.notion.com/mcp";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Simulates the user pasting the failed loopback redirect from the URL pi-notion saved. */
function pasteRedirectFromSavedUrl(home: string, code = "auth-code"): () => Promise<string> {
  return async () => {
    const authUrl = new URL(readFileSync(join(home, ".pi", "agent", "notion-oauth-url.txt"), "utf-8").trim());
    const redirect = new URL(authUrl.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", authUrl.searchParams.get("state") ?? "");
    return redirect.toString();
  };
}

describe("pi-notion headless OAuth", () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  const originalSshConnection = process.env.SSH_CONNECTION;
  const originalSshTty = process.env.SSH_TTY;
  let home: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, "save").mockResolvedValue();
    vi.spyOn(storage, "clear").mockResolvedValue();
    home = mkdtempSync(join(tmpdir(), "pi-notion-headless-"));
    process.env.HOME = home;
    delete process.env.SSH_CONNECTION;
    delete process.env.SSH_TTY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
    if (originalSshConnection === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = originalSshConnection;
    if (originalSshTty === undefined) delete process.env.SSH_TTY;
    else process.env.SSH_TTY = originalSshTty;
  });

  describe("parseManualOAuthCallbackInput", () => {
    it("accepts a pasted redirect URL with a matching state", () => {
      expect(parseManualOAuthCallbackInput("http://127.0.0.1:3000/callback?code=abc&state=s1", "s1")).toEqual({
        code: "abc",
      });
    });

    it("rejects a pasted redirect URL with a different state", () => {
      expect(parseManualOAuthCallbackInput("http://127.0.0.1:3000/callback?code=abc&state=other", "s1")).toEqual({
        error: "State mismatch",
      });
    });

    it("accepts a bare query string with or without a leading question mark", () => {
      expect(parseManualOAuthCallbackInput("code=abc&state=s1", "s1")).toEqual({ code: "abc" });
      expect(parseManualOAuthCallbackInput("  ?code=abc&state=s1 ", "s1")).toEqual({ code: "abc" });
    });

    it("surfaces an authorization error from the pasted redirect", () => {
      expect(parseManualOAuthCallbackInput("?error=access_denied&state=s1", "s1")).toMatchObject({
        error: "access_denied",
      });
    });

    it("refuses a bare code because it carries no state to check", () => {
      expect(parseManualOAuthCallbackInput(" raw-code ", "s1").error).toMatch(/Paste the full redirect URL/);
    });

    it("rejects empty input", () => {
      expect(parseManualOAuthCallbackInput("   ", "s1")).toEqual({ error: "No authorization code provided" });
    });
  });

  describe("shouldUseManualOAuth", () => {
    it("uses the manual flow when asked for headless or manual", () => {
      expect(shouldUseManualOAuth("headless")).toBe(true);
      expect(shouldUseManualOAuth("  Manual ")).toBe(true);
    });

    it("uses the manual flow automatically inside an SSH session", () => {
      expect(shouldUseManualOAuth("")).toBe(false);
      process.env.SSH_CONNECTION = "10.0.0.1 5000 10.0.0.2 22";
      expect(shouldUseManualOAuth("")).toBe(true);
      delete process.env.SSH_CONNECTION;
      process.env.SSH_TTY = "/dev/ttys001";
      expect(shouldUseManualOAuth(undefined)).toBe(true);
    });

    it("lets /notion browser override SSH detection", () => {
      process.env.SSH_CONNECTION = "10.0.0.1 5000 10.0.0.2 22";
      expect(shouldUseManualOAuth("browser")).toBe(false);
    });
  });

  describe("announceAuthorizationUrl", () => {
    it("saves the URL to a private file and tells the user where it is", () => {
      const notify = vi.fn();
      const path = announceAuthorizationUrl("https://mcp.notion.com/authorize?state=s1", notify);

      expect(path).toBe(join(home, ".pi", "agent", "notion-oauth-url.txt"));
      expect(readFileSync(path as string, "utf-8")).toBe("https://mcp.notion.com/authorize?state=s1\n");
      expect(statSync(path as string).mode & 0o777).toBe(0o600);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining(`cat "${path}"`));
    });

    it("falls back to showing the URL when the file cannot be written", () => {
      writeFileSync(join(home, ".pi"), "not a directory");
      const notify = vi.fn();

      expect(announceAuthorizationUrl("https://mcp.notion.com/authorize?state=s1", notify)).toBeNull();
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("https://mcp.notion.com/authorize?state=s1"));
    });
  });

  it("completes OAuth from a pasted redirect without a callback server", async () => {
    vi.spyOn(storage, "load").mockResolvedValue(null);
    const saveSpy = vi.spyOn(storage, "save").mockResolvedValue();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ client_id: "client-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-1", refresh_token: "refresh-1" }));
    global.fetch = fetchMock as typeof fetch;
    const client = new NotionMCPClient();
    const connectSpy = vi.spyOn(client, "connect").mockResolvedValue();
    const registerTools = vi.fn();

    const result = await ensureConnected(client, registerTools, vi.fn(), pasteRedirectFromSavedUrl(home));

    expect(result).toEqual({ reusedSavedConfig: false });
    expect(connectSpy).toHaveBeenCalledWith(MCP_URL, "access-1");
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-1", refreshToken: "refresh-1" }),
    );
    expect(registerTools).toHaveBeenCalled();

    const registeredRedirect = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).redirect_uris[0];
    const tokenBody = new URLSearchParams(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(tokenBody.get("code")).toBe("auth-code");
    expect(tokenBody.get("redirect_uri")).toBe(registeredRedirect);
  });

  it("connects through /notion headless using the UI input prompt", async () => {
    const mockPi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => undefined),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => []),
      events: { emit: vi.fn() },
    };
    notionMCPClientExtension(mockPi as never);
    const [, command] = mockPi.registerCommand.mock.calls.find(([name]) => name === "notion") ?? [];

    vi.spyOn(storage, "load").mockResolvedValue(null);
    vi.spyOn(storage, "save").mockResolvedValue();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ client_id: "client-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-1" })) as typeof fetch;
    vi.spyOn(NotionMCPClient.prototype, "connect").mockImplementation(async function (this: NotionMCPClient) {
      this.state.connected = true;
      this.state.sessionId = "session-12345678";
    });
    const ctx = { ui: { notify: vi.fn(), input: vi.fn(pasteRedirectFromSavedUrl(home)), select: vi.fn() } };

    await command.handler("headless", ctx);

    expect(ctx.ui.input).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Connected! Session: session-...", "info");
  });

  it("reports a failed connection when the headless prompt is cancelled", async () => {
    const mockPi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(() => undefined),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => []),
      events: { emit: vi.fn() },
    };
    notionMCPClientExtension(mockPi as never);
    const [, command] = mockPi.registerCommand.mock.calls.find(([name]) => name === "notion") ?? [];

    vi.spyOn(storage, "load").mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ client_id: "client-1" })) as typeof fetch;
    const ctx = { ui: { notify: vi.fn(), input: vi.fn(async () => undefined), select: vi.fn() } };

    await command.handler("headless", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Connection failed: Authorization failed: No authorization code provided",
      "error",
    );
  });
});

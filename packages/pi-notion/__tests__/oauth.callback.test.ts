import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractCallbackParams,
  FileTokenStorage,
  getAuthorizationErrorHtml,
  getAuthorizationSuccessHtml,
  getStateMismatchHtml,
  handleCallbackParams,
  parseQueryParams,
  processCallbackChunk,
  writeHtmlResponse,
  writeOutcomeResponse,
} from "../extensions/oauth.js";

describe("pi-notion oauth callback helpers", () => {
  it("parses query params and callback requests", () => {
    expect(parseQueryParams("http://localhost/callback?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" });
    expect(extractCallbackParams("GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n")).toEqual({
      code: "abc",
      state: "xyz",
    });
    expect(extractCallbackParams("GET /other HTTP/1.1\r\n\r\n")).toBeNull();
  });

  it("renders callback html messages", () => {
    expect(getStateMismatchHtml()).toContain("State mismatch");
    expect(getAuthorizationErrorHtml({ error: "denied", error_description: "nope" })).toContain("denied");
    expect(getAuthorizationSuccessHtml()).toContain("Authorization successful");
  });

  it("handles callback outcomes for mismatch, error, and success", () => {
    expect(handleCallbackParams({ state: "bad" }, "good")).toMatchObject({ type: "reject" });
    expect(handleCallbackParams({ state: "good", error: "denied" }, "good")).toMatchObject({
      type: "resolve",
      result: { error: "denied" },
    });
    expect(handleCallbackParams({ state: "good", code: "abc" }, "good")).toMatchObject({
      type: "resolve",
      result: { code: "abc", state: "good" },
    });
    expect(handleCallbackParams({ state: "good" }, "good")).toMatchObject({ type: "ignore" });
  });

  it("writes html and outcome responses to sockets", () => {
    const socket = { write: vi.fn(), end: vi.fn() } as unknown as NodeJS.WritableStream;
    writeHtmlResponse(socket, "HTTP/1.1 200 OK", "<html>ok</html>");
    expect((socket as unknown as { write: ReturnType<typeof vi.fn> }).write).toHaveBeenCalled();

    writeOutcomeResponse(socket as unknown as NodeJS.Socket, {
      type: "resolve",
      html: "<html>ok</html>",
      result: { code: "abc", state: "good" },
    });
    expect((socket as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalled();
  });

  it("processes callback chunks incrementally", () => {
    const first = processCallbackChunk("", Buffer.from("GET /callback?state=good"), "good");
    expect(first.outcome.type).toBe("ignore");

    const second = processCallbackChunk(
      first.buffer,
      Buffer.from("&code=abc HTTP/1.1\r\nHost: localhost\r\n\r\n"),
      "good",
    );
    expect(second.outcome).toMatchObject({ type: "resolve", result: { code: "abc" } });
  });
});

describe("pi-notion oauth file storage", () => {
  it("persists, reads, and clears tokens and user info", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "pi-notion-oauth-storage-"));
    const basePath = join(baseDir, "notion.json");
    const storage = new FileTokenStorage(basePath);

    await storage.save(
      {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() + 1000,
      },
      {
        workspaceId: "ws",
        workspaceName: "Workspace",
        botId: "bot",
      },
    );

    const raw = readFileSync(basePath.replace(/\.json$/, "-tokens.json"), "utf-8");
    expect(raw).toContain("access");
    expect(await storage.load()).toMatchObject({ accessToken: "access" });
    expect(await storage.getUserInfo()).toMatchObject({ workspaceId: "ws" });

    await storage.clear();
    expect(await storage.load()).toBeNull();
  });
});

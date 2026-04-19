/**
 * Tests for Notion OAuth utilities
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  FileTokenStorage,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "../extensions/oauth.js";

// =============================================================================
// PKCE Utilities
// =============================================================================

describe("pi-notion OAuth PKCE Utilities", () => {
  describe("generateCodeVerifier", () => {
    it("generates a non-empty string", () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toBeTruthy();
      expect(typeof verifier).toBe("string");
    });

    it("generates unique values", () => {
      const verifiers = new Set(Array.from({ length: 100 }, () => generateCodeVerifier()));
      expect(verifiers.size).toBe(100);
    });

    it("generates URL-safe base64 string", () => {
      const verifier = generateCodeVerifier();
      expect(verifier).not.toMatch(/[+/=]/);
    });

    it("generates verifier of sufficient length", () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe("generateCodeChallenge", () => {
    it("generates a non-empty string", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge).toBeTruthy();
      expect(typeof challenge).toBe("string");
    });

    it("generates consistent challenge for same verifier", () => {
      const verifier = "test-verifier-string";
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);
      expect(challenge1).toBe(challenge2);
    });

    it("generates different challenges for different verifiers", () => {
      const verifier1 = "verifier-1";
      const verifier2 = "verifier-2";
      const challenge1 = generateCodeChallenge(verifier1);
      const challenge2 = generateCodeChallenge(verifier2);
      expect(challenge1).not.toBe(challenge2);
    });

    it("generates URL-safe base64 string", () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(challenge).not.toMatch(/[+/=]/);
    });
  });

  describe("generateState", () => {
    it("generates a non-empty hex string", () => {
      const state = generateState();
      expect(state).toBeTruthy();
      expect(state).toMatch(/^[0-9a-f]+$/);
    });

    it("generates unique values", () => {
      const states = new Set(Array.from({ length: 100 }, () => generateState()));
      expect(states.size).toBe(100);
    });

    it("generates 16 bytes (32 hex chars)", () => {
      const state = generateState();
      expect(state.length).toBe(32);
    });
  });
});

// =============================================================================
// OAuth URL Builder
// =============================================================================

describe("pi-notion OAuth URL Builder", () => {
  const mockConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/callback",
  };

  it("builds authorization URL with required parameters", () => {
    const codeChallenge = "test-challenge";
    const state = "test-state";
    const url = buildAuthorizationUrl(mockConfig, codeChallenge, state);

    expect(url).toContain("https://api.notion.com/v1/oauth/authorize");
    expect(url).toContain(`client_id=${mockConfig.clientId}`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(mockConfig.redirectUri)}`);
    expect(url).toContain(`code_challenge=${codeChallenge}`);
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain(`state=${state}`);
  });

  it("includes response_type as code", () => {
    const url = buildAuthorizationUrl(mockConfig, "challenge", "state");
    expect(url).toContain("response_type=code");
  });

  it("includes owner=user", () => {
    const url = buildAuthorizationUrl(mockConfig, "challenge", "state");
    expect(url).toContain("owner=user");
  });

  it("URL encodes special characters in redirect URI", () => {
    const configWithSpecialChars = {
      ...mockConfig,
      redirectUri: "http://localhost:3000/callback?foo=bar&baz=qux",
    };
    const url = buildAuthorizationUrl(configWithSpecialChars, "challenge", "state");
    expect(url).toContain("callback%3Ffoo%3Dbar%26baz%3Dqux");
  });
});

// =============================================================================
// FileTokenStorage
// =============================================================================

describe("pi-notion FileTokenStorage", () => {
  let tempDir: string;
  let storage: FileTokenStorage;
  let basePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-notion-storage-"));
    basePath = join(tempDir, "notion.json");
    storage = new FileTokenStorage(basePath);
  });

  describe("save and load", () => {
    it("saves and loads tokens", async () => {
      const tokens = {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() + 3600000,
      };

      await storage.save(tokens);
      const loaded = await storage.load();

      expect(loaded).toEqual(tokens);
    });

    it("saves and loads user info", async () => {
      const tokens = {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() + 3600000,
      };

      const userInfo = {
        workspaceId: "ws-123",
        workspaceName: "Test Workspace",
        workspaceIcon: "🏢",
        botId: "bot-123",
        ownerEmail: "user@example.com",
        ownerName: "Test User",
      };

      await storage.save(tokens, userInfo);
      const loadedUserInfo = await storage.getUserInfo();

      expect(loadedUserInfo).toEqual(userInfo);
    });

    it("saves without user info", async () => {
      const tokens = {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() + 3600000,
      };

      await storage.save(tokens);

      const loadedTokens = await storage.load();
      const loadedUserInfo = await storage.getUserInfo();

      expect(loadedTokens).toEqual(tokens);
      expect(loadedUserInfo).toBeNull();
    });
  });

  describe("load", () => {
    it("returns null when no tokens saved", async () => {
      const result = await storage.load();
      expect(result).toBeNull();
    });
  });

  describe("getUserInfo", () => {
    it("returns null when no user info saved", async () => {
      const result = await storage.getUserInfo();
      expect(result).toBeNull();
    });
  });

  describe("clear", () => {
    it("clears tokens and user info", async () => {
      const tokens = {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresAt: Date.now() + 3600000,
      };

      await storage.save(tokens, {
        workspaceId: "ws",
        workspaceName: "WS",
        botId: "bot",
      });

      await storage.clear();

      expect(await storage.load()).toBeNull();
      expect(await storage.getUserInfo()).toBeNull();
    });

    it("clears when no files exist", async () => {
      await expect(storage.clear()).resolves.toBeUndefined();
    });
  });
});

// =============================================================================
// OAuth File Structure Tests
// =============================================================================

describe("pi-notion OAuth File Structure", () => {
  const oauthPath = join(__dirname, "../extensions/oauth.ts");

  it("oauth.ts contains PKCE functions", () => {
    const content = readFileSync(oauthPath, "utf-8");

    expect(content).toContain("generateCodeVerifier");
    expect(content).toContain("generateCodeChallenge");
    expect(content).toContain("generateState");
  });

  it("oauth.ts contains token exchange functions", () => {
    const content = readFileSync(oauthPath, "utf-8");

    expect(content).toContain("exchangeCodeForTokens");
    expect(content).toContain("refreshTokens");
  });

  it("oauth.ts contains storage class", () => {
    const content = readFileSync(oauthPath, "utf-8");

    expect(content).toContain("FileTokenStorage");
    expect(content).toContain("TokenStorage");
  });

  it("oauth.ts contains OAuth flow functions", () => {
    const content = readFileSync(oauthPath, "utf-8");

    expect(content).toContain("executeOAuthFlow");
    expect(content).toContain("getValidAccessToken");
    expect(content).toContain("buildAuthorizationUrl");
  });

  it("oauth.ts contains type definitions", () => {
    const content = readFileSync(oauthPath, "utf-8");

    expect(content).toContain("OAuthConfig");
    expect(content).toContain("OAuthTokens");
    expect(content).toContain("OAuthUserInfo");
  });
});

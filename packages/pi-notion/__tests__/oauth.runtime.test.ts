import { beforeEach, describe, expect, it, vi } from "vitest";

const { axiosPostMock } = vi.hoisted(() => ({
	axiosPostMock: vi.fn(),
}));

vi.mock("axios", () => ({
	default: {
		post: axiosPostMock,
	},
}));

import {
	exchangeCodeForTokens,
	getValidAccessToken,
	type OAuthConfig,
	type OAuthTokens,
	refreshTokens,
	type TokenStorage,
} from "../extensions/oauth.js";

const config: OAuthConfig = {
	clientId: "client-id",
	clientSecret: "client-secret",
	redirectUri: "http://localhost:3000/callback",
};

describe("pi-notion oauth runtime", () => {
	beforeEach(() => {
		axiosPostMock.mockReset();
	});

	it("exchanges authorization codes for tokens and owner info", async () => {
		axiosPostMock.mockResolvedValueOnce({
			data: {
				access_token: "access-token",
				refresh_token: "refresh-token",
				token_type: "bearer",
				workspace_id: "ws-1",
				workspace_name: "Workspace",
				workspace_icon: "📝",
				bot_id: "bot-1",
				owner: {
					user: {
						name: "Test User",
						person: { email: "user@example.com" },
					},
				},
			},
		});

		const result = await exchangeCodeForTokens(config, "auth-code", "verifier");

		expect(axiosPostMock).toHaveBeenCalledWith(
			expect.stringContaining("/oauth/token"),
			expect.objectContaining({
				grant_type: "authorization_code",
				code: "auth-code",
				code_verifier: "verifier",
			}),
			expect.any(Object),
		);
		expect(result.accessToken).toBe("access-token");
		expect(result.refreshToken).toBe("refresh-token");
		expect(result.owner).toEqual({
			workspaceId: "ws-1",
			workspaceName: "Workspace",
			workspaceIcon: "📝",
			botId: "bot-1",
			ownerEmail: "user@example.com",
			ownerName: "Test User",
		});
	});

	it("refreshes tokens and preserves the old refresh token when omitted", async () => {
		axiosPostMock.mockResolvedValueOnce({
			data: {
				access_token: "new-access",
				token_type: "bearer",
			},
		});

		const result = await refreshTokens(config, "existing-refresh");
		expect(result.accessToken).toBe("new-access");
		expect(result.refreshToken).toBe("existing-refresh");
	});

	it("returns an existing token when it is still valid", async () => {
		const storage: TokenStorage = {
			save: vi.fn(),
			load: vi.fn(
				async () =>
					({
						accessToken: "still-valid",
						refreshToken: "refresh",
						tokenType: "bearer",
						expiresAt: Date.now() + 60 * 60 * 1000,
					}) satisfies OAuthTokens,
			),
			clear: vi.fn(),
			getUserInfo: vi.fn(async () => null),
		};

		const token = await getValidAccessToken(config, storage);
		expect(token).toBe("still-valid");
		expect(axiosPostMock).not.toHaveBeenCalled();
	});

	it("refreshes tokens through storage when the token is near expiry", async () => {
		axiosPostMock.mockResolvedValueOnce({
			data: {
				access_token: "refreshed-access",
				refresh_token: "refreshed-refresh",
				token_type: "bearer",
			},
		});

		const save = vi.fn();
		const storage: TokenStorage = {
			save,
			load: vi.fn(
				async () =>
					({
						accessToken: "old-access",
						refreshToken: "old-refresh",
						tokenType: "bearer",
						expiresAt: Date.now() + 60 * 1000,
					}) satisfies OAuthTokens,
			),
			clear: vi.fn(),
			getUserInfo: vi.fn(async () => ({ workspaceId: "ws", workspaceName: "WS", botId: "bot" })),
		};

		const token = await getValidAccessToken(config, storage);
		expect(token).toBe("refreshed-access");
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: "refreshed-access", refreshToken: "refreshed-refresh" }),
			expect.objectContaining({ workspaceId: "ws" }),
		);
	});

	it("clears storage and throws when token refresh fails", async () => {
		axiosPostMock.mockRejectedValueOnce(new Error("refresh failed"));
		const clear = vi.fn();
		const storage: TokenStorage = {
			save: vi.fn(),
			load: vi.fn(
				async () =>
					({
						accessToken: "old-access",
						refreshToken: "old-refresh",
						tokenType: "bearer",
						expiresAt: Date.now() - 1000,
					}) satisfies OAuthTokens,
			),
			clear,
			getUserInfo: vi.fn(async () => null),
		};

		await expect(getValidAccessToken(config, storage)).rejects.toThrow("Token refresh failed: refresh failed");
		expect(clear).toHaveBeenCalled();
	});
});

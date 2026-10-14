/**
 * Shared access-token expiry rule for the MCP client and the legacy OAuth helper.
 */

/** Refresh this long before the reported expiry so in-flight requests do not race it. */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/** True when a token with this expiry (epoch ms) should be refreshed; unknown expiry never is. */
export function isNearExpiry(expiresAt: number | undefined, now = Date.now()): boolean {
  return expiresAt !== undefined && expiresAt - TOKEN_REFRESH_SKEW_MS <= now;
}

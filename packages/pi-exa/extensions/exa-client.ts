/**
 * Shared Exa client cache.
 */

import { Exa } from "exa-js";

const exaClients = new Map<string, Exa>();

/** Call-local host hooks; no global "current cycle" or raw-response archive. */
export interface ExaUsageObserver {
  before: () => Promise<() => void>;
  raw: (response: unknown) => Promise<void>;
}

export async function observeExaRequest<T>(
  observer: ExaUsageObserver | undefined,
  invoke: () => Promise<T>,
): Promise<T> {
  if (observer) {
    const guard = await observer.before();
    // No await between the final host fence and the actual SDK invocation.
    guard();
  }
  const response = await invoke();
  await observer?.raw(response);
  return response;
}

/**
 * Optional Exa API base URL override (`EXA_BASE_URL`), for self-hosted proxies
 * and controllable endpoint mocks in qualification smoke tests. Unset means the
 * SDK default (https://api.exa.ai).
 */
export function resolveExaBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.EXA_BASE_URL?.trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`EXA_BASE_URL must be an absolute http(s) URL such as https://api.exa.ai; got "${value}".`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error(`EXA_BASE_URL must use http or https; got "${parsed.protocol}".`);
  return value.replace(/\/+$/, "");
}

export function getExaClient(apiKey: string): Exa {
  const baseUrl = resolveExaBaseUrl();
  const key = baseUrl ? `${baseUrl}\u0000${apiKey}` : apiKey;
  const existing = exaClients.get(key);
  if (existing) {
    return existing;
  }

  const client = baseUrl ? new Exa(apiKey, baseUrl) : new Exa(apiKey);
  exaClients.set(key, client);
  return client;
}

export function resetExaClientCache(): void {
  exaClients.clear();
}

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

export function getExaClient(apiKey: string): Exa {
  const existing = exaClients.get(apiKey);
  if (existing) {
    return existing;
  }

  const client = new Exa(apiKey);
  exaClients.set(apiKey, client);
  return client;
}

export function resetExaClientCache(): void {
  exaClients.clear();
}

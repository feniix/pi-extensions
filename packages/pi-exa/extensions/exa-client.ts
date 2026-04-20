/**
 * Shared Exa client cache.
 */

import { Exa } from "exa-js";

const exaClients = new Map<string, Exa>();

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

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

export const DEFAULT_ENDPOINT = "https://api.ref.tools/mcp";
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export const DEFAULT_CONFIG_FILE: Record<string, unknown> = {
  url: DEFAULT_ENDPOINT,
  apiKey: null,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  protocolVersion: DEFAULT_PROTOCOL_VERSION,
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
};

export const CLIENT_INFO = {
  name: "pi-ref-tools-extension",
  version: "1.0.0",
} as const;

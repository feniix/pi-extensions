/**
 * Ref.tools MCP CLI Extension
 *
 * Provides Ref MCP tools via HTTP: ref_search_documentation and ref_read_url.
 * Token-efficient documentation search and URL reading via Ref's Model Context Protocol.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatSessionStartMessage, resolveRuntimeSettings } from "./config.js";
import { DEFAULT_CONFIG_FILE } from "./constants.js";
import { RefMcpClient } from "./mcp-client.js";
import { registerRefFlags, registerRefTools } from "./tool-registration.js";

export {
  formatSessionStartMessage,
  loadRuntimeConfig,
  parseConfig,
  resolveConfigPath,
  resolveRuntimeSettings,
} from "./config.js";
export {
  formatToolOutput,
  isJsonRpcResponse,
  isRecord,
  normalizeNumber,
  normalizeString,
  parseTimeoutMs,
  redactApiKey,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
} from "./helpers.js";
export { extractMatchingSseResponse, extractSseData, parseMatchingSseMessage } from "./mcp-client.js";
export { DEFAULT_CONFIG_FILE };

export default function refTools(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    console.log(formatSessionStartMessage(resolveRuntimeSettings(pi)));
  });

  registerRefFlags(pi);

  const getRuntimeSettings = () => resolveRuntimeSettings(pi);
  const client = new RefMcpClient(
    () => getRuntimeSettings().endpoint,
    () => getRuntimeSettings().apiKey,
    () => getRuntimeSettings().timeoutMs,
    () => getRuntimeSettings().protocolVersion,
  );

  registerRefTools(pi, client, getRuntimeSettings);
}

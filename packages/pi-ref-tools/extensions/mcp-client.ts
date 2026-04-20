import { CLIENT_INFO } from "./constants.js";
import {
  isJsonRpcResponse,
  isRecord,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpToolResult,
  toJsonString,
} from "./helpers.js";

export class RefMcpClient {
  private requestCounter = 0;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private lastEndpoint: string | null = null;
  private lastApiKey: string | null = null;
  private sessionId: string | null = null;

  constructor(
    private readonly resolveEndpoint: () => string,
    private readonly resolveApiKey: () => string | undefined,
    private readonly getTimeoutMs: () => number,
    private readonly getProtocolVersion: () => string,
  ) {}

  currentEndpoint(): string {
    return this.resolveEndpoint();
  }

  async callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    await this.ensureInitialized(signal);
    const result = await this.sendRequest("tools/call", { name: toolName, arguments: args }, signal);
    if (isRecord(result)) {
      return result as McpToolResult;
    }
    return { content: [{ type: "text", text: toJsonString(result) }] };
  }

  private async ensureInitialized(signal?: AbortSignal): Promise<void> {
    const endpoint = this.resolveEndpoint();
    const apiKey = this.resolveApiKey();

    if (this.lastEndpoint !== endpoint || this.lastApiKey !== apiKey) {
      this.initialized = false;
      this.initializing = null;
      this.sessionId = null;
      this.lastEndpoint = endpoint;
      this.lastApiKey = apiKey ?? null;
    }

    if (this.initialized) {
      return;
    }

    if (!this.initializing) {
      this.initializing = (async () => {
        await this.initialize(signal);
        this.initialized = true;
      })()
        .catch((error) => {
          this.initialized = false;
          throw error;
        })
        .finally(() => {
          this.initializing = null;
        });
    }

    await this.initializing;
  }

  private async initialize(signal?: AbortSignal): Promise<void> {
    await this.sendRequest(
      "initialize",
      {
        protocolVersion: this.getProtocolVersion(),
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      signal,
    );
    await this.sendNotification("notifications/initialized", {}, signal);
  }

  private async sendRequest(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId();
    const response = await this.sendJsonRpc(
      {
        jsonrpc: "2.0",
        id,
        method,
        params,
      },
      signal,
    );

    const json = extractJsonRpcResponse(response, id);
    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    return json.result;
  }

  private async sendNotification(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    await this.sendJsonRpc(
      {
        jsonrpc: "2.0",
        method,
        params,
      },
      signal,
      true,
    );
  }

  private async sendJsonRpc(
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    isNotification = false,
  ): Promise<unknown> {
    const endpoint = this.resolveEndpoint();
    const apiKey = this.resolveApiKey();
    const { signal: mergedSignal, cleanup } = createMergedSignal(signal, this.getTimeoutMs());

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (apiKey) {
      headers["x-ref-api-key"] = apiKey;
    }
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: mergedSignal,
      });

      const returnedSessionId = response.headers.get("mcp-session-id");
      if (returnedSessionId) {
        this.sessionId = returnedSessionId;
      }

      if (response.status === 204 || response.status === 202) {
        return undefined;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`MCP HTTP ${response.status}: ${text || response.statusText}`);
      }

      if (isNotification) {
        return undefined;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json: unknown = await response.json();
        return json;
      }
      if (contentType.includes("text/event-stream")) {
        return parseSseResponse(response, payload.id);
      }

      const text = await response.text();
      throw new Error(`Unexpected MCP response content-type: ${contentType || "unknown"} (${text.slice(0, 200)})`);
    } finally {
      cleanup();
    }
  }

  private nextId(): JsonRpcId {
    this.requestCounter += 1;
    return `ref-mcp-${this.requestCounter}`;
  }
}

function extractJsonRpcResponse(response: unknown, requestId: unknown): JsonRpcResponse {
  if (Array.isArray(response)) {
    const match = response.find((item) => isJsonRpcResponse(item) && item.id === requestId);
    if (match) {
      return match;
    }
    throw new Error("MCP response did not include matching request id.");
  }

  if (isJsonRpcResponse(response)) {
    return response;
  }

  throw new Error("Invalid MCP response payload.");
}

export function extractSseData(line: string): string | undefined {
  if (!line.startsWith("data:")) {
    return undefined;
  }

  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") {
    return undefined;
  }

  return data;
}

export function parseMatchingSseMessage(data: string, requestId: unknown): unknown {
  try {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed) && parsed.id === requestId) {
      return parsed;
    }
  } catch {
    // Ignore malformed SSE chunk.
  }

  return undefined;
}

export function extractMatchingSseResponse(
  buffer: string,
  requestId: unknown,
): { remainingBuffer: string; matched: unknown } {
  let remainingBuffer = buffer;
  let newlineIndex = remainingBuffer.indexOf("\n");

  while (newlineIndex >= 0) {
    const line = remainingBuffer.slice(0, newlineIndex).trimEnd();
    remainingBuffer = remainingBuffer.slice(newlineIndex + 1);
    newlineIndex = remainingBuffer.indexOf("\n");

    const data = extractSseData(line);
    if (!data) {
      continue;
    }

    const matched = parseMatchingSseMessage(data, requestId);
    if (matched) {
      return { remainingBuffer, matched };
    }
  }

  return { remainingBuffer, matched: undefined };
}

async function parseSseResponse(response: Response, requestId: unknown): Promise<unknown> {
  if (!response.body) {
    throw new Error("MCP response stream missing body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const result = extractMatchingSseResponse(buffer, requestId);
    buffer = result.remainingBuffer;

    if (result.matched) {
      await reader.cancel();
      return result.matched;
    }
  }

  throw new Error("MCP SSE response ended without a matching result.");
}

function createMergedSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;

  const handleAbort = () => {
    controller.abort();
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", handleAbort, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (parentSignal) {
        parentSignal.removeEventListener("abort", handleAbort);
      }
    },
  };
}

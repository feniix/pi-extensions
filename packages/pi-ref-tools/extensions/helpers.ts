import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";

export type JsonRpcId = string;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: JsonRpcId | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpToolResult {
  content?: Array<Record<string, unknown>>;
  isError?: boolean;
}

export interface McpToolDetails {
  tool: string;
  endpoint: string;
  truncated: boolean;
  truncation?: {
    truncatedBy: "lines" | "bytes" | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    maxLines: number;
    maxBytes: number;
  };
  tempFile?: string;
}

export interface McpErrorDetails {
  tool: string;
  endpoint: string;
  error: string;
}

export interface RequestedLimits {
  maxBytes?: number;
  maxLines?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && value.jsonrpc === "2.0";
}

export function toJsonString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function writeTempFile(toolName: string, content: string): string {
  const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
  const filename = `pi-ref-tools-${safeName}-${Date.now()}.txt`;
  const filePath = join(tmpdir(), filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function formatToolOutput(
  toolName: string,
  endpoint: string,
  result: McpToolResult,
  limits?: RequestedLimits,
): { text: string; details: McpToolDetails } {
  const contentBlocks = Array.isArray(result.content) ? result.content : [];
  const renderedBlocks =
    contentBlocks.length > 0
      ? contentBlocks.map((block) => {
          if (block.type === "text" && typeof block.text === "string") {
            return block.text;
          }
          return toJsonString(block);
        })
      : [toJsonString(result)];

  const rawText = renderedBlocks.join("\n");
  const truncation = truncateHead(rawText, {
    maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let tempFile: string | undefined;

  if (truncation.truncated) {
    tempFile = writeTempFile(toolName, rawText);
    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
      `Full output saved to: ${tempFile}]`;
  }

  if (truncation.firstLineExceedsLimit && rawText.length > 0) {
    text =
      `[First line exceeded ${formatSize(truncation.maxBytes)} limit. Full output saved to: ${tempFile ?? "N/A"}]\n` +
      text;
  }

  return {
    text,
    details: {
      tool: toolName,
      endpoint,
      truncated: truncation.truncated,
      truncation: {
        truncatedBy: truncation.truncatedBy,
        totalLines: truncation.totalLines,
        totalBytes: truncation.totalBytes,
        outputLines: truncation.outputLines,
        outputBytes: truncation.outputBytes,
        maxLines: truncation.maxLines,
        maxBytes: truncation.maxBytes,
      },
      tempFile,
    },
  };
}

export function parseTimeoutMs(value: string | number | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export function splitParams(params: Record<string, unknown>): {
  mcpArgs: Record<string, unknown>;
  requestedLimits: RequestedLimits;
} {
  const { piMaxBytes, piMaxLines, ...rest } = params as Record<string, unknown> & {
    piMaxBytes?: unknown;
    piMaxLines?: unknown;
  };

  return {
    mcpArgs: rest,
    requestedLimits: {
      maxBytes: normalizeNumber(piMaxBytes),
      maxLines: normalizeNumber(piMaxLines),
    },
  };
}

export function resolveEffectiveLimits(requested: RequestedLimits, maxAllowed: Required<RequestedLimits>) {
  const requestedBytes = requested.maxBytes ?? maxAllowed.maxBytes;
  const requestedLines = requested.maxLines ?? maxAllowed.maxLines;

  return {
    maxBytes: Math.min(requestedBytes, maxAllowed.maxBytes),
    maxLines: Math.min(requestedLines, maxAllowed.maxLines),
  };
}

export function redactApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return "(none)";
  }

  if (apiKey.length <= 8) {
    return "***";
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

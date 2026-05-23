import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.js";

export interface McpToolDetails {
  tool: string;
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
  warning?: string;
}

interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  firstLineExceedsLimit: boolean;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
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

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

function truncateByBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) {
    return value;
  }

  let output = "";
  for (const char of value) {
    const next = output + char;
    if (byteLength(next) > maxBytes) {
      break;
    }
    output = next;
  }
  return output;
}

function truncateHead(content: string, limits: { maxLines: number; maxBytes: number }): TruncationResult {
  const totalBytes = byteLength(content);
  const lines = content.split("\n");
  const totalLines = lines.length;

  let output = totalLines > limits.maxLines ? lines.slice(0, limits.maxLines).join("\n") : content;
  let truncatedBy: "lines" | "bytes" | null = output === content ? null : "lines";

  if (byteLength(output) > limits.maxBytes) {
    output = truncateByBytes(output, limits.maxBytes);
    truncatedBy = "bytes";
  }

  const outputLines = output.length === 0 ? 0 : output.split("\n").length;
  const outputBytes = byteLength(output);

  return {
    content: output,
    truncated: output !== content,
    truncatedBy,
    firstLineExceedsLimit: lines[0] !== undefined && byteLength(lines[0]) > limits.maxBytes,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes,
    maxLines: limits.maxLines,
    maxBytes: limits.maxBytes,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function writeTempFile(toolName: string, content: string): string {
  const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
  const filename = `pi-code-reasoning-${safeName}-${Date.now()}-${randomUUID()}.txt`;
  const filePath = join(tmpdir(), filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function formatToolOutput(
  toolName: string,
  result: unknown,
  limits: { maxBytes?: number; maxLines?: number },
): { text: string; details: McpToolDetails } {
  const rawText = toJsonString(result);
  const truncation = truncateHead(rawText, {
    maxLines: limits?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: limits?.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let tempFile: string | undefined;
  let warning: string | undefined;

  if (truncation.truncated) {
    try {
      tempFile = writeTempFile(toolName, rawText);
    } catch (error) {
      warning = `Full output could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    }

    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
      (tempFile ? `Full output saved to: ${tempFile}` : warning) +
      "]";
  }

  if (truncation.firstLineExceedsLimit && rawText.length > 0) {
    const fullOutputLocation = tempFile
      ? `Full output saved to: ${tempFile}`
      : (warning ?? "Full output could not be saved");
    text = `[First line exceeded ${formatSize(truncation.maxBytes)} limit. ${fullOutputLocation}]\n${text}`;
  }

  return {
    text,
    details: {
      tool: toolName,
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
      warning,
    },
  };
}

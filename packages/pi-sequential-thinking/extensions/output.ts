/**
 * Tool output formatting and truncation for Sequential Thinking.
 *
 * Handles serialization of tool results, byte/line truncation, and
 * spillover to a temp file when output exceeds the configured limits.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import type { ValidationError } from "./types.js";

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
  error?: string;
  validationErrors?: ValidationError[];
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

export function writeTempFile(toolName: string, content: string): string | undefined {
  const safeName = toolName.replace(/[^a-z0-9_-]/gi, "_");
  // Date.now() alone collides if two truncations fire within 1ms (e.g. rapid
  // back-to-back tool calls). The uuid suffix guarantees uniqueness while
  // keeping the timestamp for human-readable ordering of overflow files.
  const filename = `pi-seq-think-${safeName}-${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
  const filePath = join(tmpdir(), filename);
  try {
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  } catch (error) {
    // If /tmp is full or unwritable, the truncated tool result is still
    // useful — don't convert a successful tool call into an error.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-sequential-thinking] Could not write truncation overflow file: ${message}`);
    return undefined;
  }
}

export function formatToolOutput(
  toolName: string,
  result: unknown,
  limits: { maxBytes?: number; maxLines?: number },
): { text: string; details: McpToolDetails } {
  const rawText = toJsonString(result);
  const truncation = truncateHead(rawText, {
    maxLines: limits.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: limits.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  let text = truncation.content;
  let tempFile: string | undefined;

  if (truncation.truncated) {
    tempFile = writeTempFile(toolName, rawText);
    const tempSuffix = tempFile
      ? `Full output saved to: ${tempFile}`
      : "Full output unavailable (could not write overflow file)";
    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${tempSuffix}]`;
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

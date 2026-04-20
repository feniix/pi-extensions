import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatToolOutput,
  isJsonRpcResponse,
  isRecord,
  normalizeNumber,
  redactApiKey,
  resolveEffectiveLimits,
  splitParams,
  toJsonString,
  writeTempFile,
} from "../extensions/index.js";

describe("pi-ref-tools helper utilities", () => {
  it("splits params and clamps limits", () => {
    const { mcpArgs, requestedLimits } = splitParams({
      piMaxBytes: "100",
      piMaxLines: 5,
      query: "hello",
    });

    expect(mcpArgs).toEqual({ query: "hello" });
    expect(requestedLimits).toEqual({ maxBytes: 100, maxLines: 5 });

    const effective = resolveEffectiveLimits({ maxBytes: 200, maxLines: 2 }, { maxBytes: 120, maxLines: 10 });
    expect(effective).toEqual({ maxBytes: 120, maxLines: 2 });
  });

  it("uses configured limits when no overrides are requested", () => {
    expect(resolveEffectiveLimits({}, { maxBytes: 51200, maxLines: 2000 })).toEqual({
      maxBytes: 51200,
      maxLines: 2000,
    });
  });

  it("supports byte-only or line-only overrides", () => {
    expect(resolveEffectiveLimits({ maxBytes: 100 }, { maxBytes: 51200, maxLines: 2000 })).toEqual({
      maxBytes: 100,
      maxLines: 2000,
    });
    expect(resolveEffectiveLimits({ maxLines: 500 }, { maxBytes: 51200, maxLines: 2000 })).toEqual({
      maxBytes: 51200,
      maxLines: 500,
    });
  });

  it("normalizes numeric values", () => {
    expect(normalizeNumber(42)).toBe(42);
    expect(normalizeNumber("123")).toBe(123);
    expect(normalizeNumber("abc")).toBeUndefined();
    expect(normalizeNumber(null)).toBeUndefined();
    expect(normalizeNumber(undefined)).toBeUndefined();
    expect(normalizeNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("redacts API keys", () => {
    expect(redactApiKey(undefined)).toBe("(none)");
    expect(redactApiKey("short")).toBe("***");
    expect(redactApiKey("abcdefghijklmnop")).toBe("abcd...mnop");
  });
});

describe("pi-ref-tools type guards", () => {
  it("recognizes plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({ nested: { deep: true } })).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("recognizes JSON-RPC responses", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", result: {} })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: "test" })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: "abc", error: { code: -32600, message: "Invalid" } })).toBe(true);
    expect(isJsonRpcResponse({})).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: "1.0" })).toBe(false);
    expect(isJsonRpcResponse(null)).toBe(false);
  });
});

describe("pi-ref-tools serialization and formatting", () => {
  it("returns strings as-is and stringifies other values", () => {
    expect(toJsonString("hello")).toBe("hello");
    expect(toJsonString(42)).toBe("42");
    expect(toJsonString(true)).toBe("true");
    expect(toJsonString(null)).toBe("null");
    expect(JSON.parse(toJsonString({ a: 1, b: 2 }))).toEqual({ a: 1, b: 2 });
  });

  it("formats text output without truncation", () => {
    const result = formatToolOutput(
      "test_tool",
      "https://api.example.com",
      { content: [{ type: "text", text: "Hello World" }] },
      { maxBytes: 50000, maxLines: 2000 },
    );

    expect(result.text).toBe("Hello World");
    expect(result.details.truncated).toBe(false);
  });

  it("formats fallback and mixed content blocks", () => {
    const withoutContent = formatToolOutput("test_tool", "https://api.example.com", { result: "data" } as never);
    const mixed = formatToolOutput("test_tool", "https://api.example.com", {
      content: [
        { type: "image", url: "https://example.com/img.png" },
        { type: "text", text: "Description" },
      ],
    });

    expect(withoutContent.text).toContain("data");
    expect(mixed.text).toContain("Description");
  });

  it("truncates long output and includes temp file details", () => {
    const longText = Array.from({ length: 100 }, (_, index) => `Line ${index + 1}`).join("\n");
    const result = formatToolOutput(
      "test_tool",
      "https://api.example.com",
      { content: [{ type: "text", text: longText }] },
      { maxBytes: 100000, maxLines: 10 },
    );

    expect(result.details.truncated).toBe(true);
    expect(result.details.truncation?.truncatedBy).toBe("lines");
    expect(result.details.tempFile).toBeDefined();
    expect(result.text).toContain("Full output saved to:");
  });
});

describe("pi-ref-tools temp files", () => {
  const tempFiles: string[] = [];

  afterEach(async () => {
    const { unlinkSync } = await import("node:fs");
    for (const file of tempFiles.splice(0)) {
      try {
        unlinkSync(file);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("writes temp files with sanitized names and content", () => {
    const content = "test content\nwith multiple lines";
    const filePath = writeTempFile("my-tool-123!@#", content);
    tempFiles.push(filePath);

    expect(filePath).toContain("pi-ref-tools-my-tool-123__");
    expect(filePath).toContain(".txt");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe(content);
  });
});

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
	DEFAULT_CONFIG_FILE,
	ensureDefaultConfigFile,
	formatToolOutput,
	isJsonRpcResponse,
	isRecord,
	normalizeNumber,
	parseConfig,
	parseTimeoutMs,
	redactApiKey,
	resolveConfigPath,
	resolveEffectiveLimits,
	splitParams,
	toJsonString,
	writeTempFile,
} from "../extensions/index.js";

describe("pi-ref-tools helpers", () => {
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

	it("resolves effective limits using defaults when not requested", () => {
		const effective = resolveEffectiveLimits({}, { maxBytes: 51200, maxLines: 2000 });
		expect(effective).toEqual({ maxBytes: 51200, maxLines: 2000 });
	});

	it("parses timeout values", () => {
		expect(parseTimeoutMs("250", 10)).toBe(250);
		expect(parseTimeoutMs("0", 10)).toBe(10);
		expect(parseTimeoutMs(undefined, 30000)).toBe(30000);
		expect(parseTimeoutMs("abc", 500)).toBe(500);
	});

	it("normalizes numbers from strings and numbers", () => {
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

	it("writes default config when none exists", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-ref-config-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "ref-tools.json");
		const globalConfigPath = join(base, "global", "extensions", "ref-tools.json");

		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);

		expect(existsSync(globalConfigPath)).toBe(true);
		const raw = readFileSync(globalConfigPath, "utf-8");
		expect(JSON.parse(raw)).toEqual(DEFAULT_CONFIG_FILE);
	});

	it("does not overwrite existing config", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-ref-config-exists-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "ref-tools.json");
		const globalConfigPath = join(base, "global", "extensions", "ref-tools.json");

		// First call creates the file
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const firstContent = readFileSync(globalConfigPath, "utf-8");

		// Second call should not overwrite
		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const secondContent = readFileSync(globalConfigPath, "utf-8");

		expect(firstContent).toBe(secondContent);
	});
});

describe("pi-ref-tools type guards", () => {
	it("isRecord returns true for plain objects", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
		expect(isRecord({ nested: { deep: true } })).toBe(true);
	});

	it("isRecord returns false for non-objects", () => {
		expect(isRecord(null)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
		expect(isRecord("string")).toBe(false);
		expect(isRecord(123)).toBe(false);
		expect(isRecord(true)).toBe(false);
		expect(isRecord([])).toBe(false);
		expect(isRecord([1, 2, 3])).toBe(false);
	});

	it("isJsonRpcResponse returns true for valid responses", () => {
		expect(isJsonRpcResponse({ jsonrpc: "2.0", result: {} })).toBe(true);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: "test" })).toBe(true);
		expect(
			isJsonRpcResponse({ jsonrpc: "2.0", id: "abc", error: { code: -32600, message: "Invalid" } }),
		).toBe(true);
	});

	it("isJsonRpcResponse returns false for invalid responses", () => {
		expect(isJsonRpcResponse({})).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "1.0" })).toBe(false);
		expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1 })).toBe(true); // passes isRecord and has jsonrpc 2.0
		expect(isJsonRpcResponse(null)).toBe(false);
		expect(isJsonRpcResponse("string")).toBe(false);
	});
});

describe("pi-ref-tools toJsonString", () => {
	it("returns strings as-is", () => {
		expect(toJsonString("hello")).toBe("hello");
		expect(toJsonString("")).toBe("");
	});

	it("stringifies objects", () => {
		const result = toJsonString({ a: 1, b: 2 });
		expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
	});

	it("converts primitives", () => {
		expect(toJsonString(42)).toBe("42");
		expect(toJsonString(true)).toBe("true");
		expect(toJsonString(null)).toBe("null");
	});
});

describe("pi-ref-tools resolveConfigPath", () => {
	it("resolves paths starting with ~/", () => {
		const result = resolveConfigPath("~/.pi/config.json");
		expect(result).toContain(homedir());
		expect(result).toContain(".pi/config.json");
	});

	it("resolves paths starting with ~", () => {
		const result = resolveConfigPath("~/.pi/config.json");
		expect(result).toContain(".pi/config.json");
	});

	it("returns absolute paths as-is", () => {
		const absolute = "/absolute/path/to/config.json";
		expect(resolveConfigPath(absolute)).toBe(absolute);
	});

	it("resolves relative paths from cwd", () => {
		const result = resolveConfigPath("relative/path.json");
		expect(result).toBe(resolve(process.cwd(), "relative/path.json"));
	});

	it("trims whitespace", () => {
		const result = resolveConfigPath("  ~/.pi/config.json  ");
		expect(result).toContain(".pi/config.json");
	});
});

describe("pi-ref-tools parseConfig", () => {
	it("parses valid config", () => {
		const raw = {
			url: "https://api.example.com/mcp",
			apiKey: "secret-key",
			timeoutMs: 15000,
			protocolVersion: "2025-01-01",
			maxBytes: 1024,
			maxLines: 500,
		};
		const result = parseConfig(raw, "/path/to/config.json");
		expect(result).toEqual({
			url: "https://api.example.com/mcp",
			apiKey: "secret-key",
			timeoutMs: 15000,
			protocolVersion: "2025-01-01",
			maxBytes: 1024,
			maxLines: 500,
		});
	});

	it("normalizes string values", () => {
		const raw = { url: "  https://api.example.com  ", apiKey: "  " };
		const result = parseConfig(raw, "/path");
		expect(result.url).toBe("https://api.example.com");
		expect(result.apiKey).toBeUndefined(); // empty after trim
	});

	it("ignores null/undefined values", () => {
		const raw = { url: null, apiKey: undefined, timeoutMs: NaN };
		const result = parseConfig(raw, "/path");
		expect(result.url).toBeUndefined();
		expect(result.apiKey).toBeUndefined();
		expect(result.timeoutMs).toBeUndefined(); // NaN is not finite
	});

	it("throws for non-object config", () => {
		expect(() => parseConfig(null, "/path")).toThrow("Invalid Ref MCP config");
		expect(() => parseConfig("string", "/path")).toThrow("Invalid Ref MCP config");
		expect(() => parseConfig(123, "/path")).toThrow("Invalid Ref MCP config");
	});
});

describe("pi-ref-tools formatToolOutput", () => {
	it("formats simple text result", () => {
		const result = formatToolOutput(
			"test_tool",
			"https://api.example.com",
			{ content: [{ type: "text", text: "Hello World" }] },
			{ maxBytes: 50000, maxLines: 2000 },
		);
		expect(result.text).toBe("Hello World");
		expect(result.details.truncated).toBe(false);
	});

	it("formats result without content array", () => {
		const result = formatToolOutput("test_tool", "https://api.example.com", { result: "data" });
		expect(result.text).toContain("data");
	});

	it("handles multiple content blocks", () => {
		const result = formatToolOutput(
			"test_tool",
			"https://api.example.com",
			{
				content: [
					{ type: "text", text: "Block 1" },
					{ type: "text", text: "Block 2" },
				],
			},
		);
		expect(result.text).toContain("Block 1");
		expect(result.text).toContain("Block 2");
	});
});

describe("pi-ref-tools writeTempFile", () => {
	const tempFiles: string[] = [];

	afterEach(() => {
		import("node:fs").then(({ unlinkSync }) => {
			tempFiles.forEach((f) => {
				try {
					unlinkSync(f);
				} catch {
					// ignore cleanup errors
				}
			});
		});
	});

	it("writes temp file and returns path", () => {
		const path = writeTempFile("test_tool", "content here");
		tempFiles.push(path);
		expect(path).toContain("pi-ref-tools-test_tool");
		expect(path).toContain(".txt");
		expect(existsSync(path)).toBe(true);
	});

	it("sanitizes tool name", () => {
		const path = writeTempFile("my-tool-123!@#", "content");
		tempFiles.push(path);
		expect(path).toContain("my-tool-123__");
	});

	it("writes correct content", () => {
		const content = "test content\nwith multiple lines";
		const path = writeTempFile("test", content);
		tempFiles.push(path);
		expect(readFileSync(path, "utf-8")).toBe(content);
	});
});

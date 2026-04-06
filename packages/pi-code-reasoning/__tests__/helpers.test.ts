import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
	DEFAULT_CONFIG_FILE,
	formatToolOutput,
	isRecord,
	normalizeNumber,
	parseConfig,
	resolveConfigPath,
	resolveEffectiveLimits,
	splitParams,
	toJsonString,
	writeTempFile,
} from "../extensions/index.js";

describe("pi-code-reasoning helpers", () => {
	it("splits params and clamps limits", () => {
		const { toolArgs, requestedLimits } = splitParams({
			piMaxBytes: "100",
			piMaxLines: 5,
			thought: "hello",
			thought_number: 1,
			total_thoughts: 3,
			next_thought_needed: true,
		});
		expect(toolArgs).toEqual({
			thought: "hello",
			thought_number: 1,
			total_thoughts: 3,
			next_thought_needed: true,
		});
		expect(requestedLimits).toEqual({ maxBytes: 100, maxLines: 5 });

		const effective = resolveEffectiveLimits({ maxBytes: 200, maxLines: 2 }, { maxBytes: 120, maxLines: 10 });
		expect(effective).toEqual({ maxBytes: 120, maxLines: 2 });
	});

	it("resolves effective limits using defaults when not requested", () => {
		const effective = resolveEffectiveLimits({}, { maxBytes: 51200, maxLines: 2000 });
		expect(effective).toEqual({ maxBytes: 51200, maxLines: 2000 });
	});

	it("normalizes numbers from strings and numbers", () => {
		expect(normalizeNumber(42)).toBe(42);
		expect(normalizeNumber("123")).toBe(123);
		expect(normalizeNumber("abc")).toBeUndefined();
		expect(normalizeNumber(null)).toBeUndefined();
		expect(normalizeNumber(undefined)).toBeUndefined();
		expect(normalizeNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
	});

	it("returns DEFAULT_CONFIG_FILE", () => {
		expect(DEFAULT_CONFIG_FILE).toHaveProperty("maxBytes");
		expect(DEFAULT_CONFIG_FILE).toHaveProperty("maxLines");
	});
});

describe("pi-code-reasoning type guards", () => {
	it("isRecord returns true for plain objects", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
	});

	it("isRecord returns false for non-objects", () => {
		expect(isRecord(null)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
		expect(isRecord("string")).toBe(false);
		expect(isRecord(123)).toBe(false);
		expect(isRecord([])).toBe(false);
	});
});

describe("pi-code-reasoning toJsonString", () => {
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

describe("pi-code-reasoning resolveConfigPath", () => {
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
});

describe("pi-code-reasoning parseConfig", () => {
	it("parses valid config", () => {
		const raw = {
			maxBytes: 1024,
			maxLines: 500,
		};
		const result = parseConfig(raw, "/path/to/config.json");
		expect(result).toEqual({
			maxBytes: 1024,
			maxLines: 500,
		});
	});

	it("ignores null/undefined values", () => {
		const raw = { maxBytes: undefined, maxLines: NaN };
		const result = parseConfig(raw, "/path");
		expect(result.maxBytes).toBeUndefined();
		expect(result.maxLines).toBeUndefined();
	});

	it("throws for non-object config", () => {
		expect(() => parseConfig(null, "/path")).toThrow("Invalid Code Reasoning config");
		expect(() => parseConfig("string", "/path")).toThrow("Invalid Code Reasoning config");
		expect(() => parseConfig(123, "/path")).toThrow("Invalid Code Reasoning config");
	});
});

describe("pi-code-reasoning formatToolOutput", () => {
	it("formats simple result", () => {
		const result = formatToolOutput("test_tool", { message: "Hello" }, { maxBytes: 50000, maxLines: 2000 });
		expect(result.text).toContain("Hello");
		expect(result.details.truncated).toBe(false);
	});

	it("handles object result", () => {
		const result = formatToolOutput("test_tool", { data: 123 }, {});
		expect(result.text).toContain("data");
		expect(result.text).toContain("123");
	});
});

describe("pi-code-reasoning writeTempFile", () => {
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
		expect(path).toContain("pi-code-reasoning-test_tool");
		expect(path).toContain(".txt");
		expect(existsSync(path)).toBe(true);
	});

	it("sanitizes tool name", () => {
		const path = writeTempFile("my-tool!@#", "content");
		tempFiles.push(path);
		expect(path).toContain("my-tool__");
	});
});

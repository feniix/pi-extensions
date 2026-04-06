import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONFIG_FILE,
	ensureDefaultConfigFile,
	normalizeNumber,
	parseTimeoutMs,
	redactApiKey,
	resolveEffectiveLimits,
	splitParams,
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

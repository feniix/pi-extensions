import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONFIG_FILE,
	ensureDefaultConfigFile,
	normalizeNumber,
	resolveEffectiveLimits,
	splitParams,
} from "../extensions/index.js";

describe("pi-sequential-thinking helpers", () => {
	it("splits params and clamps limits", () => {
		const { toolArgs, requestedLimits } = splitParams({
			piMaxBytes: "100",
			piMaxLines: 5,
			thought: "hello",
			thought_number: 1,
			total_thoughts: 3,
			next_thought_needed: true,
			stage: "Analysis",
		});
		expect(toolArgs).toEqual({
			thought: "hello",
			thought_number: 1,
			total_thoughts: 3,
			next_thought_needed: true,
			stage: "Analysis",
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

	it("writes default config when none exists", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-seq-think-config-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "sequential-thinking.json");
		const globalConfigPath = join(base, "global", "extensions", "sequential-thinking.json");

		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);

		expect(existsSync(globalConfigPath)).toBe(true);
		const raw = readFileSync(globalConfigPath, "utf-8");
		expect(JSON.parse(raw)).toEqual(DEFAULT_CONFIG_FILE);
	});

	it("does not overwrite existing config", () => {
		const base = mkdtempSync(join(tmpdir(), "pi-seq-think-config-exists-"));
		const projectConfigPath = join(base, "project", ".pi", "extensions", "sequential-thinking.json");
		const globalConfigPath = join(base, "global", "extensions", "sequential-thinking.json");

		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const firstContent = readFileSync(globalConfigPath, "utf-8");

		ensureDefaultConfigFile(projectConfigPath, globalConfigPath);
		const secondContent = readFileSync(globalConfigPath, "utf-8");

		expect(firstContent).toBe(secondContent);
	});
});

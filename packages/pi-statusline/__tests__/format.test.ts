import { describe, expect, it } from "vitest";

import { C, formatContextPct, formatTokenCount, formatTokenPair, joinWidgets } from "../src/format.js";

describe("formatTokenCount", () => {
	it("formats numbers below 1k as-is", () => {
		expect(formatTokenCount(0)).toBe("0");
		expect(formatTokenCount(999)).toBe("999");
	});

	it("formats thousands as k", () => {
		expect(formatTokenCount(1000)).toBe("1.0k");
		expect(formatTokenCount(10500)).toBe("10.5k");
		expect(formatTokenCount(100_000)).toBe("100k");
		expect(formatTokenCount(999_500)).toBe("1000k");
	});

	it("formats millions as M", () => {
		expect(formatTokenCount(1_000_000)).toBe("1.0M");
		expect(formatTokenCount(1_500_000)).toBe("1.5M");
		expect(formatTokenCount(10_000_000)).toBe("10.0M");
	});
});

describe("formatTokenPair", () => {
	it("formats input/output with arrows and slash", () => {
		expect(formatTokenPair(10_500, 3200)).toBe("↑10.5k/↓3.2k");
		expect(formatTokenPair(1_000, 500)).toBe("↑1.0k/↓500");
		expect(formatTokenPair(0, 0)).toBe("↑0/↓0");
	});
});

describe("formatContextPct", () => {
	it("returns '?' for null", () => {
		expect(formatContextPct(null)).toBe("?");
	});

	it("formats to one decimal place", () => {
		expect(formatContextPct(11.023)).toBe("11.0");
		expect(formatContextPct(9.5)).toBe("9.5");
		expect(formatContextPct(100)).toBe("100.0");
	});
});

describe("joinWidgets", () => {
	it("returns empty string for no segments", () => {
		expect(joinWidgets()).toBe("");
	});

	it("joins single segment", () => {
		const result = joinWidgets("foo");
		expect(result.endsWith("foo")).toBe(true);
	});

	it("joins multiple segments with pipe separator", () => {
		const result = joinWidgets("a", "b", "c");
		expect(result).toContain(" | ");
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result).toContain("c");
	});
});

describe("C colors", () => {
	it("all color functions return non-empty strings", () => {
		const tests: Array<[string, (t: string) => string]> = [
			["cyan", C.cyan],
			["magenta", C.magenta],
			["blue", C.blue],
			["yellow", C.yellow],
			["brightBlack", C.brightBlack],
			["green", C.green],
		];
		for (const [_name, fn] of tests) {
			const result = fn("test");
			expect(result.length).toBeGreaterThan(0);
			expect(result).toContain("test");
		}
	});

	it("bold wraps text with ANSI bold and reset", () => {
		const result = C.bold("test");
		expect(result).toContain("test");
		expect(result).toContain("\x1b[1m");
		expect(result).toContain("\x1b[0m");
	});
});

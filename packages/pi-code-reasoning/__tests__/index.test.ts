import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import codeReasoning from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		on: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

describe("pi-code-reasoning", () => {
	it("registers tools", () => {
		const mockPi = createMockPi();
		codeReasoning(mockPi as unknown as ExtensionAPI);

		const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(toolNames).toEqual(
			expect.arrayContaining(["code_reasoning", "code_reasoning_status", "code_reasoning_reset"]),
		);
	});

	it("registers flags", () => {
		const mockPi = createMockPi();
		codeReasoning(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toEqual(
			expect.arrayContaining(["--code-reasoning-config", "--code-reasoning-max-bytes", "--code-reasoning-max-lines"]),
		);
	});
});

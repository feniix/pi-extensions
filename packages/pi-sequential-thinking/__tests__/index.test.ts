import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import sequentialThinking from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		on: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

describe("pi-sequential-thinking", () => {
	it("registers tools", () => {
		const mockPi = createMockPi();
		sequentialThinking(mockPi as unknown as ExtensionAPI);

		const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(toolNames).toEqual(
			expect.arrayContaining([
				"process_thought",
				"generate_summary",
				"clear_history",
				"export_session",
				"import_session",
			]),
		);
	});

	it("registers flags", () => {
		const mockPi = createMockPi();
		sequentialThinking(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toEqual(
			expect.arrayContaining([
				"--seq-think-command",
				"--seq-think-args",
				"--seq-think-storage-dir",
				"--seq-think-config",
				"--seq-think-max-bytes",
				"--seq-think-max-lines",
			]),
		);
	});

	it("registers session_shutdown handler", () => {
		const mockPi = createMockPi();
		sequentialThinking(mockPi as unknown as ExtensionAPI);

		const eventNames = mockPi.on.mock.calls.map(([event]) => event);
		expect(eventNames).toContain("session_shutdown");
	});
});

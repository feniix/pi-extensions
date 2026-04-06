import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import refTools from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

describe("pi-ref-tools", () => {
	it("registers tools", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(toolNames).toEqual(expect.arrayContaining(["ref_search_documentation", "ref_read_url"]));
	});

	it("registers flags", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toEqual(
			expect.arrayContaining([
				"--ref-mcp-url",
				"--ref-mcp-api-key",
				"--ref-mcp-timeout-ms",
				"--ref-mcp-protocol",
				"--ref-mcp-config",
				"--ref-mcp-max-bytes",
				"--ref-mcp-max-lines",
			]),
		);
	});
});

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import refTools from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		on: vi.fn(),
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

	it("registers exactly 2 tools", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(toolNames).toHaveLength(2);
	});

	it("registers exactly 7 flags", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toHaveLength(7);
	});

	it("registers tool with correct parameters schema", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "ref_search_documentation");
		expect(searchTool).toBeDefined();
		expect(searchTool?.parameters).toBeDefined();
		expect(searchTool?.execute).toBeDefined();
	});

	it("registers tool with description", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "ref_search_documentation");
		expect(searchTool?.description).toContain("Ref");
	});

	it("registers tool with label", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "ref_search_documentation");
		expect(searchTool?.label).toBe("Ref Doc Search");
	});

	it("registers flags with string type", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const flags = mockPi.registerFlag.mock.calls.map(([name, opts]) => ({ name, ...opts }));
		const urlFlag = flags.find((f) => f.name === "--ref-mcp-url");
		expect(urlFlag?.type).toBe("string");
	});

	it("registers flags with descriptions", () => {
		const mockPi = createMockPi();
		refTools(mockPi as unknown as ExtensionAPI);

		const flags = mockPi.registerFlag.mock.calls.map(([name, opts]) => ({ name, ...opts }));
		flags.forEach((flag) => {
			expect(flag.description).toBeDefined();
			expect(typeof flag.description).toBe("string");
		});
	});
});

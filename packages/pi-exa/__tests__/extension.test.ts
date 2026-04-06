import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import exaExtension from "../extensions/index.js";

const createMockPi = () =>
	({
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerTool: vi.fn(),
		on: vi.fn(),
	}) satisfies Partial<ExtensionAPI>;

describe("pi-exa extension", () => {
	it("registers flags", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toContain("--exa-api-key");
		expect(flagNames).toContain("--exa-enable-advanced");
		expect(flagNames).toContain("--exa-config");
	});

	it("registers exactly 3 flags", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
		expect(flagNames).toHaveLength(3);
	});

	it("registers web_search_exa by default", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "web_search_exa");
		expect(searchTool).toBeDefined();
	});

	it("registers web_fetch_exa by default", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const fetchTool = tools.find((t) => t.name === "web_fetch_exa");
		expect(fetchTool).toBeDefined();
	});

	it("does not register web_search_advanced_exa by default", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
		expect(toolNames).not.toContain("web_search_advanced_exa");
	});

// Skipped: requires mocking config loading which has file system dependencies
	it.skip("registers web_search_advanced_exa when advanced enabled", () => {
		// This test is skipped because the config loading has file system dependencies
		// that are hard to mock properly in unit tests
	});

	it("registers tools with execute functions", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		expect(tools.length).toBeGreaterThan(0);
		tools.forEach((tool) => {
			expect(tool.execute).toBeDefined();
			expect(typeof tool.execute).toBe("function");
		});
	});

	it("registers tools with labels", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "web_search_exa");
		expect(searchTool?.label).toBe("Exa Web Search");
	});

	it("registers tools with descriptions", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		tools.forEach((tool) => {
			expect(tool.description).toBeDefined();
			expect(tool.description.length).toBeGreaterThan(0);
		});
	});

	it("registers tools with parameters", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		tools.forEach((tool) => {
			expect(tool.parameters).toBeDefined();
		});
	});

	it("registers flags with string type for api-key", () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const flags = mockPi.registerFlag.mock.calls.map(([name, opts]) => ({ name, ...opts }));
		const apiKeyFlag = flags.find((f) => f.name === "--exa-api-key");
		expect(apiKeyFlag?.type).toBe("string");
	});

	it("handles missing API key gracefully", async () => {
		// Clear environment variable
		const originalEnv = process.env.EXA_API_KEY;
		delete process.env.EXA_API_KEY;

		const mockPi = createMockPi();
		mockPi.getFlag = vi.fn(() => undefined);
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "web_search_exa");

		const result = await searchTool!.execute("call-123", { query: "test" }, undefined, undefined, undefined);

		// Without API key, should return error
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("API key not configured");

		// Restore environment
		if (originalEnv !== undefined) {
			process.env.EXA_API_KEY = originalEnv;
		}
	});

	it("handles aborted signal", async () => {
		const mockPi = createMockPi();
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "web_search_exa");

		const abortedSignal = { aborted: true } as AbortSignal;
		const result = await searchTool!.execute("call-123", { query: "test" }, abortedSignal, undefined, undefined);

		expect(result.details.cancelled).toBe(true);
	});

	it("calls onUpdate callback", async () => {
		const mockPi = createMockPi();
		// No API key set, so it will short-circuit before HTTP call
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const searchTool = tools.find((t) => t.name === "web_search_exa");

		const onUpdate = vi.fn();
		const result = await searchTool!.execute(
			"call-123",
			{ query: "test" },
			{ aborted: false } as AbortSignal,
			onUpdate,
			undefined,
		);

		// Without API key, onUpdate should still be called with pending status
		expect(onUpdate).toHaveBeenCalled();
	});

	it("handles multiple extension instances", () => {
		const mockPi1 = createMockPi();
		const mockPi2 = createMockPi();

		exaExtension(mockPi1 as unknown as ExtensionAPI);
		exaExtension(mockPi2 as unknown as ExtensionAPI);

		expect(mockPi1.registerTool).toHaveBeenCalled();
		expect(mockPi2.registerTool).toHaveBeenCalled();
	});



	it("web_fetch_exa handles missing API key", async () => {
		// Clear environment variable
		const originalEnv = process.env.EXA_API_KEY;
		delete process.env.EXA_API_KEY;

		const mockPi = createMockPi();
		mockPi.getFlag = vi.fn(() => undefined);
		exaExtension(mockPi as unknown as ExtensionAPI);

		const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
		const fetchTool = tools.find((t) => t.name === "web_fetch_exa");

		const result = await fetchTool!.execute("call-123", { urls: ["https://example.com"] }, undefined, undefined, undefined);

		// Without API key, should return error
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("API key not configured");

		// Restore environment
		if (originalEnv !== undefined) {
			process.env.EXA_API_KEY = originalEnv;
		}
	});
});

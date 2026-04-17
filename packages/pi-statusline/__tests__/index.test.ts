import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import statuslineExtension, { extractSkillName } from "../extensions/index.js";

const createMockPi = () => ({
	on: vi.fn(),
	getThinkingLevel: vi.fn(() => "medium"),
	exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "", killed: false })),
	getCommands: vi.fn(() => [{ name: "release", source: "skill" }]),
	registerTool: vi.fn(),
});

describe("pi-statusline extension", () => {
	it("registers expected event handlers", () => {
		const mockPi = createMockPi();
		statuslineExtension(mockPi as unknown as ExtensionAPI);

		const eventNames = mockPi.on.mock.calls.map(([name]) => name);
		expect(eventNames).toEqual(
			expect.arrayContaining(["session_start", "model_select", "agent_end", "input", "tool_execution_start"]),
		);
	});

	it("registers /statusline tool", () => {
		const mockPi = createMockPi();
		statuslineExtension(mockPi as unknown as ExtensionAPI);

		expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
		expect(mockPi.registerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "statusline",
				parameters: expect.any(Object),
			}),
		);
	});

	it("extracts skill names from explicit skill commands", () => {
		expect(extractSkillName("/skill:release", [])).toBe("release");
	});

	it("extracts skill names from registered skill commands", () => {
		expect(extractSkillName("/release", [{ name: "release", source: "skill" }])).toBe("release");
	});

	it("ignores non-skill slash commands", () => {
		expect(extractSkillName("/model", [{ name: "release", source: "skill" }])).toBeNull();
	});

	it("registers a custom footer on session_start", async () => {
		const mockPi = createMockPi();
		statuslineExtension(mockPi as unknown as ExtensionAPI);

		const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
		const setFooter = vi.fn();
		await sessionStartHandler?.(
			{},
			{
				cwd: "/tmp/project",
				hasUI: true,
				model: { id: "opus", contextWindow: 1_000_000 },
				sessionManager: { getBranch: () => [] },
				getContextUsage: () => ({ percent: 11 }),
				ui: { setFooter },
			},
		);

		expect(setFooter).toHaveBeenCalledTimes(1);
	});
});

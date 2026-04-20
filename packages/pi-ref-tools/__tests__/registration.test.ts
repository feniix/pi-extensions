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

describe("pi-ref-tools registration", () => {
  it("registers both tools", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const toolNames = mockPi.registerTool.mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["ref_search_documentation", "ref_read_url"]));
    expect(toolNames).toHaveLength(2);
  });

  it("registers all expected flags", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toEqual(
      expect.arrayContaining([
        "--ref-mcp-url",
        "--ref-mcp-api-key",
        "--ref-mcp-timeout-ms",
        "--ref-mcp-protocol",
        "--ref-mcp-config-file",
        "--ref-mcp-config",
        "--ref-mcp-max-bytes",
        "--ref-mcp-max-lines",
      ]),
    );
    expect(flagNames).toHaveLength(8);
  });

  it("registers labels, descriptions, and execute handlers", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const searchTool = tools.find((tool) => tool.name === "ref_search_documentation");
    const readTool = tools.find((tool) => tool.name === "ref_read_url");

    expect(searchTool?.label).toBe("Ref Doc Search");
    expect(readTool?.label).toBe("Ref Read URL");
    expect(searchTool?.description).toContain("Ref");
    expect(searchTool?.parameters).toBeDefined();
    expect(typeof searchTool?.execute).toBe("function");
    expect(typeof readTool?.execute).toBe("function");
  });

  it("registers flags with string type and descriptions", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const flags = mockPi.registerFlag.mock.calls.map(([name, options]) => ({ name, ...options }));
    const urlFlag = flags.find((flag) => flag.name === "--ref-mcp-url");

    expect(urlFlag?.type).toBe("string");
    for (const flag of flags) {
      expect(flag.description).toBeDefined();
      expect(typeof flag.description).toBe("string");
    }
  });

  it("supports multiple extension instances", () => {
    const mockPi1 = createMockPi();
    const mockPi2 = createMockPi();

    refTools(mockPi1 as unknown as ExtensionAPI);
    refTools(mockPi2 as unknown as ExtensionAPI);

    expect(mockPi1.registerTool).toHaveBeenCalledTimes(2);
    expect(mockPi2.registerTool).toHaveBeenCalledTimes(2);
  });

  it("registers a session_start handler", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("can be initialized with a config flag", () => {
    const getFlagCalls: string[] = [];
    const mockPi = {
      registerFlag: vi.fn((name: string) => {
        getFlagCalls.push(name);
      }),
      getFlag: vi.fn((flag: string) => {
        if (flag === "--ref-mcp-config-file") return "/path/to/config.json";
        return undefined;
      }),
      registerTool: vi.fn(),
      on: vi.fn(),
    };

    refTools(mockPi as unknown as ExtensionAPI);

    expect(getFlagCalls).toContain("--ref-mcp-config-file");
  });
});

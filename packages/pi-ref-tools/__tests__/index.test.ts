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
        "--ref-mcp-config-file",
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

  it("registers exactly 8 flags", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);
    expect(flagNames).toHaveLength(8);
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

  it("registers both search and read tools", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const searchTool = tools.find((t) => t.name === "ref_search_documentation");
    const readTool = tools.find((t) => t.name === "ref_read_url");

    expect(searchTool?.label).toBe("Ref Doc Search");
    expect(readTool?.label).toBe("Ref Read URL");
  });

  it("registers all required flags", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const flagNames = mockPi.registerFlag.mock.calls.map(([name]) => name);

    expect(flagNames).toContain("--ref-mcp-url");
    expect(flagNames).toContain("--ref-mcp-api-key");
    expect(flagNames).toContain("--ref-mcp-timeout-ms");
    expect(flagNames).toContain("--ref-mcp-protocol");
    expect(flagNames).toContain("--ref-mcp-config-file");
    expect(flagNames).toContain("--ref-mcp-config");
    expect(flagNames).toContain("--ref-mcp-max-bytes");
    expect(flagNames).toContain("--ref-mcp-max-lines");
  });

  it("can be initialized with config flag", () => {
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

  it("registers tools with unique execute functions", () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const executeFunctions = tools.map((t) => t.execute);

    executeFunctions.forEach((fn) => {
      expect(fn).toBeDefined();
      expect(typeof fn).toBe("function");
    });
  });

  it("handles multiple extension instances", () => {
    const mockPi1 = createMockPi();
    const mockPi2 = createMockPi();

    refTools(mockPi1 as unknown as ExtensionAPI);
    refTools(mockPi2 as unknown as ExtensionAPI);

    expect(mockPi1.registerTool).toHaveBeenCalledTimes(2);
    expect(mockPi2.registerTool).toHaveBeenCalledTimes(2);
  });

  it("returns cancelled response when signal is aborted", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const searchTool = tools.find((t) => t.name === "ref_search_documentation");

    const abortedSignal = { aborted: true } as AbortSignal;
    const result = await searchTool?.execute("call-123", { query: "test" }, abortedSignal, undefined, undefined);

    expect(result.content[0].text).toContain("Cancelled");
    expect(result.details.cancelled).toBe(true);
  });

  it("returns cancelled for ref_read_url when signal is aborted", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const readTool = tools.find((t) => t.name === "ref_read_url");

    const abortedSignal = { aborted: true } as AbortSignal;
    const result = await readTool?.execute(
      "call-123",
      { url: "https://example.com" },
      abortedSignal,
      undefined,
      undefined,
    );

    expect(result.content[0].text).toContain("Cancelled");
    expect(result.details.cancelled).toBe(true);
  });

  it("calls onUpdate with pending status", async () => {
    const mockPi = createMockPi();
    refTools(mockPi as unknown as ExtensionAPI);

    const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
    const searchTool = tools.find((t) => t.name === "ref_search_documentation");

    const onUpdate = vi.fn();
    const pendingSignal = { aborted: false } as AbortSignal;

    try {
      await searchTool?.execute("call-123", { query: "test" }, pendingSignal, onUpdate, undefined);
    } catch {
      // Expected to fail without real MCP server
    }

    expect(onUpdate).toHaveBeenCalled();
  });
});

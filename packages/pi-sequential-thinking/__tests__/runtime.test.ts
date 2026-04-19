import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import sequentialThinking from "../extensions/index.js";

const createMockPi = (flags: Record<string, string | boolean | undefined> = {}) =>
  ({
    registerFlag: vi.fn(),
    getFlag: vi.fn<(name: string) => string | boolean | undefined>((name: string) => flags[name]),
    registerTool: vi.fn(),
    on: vi.fn(),
  }) satisfies Partial<ExtensionAPI>;

const getRegisteredTool = (mockPi: ReturnType<typeof createMockPi>, name: string) => {
  const tools = mockPi.registerTool.mock.calls.map(([tool]) => tool);
  return tools.find((tool) => tool.name === name);
};

describe("pi-sequential-thinking runtime", () => {
  it("processes thoughts, summarizes, clears, exports, imports, and runs sequential_think", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-"));
    const exportPath = join(storageDir, "nested", "session.json");
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const summaryTool = getRegisteredTool(mockPi, "generate_summary");
    const clearTool = getRegisteredTool(mockPi, "clear_history");
    const exportTool = getRegisteredTool(mockPi, "export_session");
    const importTool = getRegisteredTool(mockPi, "import_session");
    const sequentialTool = getRegisteredTool(mockPi, "sequential_think");

    const onUpdate = vi.fn();
    const processResult = await processTool?.execute(
      "call-1",
      {
        thought: "We should use a feature flag for rollout",
        thought_number: 1,
        total_thoughts: 3,
        next_thought_needed: true,
        stage: "Analysis",
        tags: ["rollout"],
      },
      undefined,
      onUpdate,
      undefined,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      content: [{ type: "text", text: "Processing thought..." }],
      details: { status: "pending" },
    });
    expect(processResult.isError).toBe(false);
    expect(processResult.content[0].text).toContain("thoughtAnalysis");

    const summaryResult = await summaryTool?.execute("call-2", {}, undefined, undefined, undefined);
    expect(summaryResult.isError).toBe(false);
    expect(summaryResult.content[0].text).toContain("summary");

    const exportResult = await exportTool?.execute(
      "call-3",
      { file_path: exportPath },
      undefined,
      undefined,
      undefined,
    );
    expect(exportResult.content[0].text).toContain("Session exported");
    expect(existsSync(exportPath)).toBe(true);

    const clearResult = await clearTool?.execute("call-4", {}, undefined, undefined, undefined);
    expect(clearResult.content[0].text).toContain("Thought history cleared");

    const importResult = await importTool?.execute(
      "call-5",
      { file_path: exportPath },
      undefined,
      undefined,
      undefined,
    );
    expect(importResult.content[0].text).toContain("Session imported");

    const sequentialResult = await sequentialTool?.execute(
      "call-6",
      { topic: "Database migration strategy", num_thoughts: 5 },
      undefined,
      undefined,
      undefined,
    );
    expect(sequentialResult.isError).toBe(false);
    expect(sequentialResult.content[0].text).toContain('"database"');
  });

  it("returns validation errors for invalid runtime inputs", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-errors-"));
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const importTool = getRegisteredTool(mockPi, "import_session");

    const invalidThought = await processTool?.execute(
      "call-7",
      {
        thought: "   ",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Analysis",
      },
      undefined,
      undefined,
      undefined,
    );
    expect(invalidThought.isError).toBe(true);
    expect(invalidThought.content[0].text).toContain("Thought content cannot be empty");

    const missingImport = await importTool?.execute(
      "call-8",
      { file_path: join(storageDir, "missing.json") },
      undefined,
      undefined,
      undefined,
    );
    expect(missingImport.isError).toBe(true);
    expect(missingImport.content[0].text).toContain("File not found");
  });
});

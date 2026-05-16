import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing registered tool ${name}`);
  }
  return tool;
};

const parseToolJson = (result: { content: Array<{ text: string }> }) => JSON.parse(result.content[0].text);

describe("pi-sequential-thinking runtime", () => {
  it("normalizes camelCase, adjusts dynamic totals, records receipts, and reads named history", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-"));
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const historyTool = getRegisteredTool(mockPi, "get_thinking_history");
    const onUpdate = vi.fn();

    const processResult = await processTool.execute(
      "call-1",
      {
        thought: "Use aliases and grow depth",
        thoughtNumber: 5,
        totalThoughts: 3,
        nextThoughtNeeded: true,
        stage: "Analysis",
        tags: ["runtime"],
        sessionId: "research",
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
    const processed = parseToolJson(processResult);
    expect(processed.thoughtAnalysis.currentThought.totalThoughts).toBe(5);
    expect(processed.receipt).toMatchObject({
      operation: "process_thought",
      sessionId: "research",
      sessionLabel: "research",
      preCount: 0,
      postCount: 1,
      changed: true,
      totalThoughtsAdjusted: { from: 3, to: 5 },
    });
    expect(processed.receipt.stateFingerprint).toBeDefined();

    const historyResult = await historyTool.execute(
      "call-2",
      { session_id: "research", limit: 20, include_full_thoughts: false },
      undefined,
      undefined,
      undefined,
    );
    expect(historyResult.isError).toBe(false);
    const history = parseToolJson(historyResult);
    expect(history.sessionId).toBe("research");
    expect(history.totalThoughts).toBe(1);
    expect(history.thoughts[0].thoughtNumber).toBe(5);
    expect(history.thoughts[0].snippet).toContain("Use aliases");
    expect(history.thoughts[0].thought).toBeUndefined();
  });

  it("rejects conflicting history include_full_thoughts aliases", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-history-aliases-"));
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const historyTool = getRegisteredTool(mockPi, "get_thinking_history");

    await processTool.execute(
      "call-history-aliases-1",
      {
        thought: "Alias conflict should not expose this full text",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Analysis",
      },
      undefined,
      undefined,
      undefined,
    );

    const historyResult = await historyTool.execute(
      "call-history-aliases-2",
      { include_full_thoughts: true, includeFullThoughts: false },
      undefined,
      undefined,
      undefined,
    );

    expect(historyResult.isError).toBe(true);
    expect(historyResult.details.validationErrors).toContainEqual({
      field: "include_full_thoughts",
      message: "Conflicting aliases for include_full_thoughts",
    });
  });

  it("summarizes, clears, exports, imports, and runs sequential_think per session", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-tools-"));
    const exportPath = join(storageDir, "nested", "session.json");
    const legacyPath = join(storageDir, "legacy.json");
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const summaryTool = getRegisteredTool(mockPi, "generate_summary");
    const clearTool = getRegisteredTool(mockPi, "clear_history");
    const exportTool = getRegisteredTool(mockPi, "export_session");
    const importTool = getRegisteredTool(mockPi, "import_session");
    const historyTool = getRegisteredTool(mockPi, "get_thinking_history");
    const sequentialTool = getRegisteredTool(mockPi, "sequential_think");

    await processTool.execute(
      "call-3",
      {
        thought: "Default thought",
        thought_number: 1,
        total_thoughts: 2,
        next_thought_needed: true,
        stage: "Analysis",
      },
      undefined,
      undefined,
      undefined,
    );
    await processTool.execute(
      "call-4",
      {
        thought: "Research thought",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Conclusion",
        session_id: "research",
      },
      undefined,
      undefined,
      undefined,
    );

    const summaryResult = await summaryTool.execute(
      "call-5",
      { sessionId: "research" },
      undefined,
      undefined,
      undefined,
    );
    expect(parseToolJson(summaryResult).summary.totalThoughts).toBe(1);
    expect(summaryResult.content[0].text).not.toContain("Default thought");

    const exportResult = await exportTool.execute(
      "call-6",
      { file_path: exportPath, sessionId: "research" },
      undefined,
      undefined,
      undefined,
    );
    expect(exportResult.isError).toBe(false);
    expect(existsSync(exportPath)).toBe(true);
    expect(parseToolJson(exportResult).receipt.operation).toBe("export_session");
    expect(JSON.parse(readFileSync(exportPath, "utf-8")).sessionId).toBe("research");

    const clearResult = await clearTool.execute("call-7", { sessionId: "research" }, undefined, undefined, undefined);
    expect(parseToolJson(clearResult).receipt).toMatchObject({
      operation: "clear_history",
      sessionId: "research",
      preCount: 1,
      postCount: 0,
      changed: true,
    });

    writeFileSync(
      legacyPath,
      JSON.stringify([
        {
          id: "legacy-id",
          thought: "Legacy thought",
          thought_number: 4,
          total_thoughts: 4,
          next_thought_needed: false,
          stage: "Conclusion",
          timestamp: "2026-05-16T00:00:00.000Z",
        },
      ]),
      "utf-8",
    );

    const importResult = await importTool.execute(
      "call-8",
      { file_path: legacyPath, sessionId: "legacy-import" },
      undefined,
      undefined,
      undefined,
    );
    expect(parseToolJson(importResult).receipt).toMatchObject({
      operation: "import_session",
      sessionId: "legacy-import",
      preCount: 0,
      postCount: 1,
      changed: true,
    });

    const importedHistory = parseToolJson(
      await historyTool.execute("call-9", { sessionId: "legacy-import" }, undefined, undefined, undefined),
    );
    expect(importedHistory.thoughts[0].thoughtNumber).toBe(4);

    const sequentialResult = await sequentialTool.execute(
      "call-10",
      { topic: "Database migration strategy", num_thoughts: 5, sessionId: "scratch" },
      undefined,
      undefined,
      undefined,
    );
    expect(sequentialResult.isError).toBe(false);
    const sequential = parseToolJson(sequentialResult);
    expect(sequential.receipt).toMatchObject({
      operation: "sequential_think",
      sessionId: "scratch",
      preCount: 0,
      postCount: 5,
    });

    const scratchHistory = parseToolJson(
      await historyTool.execute("call-11", { sessionId: "scratch" }, undefined, undefined, undefined),
    );
    expect(scratchHistory.totalThoughts).toBe(5);

    const defaultHistory = parseToolJson(await historyTool.execute("call-12", {}, undefined, undefined, undefined));
    expect(defaultHistory.totalThoughts).toBe(1);
    expect(defaultHistory.thoughts[0].thought).toBe("Default thought");
  });

  it("returns content-free status with effective config source labels", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(join(tmpdir(), "pi-seq-runtime-status-home-"));
    process.env.HOME = tempHome;
    try {
      const storageDir = join(tempHome, ".mcp_sequential_thinking");
      const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir, "--seq-think-max-bytes": "1000" });
      sequentialThinking(mockPi as unknown as ExtensionAPI);

      const processTool = getRegisteredTool(mockPi, "process_thought");
      const statusTool = getRegisteredTool(mockPi, "get_thinking_status");

      await processTool.execute(
        "call-status-1",
        {
          thought: "Sensitive status thought",
          thought_number: 1,
          total_thoughts: 1,
          next_thought_needed: false,
          stage: "Analysis",
          tags: ["private"],
        },
        undefined,
        undefined,
        undefined,
      );

      const statusResult = await statusTool.execute("call-status-2", {}, undefined, undefined, undefined);
      expect(statusResult.isError).toBe(false);
      const status = parseToolJson(statusResult);
      const statusText = JSON.stringify(status);

      expect(status.storageDir).toContain("~");
      expect(status.pathDisclosure).toBe("home_redacted");
      expect(status.totalThoughts).toBe(1);
      expect(status.effectiveConfig.sources.storageDir).toBe("flag");
      expect(status.effectiveConfig.sources.maxBytes).toBe("flag");
      expect(status.effectiveConfig.sources.maxLines).toBe("project_settings");
      expect(statusText).not.toContain("Sensitive status thought");
      expect(statusText).not.toContain("private");
      expect(statusText).not.toContain(storageDir);
    } finally {
      if (originalHome) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });

  it("returns structured validation errors for invalid runtime inputs", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "pi-seq-runtime-errors-"));
    const mockPi = createMockPi({ "--seq-think-storage-dir": storageDir });
    sequentialThinking(mockPi as unknown as ExtensionAPI);

    const processTool = getRegisteredTool(mockPi, "process_thought");
    const summaryTool = getRegisteredTool(mockPi, "generate_summary");
    const importTool = getRegisteredTool(mockPi, "import_session");

    const invalidThought = await processTool.execute(
      "call-13",
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
    expect(invalidThought.details.validationErrors).toContainEqual({
      field: "thought",
      message: "Thought content cannot be empty",
    });

    const missingImport = await importTool.execute(
      "call-14",
      { file_path: join(storageDir, "missing.json") },
      undefined,
      undefined,
      undefined,
    );
    expect(missingImport.isError).toBe(true);
    expect(missingImport.content[0].text).toContain("File not found");

    const conflictingSession = await summaryTool.execute(
      "call-15",
      { session_id: "one", sessionId: "two" },
      undefined,
      undefined,
      undefined,
    );
    expect(conflictingSession.isError).toBe(true);
    expect(conflictingSession.details.validationErrors).toContainEqual({
      field: "session_id",
      message: "Conflicting aliases for session_id",
    });
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executePortableTool, type PortableTool } from "@feniix/bridgekit";
import type { TObject } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThoughtAnalyzer } from "../extensions/analyzer.js";
import { ThoughtStorage } from "../extensions/storage.js";
import { createTools, type SequentialThinkingDeps } from "../extensions/tools.js";

let storageDir: string;
let deps: SequentialThinkingDeps;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "pi-seq-think-portable-"));
  deps = {
    storage: new ThoughtStorage(storageDir),
    analyzer: new ThoughtAnalyzer(),
    effectiveConfigForStatus: {
      storageDir,
      maxBytes: 51200,
      maxLines: 2000,
      sources: { storageDir: "default", maxBytes: "default", maxLines: "default" },
    },
  };
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

function findTool(name: string): PortableTool<TObject> {
  const tools = createTools(deps);
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not registered by createTools()`);
  }
  return tool;
}

describe("portable tools - createTools", () => {
  it("exposes the eight pi-sequential-thinking tools", () => {
    const names = createTools(deps).map((tool) => tool.name);
    expect(names).toEqual([
      "process_thought",
      "generate_summary",
      "clear_history",
      "export_session",
      "import_session",
      "get_thinking_history",
      "get_thinking_status",
      "sequential_think",
    ]);
  });
});

describe("portable tools - process_thought", () => {
  const validArgs = {
    thought: "First thought",
    thought_number: 1,
    total_thoughts: 1,
    next_thought_needed: false,
    stage: "Problem Definition" as const,
  };

  it("returns structured analysis plus a receipt on a valid thought", async () => {
    const tool = findTool("process_thought");
    const result = await executePortableTool(tool, validArgs, { host: "test" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      thoughtAnalysis: {
        currentThought: expect.objectContaining({
          thoughtNumber: 1,
          totalThoughts: 1,
          stage: "Problem Definition",
        }),
      },
      receipt: expect.objectContaining({
        operation: "process_thought",
        preCount: 0,
        postCount: 1,
        changed: true,
      }),
    });
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(deps.storage.getAllThoughts(null)).toHaveLength(1);
  });

  it("flags isError=true with domain validationErrors when required fields are missing", async () => {
    const tool = findTool("process_thought");
    // thought_number / total_thoughts / next_thought_needed are required at runtime
    // but optional in the TypeBox schema, so TypeBox lets this through and
    // ThoughtValidationError fires inside the handler.
    const result = await executePortableTool(tool, { thought: "x", stage: "Problem Definition" }, { host: "test" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      tool: "process_thought",
      validationErrors: expect.arrayContaining([expect.objectContaining({ field: "thought_number" })]),
    });
  });
});

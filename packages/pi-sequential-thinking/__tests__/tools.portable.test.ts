import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

async function addOneThought(tool: PortableTool<TObject>, thoughtNumber = 1, totalThoughts = 1): Promise<void> {
  await executePortableTool(
    tool,
    {
      thought: `thought ${thoughtNumber}`,
      thought_number: thoughtNumber,
      total_thoughts: totalThoughts,
      next_thought_needed: thoughtNumber < totalThoughts,
      stage: "Problem Definition" as const,
    },
    { host: "test" },
  );
}

describe("portable tools - generate_summary", () => {
  it("returns 'No thoughts recorded yet' when the session is empty", async () => {
    const tool = findTool("generate_summary");
    const result = await executePortableTool(tool, {}, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      sessionId: null,
      sessionLabel: "default",
      summary: "No thoughts recorded yet",
    });
  });

  it("returns a structured summary once thoughts exist", async () => {
    await addOneThought(findTool("process_thought"));
    const tool = findTool("generate_summary");
    const result = await executePortableTool(tool, {}, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      summary: { totalThoughts: 1, stages: { "Problem Definition": 1 } },
    });
  });
});

describe("portable tools - clear_history", () => {
  it("clears recorded thoughts and reports counts in the receipt", async () => {
    await addOneThought(findTool("process_thought"));
    expect(deps.storage.getAllThoughts(null)).toHaveLength(1);

    const tool = findTool("clear_history");
    const result = await executePortableTool(tool, {}, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "success",
      receipt: { operation: "clear_history", preCount: 1, postCount: 0, changed: true },
    });
    expect(deps.storage.getAllThoughts(null)).toHaveLength(0);
  });
});

describe("portable tools - export_session / import_session", () => {
  it("export_session writes a JSON file and reports the path", async () => {
    await addOneThought(findTool("process_thought"));
    const target = join(storageDir, "out", "exported.json");
    const result = await executePortableTool(findTool("export_session"), { file_path: target }, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "success",
      receipt: expect.objectContaining({ operation: "export_session" }),
    });
    const persisted = JSON.parse(readFileSync(target, "utf-8")) as { thoughts: unknown[] };
    expect(persisted.thoughts).toHaveLength(1);
  });

  it("export_session flags isError via TypeBox when file_path is missing", async () => {
    // file_path is required in the schema, so TypeBox rejects before the
    // handler runs. Bridgekit's execute-tool layer surfaces this as
    // kind:"validation" structured content; since 0.8 the field is derived
    // from TypeBox's structured `requiredProperties` rather than the
    // instancePath, so we get the actual property name back.
    const result = await executePortableTool(findTool("export_session"), {}, { host: "test" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: "validation",
      tool: "export_session",
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ field: "file_path", message: expect.stringContaining("file_path") }),
      ]),
    });
  });

  it("import_session restores thoughts from a written file", async () => {
    await addOneThought(findTool("process_thought"));
    const target = join(storageDir, "in.json");
    await executePortableTool(findTool("export_session"), { file_path: target }, { host: "test" });
    await executePortableTool(findTool("clear_history"), {}, { host: "test" });
    expect(deps.storage.getAllThoughts(null)).toHaveLength(0);

    const result = await executePortableTool(findTool("import_session"), { file_path: target }, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(deps.storage.getAllThoughts(null)).toHaveLength(1);
  });

  it("import_session flags isError via TypeBox when file_path is missing", async () => {
    const result = await executePortableTool(findTool("import_session"), {}, { host: "test" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: "validation",
      tool: "import_session",
      validationErrors: expect.arrayContaining([
        expect.objectContaining({ field: "file_path", message: expect.stringContaining("file_path") }),
      ]),
    });
  });

  it("import_session flags isError when the file is malformed JSON", async () => {
    const target = join(storageDir, "bad.json");
    writeFileSync(target, "{not json");
    const result = await executePortableTool(findTool("import_session"), { file_path: target }, { host: "test" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ tool: "import_session" });
  });
});

describe("portable tools - get_thinking_history", () => {
  it("paginates with limit and offset over the recorded thoughts", async () => {
    const processTool = findTool("process_thought");
    for (let i = 1; i <= 3; i++) {
      await addOneThought(processTool, i, 3);
    }
    const result = await executePortableTool(
      findTool("get_thinking_history"),
      { limit: 2, offset: 1 },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      totalThoughts: 3,
      offset: 1,
      limit: 2,
      returnedThoughts: 2,
      hasMore: false,
    });
  });

  it("honors include_full_thoughts=false by returning a snippet only", async () => {
    const longThought = "x".repeat(200);
    await executePortableTool(
      findTool("process_thought"),
      {
        thought: longThought,
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
        stage: "Problem Definition" as const,
      },
      { host: "test" },
    );
    const result = await executePortableTool(
      findTool("get_thinking_history"),
      { include_full_thoughts: false },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { thoughts: Array<{ thought?: string; snippet?: string }> };
    expect(structured.thoughts[0].thought).toBeUndefined();
    expect(structured.thoughts[0].snippet).toBeDefined();
    expect(structured.thoughts[0].snippet?.length).toBeLessThan(longThought.length);
  });
});

describe("portable tools - get_thinking_status", () => {
  it("reports diagnostics without leaking thought content", async () => {
    await addOneThought(findTool("process_thought"));
    const result = await executePortableTool(findTool("get_thinking_status"), {}, { host: "test" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      writable: true,
      schemaVersion: expect.any(Number),
      sessions: expect.arrayContaining([expect.objectContaining({ isDefault: true, thoughtCount: 1 })]),
      effectiveConfig: expect.objectContaining({ sources: expect.any(Object) }),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("thought 1");
  });
});

describe("portable tools - sequential_think", () => {
  it("scaffolds three thoughts when num_thoughts=3 is requested", async () => {
    const result = await executePortableTool(
      findTool("sequential_think"),
      { topic: "deploy pipeline overhaul", num_thoughts: 3 },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      receipt: expect.objectContaining({ operation: "sequential_think", postCount: 3, changed: true }),
    });
    const stages = deps.storage.getAllThoughts(null).map((thought) => thought.stage);
    expect(stages).toEqual(["Problem Definition", "Research", "Analysis"]);
  });

  it("rejects out-of-range num_thoughts via TypeBox structural validation", async () => {
    // The schema enforces minimum: 3, maximum: 10 on num_thoughts, so values
    // outside that range fail TypeBox validation before reaching the handler.
    const result = await executePortableTool(
      findTool("sequential_think"),
      { topic: "x", num_thoughts: 99 },
      { host: "test" },
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: "validation",
      tool: "sequential_think",
    });
    expect(deps.storage.getAllThoughts(null)).toHaveLength(0);
  });

  it("scaffolds five thoughts when num_thoughts is omitted (default 5)", async () => {
    const result = await executePortableTool(
      findTool("sequential_think"),
      { topic: "decide on serialization format" },
      { host: "test" },
    );
    expect(result.isError).toBeFalsy();
    // The default value resolved inside the handler is 5; five stages exist.
    expect(deps.storage.getAllThoughts(null)).toHaveLength(5);
  });

  it("flags isError when topic is empty", async () => {
    const result = await executePortableTool(findTool("sequential_think"), { topic: "   " }, { host: "test" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      tool: "sequential_think",
      validationErrors: expect.arrayContaining([expect.objectContaining({ field: "topic" })]),
    });
  });
});

describe("portable tools - hostExtras.pi prompt metadata", () => {
  const allToolNames = [
    "process_thought",
    "generate_summary",
    "clear_history",
    "export_session",
    "import_session",
    "get_thinking_history",
    "get_thinking_status",
    "sequential_think",
  ] as const;

  it("declares a one-line promptSnippet (<100 chars, no newlines) on every tool", () => {
    for (const name of allToolNames) {
      const tool = findTool(name);
      const snippet = tool.hostExtras?.pi?.promptSnippet;
      expect(snippet, `${name}.hostExtras.pi.promptSnippet missing`).toBeDefined();
      expect(typeof snippet).toBe("string");
      const value = snippet as string;
      expect(value.length, `${name} promptSnippet length > 0`).toBeGreaterThan(0);
      expect(value.length, `${name} promptSnippet length < 100`).toBeLessThan(100);
      expect(value, `${name} promptSnippet no newlines`).not.toContain("\n");
    }
  });

  it("declares a non-empty promptGuidelines array of strings on every tool", () => {
    for (const name of allToolNames) {
      const tool = findTool(name);
      const guidelines = tool.hostExtras?.pi?.promptGuidelines;
      expect(Array.isArray(guidelines), `${name}.hostExtras.pi.promptGuidelines is array`).toBe(true);
      const arr = guidelines as readonly string[];
      expect(arr.length, `${name} promptGuidelines length > 0`).toBeGreaterThan(0);
      for (const entry of arr) {
        expect(typeof entry).toBe("string");
        expect(entry.length).toBeGreaterThan(0);
      }
    }
  });

  it("cross-references process_thought and sequential_think in each other's guidelines", () => {
    const processGuidelines = (findTool("process_thought").hostExtras?.pi?.promptGuidelines ?? []).join(" ");
    const sequentialGuidelines = (findTool("sequential_think").hostExtras?.pi?.promptGuidelines ?? []).join(" ");
    expect(processGuidelines, "process_thought references sequential_think").toContain("sequential_think");
    expect(sequentialGuidelines, "sequential_think references process_thought").toContain("process_thought");
  });

  it("cross-references get_thinking_history and get_thinking_status in each other's guidelines", () => {
    const historyGuidelines = (findTool("get_thinking_history").hostExtras?.pi?.promptGuidelines ?? []).join(" ");
    const statusGuidelines = (findTool("get_thinking_status").hostExtras?.pi?.promptGuidelines ?? []).join(" ");
    expect(historyGuidelines, "get_thinking_history references get_thinking_status").toContain("get_thinking_status");
    expect(statusGuidelines, "get_thinking_status references get_thinking_history").toContain("get_thinking_history");
  });
});

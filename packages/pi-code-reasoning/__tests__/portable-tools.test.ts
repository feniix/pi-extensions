import { executePortableTool } from "@feniix/bridgekit";
import { describe, expect, it } from "vitest";
import { createCodeReasoningTools } from "../extensions/tools.js";

type CodeReasoningTool = ReturnType<typeof createCodeReasoningTools>[number];

function findTool(tools: readonly CodeReasoningTool[], name: string): CodeReasoningTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing portable tool: ${name}`);
  }
  return tool;
}

function getTool(name: string): CodeReasoningTool {
  return findTool(createCodeReasoningTools(), name);
}

describe("portable code reasoning tools", () => {
  it("defines the pi/MCP tool surface once", () => {
    const tools = createCodeReasoningTools();

    expect(tools.map((tool) => tool.name)).toEqual(["code_reasoning", "code_reasoning_status", "code_reasoning_reset"]);
    expect(tools.every((tool) => tool.parameters.type === "object")).toBe(true);
  });

  it("processes thoughts and shares state across portable tools", async () => {
    const tools = createCodeReasoningTools();
    const reasoningTool = findTool(tools, "code_reasoning");
    const statusTool = findTool(tools, "code_reasoning_status");

    const result = await executePortableTool(
      reasoningTool,
      {
        thought: "First portable thought",
        thought_number: 1,
        total_thoughts: 2,
        next_thought_needed: true,
      },
      { host: "test" },
    );
    const status = await executePortableTool(statusTool, {}, { host: "test" });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("processed");
    expect(status.text).toContain('"thought_count": 1');
  });

  it("rejects invalid per-call truncation limits before execution", async () => {
    const tool = getTool("code_reasoning_status");

    const result = await executePortableTool(tool, { piMaxBytes: 0 }, { host: "test" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Invalid arguments");
  });

  it("does not mirror oversized truncated output into structuredContent", async () => {
    const tools = createCodeReasoningTools();
    const reasoningTool = findTool(tools, "code_reasoning");

    await executePortableTool(
      reasoningTool,
      {
        thought: "First thought",
        thought_number: 1,
        total_thoughts: 2,
        next_thought_needed: true,
      },
      { host: "test" },
    );
    const result = await executePortableTool(
      reasoningTool,
      {
        thought: "Branch thought",
        thought_number: 2,
        total_thoughts: 2,
        next_thought_needed: false,
        branch_from_thought: 1,
        branch_id: "x".repeat(500),
        piMaxBytes: 200,
      },
      { host: "test" },
    );

    expect(result.structuredContent?.truncated).toBe(true);
    expect(result.structuredContent).not.toHaveProperty("branches");
  });

  it("reports tool-level validation failures as portable errors", async () => {
    const tool = getTool("code_reasoning");

    const result = await executePortableTool(
      tool,
      {
        thought: "",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
      },
      { host: "test" },
    );

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Thought cannot be empty");
    expect(result.structuredContent?.status).toBe("failed");
  });

  it("resets portable tool state", async () => {
    const tools = createCodeReasoningTools();
    const reasoningTool = findTool(tools, "code_reasoning");
    const resetTool = findTool(tools, "code_reasoning_reset");
    const statusTool = findTool(tools, "code_reasoning_status");

    await executePortableTool(
      reasoningTool,
      {
        thought: "Before reset",
        thought_number: 1,
        total_thoughts: 1,
        next_thought_needed: false,
      },
      { host: "test" },
    );
    const reset = await executePortableTool(resetTool, {}, { host: "test" });
    const status = await executePortableTool(statusTool, {}, { host: "test" });

    expect(reset.text).toContain("reset");
    expect(status.text).toContain('"thought_count": 0');
  });
});

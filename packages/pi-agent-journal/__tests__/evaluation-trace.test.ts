import { describe, expect, it } from "vitest";
import { normalizeEvaluationJsonl, TraceNormalizationError } from "../extensions/evaluation-trace.js";

const root = "/workspace/repo";
const header = {
  type: "evaluation_trace",
  schemaVersion: 2,
  sourceEvaluationVersion: 2,
  runId: "run-opaque",
  taskId: "task-opaque",
  taskScore: 10,
  resumedWithoutRestatement: true,
  materialTaskCorrect: true,
};
const line = (value: unknown) => JSON.stringify(value);
const normalize = (events: unknown[]) =>
  normalizeEvaluationJsonl([line(header), ...events.map(line)].join("\n"), { workspaceRoot: root });

describe("V2 safe trace normalization", () => {
  it("counts every repository read while normalizing aliases to an opaque key", () => {
    const result = normalize([
      { type: "tool_execution_start", toolName: "read", args: { path: "src/../src/a.ts" } },
      { type: "tool_execution_start", toolName: "read", args: { path: "/workspace/repo/src/a.ts" } },
    ]);
    expect(result.repositoryReads).toBe(2);
    expect(result.repositoryReadEvents).toHaveLength(2);
    expect(result.repositoryReadEvents[0].keyDigest).toBe(result.repositoryReadEvents[1].keyDigest);
    expect(JSON.stringify(result)).not.toContain("/workspace");
    expect(JSON.stringify(result)).not.toContain("src/a.ts");
  });

  it("fails closed for native and relative shell targets outside the repository", () => {
    expect(() =>
      normalize([{ type: "tool_execution_start", toolName: "grep", args: { pattern: "token", path: "/outside" } }]),
    ).toThrow(/escapes repository/i);
    expect(() =>
      normalize([{ type: "tool_execution_start", toolName: "bash", args: { command: "cat ../outside" } }]),
    ).toThrow(/escapes repository/i);
  });

  it("fails closed for unsupported nested shell read forms", () => {
    expect(() =>
      normalize([{ type: "tool_execution_start", toolName: "bash", args: { command: "bash -c 'cat src/a.ts'" } }]),
    ).toThrow(/unsupported shell read/i);
  });

  it("counts native grep, find, and list tool events", () => {
    const result = normalize([
      { type: "tool_execution_start", toolName: "grep", args: { pattern: "token", path: "src" } },
      { type: "tool_execution_start", toolName: "find", args: { pattern: "*.ts", path: "src" } },
      { type: "tool_execution_start", toolName: "list", args: { path: "packages" } },
    ]);
    expect(result.repositoryReadEvents.map((event) => event.kind)).toEqual(["search", "search", "list"]);
  });

  it("normalizes worktree paths embedded in shell search commands", () => {
    const first = normalize([
      { type: "tool_execution_start", toolName: "bash", args: { command: "rg token /workspace/repo/src" } },
    ]);
    const second = normalize([{ type: "tool_execution_start", toolName: "bash", args: { command: "rg token src" } }]);
    expect(first.repositoryReadEvents[0].keyDigest).toBe(second.repositoryReadEvents[0].keyDigest);
  });

  it("counts wc and git show as repository reads", () => {
    const result = normalize([
      { type: "tool_execution_start", toolName: "bash", args: { command: "wc -l src/a.ts" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "git show HEAD:src/a.ts" } },
    ]);
    expect(result.repositoryReads).toBe(2);
    expect(result.repositoryReadEvents.map((event) => event.kind)).toEqual(["read", "read"]);
  });

  it("counts shell file reads and every read operation in a compound command", () => {
    const result = normalize([
      {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "cat src/a.ts; sed -n '1,20p' src/b.ts | grep token; head src/c.ts; tail src/d.ts" },
      },
    ]);
    expect(result.repositoryReads).toBe(5);
    expect(result.repositoryReadEvents.map((event) => event.kind)).toEqual(["read", "read", "search", "read", "read"]);
  });

  it("counts searches and listings but ignores edits, tests, narration, and raw results", () => {
    const result = normalize([
      { type: "tool_execution_start", toolName: "bash", args: { command: "rg token src" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "find src -name '*.ts'" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "ls packages" } },
      { type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts", newText: "secret" } },
      { type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } },
      { type: "message_end", message: { role: "assistant", content: "narration" } },
      { type: "tool_execution_end", result: "raw output" },
    ]);
    expect(result.repositoryReads).toBe(3);
    expect(result.repositoryReadEvents.map((event) => event.kind)).toEqual(["search", "search", "list"]);
  });

  it.each([
    ["malformed JSONL", `${line(header)}\nnot-json`],
    ["unsupported event schema", `${line(header)}\n${line({ type: "schema", schemaVersion: 99 })}`],
    ["missing header", line({ type: "tool_execution_start", toolName: "read", args: { path: "x" } })],
  ])("fails closed for %s", (_name, jsonl) => {
    expect(() => normalizeEvaluationJsonl(jsonl, { workspaceRoot: root })).toThrow(TraceNormalizationError);
  });

  it("excludes prompts, tool bytes, credentials, control sequences, and absolute paths from output", () => {
    const candidate = "sk-abcdefghijklmnopqrstuvwxyz123456 \u001b[31m /private/secret";
    const result = normalize([
      { type: "message_end", message: { content: candidate } },
      { type: "tool_execution_start", toolName: "write", args: { path: "/workspace/repo/a", content: candidate } },
      { type: "tool_execution_end", result: candidate },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(serialized).not.toContain("/private/secret");
    expect(serialized).not.toContain("\\u001b");
  });

  it("rejects unknown owner and safety kinds", () => {
    expect(() => normalize([{ type: "evaluation_intervention", id: "i", kind: "made_up", sequence: 1 }])).toThrow(
      /unknown intervention/i,
    );
  });

  it("separates avoidable owner maintenance from necessary safety and preserves event order", () => {
    const result = normalize([
      { type: "evaluation_intervention", id: "owner-1", kind: "status_refresh", sequence: 2 },
      { type: "evaluation_intervention", id: "safety-1", kind: "material_stale_resolution", sequence: 3 },
      {
        type: "evaluation_material_case",
        id: "case-1",
        detectedBeforeContinuation: true,
        resolvedAppendOnly: true,
        falsePositive: false,
        sequence: 4,
      },
    ]);
    expect(result.avoidableMaintenanceCount).toBe(1);
    expect(result.necessarySafetyCount).toBe(1);
    expect(result.interventions.map((value) => value.kind)).toEqual(["status_refresh", "material_stale_resolution"]);
    expect(result.eventOrder.map((value) => value.sequence)).toEqual([2, 3, 4]);
  });

  it("enforces bounded input without persisting raw events", () => {
    const jsonl = [line(header), ...Array.from({ length: 1001 }, () => line({ type: "message_end" }))].join("\n");
    expect(() => normalizeEvaluationJsonl(jsonl, { workspaceRoot: root, maxEvents: 1000 })).toThrow(/event limit/i);
  });
});

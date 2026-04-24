import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskContractPrompt,
  extractFinalAssistantText,
  mapStopReasonToRunOutcome,
  preflightWorkerRunRuntime,
} from "../extensions/runtime.js";

describe("worker run runtime helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("builds an explicit task contract prompt for child worker runs", () => {
    const prompt = buildTaskContractPrompt({
      taskId: "task-1",
      runId: "run-1",
      taskRevision: 2,
      goal: "Implement durable tasks",
      constraints: ["Do not publish a PR"],
      explicitCompletionTools: true,
    });

    expect(prompt).toContain("task-1");
    expect(prompt).toContain("run-1");
    expect(prompt).toContain("revision 2");
    expect(prompt).toContain("Implement durable tasks");
    expect(prompt).toContain("Do not publish a PR");
    expect(prompt).toContain("conductor_complete_task");
    expect(prompt).toContain("conductor_report_progress");
  });

  it("maps Pi stop reasons to conductor run outcomes", () => {
    expect(mapStopReasonToRunOutcome("stop")).toEqual({ status: "success", errorMessage: null });
    expect(mapStopReasonToRunOutcome("aborted")).toEqual({ status: "aborted", errorMessage: null });
    expect(mapStopReasonToRunOutcome("error")).toEqual({ status: "error", errorMessage: null });
    expect(mapStopReasonToRunOutcome("toolUse")).toEqual({
      status: "error",
      errorMessage: "Run ended unexpectedly while waiting on tool execution",
    });
    expect(mapStopReasonToRunOutcome("length")).toEqual({
      status: "error",
      errorMessage:
        "Run stopped because the model hit its output or context length limit; shorten or split the task and retry",
    });
  });

  it("validates worker context before declaring preflight success", async () => {
    vi.spyOn(ModelRegistry, "create").mockReturnValue({
      getAvailable: () => [{ id: "fake-model" }],
    } as unknown as ModelRegistry);

    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");

    await expect(preflightWorkerRunRuntime({ worktreePath, sessionFile })).resolves.toBeUndefined();
    await expect(preflightWorkerRunRuntime({ worktreePath: "/missing", sessionFile })).rejects.toThrow(/worktree/i);
    await expect(preflightWorkerRunRuntime({ worktreePath, sessionFile: "/missing/session.jsonl" })).rejects.toThrow(
      /session file/i,
    );
  });

  it("extracts final assistant text content and falls back cleanly when absent", () => {
    expect(
      extractFinalAssistantText([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "..." },
            { type: "text", text: "Implemented status output." },
            { type: "text", text: "Tests are green." },
          ],
        },
      ]),
    ).toBe("Implemented status output.\n\nTests are green.");

    expect(
      extractFinalAssistantText([
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "..." }],
        },
      ]),
    ).toBeNull();
  });
});

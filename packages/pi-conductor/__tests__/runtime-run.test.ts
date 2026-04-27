import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const codingAgentMocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  openSession: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
  return {
    ...actual,
    SessionManager: {
      ...actual.SessionManager,
      open: codingAgentMocks.openSession,
    },
    createAgentSession: codingAgentMocks.createAgentSession,
  };
});

import {
  buildRunScopedConductorTools,
  buildTaskContractPrompt,
  extractFinalAssistantText,
  mapStopReasonToRunOutcome,
  preflightWorkerRunRuntime,
  runWorkerPromptRuntime,
} from "../extensions/runtime.js";

describe("worker run runtime helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    codingAgentMocks.openSession.mockReset();
    codingAgentMocks.createAgentSession.mockReset();
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
    expect(prompt).toContain("conductor_child_complete");
    expect(prompt).toContain("conductor_child_progress");
    expect(prompt).toContain("conductor_child_create_gate");
    expect(prompt).toContain("idempotencyKey");
    expect(prompt).not.toContain("conductor_child_create_followup_task");
  });

  it("includes follow-up task instructions only when allowed", () => {
    const prompt = buildTaskContractPrompt({
      taskId: "task-1",
      runId: "run-1",
      taskRevision: 2,
      goal: "Implement durable tasks",
      explicitCompletionTools: true,
      allowFollowUpTasks: true,
    });

    expect(prompt).toContain("conductor_child_create_followup_task");
  });

  it("builds run-scoped conductor tools for native child sessions", async () => {
    const progressCalls: unknown[] = [];
    const completeCalls: unknown[] = [];
    const gateCalls: unknown[] = [];
    const tools = buildRunScopedConductorTools({
      onConductorProgress: async (params) => {
        progressCalls.push(params);
      },
      onConductorComplete: async (params) => {
        completeCalls.push(params);
      },
      onConductorGate: async (params) => {
        gateCalls.push(params);
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "conductor_child_progress",
      "conductor_child_create_gate",
      "conductor_child_complete",
    ]);

    await tools[0]?.execute?.(
      "call-1",
      { runId: "run-1", taskId: "task-1", progress: "half done" } as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    await tools[1]?.execute?.(
      "call-2",
      {
        runId: "run-1",
        taskId: "task-1",
        type: "needs_input",
        requestedDecision: "Which database should I use?",
      } as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    await tools[2]?.execute?.(
      "call-3",
      {
        runId: "run-1",
        taskId: "task-1",
        status: "succeeded",
        completionSummary: "done",
      } as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    expect(progressCalls).toEqual([{ runId: "run-1", taskId: "task-1", progress: "half done" }]);
    expect(gateCalls).toEqual([
      { runId: "run-1", taskId: "task-1", type: "needs_input", requestedDecision: "Which database should I use?" },
    ]);
    expect(completeCalls).toEqual([
      { runId: "run-1", taskId: "task-1", status: "succeeded", completionSummary: "done" },
    ]);
  });

  it("adds a scoped follow-up task tool only when the task contract allows it", async () => {
    const followUpCalls: unknown[] = [];
    const tools = buildRunScopedConductorTools({
      taskContract: {
        taskId: "task-1",
        runId: "run-1",
        taskRevision: 1,
        goal: "Do it",
        explicitCompletionTools: true,
        allowFollowUpTasks: true,
      },
      onConductorFollowUpTask: async (params) => {
        followUpCalls.push(params);
      },
    });

    expect(tools.map((tool) => tool.name)).toContain("conductor_child_create_followup_task");
    const followUpTool = tools.find((tool) => tool.name === "conductor_child_create_followup_task");
    await followUpTool?.execute?.(
      "call-1",
      { runId: "run-1", taskId: "task-1", title: "Follow up", prompt: "Do the follow-up" } as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    expect(followUpCalls).toEqual([
      { runId: "run-1", taskId: "task-1", title: "Follow up", prompt: "Do the follow-up" },
    ]);
    expect(
      buildRunScopedConductorTools({
        taskContract: {
          taskId: "task-1",
          runId: "run-1",
          taskRevision: 1,
          goal: "Do it",
          explicitCompletionTools: true,
        },
      }).map((tool) => tool.name),
    ).not.toContain("conductor_child_create_followup_task");
  });

  it("rejects scoped child tool calls for another task or run", async () => {
    const tools = buildRunScopedConductorTools({
      taskContract: {
        taskId: "task-1",
        runId: "run-1",
        taskRevision: 1,
        goal: "Do it",
        explicitCompletionTools: true,
      },
    });

    await expect(
      tools[0]?.execute?.(
        "call-1",
        { runId: "other-run", taskId: "task-1", progress: "spoofed" } as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    ).rejects.toThrow(/not scoped/i);
    await expect(
      tools[2]?.execute?.(
        "call-2",
        { runId: "run-1", taskId: "other-task", status: "succeeded", completionSummary: "spoofed" } as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
    ).rejects.toThrow(/not scoped/i);
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

  it("returns aborted status when a running prompt is cancelled", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");
    codingAgentMocks.openSession.mockReturnValue({} as never);

    let continuePrompt: (() => void) | null = null;
    let resolvePromptStarted: (() => void) | null = null;
    const promptStarted = new Promise<void>((resolve) => {
      resolvePromptStarted = resolve;
    });
    const session = {
      sessionId: "run-session-abort",
      messages: [] as unknown[],
      bindExtensions: vi.fn(async () => {}),
      prompt: vi.fn(async () => {
        resolvePromptStarted?.();
        await new Promise<void>((resolve) => {
          continuePrompt = resolve;
        });
        throw new Error("interrupted");
      }),
      abort: vi.fn(async () => {
        continuePrompt?.();
      }),
      dispose: vi.fn(),
    };
    codingAgentMocks.createAgentSession.mockResolvedValue({ session });

    const controller = new AbortController();
    const runtime = runWorkerPromptRuntime({ worktreePath, sessionFile, task: "do work", signal: controller.signal });
    await promptStarted;
    controller.abort();

    const result = await runtime;

    expect(result.status).toBe("aborted");
    expect(result.sessionId).toBe("run-session-abort");
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("ignores assistant messages that were present before prompt execution", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");
    codingAgentMocks.openSession.mockReturnValue({} as never);

    const session = {
      sessionId: "run-session-stale",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "stale pre-run summary" }], stopReason: "stop" },
      ] as unknown[],
      bindExtensions: vi.fn(async () => {}),
      prompt: vi.fn(async () => {
        session.messages.push({ role: "user", content: [{ type: "text", text: "still in progress" }] });
      }),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    codingAgentMocks.createAgentSession.mockResolvedValue({ session });

    const result = await runWorkerPromptRuntime({ worktreePath, sessionFile, task: "do work" });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Run finished without a terminal assistant message");
    expect(result.sessionId).toBe("run-session-stale");
  });

  it("fails preflight when no model provider is configured", async () => {
    vi.spyOn(ModelRegistry, "create").mockReturnValue({ getAvailable: () => [] } as unknown as ModelRegistry);

    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");

    await expect(preflightWorkerRunRuntime({ worktreePath, sessionFile })).rejects.toThrow(
      /No usable model or provider configuration/,
    );
  });

  it("returns successful outcome from assistant final state and text extraction", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");
    codingAgentMocks.openSession.mockReturnValue({} as never);

    const session = {
      sessionId: "run-session-success",
      messages: [] as unknown[],
      bindExtensions: vi.fn(async () => {}),
      prompt: vi.fn(async () => {
        session.messages.push({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done now" }] });
      }),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    codingAgentMocks.createAgentSession.mockResolvedValue({ session });

    const result = await runWorkerPromptRuntime({ worktreePath, sessionFile, task: "do work" });

    expect(result.status).toBe("success");
    expect(result.finalText).toBe("done now");
    expect(result.errorMessage).toBeNull();
    expect(result.sessionId).toBe("run-session-success");
  });

  it("enables run-scoped conductor tools in child session allowlist", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "pi-conductor-runtime-"));
    const sessionFile = join(worktreePath, "session.jsonl");
    writeFileSync(sessionFile, "{}\n", "utf-8");
    codingAgentMocks.openSession.mockReturnValue({} as never);

    const session = {
      sessionId: "run-session-tools",
      messages: [] as unknown[],
      bindExtensions: vi.fn(async () => {}),
      prompt: vi.fn(async () => {
        session.messages.push({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] });
      }),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    codingAgentMocks.createAgentSession.mockResolvedValue({ session });

    await runWorkerPromptRuntime({
      worktreePath,
      sessionFile,
      task: "do work",
      taskContract: {
        taskId: "task-1",
        runId: "run-1",
        taskRevision: 1,
        goal: "do work",
        explicitCompletionTools: true,
        allowFollowUpTasks: true,
      },
    });

    expect(codingAgentMocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          "read",
          "conductor_child_progress",
          "conductor_child_create_gate",
          "conductor_child_create_followup_task",
          "conductor_child_complete",
        ]),
        customTools: expect.arrayContaining([
          expect.objectContaining({ name: "conductor_child_progress" }),
          expect.objectContaining({ name: "conductor_child_create_gate" }),
          expect.objectContaining({ name: "conductor_child_create_followup_task" }),
          expect.objectContaining({ name: "conductor_child_complete" }),
        ]),
      }),
    );
  });
});

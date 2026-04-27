import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type {
  ConductorCompletionReportInput,
  ConductorFollowUpTaskInput,
  ConductorGateReportInput,
  ConductorProgressReportInput,
  RuntimeRunContext,
  RuntimeRunPreflightContext,
  RuntimeRunResult,
  TaskContractInput,
  WorkerRunStatus,
  WorkerRuntimeState,
} from "./types.js";

export interface WorkerRuntimeHandle extends WorkerRuntimeState {
  sessionFile: string | null;
}

function persistSessionFile(sessionManager: SessionManager, sessionFile: string): void {
  // Intentionally rewrites the full JSONL session file from SessionManager state.
  // This keeps create/resume behavior consistent and preserves newly appended
  // runtime entries such as pi-conductor resume markers.
  const header = sessionManager.getHeader();
  const entries = sessionManager.getEntries();
  mkdirSync(dirname(sessionFile), { recursive: true });
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf-8");
}

function buildRuntimeHandle(sessionManager: SessionManager, lastResumedAt: string | null): WorkerRuntimeHandle {
  const sessionFile = sessionManager.getSessionFile() ?? null;
  if (sessionFile) {
    persistSessionFile(sessionManager, sessionFile);
  }

  return {
    backend: "session_manager",
    sessionId: sessionManager.getSessionId(),
    lastResumedAt,
    sessionFile,
  };
}

function createMinimalRunResourceLoader() {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      [
        "You are a headless pi-conductor worker run.",
        "Operate non-interactively.",
        "Use the available coding tools to inspect and modify the repository in the current working tree.",
        "Do not rely on slash commands, interactive UI affordances, or conductor management tools.",
        "Be concise and finish with a short outcome summary.",
      ].join(" "),
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

function getModelRegistryForRun(): ModelRegistry {
  const authStorage = AuthStorage.create();
  return ModelRegistry.create(authStorage);
}

export function mapStopReasonToRunOutcome(stopReason: StopReason): {
  status: WorkerRunStatus;
  errorMessage: string | null;
} {
  switch (stopReason) {
    case "stop":
      return { status: "success", errorMessage: null };
    case "aborted":
      return { status: "aborted", errorMessage: null };
    case "error":
      return { status: "error", errorMessage: null };
    case "length":
      return {
        status: "error",
        errorMessage:
          "Run stopped because the model hit its output or context length limit; shorten or split the task and retry",
      };
    case "toolUse":
      return {
        status: "error",
        errorMessage: "Run ended unexpectedly while waiting on tool execution",
      };
    default: {
      const exhaustive: never = stopReason;
      return exhaustive;
    }
  }
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
  return typeof message === "object" && message !== null && "role" in message && message.role === "assistant";
}

export function extractFinalAssistantText(messages: unknown[]): string | null {
  // AgentSession.messages contains a broader union than the final assistant-shaping
  // logic actually needs here, and it may include non-assistant or even malformed
  // entries from conductor's point of view. Keep the helper intentionally loose
  // and extract only the assistant text blocks conductor cares about for operator
  // summaries.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "assistant") {
      continue;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .flatMap((item) => {
        const block = item as { type?: string; text?: string };
        return block.type === "text" && typeof block.text === "string" ? [block.text.trim()] : [];
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return text || null;
  }
  return null;
}

const artifactTypeSchema = Type.Union([
  Type.Literal("note"),
  Type.Literal("test_result"),
  Type.Literal("changed_files"),
  Type.Literal("log"),
  Type.Literal("completion_report"),
  Type.Literal("pr_evidence"),
  Type.Literal("other"),
]);

export function buildRunScopedConductorTools(input: {
  taskContract?: TaskContractInput;
  onConductorProgress?: (params: ConductorProgressReportInput) => void | Promise<void>;
  onConductorComplete?: (params: ConductorCompletionReportInput) => void | Promise<void>;
  onConductorGate?: (params: ConductorGateReportInput) => void | Promise<void>;
  onConductorFollowUpTask?: (params: ConductorFollowUpTaskInput) => void | Promise<void>;
}) {
  function assertScoped(params: { runId: string; taskId: string }): void {
    if (!input.taskContract) {
      return;
    }
    if (params.runId !== input.taskContract.runId || params.taskId !== input.taskContract.taskId) {
      throw new Error(
        `Child conductor tool call is not scoped to run ${input.taskContract.runId} task ${input.taskContract.taskId}`,
      );
    }
  }

  const tools = [
    defineTool({
      name: "conductor_child_progress",
      label: "Conductor Child Progress",
      description: "Report scoped progress for the current conductor task run",
      parameters: Type.Object({
        runId: Type.String(),
        taskId: Type.String(),
        progress: Type.String(),
        idempotencyKey: Type.Optional(Type.String()),
        artifact: Type.Optional(
          Type.Object({
            type: artifactTypeSchema,
            ref: Type.String(),
            metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        assertScoped(params);
        await input.onConductorProgress?.(params as ConductorProgressReportInput);
        return { content: [{ type: "text", text: `recorded progress for task ${params.taskId}` }], details: params };
      },
    }),
    defineTool({
      name: "conductor_child_create_gate",
      label: "Conductor Child Create Gate",
      description: "Request scoped input or review for the current conductor task run",
      parameters: Type.Object({
        runId: Type.String(),
        taskId: Type.String(),
        type: Type.Union([Type.Literal("needs_input"), Type.Literal("needs_review")]),
        requestedDecision: Type.String(),
      }),
      execute: async (_toolCallId, params) => {
        assertScoped(params);
        await input.onConductorGate?.(params as ConductorGateReportInput);
        return {
          content: [{ type: "text", text: `created ${params.type} gate for task ${params.taskId}` }],
          details: params,
        };
      },
    }),
    ...(input.taskContract?.allowFollowUpTasks
      ? [
          defineTool({
            name: "conductor_child_create_followup_task",
            label: "Conductor Child Create Follow-Up Task",
            description: "Create a scoped follow-up task requested by the current conductor task run",
            parameters: Type.Object({
              runId: Type.String(),
              taskId: Type.String(),
              title: Type.String(),
              prompt: Type.String(),
            }),
            execute: async (_toolCallId, params) => {
              assertScoped(params);
              await input.onConductorFollowUpTask?.(params as ConductorFollowUpTaskInput);
              return {
                content: [{ type: "text", text: `created follow-up task request from ${params.taskId}` }],
                details: params,
              };
            },
          }),
        ]
      : []),
    defineTool({
      name: "conductor_child_complete",
      label: "Conductor Child Complete",
      description: "Complete the current conductor task run with a scoped semantic outcome",
      parameters: Type.Object({
        runId: Type.String(),
        taskId: Type.String(),
        status: Type.Union([
          Type.Literal("succeeded"),
          Type.Literal("partial"),
          Type.Literal("blocked"),
          Type.Literal("failed"),
          Type.Literal("aborted"),
        ]),
        completionSummary: Type.String(),
        idempotencyKey: Type.Optional(Type.String()),
        artifact: Type.Optional(
          Type.Object({
            type: artifactTypeSchema,
            ref: Type.String(),
            metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        assertScoped(params);
        await input.onConductorComplete?.(params as ConductorCompletionReportInput);
        return {
          content: [{ type: "text", text: `completed task ${params.taskId} with ${params.status}` }],
          details: params,
        };
      },
    }),
  ];
  return tools;
}

export function buildTaskContractPrompt(input: TaskContractInput): string {
  const constraints = input.constraints?.length
    ? input.constraints.map((constraint) => `- ${constraint}`).join("\n")
    : "- No additional constraints were provided.";
  const followUpInstruction = input.allowFollowUpTasks
    ? "If you discover follow-up work that should be tracked separately, call conductor_child_create_followup_task."
    : null;
  const completion = input.explicitCompletionTools
    ? [
        "Report progress with conductor_child_progress when meaningful milestones happen.",
        "Attach evidence through the artifact field on conductor_child_progress or conductor_child_complete.",
        "If you are blocked or need input/review, create a scoped gate with conductor_child_create_gate.",
        ...(followUpInstruction ? [followUpInstruction] : []),
        "Include a stable idempotencyKey on progress and completion tool calls when retrying or after tool-call uncertainty.",
        "When finished, call conductor_child_complete with succeeded, partial, blocked, failed, or aborted status.",
      ].join("\n")
    : "Explicit conductor completion tools are unavailable for this backend; finish with a concise outcome summary and expect parent review.";

  return [
    "# pi-conductor task contract",
    `Task ID: ${input.taskId}`,
    `Run ID: ${input.runId}`,
    `Task revision ${input.taskRevision}`,
    "",
    "## Goal",
    input.goal,
    "",
    "## Constraints",
    constraints,
    "",
    "## Completion contract",
    completion,
  ].join("\n");
}

export async function preflightWorkerRunRuntime(input: RuntimeRunPreflightContext): Promise<void> {
  if (!input.worktreePath || !existsSync(input.worktreePath)) {
    throw new Error("Worker worktree is not available for a foreground run");
  }
  if (!input.sessionFile || !existsSync(input.sessionFile)) {
    throw new Error("Worker session file is not available for a foreground run");
  }

  const modelRegistry = getModelRegistryForRun();
  if (modelRegistry.getAvailable().length === 0) {
    throw new Error("No usable model or provider configuration is available for pi-conductor worker runs");
  }
}

export async function runWorkerPromptRuntime(input: RuntimeRunContext): Promise<RuntimeRunResult> {
  const sessionManager = SessionManager.open(input.sessionFile);
  const modelRegistry = getModelRegistryForRun();
  const authStorage = modelRegistry.authStorage;
  const resourceLoader = createMinimalRunResourceLoader();

  if (input.signal?.aborted) {
    return {
      status: "aborted",
      finalText: null,
      errorMessage: null,
      sessionId: null,
    };
  }

  const customTools = input.taskContract ? buildRunScopedConductorTools(input) : [];
  const enabledTools = ["read", "bash", "edit", "write", "grep", "find", "ls", ...customTools.map((tool) => tool.name)];

  const { session } = await createAgentSession({
    cwd: input.worktreePath,
    sessionManager,
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: enabledTools,
    customTools,
  });

  let unsubscribeAbortHandler: (() => void) | null = null;
  if (input.signal) {
    const onAbort = () => {
      void session.abort().catch(() => undefined);
    };
    input.signal.addEventListener("abort", onAbort);
    if (input.signal.aborted) {
      onAbort();
    }
    unsubscribeAbortHandler = () => input.signal?.removeEventListener("abort", onAbort);
  }

  let initialMessageCount = 0;
  let newMessages: unknown[] = [];

  try {
    await session.bindExtensions({});
    await input.onSessionReady?.(session.sessionId);

    initialMessageCount = session.messages.length;

    await session.prompt(input.taskContract ? buildTaskContractPrompt(input.taskContract) : input.task);

    newMessages = session.messages.slice(initialMessageCount);
    const finalAssistant = [...newMessages].reverse().find(isAssistantMessage);
    if (!finalAssistant) {
      if (input.signal?.aborted) {
        return {
          status: "aborted",
          finalText: null,
          errorMessage: null,
          sessionId: session.sessionId,
        };
      }

      return {
        status: "error",
        finalText: null,
        errorMessage: "Run finished without a terminal assistant message",
        sessionId: session.sessionId,
      };
    }

    const mapped = mapStopReasonToRunOutcome(finalAssistant.stopReason);
    const finalText = extractFinalAssistantText(newMessages);
    const errorMessage = mapped.errorMessage ?? finalAssistant.errorMessage ?? null;

    return {
      status: mapped.status,
      finalText,
      errorMessage,
      sessionId: session.sessionId,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      const messagesAfterStart = session.messages.slice(initialMessageCount);
      return {
        status: "aborted",
        finalText: extractFinalAssistantText(messagesAfterStart),
        errorMessage: null,
        sessionId: session.sessionId,
      };
    }

    return {
      status: "error",
      finalText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      sessionId: session.sessionId,
    };
  } finally {
    unsubscribeAbortHandler?.();
    session.dispose();
  }
}

export async function createWorkerSessionRuntime(worktreePath: string): Promise<WorkerRuntimeHandle> {
  const sessionManager = SessionManager.create(worktreePath);
  await sessionManager.appendSessionInfo("pi-conductor worker");
  return buildRuntimeHandle(sessionManager, null);
}

export async function recoverWorkerSessionRuntime(worktreePath: string): Promise<WorkerRuntimeHandle> {
  // Recovery currently re-establishes a fresh persisted session for the worker.
  // Keep this as a named seam so recovery can diverge from plain creation later.
  return createWorkerSessionRuntime(worktreePath);
}

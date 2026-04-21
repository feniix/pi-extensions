import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StopReason } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createExtensionRuntime,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { generateWorkerSummaryFromSession } from "./summaries.js";
import type {
  RuntimeRunContext,
  RuntimeRunPreflightContext,
  RuntimeRunResult,
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

export function extractFinalAssistantText(messages: unknown[]): string | null {
  // AgentSession.messages contains a broader union than the final assistant-shaping
  // logic actually needs here, so keep the helper intentionally loose and extract
  // only the assistant text blocks conductor cares about for operator summaries.
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
  const { session } = await createAgentSession({
    cwd: input.worktreePath,
    sessionManager,
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: [
      createReadTool(input.worktreePath),
      createBashTool(input.worktreePath),
      createEditTool(input.worktreePath),
      createWriteTool(input.worktreePath),
      createGrepTool(input.worktreePath),
      createFindTool(input.worktreePath),
      createLsTool(input.worktreePath),
    ],
  });

  try {
    await session.bindExtensions({});
    await input.onSessionReady?.(session.sessionId);

    await session.prompt(input.task);

    const finalAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
    if (!finalAssistant || finalAssistant.role !== "assistant") {
      return {
        status: "error",
        finalText: null,
        errorMessage: "Run finished without a terminal assistant message",
        sessionId: session.sessionId,
      };
    }

    const mapped = mapStopReasonToRunOutcome(finalAssistant.stopReason);
    const finalText = extractFinalAssistantText(session.messages);
    const errorMessage = mapped.errorMessage ?? finalAssistant.errorMessage ?? null;

    return {
      status: mapped.status,
      finalText,
      errorMessage,
      sessionId: session.sessionId,
    };
  } catch (error) {
    return {
      status: "error",
      finalText: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      sessionId: session.sessionId,
    };
  } finally {
    session.dispose();
  }
}

export async function createWorkerSessionRuntime(worktreePath: string): Promise<WorkerRuntimeHandle> {
  const sessionManager = SessionManager.create(worktreePath);
  await sessionManager.appendSessionInfo("pi-conductor worker");
  return buildRuntimeHandle(sessionManager, null);
}

export async function resumeWorkerSessionRuntime(sessionFile: string): Promise<WorkerRuntimeHandle> {
  const sessionManager = SessionManager.open(sessionFile);
  const lastResumedAt = new Date().toISOString();
  await sessionManager.appendCustomEntry("pi-conductor_runtime_resume", {
    resumedAt: lastResumedAt,
  });
  return buildRuntimeHandle(sessionManager, lastResumedAt);
}

export async function recoverWorkerSessionRuntime(worktreePath: string): Promise<WorkerRuntimeHandle> {
  // Recovery currently re-establishes a fresh persisted session for the worker.
  // Keep this as a named seam so recovery can diverge from plain creation later.
  return createWorkerSessionRuntime(worktreePath);
}

export async function summarizeWorkerSessionRuntime(sessionFile: string): Promise<string> {
  // Keep summary generation behind the runtime seam so a future backend can
  // replace raw session-file summarization without changing conductor flows.
  return generateWorkerSummaryFromSession(sessionFile);
}

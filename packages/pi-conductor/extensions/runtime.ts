import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { generateWorkerSummaryFromSession } from "./summaries.js";
import type { WorkerRuntimeState } from "./types.js";

export interface WorkerRuntimeHandle extends WorkerRuntimeState {
  sessionFile: string | null;
}

function persistSessionFile(sessionManager: SessionManager, sessionFile: string): void {
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
  return createWorkerSessionRuntime(worktreePath);
}

export async function summarizeWorkerSessionRuntime(sessionFile: string): Promise<string> {
  return generateWorkerSummaryFromSession(sessionFile);
}

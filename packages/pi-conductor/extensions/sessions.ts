import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";

function ensurePersistedSessionFile(sessionManager: SessionManager, sessionFile: string): void {
  if (existsSync(sessionFile)) {
    return;
  }
  const header = sessionManager.getHeader();
  const entries = sessionManager.getEntries();
  mkdirSync(dirname(sessionFile), { recursive: true });
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf-8");
}

export async function createWorkerSessionLink(worktreePath: string): Promise<string | null> {
  const sessionManager = SessionManager.create(worktreePath);
  await sessionManager.appendSessionInfo("pi-conductor worker");
  const sessionFile = sessionManager.getSessionFile() ?? null;
  if (!sessionFile) {
    return null;
  }
  ensurePersistedSessionFile(sessionManager, sessionFile);
  return sessionFile;
}

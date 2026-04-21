import { createWorkerSessionRuntime } from "./runtime.js";

export async function createWorkerSessionLink(worktreePath: string): Promise<string | null> {
  const runtime = await createWorkerSessionRuntime(worktreePath);
  return runtime.sessionFile;
}

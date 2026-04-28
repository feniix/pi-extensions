import { mutateRepoRunSync } from "./repo-run.js";
import type { RunRecord } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function withStateLockRetry<T>(operation: () => T): Promise<T> {
  const delays = [10, 25, 50, 100, 200];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!/locked/i.test(errorMessage(error)) || attempt >= delays.length - 1) throw error;
      await sleep(delays[attempt] ?? delays.at(-1) ?? 200);
    }
  }
}

export async function mutateRepoRunWithLockRetry(
  repoRoot: string,
  mutator: (run: RunRecord) => RunRecord,
): Promise<RunRecord> {
  return withStateLockRetry(() => mutateRepoRunSync(repoRoot, mutator));
}

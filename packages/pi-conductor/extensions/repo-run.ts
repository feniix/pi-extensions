import { resolve } from "node:path";
import { deriveProjectKey } from "./project-key.js";
import { mutateRunWithFileLockSync, readRun } from "./storage.js";
import type { RunRecord } from "./types.js";

export function mutateRepoRunSync(repoRoot: string, mutator: (run: RunRecord) => RunRecord): RunRecord {
  const normalizedRoot = resolve(repoRoot);
  return mutateRunWithFileLockSync(deriveProjectKey(normalizedRoot), normalizedRoot, mutator);
}

export function getOrCreateRunForRepo(repoRoot: string): RunRecord {
  const normalizedRoot = resolve(repoRoot);
  const projectKey = deriveProjectKey(normalizedRoot);
  const existing = readRun(projectKey);
  return existing ?? mutateRepoRunSync(normalizedRoot, (run) => run);
}

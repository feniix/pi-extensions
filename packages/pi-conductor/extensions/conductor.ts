import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  commitAllChanges,
  createPullRequest,
  pushBranchToOrigin,
  validatePrPreconditions,
  validatePushPreconditions,
} from "./git-pr.js";
import { deriveProjectKey } from "./project-key.js";
import {
  createWorkerSessionRuntime,
  recoverWorkerSessionRuntime,
  resumeWorkerSessionRuntime,
  summarizeWorkerSessionRuntime,
} from "./runtime.js";
import {
  addWorker,
  createEmptyRun,
  createWorkerRecord,
  readRun,
  removeWorker,
  setWorkerLifecycle,
  setWorkerPrState,
  setWorkerRuntimeState,
  setWorkerSummary,
  setWorkerTask,
  writeRun,
} from "./storage.js";
import type { RunRecord, WorkerLifecycleState, WorkerRecord } from "./types.js";
import { createWorkerId } from "./workers.js";
import {
  createManagedWorktree,
  recreateManagedWorktree,
  removeManagedBranch,
  removeManagedWorktree,
} from "./worktrees.js";

export function getOrCreateRunForRepo(repoRoot: string): RunRecord {
  const normalizedRoot = resolve(repoRoot);
  const projectKey = deriveProjectKey(normalizedRoot);
  const existing = readRun(projectKey);
  if (existing) {
    return existing;
  }
  const run = createEmptyRun(projectKey, normalizedRoot);
  writeRun(run);
  return run;
}

export async function createWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const workerId = createWorkerId();
  const worktree = createManagedWorktree(run.repoRoot, {
    workerId,
    workerName,
  });
  const runtime = await createWorkerSessionRuntime(worktree.worktreePath);
  const worker = createWorkerRecord({
    workerId,
    name: workerName,
    branch: worktree.branch,
    worktreePath: worktree.worktreePath,
    sessionFile: runtime.sessionFile,
    sessionId: runtime.sessionId,
  });
  const updatedRun = addWorker(run, worker);
  writeRun(updatedRun);
  return worker;
}

export function updateWorkerTaskForRepo(repoRoot: string, workerName: string, task: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const updatedRun = setWorkerLifecycle(setWorkerTask(run, worker.workerId, task), worker.workerId, "idle");
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during task update`);
  }
  return updatedWorker;
}

export async function resumeWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (worker.lifecycle === "broken") {
    throw new Error(`Worker named ${workerName} is broken and must be recovered before resume`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} does not have a valid session file`);
  }

  const runtime = await resumeWorkerSessionRuntime(worker.sessionFile);
  const updatedRun = setWorkerLifecycle(
    setWorkerRuntimeState(run, worker.workerId, {
      sessionFile: runtime.sessionFile,
      sessionId: runtime.sessionId,
      lastResumedAt: runtime.lastResumedAt,
    }),
    worker.workerId,
    "idle",
  );
  writeRun(updatedRun);
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function updateWorkerLifecycleForRepo(
  repoRoot: string,
  workerName: string,
  lifecycle: WorkerLifecycleState,
): WorkerRecord {
  if (lifecycle === "broken") {
    throw new Error("Broken lifecycle is reserved for detected health failures");
  }
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const updatedRun = setWorkerLifecycle(run, worker.workerId, lifecycle);
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during lifecycle update`);
  }
  return updatedWorker;
}

export function reconcileWorkerHealth(run: RunRecord): RunRecord {
  const workers = run.workers.map((worker) => {
    const worktreeMissing = !worker.worktreePath || !existsSync(worker.worktreePath);
    const sessionMissing = !worker.sessionFile || !existsSync(worker.sessionFile);
    if (!worktreeMissing && !sessionMissing) {
      return worker;
    }
    return {
      ...worker,
      lifecycle: "broken" as const,
      recoverable: true,
      updatedAt: new Date().toISOString(),
    };
  });
  return {
    ...run,
    workers,
    updatedAt: new Date().toISOString(),
  };
}

export async function refreshWorkerSummaryForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} does not have a valid session file`);
  }
  const summaryText = await summarizeWorkerSessionRuntime(worker.sessionFile);
  const updatedRun = setWorkerSummary(run, worker.workerId, summaryText);
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during summary refresh`);
  }
  return updatedWorker;
}

export function removeWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (worker.worktreePath && existsSync(worker.worktreePath)) {
    removeManagedWorktree(run.repoRoot, worker.worktreePath);
  }
  if (worker.sessionFile && existsSync(worker.sessionFile)) {
    rmSync(worker.sessionFile, { force: true });
  }
  if (worker.branch) {
    removeManagedBranch(run.repoRoot, worker.branch);
  }
  const updatedRun = removeWorker(run, worker.workerId);
  writeRun(updatedRun);
  return worker;
}

export function commitWorkerForRepo(repoRoot: string, workerName: string, message: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree`);
  }
  commitAllChanges(worker.worktreePath, message);
  const updatedRun = setWorkerPrState(run, worker.workerId, {
    commitSucceeded: true,
    pushSucceeded: false,
    prCreationAttempted: false,
    url: null,
    number: null,
  });
  writeRun(updatedRun);
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function pushWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath) || !worker.branch) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree or branch`);
  }
  validatePushPreconditions(run.repoRoot);
  pushBranchToOrigin(worker.worktreePath, worker.branch);
  const updatedRun = setWorkerPrState(run, worker.workerId, {
    pushSucceeded: true,
  });
  writeRun(updatedRun);
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function createWorkerPrForRepo(
  repoRoot: string,
  workerName: string,
  title: string,
  body?: string,
): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath) || !worker.branch) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree or branch`);
  }
  validatePrPreconditions(run.repoRoot);
  const prBody = body?.trim() || worker.summary.text || worker.currentTask || `PR for ${worker.name}`;
  try {
    const pr = createPullRequest({
      repoRoot: run.repoRoot,
      worktreePath: worker.worktreePath,
      branch: worker.branch,
      title,
      body: prBody,
    });
    const updatedRun = setWorkerPrState(run, worker.workerId, {
      prCreationAttempted: true,
      url: pr.url,
      number: pr.number,
    });
    writeRun(updatedRun);
    return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
  } catch (error) {
    const updatedRun = setWorkerPrState(run, worker.workerId, {
      prCreationAttempted: true,
      url: null,
      number: null,
    });
    writeRun(updatedRun);
    throw error;
  }
}

export async function recoverWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }

  let worktreePath = worker.worktreePath;
  if (!worktreePath || !existsSync(worktreePath)) {
    if (!worker.branch) {
      throw new Error(`Worker named ${workerName} cannot be recovered without a valid branch`);
    }
    worktreePath = recreateManagedWorktree(run.repoRoot, {
      workerName: worker.name,
      branch: worker.branch,
    }).worktreePath;
  }

  let runtime = null;
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    runtime = await recoverWorkerSessionRuntime(worktreePath);
  }

  const workers = run.workers.map((entry) =>
    entry.workerId === worker.workerId
      ? {
          ...entry,
          worktreePath,
          sessionFile: runtime?.sessionFile ?? entry.sessionFile,
          runtime: {
            ...entry.runtime,
            sessionId: runtime?.sessionId ?? entry.runtime.sessionId,
            lastResumedAt: runtime?.lastResumedAt ?? entry.runtime.lastResumedAt,
          },
          lifecycle: "idle" as const,
          recoverable: false,
          updatedAt: new Date().toISOString(),
        }
      : entry,
  );
  const updatedRun = {
    ...run,
    workers,
    updatedAt: new Date().toISOString(),
  };
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during recovery`);
  }
  return updatedWorker;
}

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
  preflightWorkerRunRuntime,
  recoverWorkerSessionRuntime,
  resumeWorkerSessionRuntime,
  runWorkerPromptRuntime,
  summarizeWorkerSessionRuntime,
} from "./runtime.js";
import {
  addTask,
  addWorker,
  assignTaskToWorker,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
  finishWorkerRun,
  readRun,
  removeWorker,
  setWorkerLifecycle,
  setWorkerPrState,
  setWorkerRunSessionId,
  setWorkerRuntimeState,
  setWorkerSummary,
  setWorkerTask,
  startWorkerRun,
  writeRun,
} from "./storage.js";
import type { RunRecord, TaskRecord, WorkerLifecycleState, WorkerRecord, WorkerRunResult } from "./types.js";
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

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTaskForRepo(repoRoot: string, input: { title: string; prompt: string }): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = createTaskRecord({
    taskId: createTaskId(),
    title: input.title,
    prompt: input.prompt,
  });
  const updatedRun = addTask(run, task);
  writeRun(updatedRun);
  return task;
}

export function assignTaskForRepo(repoRoot: string, taskId: string, workerId: string): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = assignTaskToWorker(run, taskId, workerId);
  writeRun(updatedRun);
  const task = updatedRun.tasks.find((entry) => entry.taskId === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} disappeared during assignment`);
  }
  return task;
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
  // Resume in the current MVP means "reopen and re-link the persisted worker
  // session" rather than "continue an autonomous running agent". For that
  // reason, resume intentionally normalizes the worker back to idle.
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

export async function runWorkerForRepo(repoRoot: string, workerName: string, task: string): Promise<WorkerRunResult> {
  const run = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (worker.lifecycle === "broken") {
    throw new Error(`Worker named ${workerName} is broken and must recover the worker first`);
  }
  if (worker.lifecycle === "running") {
    throw new Error(`Worker named ${workerName} is already running and cannot accept overlapping runs`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} is missing its session file; recover the worker first`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker named ${workerName} is missing its worktree; recover the worker first`);
  }

  await preflightWorkerRunRuntime({
    worktreePath: worker.worktreePath,
    sessionFile: worker.sessionFile,
  });

  const runningRun = startWorkerRun(run, worker.workerId, {
    task,
    sessionId: null,
  });
  writeRun(runningRun);

  // latestRun is intentionally captured by the onSessionReady callback so the
  // single foreground run can durably record the execution session id before the
  // prompt completes. This path is single-session and single-threaded.
  let latestRun = runningRun;

  try {
    const runtimeResult = await runWorkerPromptRuntime({
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
      task,
      onSessionReady: async (sessionId) => {
        latestRun = setWorkerRunSessionId(latestRun, worker.workerId, sessionId);
        writeRun(latestRun);
      },
    });

    if (
      runtimeResult.sessionId &&
      latestRun.workers.find((entry) => entry.workerId === worker.workerId)?.lastRun?.sessionId !==
        runtimeResult.sessionId
    ) {
      latestRun = setWorkerRunSessionId(latestRun, worker.workerId, runtimeResult.sessionId);
    }
    const completedRun = finishWorkerRun(latestRun, worker.workerId, {
      status: runtimeResult.status,
      errorMessage: runtimeResult.errorMessage,
    });
    writeRun(completedRun);

    return {
      workerName: worker.name,
      status: runtimeResult.status,
      finalText: runtimeResult.finalText,
      errorMessage: runtimeResult.errorMessage,
      sessionId: runtimeResult.sessionId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      const completedRun = finishWorkerRun(latestRun, worker.workerId, {
        status: "error",
        errorMessage: message,
      });
      writeRun(completedRun);
    } catch (persistenceError) {
      const persistenceMessage =
        persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
      throw new Error(`${message} (Additionally failed to persist worker run error state: ${persistenceMessage})`);
    }

    return {
      workerName: worker.name,
      status: "error",
      finalText: null,
      errorMessage: message,
      sessionId: null,
    };
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

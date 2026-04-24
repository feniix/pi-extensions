import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type ConductorBackendsStatus, inspectConductorBackends } from "./backends.js";
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
  addConductorArtifact,
  addTask,
  addWorker,
  appendConductorEvent,
  assignTaskToWorker,
  cancelTaskRun,
  completeTaskRun,
  createConductorGate,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
  finishWorkerRun,
  readRun,
  reconcileRunLeases,
  recordTaskCompletion,
  recordTaskProgress,
  removeWorker,
  resolveConductorGate,
  setWorkerLifecycle,
  setWorkerPrState,
  setWorkerRunSessionId,
  setWorkerRuntimeState,
  setWorkerSummary,
  setWorkerTask,
  startTaskRun,
  startWorkerRun,
  updateTask,
  writeRun,
} from "./storage.js";
import type {
  ConductorActor,
  ConductorResourceRefs,
  GateRecord,
  GateStatus,
  RunAttemptRecord,
  RunRecord,
  TaskContractInput,
  TaskRecord,
  WorkerLifecycleState,
  WorkerRecord,
  WorkerRunResult,
} from "./types.js";
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

function createRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function leaseExpiryFromNow(leaseSeconds: number): string {
  return new Date(Date.now() + leaseSeconds * 1000).toISOString();
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

export function updateTaskForRepo(
  repoRoot: string,
  input: { taskId: string; title?: string; prompt?: string },
): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = updateTask(run, input);
  writeRun(updatedRun);
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during update`);
  }
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

export function recordTaskProgressForRepo(
  repoRoot: string,
  input: {
    runId: string;
    taskId: string;
    progress: string;
    idempotencyKey?: string;
    artifact?: {
      type: "note" | "test_result" | "changed_files" | "log" | "completion_report" | "pr_evidence" | "other";
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = recordTaskProgress(run, input);
  writeRun(updatedRun);
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during progress update`);
  }
  return task;
}

export function recordTaskCompletionForRepo(
  repoRoot: string,
  input: {
    runId: string;
    taskId: string;
    status: "succeeded" | "partial" | "blocked" | "failed" | "aborted";
    completionSummary: string;
    idempotencyKey?: string;
    artifact?: {
      type: "note" | "test_result" | "changed_files" | "log" | "completion_report" | "pr_evidence" | "other";
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = recordTaskCompletion(run, input);
  writeRun(updatedRun);
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during completion update`);
  }
  return task;
}

export function createGateForRepo(
  repoRoot: string,
  input: { type: GateRecord["type"]; resourceRefs: ConductorResourceRefs; requestedDecision: string; gateId?: string },
): GateRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const gateId = input.gateId ?? `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const updatedRun = createConductorGate(run, { ...input, gateId });
  writeRun(updatedRun);
  const gate = updatedRun.gates.find((entry) => entry.gateId === gateId);
  if (!gate) {
    throw new Error(`Gate ${gateId} disappeared during creation`);
  }
  return gate;
}

export function resolveGateForRepo(
  repoRoot: string,
  input: { gateId: string; status: Exclude<GateStatus, "open">; actor: ConductorActor; resolutionReason: string },
): GateRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = resolveConductorGate(run, input);
  writeRun(updatedRun);
  const gate = updatedRun.gates.find((entry) => entry.gateId === input.gateId);
  if (!gate) {
    throw new Error(`Gate ${input.gateId} disappeared during resolution`);
  }
  return gate;
}

export function startTaskRunForRepo(
  repoRoot: string,
  input: {
    taskId: string;
    workerId?: string;
    leaseSeconds?: number;
    runId?: string;
    backend?: RunAttemptRecord["backend"];
    allowFollowUpTasks?: boolean;
    inspectBackends?: () => ConductorBackendsStatus;
  },
): { run: RunAttemptRecord; taskContract: TaskContractInput } {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  const workerId = input.workerId ?? task.assignedWorkerId;
  if (!workerId) {
    throw new Error(`Task ${input.taskId} is not assigned to a worker`);
  }
  const backend = input.backend ?? "native";
  if (backend === "pi-subagents") {
    const status = (input.inspectBackends ?? inspectConductorBackends)().piSubagents;
    const withEvent = appendConductorEvent(run, {
      actor: { type: "backend", id: "pi-subagents" },
      type: "backend.unavailable",
      resourceRefs: { projectKey: run.projectKey, taskId: input.taskId, workerId },
      payload: {
        backend,
        diagnostic: status.available
          ? "pi-subagents dispatch adapter is not implemented yet"
          : (status.diagnostic ?? "pi-subagents backend is unavailable"),
      },
    });
    writeRun(withEvent);
    throw new Error(
      `pi-subagents backend unavailable: ${status.available ? "dispatch adapter is not implemented yet" : (status.diagnostic ?? "not available")}`,
    );
  }
  const runId = input.runId ?? createRunId();
  const updatedRun = startTaskRun(run, {
    runId,
    taskId: input.taskId,
    workerId,
    backend,
    leaseExpiresAt: leaseExpiryFromNow(input.leaseSeconds ?? 900),
  });
  writeRun(updatedRun);
  const started = updatedRun.runs.find((entry) => entry.runId === runId);
  const updatedTask = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!started || !updatedTask) {
    throw new Error(`Run ${runId} disappeared during start`);
  }
  return {
    run: started,
    taskContract: {
      taskId: updatedTask.taskId,
      runId: started.runId,
      taskRevision: started.taskRevision,
      goal: updatedTask.prompt,
      constraints: [],
      explicitCompletionTools: true,
      allowFollowUpTasks: input.allowFollowUpTasks ?? false,
    },
  };
}

export function cancelTaskRunForRepo(repoRoot: string, input: { runId: string; reason: string }): RunRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = cancelTaskRun(run, input);
  writeRun(updatedRun);
  return updatedRun;
}

export function retryTaskForRepo(
  repoRoot: string,
  input: { taskId: string; workerId?: string; leaseSeconds?: number },
): { run: RunAttemptRecord; taskContract: TaskContractInput } {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  if (task.activeRunId) {
    throw new Error(`Task ${input.taskId} already has an active run`);
  }
  if (!["blocked", "failed", "needs_review", "canceled"].includes(task.state)) {
    throw new Error(`Task ${input.taskId} is ${task.state} and is not eligible for retry`);
  }
  return startTaskRunForRepo(repoRoot, input);
}

export function createFollowUpTaskForRepo(
  repoRoot: string,
  input: { runId: string; taskId: string; title: string; prompt: string },
): TaskRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const runAttempt = run.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt || runAttempt.taskId !== input.taskId || runAttempt.finishedAt) {
    throw new Error(`Run ${input.runId} is not an active run for task ${input.taskId}`);
  }
  const task = createTaskRecord({ taskId: createTaskId(), title: input.title, prompt: input.prompt });
  const withTask = addTask(run, task);
  const withEvent = appendConductorEvent(withTask, {
    actor: { type: "child_run", id: input.runId },
    type: "task.followup_created",
    resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, runId: input.runId },
    payload: { parentTaskId: input.taskId, title: input.title },
  });
  writeRun(withEvent);
  const created = withEvent.tasks.find((entry) => entry.taskId === task.taskId);
  if (!created) {
    throw new Error(`Follow-up task ${task.taskId} disappeared during creation`);
  }
  return created;
}

export async function delegateTaskForRepo(
  repoRoot: string,
  input: { title: string; prompt: string; workerName: string; startRun?: boolean; leaseSeconds?: number },
): Promise<{
  worker: WorkerRecord;
  task: TaskRecord;
  run: RunAttemptRecord | null;
  taskContract: TaskContractInput | null;
}> {
  const initialRun = getOrCreateRunForRepo(repoRoot);
  const worker =
    initialRun.workers.find((entry) => entry.name === input.workerName) ??
    (await createWorkerForRepo(repoRoot, input.workerName));
  const task = createTaskForRepo(repoRoot, { title: input.title, prompt: input.prompt });
  const assigned = assignTaskForRepo(repoRoot, task.taskId, worker.workerId);

  if (!input.startRun) {
    return { worker, task: assigned, run: null, taskContract: null };
  }

  const started = startTaskRunForRepo(repoRoot, {
    taskId: assigned.taskId,
    workerId: worker.workerId,
    leaseSeconds: input.leaseSeconds,
  });
  const current = getOrCreateRunForRepo(repoRoot);
  return {
    worker,
    task: current.tasks.find((entry) => entry.taskId === assigned.taskId) ?? assigned,
    run: started.run,
    taskContract: started.taskContract,
  };
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

export function reconcileProjectForRepo(repoRoot: string, input: { now?: string; dryRun?: boolean } = {}): RunRecord {
  const healthReconciled = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const leaseReconciled = reconcileRunLeases(healthReconciled, input);
  if (!input.dryRun) {
    writeRun(leaseReconciled);
  }
  return leaseReconciled;
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
  const cleanupGate = run.gates.find(
    (gate) =>
      gate.type === "destructive_cleanup" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.status !== "canceled",
  );
  if (cleanupGate?.status !== "approved") {
    if (!cleanupGate) {
      createGateForRepo(repoRoot, {
        type: "destructive_cleanup",
        resourceRefs: { workerId: worker.workerId },
        requestedDecision: `Approve deleting worker ${worker.name}, its worktree, session link, and managed branch`,
      });
    }
    throw new Error(`Worker ${worker.name} requires an approved destructive_cleanup gate before cleanup`);
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
  const readyGate = run.gates.find(
    (gate) =>
      gate.type === "ready_for_pr" && gate.resourceRefs.workerId === worker.workerId && gate.status !== "canceled",
  );
  if (readyGate?.status !== "approved") {
    if (!readyGate) {
      createGateForRepo(repoRoot, {
        type: "ready_for_pr",
        resourceRefs: { workerId: worker.workerId },
        requestedDecision: `Approve creating a pull request for worker ${worker.name}`,
      });
    }
    throw new Error(`Worker ${worker.name} requires an approved ready_for_pr gate before PR creation`);
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
    const completedTasks = updatedRun.tasks.filter(
      (task) => task.assignedWorkerId === worker.workerId && ["completed", "needs_review"].includes(task.state),
    );
    const taskIds = completedTasks.map((task) => task.taskId);
    const runIds = completedTasks.flatMap((task) => task.runIds);
    const withEvidence = pr.url
      ? addConductorArtifact(updatedRun, {
          type: "pr_evidence",
          ref: pr.url,
          resourceRefs: { workerId: worker.workerId, taskId: taskIds[0], runId: runIds[0] },
          producer: { type: "system", id: "github-cli" },
          metadata: { number: pr.number, branch: worker.branch ?? null, title, taskIds, runIds },
        })
      : updatedRun;
    writeRun(withEvidence);
    return withEvidence.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
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

function mapWorkerRunStatusToRunStatus(status: WorkerRunResult["status"]): "succeeded" | "failed" | "aborted" {
  switch (status) {
    case "success":
      return "succeeded";
    case "aborted":
      return "aborted";
    default:
      return "failed";
  }
}

function createGateId(): string {
  return `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runTaskForRepo(repoRoot: string, taskId: string): Promise<WorkerRunResult> {
  const started = startTaskRunForRepo(repoRoot, { taskId });
  let currentRun = getOrCreateRunForRepo(repoRoot);
  const worker = currentRun.workers.find((entry) => entry.workerId === started.run.workerId);
  const task = currentRun.tasks.find((entry) => entry.taskId === taskId);
  if (!worker || !task) {
    throw new Error(`Task ${taskId} has invalid worker/run references`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker ${worker.name} is missing its session file; recover the worker first`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker ${worker.name} is missing its worktree; recover the worker first`);
  }

  await preflightWorkerRunRuntime({ worktreePath: worker.worktreePath, sessionFile: worker.sessionFile });

  const runtimeResult = await runWorkerPromptRuntime({
    worktreePath: worker.worktreePath,
    sessionFile: worker.sessionFile,
    task: task.prompt,
    taskContract: started.taskContract,
    onConductorProgress: async (progress) => {
      recordTaskProgressForRepo(repoRoot, progress);
    },
    onConductorComplete: async (completion) => {
      recordTaskCompletionForRepo(repoRoot, completion);
    },
    onConductorGate: async (gate) => {
      createGateForRepo(repoRoot, {
        type: gate.type,
        resourceRefs: { taskId: gate.taskId, runId: gate.runId, workerId: worker.workerId },
        requestedDecision: gate.requestedDecision,
      });
    },
    onConductorFollowUpTask: async (followUp) => {
      createFollowUpTaskForRepo(repoRoot, followUp);
    },
  });

  currentRun = getOrCreateRunForRepo(repoRoot);
  const runAttempt = currentRun.runs.find((entry) => entry.runId === started.run.runId);
  if (runAttempt && !runAttempt.finishedAt) {
    const semanticStatus =
      runtimeResult.status === "success" ? "partial" : mapWorkerRunStatusToRunStatus(runtimeResult.status);
    const completedRun = completeTaskRun(currentRun, {
      runId: started.run.runId,
      status: semanticStatus,
      completionSummary: runtimeResult.finalText,
      errorMessage: runtimeResult.errorMessage,
    });
    writeRun(completedRun);
    if (runtimeResult.status === "success") {
      createGateForRepo(repoRoot, {
        gateId: createGateId(),
        type: "needs_review",
        resourceRefs: { taskId, runId: started.run.runId, workerId: worker.workerId },
        requestedDecision: `Review task ${taskId}: native worker exited without explicit conductor_child_complete`,
      });
    }
  }

  return {
    workerName: worker.name,
    status: runtimeResult.status,
    finalText: runtimeResult.finalText,
    errorMessage: runtimeResult.errorMessage,
    sessionId: runtimeResult.sessionId,
  };
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

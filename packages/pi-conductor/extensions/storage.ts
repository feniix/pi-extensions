import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { deriveProjectKey } from "./project-key.js";
import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import { createRunRuntimeMetadata, mapRunStatusToRuntimeStatus } from "./runtime-metadata.js";
import { markRunAttemptStale } from "./runtime-stale.js";
import { defaultOperationForGate, normalizeProjectRecord } from "./storage-normalize.js";
import { validateRunRecord } from "./storage-validation.js";

export { queryConductorArtifacts, queryConductorEvents } from "./storage-query.js";
export { validateRunRecord } from "./storage-validation.js";

import type {
  ArtifactRecord,
  ArtifactType,
  ConductorActor,
  ConductorEvent,
  ConductorEventType,
  ConductorResourceRefs,
  GateOperation,
  GateRecord,
  GateStatus,
  ObjectiveRecord,
  ObjectiveStatus,
  PersistedRunRecord,
  RunAttemptRecord,
  RunRecord,
  RunRuntimeMode,
  RunStatus,
  TaskRecord,
  WorkerPrState,
  WorkerRecord,
  WorkerRuntimeState,
} from "./types.js";
import { CONDUCTOR_SCHEMA_VERSION } from "./types.js";

function getConductorRoot(): string {
  const override = process.env.PI_CONDUCTOR_HOME?.trim();
  if (override) {
    return join(resolve(override), "projects");
  }
  return join(homedir(), ".pi", "agent", "conductor", "projects");
}

export function getConductorProjectDir(projectKey: string): string {
  return join(getConductorRoot(), projectKey);
}

export function getRunFile(projectKey: string): string {
  return join(getConductorProjectDir(projectKey), "run.json");
}

export function getRunLockFile(projectKey: string): string {
  return join(getConductorProjectDir(projectKey), "run.lock");
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function createEventId(sequence: number): string {
  return `event-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readRun(projectKey: string): RunRecord | null {
  const path = getRunFile(projectKey);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const run = JSON.parse(readFileSync(path, "utf-8")) as PersistedRunRecord;
    validateRunRecord(run);
    return normalizeProjectRecord(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read conductor state for project ${projectKey} at ${path}: ${message}`);
  }
}

export function writeRun(run: RunRecord): void {
  validateRunRecord(run);
  const normalized = normalizeProjectRecord(run);
  const path = getRunFile(normalized.projectKey);
  ensureDir(dirname(path));
  const tmpPath = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, path);
  } catch (error) {
    if (existsSync(tmpPath)) {
      rmSync(tmpPath, { force: true });
    }
    throw error;
  }
}

const projectMutationLocks = new Map<string, Promise<void>>();

function acquireRunFileLock(projectKey: string): () => void {
  const lockPath = getRunLockFile(projectKey);
  ensureDir(dirname(lockPath));
  if (existsSync(lockPath)) {
    throw new Error(`Conductor state for project ${projectKey} is locked`);
  }
  const fd = openSync(lockPath, "wx");
  writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  return () => {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  };
}

export async function mutateRunWithFileLock(
  projectKey: string,
  repoRoot: string,
  mutator: (run: RunRecord) => RunRecord | Promise<RunRecord>,
): Promise<RunRecord> {
  const release = acquireRunFileLock(projectKey);
  try {
    const current = readRun(projectKey) ?? createEmptyRun(projectKey, repoRoot);
    const updated = await mutator(current);
    writeRun(updated);
    return updated;
  } finally {
    release();
  }
}

export function mutateRunWithFileLockSync(
  projectKey: string,
  repoRoot: string,
  mutator: (run: RunRecord) => RunRecord,
): RunRecord {
  const release = acquireRunFileLock(projectKey);
  try {
    const current = readRun(projectKey) ?? createEmptyRun(projectKey, repoRoot);
    const updated = mutator(current);
    writeRun(updated);
    return updated;
  } finally {
    release();
  }
}

export async function mutateRun(
  projectKey: string,
  repoRoot: string,
  mutator: (run: RunRecord) => RunRecord | Promise<RunRecord>,
): Promise<RunRecord> {
  const previous = projectMutationLocks.get(projectKey) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chainedLock = previous.then(
    () => currentLock,
    () => currentLock,
  );
  projectMutationLocks.set(projectKey, chainedLock);

  await previous;
  try {
    const current = readRun(projectKey) ?? createEmptyRun(projectKey, repoRoot);
    const updated = await mutator(current);
    writeRun(updated);
    return updated;
  } finally {
    releaseCurrent();
    if (projectMutationLocks.get(projectKey) === chainedLock) {
      projectMutationLocks.delete(projectKey);
    }
  }
}

export function createEmptyRun(projectKey: string, repoRoot: string): RunRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: CONDUCTOR_SCHEMA_VERSION,
    revision: 0,
    projectKey,
    repoRoot: resolve(repoRoot),
    storageDir: getConductorProjectDir(projectKey),
    workers: [],
    archivedWorkers: [],
    objectives: [],
    tasks: [],
    runs: [],
    gates: [],
    artifacts: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendConductorEvent(
  run: RunRecord,
  input: {
    actor: ConductorActor;
    type: ConductorEventType;
    resourceRefs: ConductorResourceRefs;
    payload?: Record<string, unknown>;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const now = new Date().toISOString();
  const sequence = (normalized.events.at(-1)?.sequence ?? 0) + 1;
  const projectRevision = normalized.revision + 1;
  const event: ConductorEvent = {
    eventId: createEventId(sequence),
    sequence,
    schemaVersion: normalized.schemaVersion,
    projectRevision,
    occurredAt: now,
    actor: input.actor,
    type: input.type,
    resourceRefs: input.resourceRefs,
    payload: input.payload ?? {},
  };

  return {
    ...normalized,
    revision: projectRevision,
    events: [...normalized.events, event],
    updatedAt: now,
  };
}

export function createObjectiveRecord(input: {
  objectiveId: string;
  title: string;
  prompt: string;
  status?: ObjectiveStatus;
}): ObjectiveRecord {
  const now = new Date().toISOString();
  return {
    objectiveId: input.objectiveId,
    title: input.title,
    prompt: input.prompt,
    status: input.status ?? "active",
    revision: 1,
    taskIds: [],
    gateIds: [],
    artifactIds: [],
    summary: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addObjective(run: RunRecord, objective: ObjectiveRecord): RunRecord {
  const normalized = normalizeProjectRecord(run);
  if (normalized.objectives.some((existing) => existing.objectiveId === objective.objectiveId)) {
    throw new Error(`Objective ${objective.objectiveId} already exists`);
  }
  return appendConductorEvent(
    {
      ...normalized,
      objectives: [...normalized.objectives, objective],
      updatedAt: new Date().toISOString(),
    },
    {
      actor: { type: "parent_agent", id: "conductor" },
      type: "objective.created",
      resourceRefs: { projectKey: normalized.projectKey, objectiveId: objective.objectiveId },
      payload: { title: objective.title },
    },
  );
}

export function updateObjective(
  run: RunRecord,
  input: { objectiveId: string; title?: string; prompt?: string; status?: ObjectiveStatus; summary?: string | null },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const existing = normalized.objectives.find((entry) => entry.objectiveId === input.objectiveId);
  if (!existing) {
    throw new Error(`Objective ${input.objectiveId} not found`);
  }
  const now = new Date().toISOString();
  return appendConductorEvent(
    {
      ...normalized,
      objectives: normalized.objectives.map((entry) =>
        entry.objectiveId === input.objectiveId
          ? {
              ...entry,
              title: input.title ?? entry.title,
              prompt: input.prompt ?? entry.prompt,
              status: input.status ?? entry.status,
              summary: input.summary !== undefined ? input.summary : entry.summary,
              revision: entry.revision + 1,
              updatedAt: now,
            }
          : entry,
      ),
      updatedAt: now,
    },
    {
      actor: { type: "parent_agent", id: "conductor" },
      type: "objective.updated",
      resourceRefs: { projectKey: normalized.projectKey, objectiveId: input.objectiveId },
      payload: { status: input.status ?? existing.status },
    },
  );
}

export function linkTaskToObjective(run: RunRecord, objectiveId: string, taskId: string): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const objective = normalized.objectives.find((entry) => entry.objectiveId === objectiveId);
  if (!objective) {
    throw new Error(`Objective ${objectiveId} not found`);
  }
  const task = normalized.tasks.find((entry) => entry.taskId === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  const now = new Date().toISOString();
  return appendConductorEvent(
    {
      ...normalized,
      objectives: normalized.objectives.map((entry) =>
        entry.objectiveId === objectiveId
          ? { ...entry, taskIds: Array.from(new Set([...entry.taskIds, taskId])), updatedAt: now }
          : entry,
      ),
      tasks: normalized.tasks.map((entry) =>
        entry.taskId === taskId ? { ...entry, objectiveId, updatedAt: now } : entry,
      ),
      updatedAt: now,
    },
    {
      actor: { type: "parent_agent", id: "conductor" },
      type: "objective.task_linked",
      resourceRefs: { projectKey: normalized.projectKey, objectiveId, taskId },
      payload: {},
    },
  );
}

export function createTaskRecord(input: {
  taskId: string;
  title: string;
  prompt: string;
  objectiveId?: string;
  dependsOnTaskIds?: string[];
}): TaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: input.taskId,
    title: input.title,
    prompt: input.prompt,
    state: "ready",
    revision: 1,
    assignedWorkerId: null,
    activeRunId: null,
    runIds: [],
    artifactIds: [],
    gateIds: [],
    objectiveId: input.objectiveId ?? null,
    dependsOnTaskIds: input.dependsOnTaskIds ?? [],
    latestProgress: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addTask(run: RunRecord, task: TaskRecord): RunRecord {
  const normalized = normalizeProjectRecord(run);
  if (normalized.tasks.some((existing) => existing.taskId === task.taskId)) {
    throw new Error(`Task ${task.taskId} already exists`);
  }
  return appendConductorEvent(
    {
      ...normalized,
      tasks: [...normalized.tasks, task],
      updatedAt: new Date().toISOString(),
    },
    {
      actor: { type: "system", id: "storage" },
      type: "task.created",
      resourceRefs: { projectKey: normalized.projectKey, taskId: task.taskId },
      payload: { title: task.title },
    },
  );
}

export function updateTask(run: RunRecord, input: { taskId: string; title?: string; prompt?: string }): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const existing = normalized.tasks.find((entry) => entry.taskId === input.taskId);
  if (!existing) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  if (existing.activeRunId) {
    throw new Error(`Task ${input.taskId} has an active run and cannot be updated`);
  }
  const now = new Date().toISOString();
  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === input.taskId
        ? {
            ...entry,
            title: input.title ?? entry.title,
            prompt: input.prompt ?? entry.prompt,
            revision: entry.revision + 1,
            updatedAt: now,
          }
        : entry,
    ),
    updatedAt: now,
  };
  return appendConductorEvent(updated, {
    actor: { type: "parent_agent", id: "conductor" },
    type: "task.updated",
    resourceRefs: { projectKey: normalized.projectKey, taskId: input.taskId },
    payload: { titleChanged: input.title !== undefined, promptChanged: input.prompt !== undefined },
  });
}

export function assignTaskToWorker(run: RunRecord, taskId: string, workerId: string): RunRecord {
  const normalized = normalizeProjectRecord(run);
  if (!normalized.workers.some((worker) => worker.workerId === workerId)) {
    throw new Error(`Worker ${workerId} not found`);
  }

  let found = false;
  const now = new Date().toISOString();
  const tasks = normalized.tasks.map((task) => {
    if (task.taskId !== taskId) {
      return task;
    }
    found = true;
    if (task.activeRunId) {
      throw new Error(`Task ${taskId} has an active run and cannot be reassigned`);
    }
    return {
      ...task,
      state: "assigned" as const,
      assignedWorkerId: workerId,
      updatedAt: now,
    };
  });

  if (!found) {
    throw new Error(`Task ${taskId} not found`);
  }

  return appendConductorEvent(
    {
      ...normalized,
      tasks,
      updatedAt: now,
    },
    {
      actor: { type: "system", id: "storage" },
      type: "task.assigned",
      resourceRefs: { projectKey: normalized.projectKey, taskId, workerId },
      payload: {},
    },
  );
}

function appendWorkerLifecycleChangedEvent(run: RunRecord, before: WorkerRecord, after: WorkerRecord): RunRecord {
  if (before.lifecycle === after.lifecycle) {
    return run;
  }
  return appendConductorEvent(run, {
    actor: { type: "system", id: "storage" },
    type: "worker.lifecycle_changed",
    resourceRefs: { projectKey: run.projectKey, workerId: after.workerId },
    payload: { previousLifecycle: before.lifecycle, lifecycle: after.lifecycle, name: after.name },
  });
}

export function startTaskRun(
  run: RunRecord,
  input: {
    runId: string;
    taskId: string;
    workerId: string;
    backend: RunAttemptRecord["backend"];
    runtimeMode?: RunRuntimeMode;
    leaseExpiresAt: string;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const now = new Date().toISOString();
  const task = normalized.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  if (task.activeRunId) {
    throw new Error(`Task ${input.taskId} already has an active run`);
  }
  if (task.assignedWorkerId !== input.workerId) {
    throw new Error(`Task ${input.taskId} is not assigned to worker ${input.workerId}`);
  }
  const worker = normalized.workers.find((entry) => entry.workerId === input.workerId);
  if (!worker) {
    throw new Error(`Worker ${input.workerId} not found`);
  }
  if (worker.lifecycle !== "idle") {
    throw new Error(`Worker ${input.workerId} is ${worker.lifecycle} and cannot start another run`);
  }
  if (normalized.runs.some((entry) => entry.runId === input.runId)) {
    throw new Error(`Run ${input.runId} already exists`);
  }

  const runAttempt: RunAttemptRecord = {
    runId: input.runId,
    taskId: input.taskId,
    workerId: input.workerId,
    taskRevision: task.revision,
    status: "running",
    backend: input.backend,
    backendRunId: null,
    sessionId: worker.runtime.sessionId,
    runtime: createRunRuntimeMetadata({
      mode: input.runtimeMode ?? "headless",
      status: "running",
      sessionId: worker.runtime.sessionId,
      cwd: worker.worktreePath,
      startedAt: now,
    }),
    leaseGeneration: 1,
    leaseStartedAt: now,
    leaseExpiresAt: input.leaseExpiresAt,
    lastHeartbeatAt: null,
    startedAt: now,
    finishedAt: null,
    completionSummary: null,
    errorMessage: null,
    artifactIds: [],
    gateIds: [],
  };

  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === input.taskId
        ? {
            ...entry,
            state: "running" as const,
            activeRunId: input.runId,
            runIds: [...entry.runIds, input.runId],
            updatedAt: now,
          }
        : entry,
    ),
    workers: normalized.workers.map((entry) =>
      entry.workerId === input.workerId ? { ...entry, lifecycle: "running" as const, updatedAt: now } : entry,
    ),
    runs: [...normalized.runs, runAttempt],
    updatedAt: now,
  };

  const withRunStarted = appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "run.started",
    resourceRefs: {
      projectKey: normalized.projectKey,
      taskId: input.taskId,
      workerId: input.workerId,
      runId: input.runId,
    },
    payload: { backend: input.backend },
  });
  const updatedWorker = withRunStarted.workers.find((entry) => entry.workerId === input.workerId);
  return updatedWorker ? appendWorkerLifecycleChangedEvent(withRunStarted, worker, updatedWorker) : withRunStarted;
}

export function cancelTaskRun(run: RunRecord, input: { runId: string; reason: string }): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const runAttempt = normalized.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    return appendConductorEvent(normalized, {
      actor: { type: "parent_agent", id: "conductor" },
      type: "run.cancel_rejected",
      resourceRefs: {
        projectKey: normalized.projectKey,
        taskId: runAttempt.taskId,
        workerId: runAttempt.workerId,
        runId: input.runId,
      },
      payload: { reason: "run_terminal", requestedReason: input.reason },
    });
  }
  const now = new Date().toISOString();
  const updated = {
    ...normalized,
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            status: "aborted" as const,
            runtime: {
              ...entry.runtime,
              status: "aborted" as const,
              finishedAt: now,
              cleanupStatus: entry.runtime.mode === "headless" ? "not_required" : entry.runtime.cleanupStatus,
            },
            finishedAt: now,
            leaseExpiresAt: null,
            errorMessage: input.reason,
            updatedAt: now,
          }
        : entry,
    ),
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === runAttempt.taskId && entry.activeRunId === input.runId
        ? { ...entry, state: "canceled" as const, activeRunId: null, updatedAt: now }
        : entry,
    ),
    workers: normalized.workers.map((entry) =>
      entry.workerId === runAttempt.workerId
        ? runAttempt.runtime.mode === "headless"
          ? { ...entry, lifecycle: "idle" as const, updatedAt: now }
          : { ...entry, lifecycle: "broken" as const, recoverable: true, updatedAt: now }
        : entry,
    ),
    updatedAt: now,
  };
  const withRunCanceled = appendConductorEvent(updated, {
    actor: { type: "parent_agent", id: "conductor" },
    type: "run.canceled",
    resourceRefs: {
      projectKey: normalized.projectKey,
      taskId: runAttempt.taskId,
      workerId: runAttempt.workerId,
      runId: input.runId,
    },
    payload: { reason: input.reason },
  });
  const beforeWorker = normalized.workers.find((entry) => entry.workerId === runAttempt.workerId);
  const afterWorker = withRunCanceled.workers.find((entry) => entry.workerId === runAttempt.workerId);
  return beforeWorker && afterWorker
    ? appendWorkerLifecycleChangedEvent(withRunCanceled, beforeWorker, afterWorker)
    : withRunCanceled;
}

export function recordRunHeartbeat(
  run: RunRecord,
  input: { runId: string; leaseExpiresAt?: string | null },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const now = new Date().toISOString();
  const runAttempt = normalized.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    throw new Error(`Run ${input.runId} is already terminal`);
  }
  const updated = {
    ...normalized,
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            lastHeartbeatAt: now,
            runtime: { ...entry.runtime, heartbeatAt: now },
            leaseExpiresAt: input.leaseExpiresAt === undefined ? entry.leaseExpiresAt : input.leaseExpiresAt,
          }
        : entry,
    ),
    updatedAt: now,
  };

  return appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "run.heartbeat",
    resourceRefs: {
      projectKey: normalized.projectKey,
      taskId: runAttempt.taskId,
      workerId: runAttempt.workerId,
      runId: input.runId,
    },
    payload: { leaseExpiresAt: input.leaseExpiresAt ?? runAttempt.leaseExpiresAt },
  });
}

function requiresHumanApproval(gateType: GateRecord["type"]): boolean {
  return ["approval_required", "ready_for_pr", "destructive_cleanup"].includes(gateType);
}

export function reconcileRunLeases(run: RunRecord, input: { now?: string } = {}): RunRecord {
  let current = normalizeProjectRecord(run);
  const now = input.now ?? new Date().toISOString();
  const expiredRuns = current.runs.filter(
    (entry) => !isTerminalRunStatus(entry.status) && entry.leaseExpiresAt !== null && entry.leaseExpiresAt <= now,
  );

  for (const expired of expiredRuns) {
    const updated = markRunAttemptStale({
      run: current,
      attempt: expired,
      now,
      diagnostic: "Lease expired",
      workerLifecycle: "idle",
      workerRecoverable: false,
    });
    const withLeaseExpired = appendConductorEvent(updated, {
      actor: { type: "system", id: "reconciler" },
      type: "run.lease_expired",
      resourceRefs: {
        projectKey: current.projectKey,
        taskId: expired.taskId,
        workerId: expired.workerId,
        runId: expired.runId,
      },
      payload: { leaseExpiresAt: expired.leaseExpiresAt, reconciledAt: now },
    });
    const beforeWorker = current.workers.find((entry) => entry.workerId === expired.workerId);
    const afterWorker = withLeaseExpired.workers.find((entry) => entry.workerId === expired.workerId);
    current =
      beforeWorker && afterWorker
        ? appendWorkerLifecycleChangedEvent(withLeaseExpired, beforeWorker, afterWorker)
        : withLeaseExpired;
  }

  return current;
}

function taskStateForRunStatus(status: RunStatus): TaskRecord["state"] {
  switch (status) {
    case "succeeded":
      return "completed";
    case "blocked":
      return "blocked";
    case "aborted":
      return "canceled";
    case "partial":
    case "unknown_dispatch":
      return "needs_review";
    default:
      return "failed";
  }
}

export function createConductorGate(
  run: RunRecord,
  input: {
    gateId: string;
    type: GateRecord["type"];
    resourceRefs: GateRecord["resourceRefs"];
    requestedDecision: string;
    operation?: GateOperation;
    targetRevision?: number | null;
    expiresAt?: string | null;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  if (normalized.gates.some((entry) => entry.gateId === input.gateId)) {
    throw new Error(`Gate ${input.gateId} already exists`);
  }
  const now = new Date().toISOString();
  const gate: GateRecord = {
    gateId: input.gateId,
    type: input.type,
    status: "open",
    resourceRefs: { projectKey: normalized.projectKey, ...input.resourceRefs },
    requestedDecision: input.requestedDecision,
    operation: input.operation ?? defaultOperationForGate(input.type),
    targetRevision: input.targetRevision ?? null,
    expiresAt: input.expiresAt ?? null,
    usedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    createdAt: now,
    updatedAt: now,
  };
  const updated = {
    ...normalized,
    gates: [...normalized.gates, gate],
    updatedAt: now,
  };

  return appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "gate.created",
    resourceRefs: gate.resourceRefs,
    payload: {
      gateId: gate.gateId,
      gateType: gate.type,
      requestedDecision: gate.requestedDecision,
      operation: gate.operation,
      targetRevision: gate.targetRevision,
      expiresAt: gate.expiresAt,
    },
  });
}

export function markConductorGateUsed(run: RunRecord, gateId: string, input: { usedAt?: string } = {}): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const existing = normalized.gates.find((entry) => entry.gateId === gateId);
  if (!existing) {
    throw new Error(`Gate ${gateId} not found`);
  }
  if (existing.status !== "approved") {
    throw new Error(`Gate ${gateId} is not approved`);
  }
  if (existing.usedAt) {
    throw new Error(`Gate ${gateId} has already been used`);
  }
  const usedAt = input.usedAt ?? new Date().toISOString();
  const updated = {
    ...normalized,
    gates: normalized.gates.map((entry) => (entry.gateId === gateId ? { ...entry, usedAt, updatedAt: usedAt } : entry)),
    updatedAt: usedAt,
  };
  return appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "gate.used",
    resourceRefs: existing.resourceRefs,
    payload: { gateId, operation: existing.operation },
  });
}

export function resolveConductorGate(
  run: RunRecord,
  input: {
    gateId: string;
    status: Exclude<GateStatus, "open">;
    actor: GateRecord["resolvedBy"];
    resolutionReason: string;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const existing = normalized.gates.find((entry) => entry.gateId === input.gateId);
  if (!existing) {
    throw new Error(`Gate ${input.gateId} not found`);
  }
  if (existing.status !== "open") {
    throw new Error(`Gate ${input.gateId} is already resolved`);
  }
  if (existing.expiresAt && existing.expiresAt <= new Date().toISOString()) {
    throw new Error(`Gate ${input.gateId} expired at ${existing.expiresAt}`);
  }
  if (input.status === "approved" && requiresHumanApproval(existing.type) && input.actor?.type !== "human") {
    throw new Error(`A human actor is required to approve ${existing.type} gate ${input.gateId}`);
  }
  const now = new Date().toISOString();
  const updated = {
    ...normalized,
    gates: normalized.gates.map((entry) =>
      entry.gateId === input.gateId
        ? {
            ...entry,
            status: input.status,
            resolvedBy: input.actor,
            resolutionReason: input.resolutionReason,
            updatedAt: now,
          }
        : entry,
    ),
    updatedAt: now,
  };

  return appendConductorEvent(updated, {
    actor: input.actor ?? { type: "system", id: "storage" },
    type: "gate.resolved",
    resourceRefs: existing.resourceRefs,
    payload: { gateId: input.gateId, status: input.status, resolutionReason: input.resolutionReason },
  });
}

function assertSafeArtifactRef(ref: string): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return;
  }
  const normalized = normalize(ref);
  if (
    isAbsolute(ref) ||
    normalized === ".." ||
    normalized.startsWith(`..${"/"}`) ||
    normalized.includes(`${"/"}..${"/"}`)
  ) {
    throw new Error(`Unsafe artifact ref '${ref}'`);
  }
}

function createArtifactRecord(input: {
  artifactId: string;
  type: ArtifactType;
  ref: string;
  resourceRefs: ArtifactRecord["resourceRefs"];
  producer: ArtifactRecord["producer"];
  metadata?: Record<string, unknown>;
}): ArtifactRecord {
  assertSafeArtifactRef(input.ref);
  const now = new Date().toISOString();
  return {
    artifactId: input.artifactId,
    type: input.type,
    ref: input.ref,
    resourceRefs: input.resourceRefs,
    producer: input.producer,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

function createArtifactId(runId: string): string {
  return `artifact-${runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const NOTE_CONTENT_REF_METADATA_KEY = "conductorNoteContentRef";
const CHILD_ARTIFACT_RESERVED_METADATA_KEYS = new Set([NOTE_CONTENT_REF_METADATA_KEY]);

function sanitizeChildArtifactMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) => !CHILD_ARTIFACT_RESERVED_METADATA_KEYS.has(key)),
  );
}

function capturedNoteContentRef(artifactId: string): string {
  return `artifacts/${artifactId}.txt`;
}

function writeCapturedNoteContent(run: RunRecord, artifactId: string, content: string): string {
  const ref = capturedNoteContentRef(artifactId);
  const path = resolve(run.storageDir, ref);
  if (!path.startsWith(`${resolve(run.storageDir)}/`)) {
    throw new Error(`Unsafe captured note ref '${ref}'`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, "utf-8");
  return ref;
}

function childNoteMetadata(
  artifact: { type: ArtifactType; metadata?: Record<string, unknown> } | undefined,
  noteContentRef: string | null,
): Record<string, unknown> | undefined {
  if (!artifact) return undefined;
  const metadata = sanitizeChildArtifactMetadata(artifact.metadata);
  if (artifact.type !== "note" || !noteContentRef) return metadata;
  return { ...metadata, [NOTE_CONTENT_REF_METADATA_KEY]: noteContentRef };
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  let bytes = 0;
  let output = "";
  for (const char of content) {
    const charBytes = Buffer.byteLength(char, "utf-8");
    if (bytes + charBytes > maxBytes) {
      return { content: output, truncated: true };
    }
    output += char;
    bytes += charBytes;
  }
  return { content: output, truncated: false };
}

function boundedArtifactContent(
  artifactId: string,
  ref: string,
  content: string,
  maxBytes: number,
  diagnostic: string | null = null,
): { artifactId: string; ref: string; content: string; truncated: boolean; diagnostic: string | null } {
  return { artifactId, ref, ...truncateUtf8(content, maxBytes), diagnostic };
}

function readBoundedTextFile(path: string, maxBytes: number): { content: string; truncated: boolean } {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, maxBytes + 4));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const bounded = truncateUtf8(buffer.subarray(0, bytesRead).toString("utf-8"), maxBytes);
    return { content: bounded.content, truncated: bounded.truncated || size > maxBytes };
  } finally {
    closeSync(fd);
  }
}

function fileHasBinaryPrefix(path: string): boolean {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(size, 1024));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    closeSync(fd);
  }
}

export function readArtifactContentForRepo(
  repoRoot: string,
  artifactId: string,
  input: { maxBytes?: number } = {},
): { artifactId: string; ref: string; content: string | null; truncated: boolean; diagnostic: string | null } {
  const normalizedRoot = resolve(repoRoot);
  const run = readRun(deriveProjectKey(normalizedRoot));
  if (!run) {
    throw new Error(`Artifact ${artifactId} not found`);
  }
  const artifact = run.artifacts.find((entry) => entry.artifactId === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found`);
  }
  const maxBytes = Math.max(1, Math.min(input.maxBytes ?? 8192, 1024 * 1024));
  const metadata = artifact.metadata ?? {};
  const capturedNoteContentRef = metadata[NOTE_CONTENT_REF_METADATA_KEY];
  if (
    artifact.type === "note" &&
    artifact.producer.type === "child_run" &&
    typeof capturedNoteContentRef === "string"
  ) {
    assertSafeArtifactRef(capturedNoteContentRef);
    const noteContentPath = resolve(run.storageDir, capturedNoteContentRef);
    const storageRoot = resolve(run.storageDir);
    if (!noteContentPath.startsWith(`${storageRoot}/`)) {
      throw new Error(`Unsafe captured note ref '${capturedNoteContentRef}'`);
    }
    if (!existsSync(noteContentPath)) {
      return {
        artifactId,
        ref: artifact.ref,
        content: null,
        truncated: false,
        diagnostic: "Captured note content file is missing",
      };
    }
    const content = readBoundedTextFile(noteContentPath, maxBytes);
    return { artifactId, ref: artifact.ref, ...content, diagnostic: null };
  }
  if (artifact.type === "note") {
    assertSafeArtifactRef(artifact.ref);
    const metadataContent = JSON.stringify({ metadata }, null, 2);
    if (/^[a-z][a-z0-9+.-]*:/i.test(artifact.ref)) {
      return boundedArtifactContent(
        artifactId,
        artifact.ref,
        metadataContent,
        maxBytes,
        "Metadata-only note artifact has no readable content file",
      );
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(artifact.ref)) {
    return {
      artifactId,
      ref: artifact.ref,
      content: null,
      truncated: false,
      diagnostic: "Artifact ref is external or virtual",
    };
  }
  assertSafeArtifactRef(artifact.ref);
  const trustsMetadataRoots = artifact.producer.type !== "child_run";
  const metadataRoot = trustsMetadataRoots ? metadata.worktreeRoot : undefined;
  const worker = artifact.resourceRefs.workerId
    ? [...(run?.workers ?? []), ...(run?.archivedWorkers ?? [])].find(
        (entry) => entry.workerId === artifact.resourceRefs.workerId,
      )
    : null;
  const readRoot =
    trustsMetadataRoots && metadata.root === "storage"
      ? (run?.storageDir ?? getConductorProjectDir(deriveProjectKey(normalizedRoot)))
      : typeof metadataRoot === "string"
        ? resolve(metadataRoot)
        : resolve(worker?.worktreePath ?? normalizedRoot);
  if (typeof metadataRoot === "string" && (!worker?.worktreePath || resolve(worker.worktreePath) !== readRoot)) {
    throw new Error(`Artifact ${artifact.artifactId} declares an untrusted worktree root`);
  }
  const artifactPath = resolve(readRoot, artifact.ref);
  if (!artifactPath.startsWith(`${readRoot}${"/"}`) && artifactPath !== readRoot) {
    throw new Error(`Unsafe artifact ref '${artifact.ref}'`);
  }
  if (!existsSync(artifactPath)) {
    return { artifactId, ref: artifact.ref, content: null, truncated: false, diagnostic: "Artifact file is missing" };
  }
  const realRoot = realpathSync(readRoot);
  const realArtifactPath = realpathSync(artifactPath);
  if (!realArtifactPath.startsWith(`${realRoot}${"/"}`) && realArtifactPath !== realRoot) {
    throw new Error(`Unsafe artifact ref '${artifact.ref}'`);
  }
  if (!lstatSync(realArtifactPath).isFile()) {
    return { artifactId, ref: artifact.ref, content: null, truncated: false, diagnostic: "Artifact ref is not a file" };
  }
  if (fileHasBinaryPrefix(realArtifactPath)) {
    return {
      artifactId,
      ref: artifact.ref,
      content: null,
      truncated: false,
      diagnostic: "Artifact file appears to be binary",
    };
  }
  const content = readBoundedTextFile(realArtifactPath, maxBytes);
  return { artifactId, ref: artifact.ref, ...content, diagnostic: null };
}

export function addConductorArtifact(
  run: RunRecord,
  input: {
    artifactId?: string;
    type: ArtifactType;
    ref: string;
    resourceRefs: ArtifactRecord["resourceRefs"];
    producer: ArtifactRecord["producer"];
    metadata?: Record<string, unknown>;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const artifact = createArtifactRecord({
    artifactId:
      input.artifactId ?? createArtifactId(input.resourceRefs.runId ?? input.resourceRefs.workerId ?? "project"),
    type: input.type,
    ref: input.ref,
    resourceRefs: { projectKey: normalized.projectKey, ...input.resourceRefs },
    producer: input.producer,
    metadata: input.metadata,
  });
  const updated = {
    ...normalized,
    tasks: artifact.resourceRefs.taskId
      ? normalized.tasks.map((task) =>
          task.taskId === artifact.resourceRefs.taskId
            ? {
                ...task,
                artifactIds: [...new Set([...task.artifactIds, artifact.artifactId])],
                updatedAt: artifact.updatedAt,
              }
            : task,
        )
      : normalized.tasks,
    runs: artifact.resourceRefs.runId
      ? normalized.runs.map((attempt) =>
          attempt.runId === artifact.resourceRefs.runId
            ? {
                ...attempt,
                artifactIds: [...new Set([...attempt.artifactIds, artifact.artifactId])],
                updatedAt: artifact.updatedAt,
              }
            : attempt,
        )
      : normalized.runs,
    artifacts: [...normalized.artifacts, artifact],
    updatedAt: artifact.updatedAt,
  };
  return appendConductorEvent(updated, {
    actor: input.producer,
    type: "artifact.created",
    resourceRefs: artifact.resourceRefs,
    payload: { artifactId: artifact.artifactId, type: artifact.type, ref: artifact.ref },
  });
}

function hasIdempotentEvent(
  run: RunRecord,
  input: { runId: string; taskId: string; eventType: string; idempotencyKey?: string },
): boolean {
  return Boolean(
    input.idempotencyKey &&
      run.events.some(
        (event) =>
          event.type === input.eventType &&
          event.resourceRefs.runId === input.runId &&
          event.resourceRefs.taskId === input.taskId &&
          event.payload.idempotencyKey === input.idempotencyKey,
      ),
  );
}

function getActiveRunForTask(normalized: RunRecord, input: { runId: string; taskId: string }): RunAttemptRecord {
  const runAttempt = normalized.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (runAttempt.taskId !== input.taskId) {
    throw new Error(`Run ${input.runId} is not scoped to task ${input.taskId}`);
  }
  if (runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    throw new Error(`Run ${input.runId} is already terminal`);
  }
  const task = normalized.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  if (task.activeRunId !== input.runId) {
    throw new Error(`Task ${input.taskId} is not actively running ${input.runId}`);
  }
  return runAttempt;
}

export function recordTaskProgress(
  run: RunRecord,
  input: {
    runId: string;
    taskId: string;
    progress: string;
    idempotencyKey?: string;
    artifact?: { type: ArtifactType; ref: string; metadata?: Record<string, unknown> };
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const now = new Date().toISOString();
  if (hasIdempotentEvent(normalized, { ...input, eventType: "run.progress_reported" })) {
    return normalized;
  }
  const existingRun = normalized.runs.find((entry) => entry.runId === input.runId);
  if (existingRun?.taskId === input.taskId && (existingRun.finishedAt || isTerminalRunStatus(existingRun.status))) {
    return appendConductorEvent(normalized, {
      actor: { type: "child_run", id: input.runId },
      type: "task.progress_rejected",
      resourceRefs: {
        projectKey: normalized.projectKey,
        taskId: input.taskId,
        workerId: existingRun.workerId,
        runId: input.runId,
      },
      payload: { reason: "run_terminal", progress: input.progress },
    });
  }
  const runAttempt = getActiveRunForTask(normalized, input);
  const artifactId = input.artifact ? createArtifactId(input.runId) : null;
  const capturedNoteRef =
    input.artifact?.type === "note" && artifactId
      ? writeCapturedNoteContent(normalized, artifactId, input.progress)
      : null;
  const artifact =
    input.artifact && artifactId
      ? createArtifactRecord({
          artifactId,
          type: input.artifact.type,
          ref: input.artifact.ref,
          resourceRefs: {
            projectKey: normalized.projectKey,
            taskId: input.taskId,
            workerId: runAttempt.workerId,
            runId: input.runId,
          },
          producer: { type: "child_run", id: input.runId },
          metadata: childNoteMetadata(input.artifact, capturedNoteRef),
        })
      : null;
  const artifactIds = artifact ? [artifact.artifactId] : [];
  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === input.taskId
        ? {
            ...entry,
            latestProgress: input.progress,
            artifactIds: [...entry.artifactIds, ...artifactIds],
            updatedAt: now,
          }
        : entry,
    ),
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            lastHeartbeatAt: now,
            runtime: { ...entry.runtime, heartbeatAt: now },
            artifactIds: [...entry.artifactIds, ...artifactIds],
          }
        : entry,
    ),
    artifacts: artifact ? [...normalized.artifacts, artifact] : normalized.artifacts,
    updatedAt: now,
  };

  return appendConductorEvent(updated, {
    actor: { type: "child_run", id: input.runId },
    type: "run.progress_reported",
    resourceRefs: {
      projectKey: normalized.projectKey,
      taskId: input.taskId,
      workerId: runAttempt.workerId,
      runId: input.runId,
    },
    payload: { progress: input.progress, artifactIds, idempotencyKey: input.idempotencyKey ?? null },
  });
}

export function recordTaskCompletion(
  run: RunRecord,
  input: {
    runId: string;
    taskId: string;
    status: RunStatus;
    completionSummary: string;
    idempotencyKey?: string;
    artifact?: { type: ArtifactType; ref: string; metadata?: Record<string, unknown> };
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  if (hasIdempotentEvent(normalized, { ...input, eventType: "run.completed" })) {
    return normalized;
  }
  const existingRun = normalized.runs.find((entry) => entry.runId === input.runId);
  if (existingRun?.taskId === input.taskId && (existingRun.finishedAt || isTerminalRunStatus(existingRun.status))) {
    return appendConductorEvent(normalized, {
      actor: { type: "child_run", id: input.runId },
      type: "task.completion_rejected",
      resourceRefs: {
        projectKey: normalized.projectKey,
        taskId: input.taskId,
        workerId: existingRun.workerId,
        runId: input.runId,
      },
      payload: { reason: "run_terminal", status: input.status, completionSummary: input.completionSummary },
    });
  }
  const runAttempt = getActiveRunForTask(normalized, input);
  const artifactId = input.artifact ? createArtifactId(input.runId) : null;
  const capturedNoteRef =
    input.artifact?.type === "note" && artifactId
      ? writeCapturedNoteContent(normalized, artifactId, input.completionSummary)
      : null;
  const artifact =
    input.artifact && artifactId
      ? createArtifactRecord({
          artifactId,
          type: input.artifact.type,
          ref: input.artifact.ref,
          resourceRefs: {
            projectKey: normalized.projectKey,
            taskId: input.taskId,
            workerId: runAttempt.workerId,
            runId: input.runId,
          },
          producer: { type: "child_run", id: input.runId },
          metadata: childNoteMetadata(input.artifact, capturedNoteRef),
        })
      : null;
  const withArtifact = artifact
    ? {
        ...normalized,
        tasks: normalized.tasks.map((entry) =>
          entry.taskId === input.taskId
            ? { ...entry, artifactIds: [...entry.artifactIds, artifact.artifactId] }
            : entry,
        ),
        runs: normalized.runs.map((entry) =>
          entry.runId === input.runId ? { ...entry, artifactIds: [...entry.artifactIds, artifact.artifactId] } : entry,
        ),
        artifacts: [...normalized.artifacts, artifact],
      }
    : normalized;
  return completeTaskRun(withArtifact, {
    runId: input.runId,
    status: input.status,
    completionSummary: input.completionSummary,
    idempotencyKey: input.idempotencyKey,
  });
}

export function completeTaskRun(
  run: RunRecord,
  input: {
    runId: string;
    status: RunStatus;
    completionSummary?: string | null;
    errorMessage?: string | null;
    idempotencyKey?: string;
  },
): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const now = new Date().toISOString();
  const runAttempt = normalized.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    throw new Error(`Run ${input.runId} is already terminal`);
  }

  const taskState = taskStateForRunStatus(input.status);
  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === runAttempt.taskId ? { ...entry, state: taskState, activeRunId: null, updatedAt: now } : entry,
    ),
    workers: normalized.workers.map((entry) =>
      entry.workerId === runAttempt.workerId
        ? {
            ...entry,
            lifecycle: isTmuxRuntimeMode(runAttempt.runtime.mode) ? ("running" as const) : ("idle" as const),
            updatedAt: now,
          }
        : entry,
    ),
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            status: input.status,
            runtime: {
              ...entry.runtime,
              status: mapRunStatusToRuntimeStatus(input.status),
              finishedAt: now,
              cleanupStatus: entry.runtime.mode === "headless" ? "not_required" : entry.runtime.cleanupStatus,
            },
            finishedAt: now,
            leaseExpiresAt: null,
            completionSummary: input.completionSummary ?? null,
            errorMessage: input.errorMessage ?? null,
            updatedAt: now,
          }
        : entry,
    ),
    updatedAt: now,
  };

  const withRunCompleted = appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "run.completed",
    resourceRefs: {
      projectKey: normalized.projectKey,
      taskId: runAttempt.taskId,
      workerId: runAttempt.workerId,
      runId: input.runId,
    },
    payload: {
      status: input.status,
      completionSummary: input.completionSummary ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  const beforeWorker = normalized.workers.find((entry) => entry.workerId === runAttempt.workerId);
  const afterWorker = withRunCompleted.workers.find((entry) => entry.workerId === runAttempt.workerId);
  return beforeWorker && afterWorker
    ? appendWorkerLifecycleChangedEvent(withRunCompleted, beforeWorker, afterWorker)
    : withRunCompleted;
}

export function createWorkerRecord(input: {
  workerId: string;
  name: string;
  branch: string | null;
  worktreePath: string | null;
  sessionFile: string | null;
  sessionId?: string | null;
}): WorkerRecord {
  const now = new Date().toISOString();
  return {
    workerId: input.workerId,
    name: input.name,
    branch: input.branch,
    worktreePath: input.worktreePath,
    sessionFile: input.sessionFile,
    runtime: {
      backend: "session_manager",
      sessionId: input.sessionId ?? null,
      lastResumedAt: null,
    },
    lifecycle: "idle",
    recoverable: false,
    pr: {
      url: null,
      number: null,
      commitSucceeded: false,
      pushSucceeded: false,
      prCreationAttempted: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function addWorker(run: RunRecord, worker: WorkerRecord): RunRecord {
  if (run.workers.some((existing) => existing.name === worker.name)) {
    throw new Error(`Worker named ${worker.name} already exists`);
  }

  return appendConductorEvent(
    {
      ...run,
      workers: [...run.workers, worker],
      updatedAt: new Date().toISOString(),
    },
    {
      actor: { type: "system", id: "storage" },
      type: "worker.created",
      resourceRefs: { projectKey: run.projectKey, workerId: worker.workerId },
      payload: { name: worker.name },
    },
  );
}

export function removeWorker(run: RunRecord, workerId: string): RunRecord {
  const worker = run.workers.find((entry) => entry.workerId === workerId);
  if (!worker) {
    throw new Error(`Worker ${workerId} not found`);
  }
  const now = new Date().toISOString();
  return appendConductorEvent(
    {
      ...run,
      workers: run.workers.filter((entry) => entry.workerId !== workerId),
      archivedWorkers: [
        ...run.archivedWorkers,
        { ...worker, lifecycle: "archived", recoverable: false, updatedAt: now },
      ],
      updatedAt: now,
    },
    {
      actor: { type: "system", id: "storage" },
      type: "worker.archived",
      resourceRefs: { projectKey: run.projectKey, workerId },
      payload: { name: worker.name },
    },
  );
}

export function setWorkerRuntimeState(
  run: RunRecord,
  workerId: string,
  runtime: Partial<WorkerRuntimeState> & { sessionFile?: string | null },
): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const { sessionFile, ...runtimeFields } = runtime;
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      sessionFile: sessionFile === undefined ? worker.sessionFile : sessionFile,
      runtime: {
        ...worker.runtime,
        ...runtimeFields,
      },
      updatedAt: now,
    };
  });
  if (!found) {
    throw new Error(`Worker ${workerId} not found`);
  }
  return {
    ...run,
    workers,
    updatedAt: now,
  };
}

export function setWorkerPrState(run: RunRecord, workerId: string, pr: Partial<WorkerPrState>): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      pr: {
        ...worker.pr,
        ...pr,
      },
      updatedAt: now,
    };
  });
  if (!found) {
    throw new Error(`Worker ${workerId} not found`);
  }
  const updated = {
    ...run,
    workers,
    updatedAt: now,
  };
  return appendConductorEvent(updated, {
    actor: { type: "system", id: "storage" },
    type: "worker.pr_updated",
    resourceRefs: { projectKey: run.projectKey, workerId },
    payload: { changed: Object.keys(pr), pr: workers.find((worker) => worker.workerId === workerId)?.pr ?? null },
  });
}

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type {
  ArtifactRecord,
  ArtifactType,
  ConductorActor,
  ConductorEvent,
  ConductorResourceRefs,
  GateOperation,
  GateRecord,
  GateStatus,
  ObjectiveRecord,
  ObjectiveStatus,
  RunAttemptRecord,
  RunRecord,
  RunStatus,
  TaskRecord,
  WorkerLastRun,
  WorkerLifecycleState,
  WorkerPrState,
  WorkerRecord,
  WorkerRunStatus,
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

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function createEventId(sequence: number): string {
  return `event-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProjectRecord(run: RunRecord): RunRecord {
  return {
    ...run,
    schemaVersion: run.schemaVersion ?? CONDUCTOR_SCHEMA_VERSION,
    revision: run.revision ?? 0,
    workers: (run.workers ?? []).map(normalizeWorkerRecord),
    objectives: run.objectives ?? [],
    tasks: (run.tasks ?? []).map(normalizeTaskRecord),
    runs: run.runs ?? [],
    gates: (run.gates ?? []).map(normalizeGateRecord),
    artifacts: run.artifacts ?? [],
    events: run.events ?? [],
  };
}

function defaultOperationForGate(type: GateRecord["type"]): GateOperation {
  switch (type) {
    case "ready_for_pr":
      return "create_worker_pr";
    case "destructive_cleanup":
      return "destructive_cleanup";
    case "needs_input":
    case "needs_review":
    case "approval_required":
      return "resolve_blocker";
    default:
      return "generic";
  }
}

function normalizeGateRecord(gate: GateRecord): GateRecord {
  return {
    ...gate,
    operation: gate.operation ?? defaultOperationForGate(gate.type),
    targetRevision: gate.targetRevision ?? null,
    expiresAt: gate.expiresAt ?? null,
    usedAt: gate.usedAt ?? null,
  };
}

function normalizeTaskRecord(task: TaskRecord): TaskRecord {
  return {
    ...task,
    objectiveId: task.objectiveId ?? null,
    dependsOnTaskIds: task.dependsOnTaskIds ?? [],
  };
}

function normalizeWorkerRecord(worker: WorkerRecord): WorkerRecord {
  return {
    ...worker,
    runtime: worker.runtime ?? {
      backend: "session_manager",
      sessionId: null,
      lastResumedAt: null,
    },
    lastRun: worker.lastRun ?? null,
  };
}

function assertUnique(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label} ${id}`);
    }
    seen.add(id);
  }
}

function assertRefsExist(
  refs: ConductorResourceRefs,
  indexes: ReturnType<typeof createResourceIndexes>,
  context: string,
): void {
  if (refs.workerId && !indexes.workerIds.has(refs.workerId)) {
    throw new Error(`${context} references missing worker ${refs.workerId}`);
  }
  if (refs.taskId && !indexes.taskIds.has(refs.taskId)) {
    throw new Error(`${context} references missing task ${refs.taskId}`);
  }
  if (refs.runId && !indexes.runIds.has(refs.runId)) {
    throw new Error(`${context} references missing run ${refs.runId}`);
  }
  if (refs.gateId && !indexes.gateIds.has(refs.gateId)) {
    throw new Error(`${context} references missing gate ${refs.gateId}`);
  }
  if (refs.artifactId && !indexes.artifactIds.has(refs.artifactId)) {
    throw new Error(`${context} references missing artifact ${refs.artifactId}`);
  }
  if (refs.objectiveId && !indexes.objectiveIds.has(refs.objectiveId)) {
    throw new Error(`${context} references missing objective ${refs.objectiveId}`);
  }
}

function createResourceIndexes(run: RunRecord) {
  return {
    workerIds: new Set(run.workers.map((worker) => worker.workerId)),
    taskIds: new Set(run.tasks.map((task) => task.taskId)),
    runIds: new Set(run.runs.map((attempt) => attempt.runId)),
    gateIds: new Set(run.gates.map((gate) => gate.gateId)),
    artifactIds: new Set(run.artifacts.map((artifact) => artifact.artifactId)),
    objectiveIds: new Set(run.objectives.map((objective) => objective.objectiveId)),
  };
}

export function validateRunRecord(run: RunRecord): void {
  const normalized = normalizeProjectRecord(run);
  if (normalized.schemaVersion !== CONDUCTOR_SCHEMA_VERSION) {
    throw new Error(`Unsupported conductor schemaVersion ${normalized.schemaVersion}`);
  }
  assertUnique(
    normalized.workers.map((worker) => worker.workerId),
    "workerId",
  );
  assertUnique(
    normalized.workers.map((worker) => worker.name),
    "worker name",
  );
  assertUnique(
    normalized.objectives.map((objective) => objective.objectiveId),
    "objectiveId",
  );
  assertUnique(
    normalized.tasks.map((task) => task.taskId),
    "taskId",
  );
  assertUnique(
    normalized.runs.map((attempt) => attempt.runId),
    "runId",
  );
  assertUnique(
    normalized.gates.map((gate) => gate.gateId),
    "gateId",
  );
  assertUnique(
    normalized.artifacts.map((artifact) => artifact.artifactId),
    "artifactId",
  );

  const indexes = createResourceIndexes(normalized);
  for (const objective of normalized.objectives) {
    for (const taskId of objective.taskIds) {
      if (!indexes.taskIds.has(taskId)) {
        throw new Error(`Objective ${objective.objectiveId} references missing task ${taskId}`);
      }
    }
    for (const gateId of objective.gateIds) {
      if (!indexes.gateIds.has(gateId)) {
        throw new Error(`Objective ${objective.objectiveId} references missing gate ${gateId}`);
      }
    }
    for (const artifactId of objective.artifactIds) {
      if (!indexes.artifactIds.has(artifactId)) {
        throw new Error(`Objective ${objective.objectiveId} references missing artifact ${artifactId}`);
      }
    }
  }
  for (const task of normalized.tasks) {
    if (task.objectiveId && !indexes.objectiveIds.has(task.objectiveId)) {
      throw new Error(`Task ${task.taskId} references missing objective ${task.objectiveId}`);
    }
    if (task.assignedWorkerId && !indexes.workerIds.has(task.assignedWorkerId)) {
      throw new Error(`Task ${task.taskId} references missing worker ${task.assignedWorkerId}`);
    }
    if (task.activeRunId && !indexes.runIds.has(task.activeRunId)) {
      throw new Error(`Task ${task.taskId} references missing run ${task.activeRunId}`);
    }
    for (const dependencyId of task.dependsOnTaskIds) {
      if (!indexes.taskIds.has(dependencyId)) {
        throw new Error(`Task ${task.taskId} references missing dependency ${dependencyId}`);
      }
    }
    for (const runId of task.runIds) {
      if (!indexes.runIds.has(runId)) {
        throw new Error(`Task ${task.taskId} references missing run ${runId}`);
      }
    }
  }
  for (const attempt of normalized.runs) {
    if (!indexes.taskIds.has(attempt.taskId)) {
      throw new Error(`Run ${attempt.runId} references missing task ${attempt.taskId}`);
    }
    if (!indexes.workerIds.has(attempt.workerId)) {
      throw new Error(`Run ${attempt.runId} references missing worker ${attempt.workerId}`);
    }
  }
  for (const gate of normalized.gates) {
    assertRefsExist(gate.resourceRefs, indexes, `Gate ${gate.gateId}`);
  }
  for (const artifact of normalized.artifacts) {
    assertRefsExist(artifact.resourceRefs, indexes, `Artifact ${artifact.artifactId}`);
  }
}

export function readRun(projectKey: string): RunRecord | null {
  const path = getRunFile(projectKey);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const run = JSON.parse(readFileSync(path, "utf-8")) as RunRecord;
    return normalizeProjectRecord(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read conductor state for project ${projectKey} at ${path}: ${message}`);
  }
}

export function writeRun(run: RunRecord): void {
  const normalized = normalizeProjectRecord(run);
  validateRunRecord(normalized);
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
    type: string;
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

export function queryConductorArtifacts(
  run: RunRecord,
  input: {
    workerId?: string;
    taskId?: string;
    runId?: string;
    gateId?: string;
    artifactId?: string;
    type?: ArtifactType;
    afterIndex?: number;
    limit?: number;
  } = {},
): { artifacts: ArtifactRecord[]; lastIndex: number | null; hasMore: boolean } {
  const normalized = normalizeProjectRecord(run);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const filtered = normalized.artifacts
    .map((artifact, index) => ({ artifact, index: index + 1 }))
    .filter(({ artifact, index }) => {
      if (input.afterIndex !== undefined && index <= input.afterIndex) {
        return false;
      }
      if (input.type && artifact.type !== input.type) {
        return false;
      }
      for (const key of ["workerId", "taskId", "runId", "gateId", "artifactId"] as const) {
        if (input[key] && artifact.resourceRefs[key] !== input[key] && artifact.artifactId !== input[key]) {
          return false;
        }
      }
      return true;
    });
  const page = filtered.slice(0, limit);
  return {
    artifacts: page.map((entry) => entry.artifact),
    lastIndex: page.at(-1)?.index ?? null,
    hasMore: filtered.length > page.length,
  };
}

export function queryConductorEvents(
  run: RunRecord,
  input: {
    workerId?: string;
    taskId?: string;
    runId?: string;
    gateId?: string;
    artifactId?: string;
    type?: string;
    afterSequence?: number;
    limit?: number;
  } = {},
): { events: ConductorEvent[]; lastSequence: number | null; hasMore: boolean } {
  const normalized = normalizeProjectRecord(run);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const filtered = normalized.events.filter((event) => {
    if (input.afterSequence !== undefined && event.sequence <= input.afterSequence) {
      return false;
    }
    if (input.type && event.type !== input.type) {
      return false;
    }
    for (const key of ["workerId", "taskId", "runId", "gateId", "artifactId"] as const) {
      if (input[key] && event.resourceRefs[key] !== input[key]) {
        return false;
      }
    }
    return true;
  });
  const events = filtered.slice(0, limit);
  return {
    events,
    lastSequence: events.at(-1)?.sequence ?? null,
    hasMore: filtered.length > events.length,
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

export function startTaskRun(
  run: RunRecord,
  input: {
    runId: string;
    taskId: string;
    workerId: string;
    backend: RunAttemptRecord["backend"];
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

  return appendConductorEvent(updated, {
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
}

export function cancelTaskRun(run: RunRecord, input: { runId: string; reason: string }): RunRecord {
  const normalized = normalizeProjectRecord(run);
  const runAttempt = normalized.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (runAttempt.finishedAt) {
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
      entry.workerId === runAttempt.workerId ? { ...entry, lifecycle: "idle" as const, updatedAt: now } : entry,
    ),
    updatedAt: now,
  };
  return appendConductorEvent(updated, {
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
  if (runAttempt.finishedAt) {
    throw new Error(`Run ${input.runId} is already terminal`);
  }
  const updated = {
    ...normalized,
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            lastHeartbeatAt: now,
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

function isTerminalRunStatus(status: RunStatus): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
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
    const updated = {
      ...current,
      runs: current.runs.map((entry) =>
        entry.runId === expired.runId
          ? { ...entry, status: "stale" as const, finishedAt: now, leaseExpiresAt: null, errorMessage: "Lease expired" }
          : entry,
      ),
      tasks: current.tasks.map((entry) =>
        entry.taskId === expired.taskId && entry.activeRunId === expired.runId
          ? { ...entry, state: "needs_review" as const, activeRunId: null, updatedAt: now }
          : entry,
      ),
      workers: current.workers.map((entry) =>
        entry.workerId === expired.workerId && entry.lifecycle === "running"
          ? { ...entry, lifecycle: "idle" as const, updatedAt: now }
          : entry,
      ),
      updatedAt: now,
    };
    current = appendConductorEvent(updated, {
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
  if (runAttempt.finishedAt) {
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
  if (existingRun?.taskId === input.taskId && existingRun.finishedAt) {
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
  const artifact = input.artifact
    ? createArtifactRecord({
        artifactId: createArtifactId(input.runId),
        type: input.artifact.type,
        ref: input.artifact.ref,
        resourceRefs: {
          projectKey: normalized.projectKey,
          taskId: input.taskId,
          workerId: runAttempt.workerId,
          runId: input.runId,
        },
        producer: { type: "child_run", id: input.runId },
        metadata: input.artifact.metadata,
      })
    : null;
  const artifactIds = artifact ? [artifact.artifactId] : [];
  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === input.taskId ? { ...entry, latestProgress: input.progress, updatedAt: now } : entry,
    ),
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? { ...entry, lastHeartbeatAt: now, artifactIds: [...entry.artifactIds, ...artifactIds] }
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
  if (existingRun?.taskId === input.taskId && existingRun.finishedAt) {
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
  const artifact = input.artifact
    ? createArtifactRecord({
        artifactId: createArtifactId(input.runId),
        type: input.artifact.type,
        ref: input.artifact.ref,
        resourceRefs: {
          projectKey: normalized.projectKey,
          taskId: input.taskId,
          workerId: runAttempt.workerId,
          runId: input.runId,
        },
        producer: { type: "child_run", id: input.runId },
        metadata: input.artifact.metadata,
      })
    : null;
  const withArtifact = artifact
    ? {
        ...normalized,
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
  if (runAttempt.finishedAt) {
    throw new Error(`Run ${input.runId} is already terminal`);
  }

  const taskState = taskStateForRunStatus(input.status);
  const updated = {
    ...normalized,
    tasks: normalized.tasks.map((entry) =>
      entry.taskId === runAttempt.taskId ? { ...entry, state: taskState, activeRunId: null, updatedAt: now } : entry,
    ),
    workers: normalized.workers.map((entry) =>
      entry.workerId === runAttempt.workerId ? { ...entry, lifecycle: "idle" as const, updatedAt: now } : entry,
    ),
    runs: normalized.runs.map((entry) =>
      entry.runId === input.runId
        ? {
            ...entry,
            status: input.status,
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

  return appendConductorEvent(updated, {
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
    currentTask: null,
    lifecycle: "idle",
    recoverable: false,
    lastRun: null,
    summary: {
      text: null,
      updatedAt: null,
      stale: false,
    },
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

  return {
    ...run,
    workers: [...run.workers, worker],
    updatedAt: new Date().toISOString(),
  };
}

export function setWorkerTask(run: RunRecord, workerId: string, task: string): RunRecord {
  let found = false;
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      currentTask: task,
      summary: {
        ...worker.summary,
        stale: worker.summary.text !== null ? true : worker.summary.stale,
      },
      updatedAt: new Date().toISOString(),
    };
  });

  if (!found) {
    throw new Error(`Worker ${workerId} not found`);
  }

  return {
    ...run,
    workers,
    updatedAt: new Date().toISOString(),
  };
}

export function setWorkerSummary(run: RunRecord, workerId: string, summaryText: string): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      summary: {
        text: summaryText,
        updatedAt: now,
        stale: false,
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

export function removeWorker(run: RunRecord, workerId: string): RunRecord {
  const workers = run.workers.filter((worker) => worker.workerId !== workerId);
  if (workers.length === run.workers.length) {
    throw new Error(`Worker ${workerId} not found`);
  }
  return {
    ...run,
    workers,
    gates: run.gates.filter((gate) => gate.resourceRefs.workerId !== workerId),
    updatedAt: new Date().toISOString(),
  };
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
  return {
    ...run,
    workers,
    updatedAt: now,
  };
}

export function startWorkerRun(
  run: RunRecord,
  workerId: string,
  input: { task: string; sessionId: string | null },
): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      currentTask: input.task,
      lifecycle: "running" as const,
      lastRun: {
        task: input.task,
        status: null,
        startedAt: now,
        finishedAt: null,
        errorMessage: null,
        sessionId: input.sessionId,
      },
      summary: {
        ...worker.summary,
        stale: worker.summary.text !== null ? true : worker.summary.stale,
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

export function setWorkerRunSessionId(run: RunRecord, workerId: string, sessionId: string): RunRecord {
  let found = false;
  let workerHadLastRun = true;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    if (!worker.lastRun) {
      workerHadLastRun = false;
      return worker;
    }
    return {
      ...worker,
      lastRun: {
        ...worker.lastRun,
        sessionId,
      },
      updatedAt: now,
    };
  });

  if (!found) {
    throw new Error(`Worker ${workerId} not found`);
  }
  if (!workerHadLastRun) {
    throw new Error(`Worker ${workerId} does not have an active lastRun to attach a session id to`);
  }

  return {
    ...run,
    workers,
    updatedAt: now,
  };
}

export function finishWorkerRun(
  run: RunRecord,
  workerId: string,
  input: { status: WorkerRunStatus; errorMessage?: string | null },
): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    const lastRun: WorkerLastRun = {
      task: worker.lastRun?.task ?? worker.currentTask ?? "(unknown task)",
      status: input.status,
      startedAt: worker.lastRun?.startedAt ?? now,
      finishedAt: now,
      errorMessage: input.errorMessage ?? null,
      sessionId: worker.lastRun?.sessionId ?? null,
    };
    return {
      ...worker,
      lifecycle: input.status === "error" ? ("blocked" as const) : ("idle" as const),
      lastRun,
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

export function setWorkerLifecycle(run: RunRecord, workerId: string, lifecycle: WorkerLifecycleState): RunRecord {
  let found = false;
  const now = new Date().toISOString();
  const workers = run.workers.map((worker) => {
    if (worker.workerId !== workerId) {
      return worker;
    }
    found = true;
    return {
      ...worker,
      lifecycle,
      summary: {
        ...worker.summary,
        stale: worker.summary.text !== null && worker.lifecycle !== lifecycle ? true : worker.summary.stale,
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

import { normalizeProjectRecord } from "./storage-normalize.js";
import type { ConductorActor, ConductorEventType, ConductorResourceRefs, RunRecord } from "./types.js";
import { CONDUCTOR_SCHEMA_VERSION } from "./types.js";

const conductorEventTypes = new Set<ConductorEventType>([
  "artifact.created",
  "backend.dispatch_failed",
  "backend.dispatch_succeeded",
  "backend.unavailable",
  "external_operation.failed",
  "external_operation.succeeded",
  "gate.created",
  "gate.resolved",
  "gate.used",
  "objective.created",
  "objective.planned",
  "objective.status_refreshed",
  "objective.task_linked",
  "objective.updated",
  "project.created",
  "run.cancel_rejected",
  "run.canceled",
  "run.completed",
  "run.heartbeat",
  "run.lease_expired",
  "run.progress_reported",
  "run.started",
  "scheduler.action_selected",
  "scheduler.action_skipped",
  "scheduler.capacity_exhausted",
  "scheduler.tick_failed",
  "scheduler.tick_started",
  "scheduler.tick_succeeded",
  "task.assigned",
  "task.completion_rejected",
  "task.created",
  "task.followup_created",
  "task.progress",
  "task.progress_rejected",
  "task.updated",
  "worker.archived",
  "worker.cleanup_failed",
  "worker.cleanup_succeeded",
  "worker.commit_failed",
  "worker.commit_succeeded",
  "worker.created",
  "worker.lifecycle_changed",
  "worker.pr_created",
  "worker.pr_failed",
  "worker.pr_updated",
  "worker.push_failed",
  "worker.push_succeeded",
  "worker.recovery_failed",
  "worker.recovery_succeeded",
]);

const conductorActorTypes = new Set<ConductorActor["type"]>([
  "parent_agent",
  "child_run",
  "human",
  "backend",
  "system",
  "test",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function assertRequiredKeys(value: unknown, keys: readonly string[], context: string): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${context} is not an object`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${context} missing required field ${key}`);
    }
  }
}

function assertNoUnexpectedKeys(value: unknown, allowedKeys: readonly string[], context: string): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${context} is not an object`);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${context} contains unsupported field ${key}`);
    }
  }
}

function createResourceIndexes(run: RunRecord) {
  return {
    workerIds: new Set([...run.workers, ...run.archivedWorkers].map((worker) => worker.workerId)),
    taskIds: new Set(run.tasks.map((task) => task.taskId)),
    runIds: new Set(run.runs.map((attempt) => attempt.runId)),
    gateIds: new Set(run.gates.map((gate) => gate.gateId)),
    artifactIds: new Set(run.artifacts.map((artifact) => artifact.artifactId)),
    objectiveIds: new Set(run.objectives.map((objective) => objective.objectiveId)),
  };
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

export function validateRunRecord(run: RunRecord): void {
  const workerRecordKeys = [
    "workerId",
    "name",
    "branch",
    "worktreePath",
    "sessionFile",
    "runtime",
    "lifecycle",
    "recoverable",
    "pr",
    "createdAt",
    "updatedAt",
  ] as const;

  assertRequiredKeys(
    run,
    [
      "schemaVersion",
      "revision",
      "projectKey",
      "repoRoot",
      "storageDir",
      "workers",
      "archivedWorkers",
      "objectives",
      "tasks",
      "runs",
      "gates",
      "artifacts",
      "events",
      "createdAt",
      "updatedAt",
    ],
    "RunRecord",
  );
  for (const worker of [...run.workers, ...run.archivedWorkers]) {
    const context = `Worker ${worker.workerId ?? "<unknown>"}`;
    assertRequiredKeys(worker, workerRecordKeys, context);
    assertNoUnexpectedKeys(worker, workerRecordKeys, context);
  }
  for (const task of run.tasks) {
    assertRequiredKeys(
      task,
      [
        "taskId",
        "title",
        "prompt",
        "state",
        "revision",
        "assignedWorkerId",
        "activeRunId",
        "runIds",
        "artifactIds",
        "gateIds",
        "objectiveId",
        "dependsOnTaskIds",
        "latestProgress",
        "createdAt",
        "updatedAt",
      ],
      `Task ${task.taskId ?? "<unknown>"}`,
    );
  }
  for (const gate of run.gates) {
    assertRequiredKeys(
      gate,
      [
        "gateId",
        "type",
        "status",
        "resourceRefs",
        "requestedDecision",
        "operation",
        "targetRevision",
        "expiresAt",
        "usedAt",
        "resolvedBy",
        "resolutionReason",
        "createdAt",
        "updatedAt",
      ],
      `Gate ${gate.gateId ?? "<unknown>"}`,
    );
  }
  const normalized = normalizeProjectRecord(run);
  if (normalized.schemaVersion !== CONDUCTOR_SCHEMA_VERSION) {
    throw new Error(`Unsupported conductor schemaVersion ${normalized.schemaVersion}`);
  }
  assertUnique(
    [...normalized.workers, ...normalized.archivedWorkers].map((worker) => worker.workerId),
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
  let previousSequence = 0;
  for (const event of normalized.events) {
    if (typeof event.eventId !== "string" || !event.eventId) {
      throw new Error("Event has invalid eventId");
    }
    if (!conductorEventTypes.has(event.type)) {
      throw new Error(`Event ${event.eventId} has invalid event type ${String(event.type)}`);
    }
    if (!event.actor || !conductorActorTypes.has(event.actor.type) || typeof event.actor.id !== "string") {
      throw new Error(`Event ${event.eventId} has invalid actor type`);
    }
    if (!isPlainRecord(event.resourceRefs)) {
      throw new Error(`Event ${event.eventId} has invalid resourceRefs`);
    }
    if (!isPlainRecord(event.payload)) {
      throw new Error(`Event ${event.eventId} has invalid payload`);
    }
    if (typeof event.occurredAt !== "string" || !event.occurredAt) {
      throw new Error(`Event ${event.eventId} has invalid occurredAt`);
    }
    if (event.schemaVersion !== CONDUCTOR_SCHEMA_VERSION) {
      throw new Error(`Event ${event.eventId} has unsupported schemaVersion ${event.schemaVersion}`);
    }
    if (event.sequence <= previousSequence) {
      throw new Error(`Event sequence ${event.sequence} is not greater than previous sequence ${previousSequence}`);
    }
    if (event.projectRevision <= 0) {
      throw new Error(`Event ${event.eventId} has invalid projectRevision ${event.projectRevision}`);
    }
    previousSequence = event.sequence;
    assertRefsExist(event.resourceRefs, indexes, `Event ${event.eventId}`);
  }
}

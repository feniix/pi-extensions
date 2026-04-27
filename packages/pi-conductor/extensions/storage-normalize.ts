import { normalizeRunRuntimeMetadata } from "./runtime-metadata.js";
import type { GateOperation, GateRecord, RunAttemptRecord, RunRecord, TaskRecord, WorkerRecord } from "./types.js";

export function normalizeProjectRecord(run: RunRecord): RunRecord {
  return {
    ...run,
    schemaVersion: run.schemaVersion,
    revision: run.revision,
    workers: run.workers.map(normalizeWorkerRecord),
    archivedWorkers: run.archivedWorkers.map(normalizeWorkerRecord),
    objectives: run.objectives,
    tasks: run.tasks.map(normalizeTaskRecord),
    runs: run.runs.map(normalizeRunAttemptRecord),
    gates: run.gates.map(normalizeGateRecord),
    artifacts: run.artifacts,
    events: run.events,
  };
}

export function defaultOperationForGate(type: GateRecord["type"]): GateOperation {
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
    operation: gate.operation,
    targetRevision: gate.targetRevision,
    expiresAt: gate.expiresAt,
    usedAt: gate.usedAt,
  };
}

function normalizeTaskRecord(task: TaskRecord): TaskRecord {
  return {
    ...task,
    objectiveId: task.objectiveId,
    dependsOnTaskIds: task.dependsOnTaskIds,
  };
}

function normalizeRunAttemptRecord(run: RunAttemptRecord): RunAttemptRecord {
  return {
    ...run,
    runtime: normalizeRunRuntimeMetadata(run),
  };
}

function normalizeWorkerRecord(worker: WorkerRecord): WorkerRecord {
  return {
    workerId: worker.workerId,
    name: worker.name,
    branch: worker.branch,
    worktreePath: worker.worktreePath,
    sessionFile: worker.sessionFile,
    runtime: worker.runtime,
    lifecycle: worker.lifecycle,
    recoverable: worker.recoverable,
    pr: worker.pr,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
}

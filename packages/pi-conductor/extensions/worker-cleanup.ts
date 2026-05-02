import { existsSync, rmSync } from "node:fs";
import { assertWorkerCleanupReady } from "./cleanup-guidance.js";
import { createGateForRepo } from "./gate-service.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { appendConductorEvent, markConductorGateUsed, removeWorker } from "./storage.js";
import type { RunRecord, WorkerRecord } from "./types.js";
import { removeManagedBranch, removeManagedWorktree } from "./worktrees.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workerCleanupGeneration(run: RunRecord, workerId: string): number {
  return (
    run.tasks.filter((task) => task.assignedWorkerId === workerId).length +
    run.runs.filter((entry) => entry.workerId === workerId).length
  );
}

function appendCleanupEvent(
  run: RunRecord,
  input: { status: "succeeded" | "failed"; workerId: string; gateId: string; payload: Record<string, unknown> },
): RunRecord {
  return appendConductorEvent(run, {
    actor: { type: "system", id: "conductor" },
    type: input.status === "succeeded" ? "worker.cleanup_succeeded" : "worker.cleanup_failed",
    resourceRefs: { projectKey: run.projectKey, workerId: input.workerId, gateId: input.gateId },
    payload: input.payload,
  });
}

export function removeWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const currentCleanupGeneration = workerCleanupGeneration(run, worker.workerId);
  const cleanupGate = run.gates.find(
    (gate) =>
      gate.type === "destructive_cleanup" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.operation === "destructive_cleanup" &&
      gate.status !== "canceled" &&
      gate.usedAt === null &&
      gate.targetRevision === currentCleanupGeneration,
  );
  const wrongOperationGate = run.gates.find(
    (gate) =>
      gate.type === "destructive_cleanup" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.status === "approved" &&
      gate.operation !== "destructive_cleanup" &&
      gate.usedAt === null,
  );
  if (wrongOperationGate) {
    throw new Error(`Worker ${worker.name} requires a destructive_cleanup gate scoped to destructive_cleanup`);
  }
  if (cleanupGate?.status !== "approved") {
    if (!cleanupGate) {
      createGateForRepo(repoRoot, {
        type: "destructive_cleanup",
        resourceRefs: { workerId: worker.workerId },
        requestedDecision: `Approve deleting worker ${worker.name}, its worktree, session link, and managed branch`,
        targetRevision: currentCleanupGeneration,
      });
    }
    throw new Error(
      `Worker ${worker.name} requires an approved destructive_cleanup gate before cleanup. Approve via /conductor human dashboard, then rerun conductor_cleanup_worker(${JSON.stringify({ name: worker.name })}).`,
    );
  }

  const reserved = mutateRepoRunSync(repoRoot, (latest) => {
    const latestGate = latest.gates.find((gate) => gate.gateId === cleanupGate.gateId);
    if (!latestGate || latestGate.status !== "approved" || latestGate.usedAt !== null) {
      throw new Error(`Worker ${worker.name} requires a fresh destructive_cleanup gate before cleanup finalization`);
    }
    const latestWorker = assertWorkerCleanupReady(latest, worker.workerId, worker.name);
    if (latestGate.targetRevision !== workerCleanupGeneration(latest, worker.workerId)) {
      throw new Error(`Worker ${worker.name} requires a fresh destructive_cleanup gate after worker activity changed`);
    }
    return {
      ...latest,
      workers: latest.workers.map((entry) =>
        entry.workerId === latestWorker.workerId
          ? { ...entry, lifecycle: "broken" as const, recoverable: true, updatedAt: new Date().toISOString() }
          : entry,
      ),
    };
  });
  const reservedWorker = reserved.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;

  try {
    if (reservedWorker.worktreePath && existsSync(reservedWorker.worktreePath)) {
      removeManagedWorktree(reserved.repoRoot, reservedWorker.worktreePath);
    }
    if (reservedWorker.sessionFile && existsSync(reservedWorker.sessionFile))
      rmSync(reservedWorker.sessionFile, { force: true });
    if (reservedWorker.branch) removeManagedBranch(reserved.repoRoot, reservedWorker.branch);
  } catch (error) {
    mutateRepoRunSync(repoRoot, (latest) =>
      appendCleanupEvent(
        {
          ...latest,
          workers: latest.workers.map((entry) =>
            entry.workerId === worker.workerId
              ? {
                  ...entry,
                  lifecycle: worker.lifecycle,
                  recoverable: worker.recoverable,
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        },
        {
          status: "failed",
          workerId: worker.workerId,
          gateId: cleanupGate.gateId,
          payload: {
            operation: "cleanup_worker",
            name: worker.name,
            worktreePath: reservedWorker.worktreePath,
            branch: reservedWorker.branch,
            errorMessage: errorMessage(error),
          },
        },
      ),
    );
    throw error;
  }

  const updatedRun = mutateRepoRunSync(repoRoot, (latest) => {
    const latestGate = latest.gates.find((gate) => gate.gateId === cleanupGate.gateId);
    if (!latestGate || latestGate.status !== "approved" || latestGate.usedAt !== null) {
      throw new Error(`Worker ${worker.name} requires a fresh destructive_cleanup gate before cleanup finalization`);
    }
    if (latestGate.targetRevision !== workerCleanupGeneration(latest, worker.workerId)) {
      throw new Error(`Worker ${worker.name} requires a fresh destructive_cleanup gate after worker activity changed`);
    }
    const latestWorker = latest.workers.find((entry) => entry.workerId === worker.workerId);
    if (!latestWorker) throw new Error(`Worker named ${worker.name} not found`);
    return appendCleanupEvent(removeWorker(markConductorGateUsed(latest, cleanupGate.gateId), worker.workerId), {
      status: "succeeded",
      workerId: worker.workerId,
      gateId: cleanupGate.gateId,
      payload: {
        operation: "cleanup_worker",
        name: worker.name,
        worktreePath: reservedWorker.worktreePath,
        branch: reservedWorker.branch,
      },
    });
  });
  return updatedRun.archivedWorkers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

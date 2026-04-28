import { mutateRepoRunSync } from "./repo-run.js";
import { isTerminalRunStatus } from "./run-status.js";
import { createConductorGate, resolveConductorGate } from "./storage.js";
import type { ConductorActor, ConductorResourceRefs, GateOperation, GateRecord, GateStatus } from "./types.js";

function createGateId(): string {
  return `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGateForRepo(
  repoRoot: string,
  input: {
    type: GateRecord["type"];
    resourceRefs: ConductorResourceRefs;
    requestedDecision: string;
    gateId?: string;
    operation?: GateOperation;
    targetRevision?: number | null;
    expiresAt?: string | null;
    requireActiveRun?: boolean;
  },
): GateRecord {
  const gateId = input.gateId ?? createGateId();
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => {
    const runId = input.resourceRefs.runId;
    const taskId = input.resourceRefs.taskId;
    if (input.requireActiveRun && runId && taskId) {
      const attempt = run.runs.find((entry) => entry.runId === runId);
      const task = run.tasks.find((entry) => entry.taskId === taskId);
      if (!attempt || attempt.finishedAt || isTerminalRunStatus(attempt.status) || task?.activeRunId !== runId) {
        throw new Error(`Cannot create gate for inactive run ${runId}`);
      }
    }
    return createConductorGate(run, { ...input, gateId });
  });
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
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => resolveConductorGate(run, input));
  const gate = updatedRun.gates.find((entry) => entry.gateId === input.gateId);
  if (!gate) {
    throw new Error(`Gate ${input.gateId} disappeared during resolution`);
  }
  return gate;
}

export function resolveGateFromTrustedHumanForRepo(
  repoRoot: string,
  input: { gateId: string; status: Exclude<GateStatus, "open">; humanId: string; resolutionReason: string },
): GateRecord {
  if (!input.humanId.trim()) {
    throw new Error("Trusted human resolver requires a non-empty humanId");
  }
  return resolveGateForRepo(repoRoot, {
    gateId: input.gateId,
    status: input.status,
    resolutionReason: input.resolutionReason,
    actor: { type: "human", id: input.humanId },
  });
}

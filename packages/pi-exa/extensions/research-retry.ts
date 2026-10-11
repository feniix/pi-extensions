/** History/risk assessment only. Never a spending grant or SDK dispatch guard. */
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { AccountingIdentity } from "./research-accounting.js";
import {
  assessExploration,
  explorationOperationSchema,
  moneyMicros,
  spendingGrantSchema,
  uncertaintyPermissionSchema,
} from "./research-accounting.js";
import {
  AGENT_RATE_PROFILE,
  agentAttemptSchema,
  retryAuthorizationSchema,
  validateAgentAttempts,
} from "./research-execution.js";

export const replacementPermissionSchema = Type.Object(
  {
    kind: Type.Literal("exa-replacement-permission-v1"),
    source: Type.Literal("command"),
    issuerSessionId: Type.String({ minLength: 1 }),
    liabilityPermissionId: Type.String({ minLength: 1 }),
    id: Type.String({ minLength: 1 }),
    cycleId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    attemptId: Type.String({ minLength: 1 }),
    operationId: Type.String({ minLength: 1 }),
    requestHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    originalAllowanceMicros: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    duplicateWorkAcknowledged: Type.Literal(true),
    additionalChargesAcknowledged: Type.Literal(true),
    issuedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ReplacementPermission = Static<typeof replacementPermissionSchema>;

/** Trusted projection of durable attempt/operation facts, never tool-supplied flags. */
export interface RetryAttemptFact extends AccountingIdentity {
  id: string;
  operationId: string;
  state: "completed" | "failed" | "not-dispatched" | "unknown" | "live" | "unclassified";
  replacementPermissionIds?: readonly string[];
  knownLiabilityMicros?: number;
}

export function retryAttemptFacts(
  attempts: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
): RetryAttemptFact[] {
  validateAgentAttempts(attempts, ledger, identity);
  return attempts.map((attempt, index) => {
    if (!Value.Check(agentAttemptSchema, attempt))
      return {
        ...identity,
        id: "id" in attempt && typeof attempt.id === "string" && attempt.id ? attempt.id : `legacy-${index}`,
        operationId: `unclassified-${index}`,
        state: "unclassified" as const,
        knownLiabilityMicros: 0,
      };
    const operation = ledger.find((entry) => "id" in entry && entry.id === attempt.operationId);
    if (!Value.Check(explorationOperationSchema, operation)) throw new Error("Retry history identity conflict.");
    const state: RetryAttemptFact["state"] =
      attempt.result?.remoteStatus === "completed"
        ? "completed"
        : attempt.result?.terminal && ["failed", "cancelled"].includes(attempt.result.remoteStatus)
          ? "failed"
          : attempt.status === "not-dispatched" && operation.status === "not-dispatched"
            ? "not-dispatched"
            : attempt.status === "intent" || attempt.status === "running"
              ? "live"
              : attempt.status === "unknown"
                ? "unknown"
                : "unclassified";
    const effort = "effort" in attempt.artifact.request ? (attempt.artifact.request.effort ?? "medium") : "medium";
    const base = Object.entries(AGENT_RATE_PROFILE.fixed).find(([name]) => name === effort)?.[1] ?? 0;
    return {
      ...identity,
      id: attempt.id,
      operationId: attempt.operationId,
      state,
      replacementPermissionIds: attempt.replacementPermissionIds,
      knownLiabilityMicros: Math.max(
        operation.reportedMicros ?? 0,
        ...(operation.conflictingMicros ?? []),
        moneyMicros(attempt.result?.provisionalTotalDollars ?? 0),
        moneyMicros(base),
      ),
    };
  });
}

export function retryGrantIds(grants: readonly object[]): string[] {
  return grants.flatMap((entry) =>
    Value.Check(spendingGrantSchema, entry) ||
    Value.Check(uncertaintyPermissionSchema, entry) ||
    Value.Check(replacementPermissionSchema, entry)
      ? [entry.id]
      : [],
  );
}

export function freezeRetryAuthorization(
  grants: readonly object[],
  attempts: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
) {
  const proof = {
    kind: "exa-retry-authorization-v1",
    history: retryAttemptFacts(attempts, ledger, identity).map((fact) => ({
      ...fact,
      replacementPermissionIds: [...(fact.replacementPermissionIds ?? [])],
    })),
    grantIds: retryGrantIds(grants),
    ledger: structuredClone(ledger),
  };
  if (!Value.Check(retryAuthorizationSchema, proof)) throw new Error("Invalid retry intent authorization.");
  return proof;
}

/** Durable recognized records must retain their original command/money binding. */
export function validateReplacementRecords(
  grants: readonly object[],
  attempts: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
): void {
  const ids = new Set<string>(
    [...grants, ...ledger, ...attempts]
      .filter((entry) => !("kind" in entry) || entry.kind !== "exa-replacement-permission-v1")
      .flatMap((entry) => ("id" in entry && typeof entry.id === "string" ? [entry.id] : [])),
  );
  for (const entry of grants) {
    if (!("kind" in entry) || entry.kind !== "exa-replacement-permission-v1") continue;
    if (!Value.Check(replacementPermissionSchema, entry)) throw new Error("Invalid replacement permission.");
    const attempt = attempts.find((item) => "id" in item && item.id === entry.attemptId);
    const liability = grants.find((item) => "id" in item && item.id === entry.liabilityPermissionId);
    if (
      ids.has(entry.id) ||
      entry.cycleId !== identity.cycleId ||
      entry.projectId !== identity.projectId ||
      !Value.Check(agentAttemptSchema, attempt) ||
      attempt.operationId !== entry.operationId ||
      !Value.Check(uncertaintyPermissionSchema, liability) ||
      liability.cycleId !== identity.cycleId ||
      liability.projectId !== identity.projectId ||
      liability.targetType !== "liability" ||
      liability.subjectId !== entry.operationId ||
      liability.allowanceMicros !== entry.originalAllowanceMicros ||
      liability.issuerSessionId !== entry.issuerSessionId ||
      liability.issuedAt !== entry.issuedAt
    )
      throw new Error("Replacement permission identity conflict.");
    ids.add(entry.id);
  }
  retryAttemptFacts(attempts, ledger, identity);
  const consumed = new Set<string>();
  for (const [index, attempt] of attempts.entries()) {
    if (!Value.Check(agentAttemptSchema, attempt)) continue;
    if (!attempt.transitionMode) {
      if (
        attempt.sourceAttemptIds !== undefined ||
        attempt.replacementPermissionIds !== undefined ||
        attempt.retryAuthorization !== undefined
      )
        throw new Error("Invalid retry intent metadata.");
      continue;
    }
    const operation = ledger.find((entry) => "id" in entry && entry.id === attempt.operationId);
    const funding = Value.Check(explorationOperationSchema, operation)
      ? grants.find((entry) => "id" in entry && entry.id === operation.requestPermissionId)
      : undefined;
    if (
      !Value.Check(explorationOperationSchema, operation) ||
      !Value.Check(uncertaintyPermissionSchema, funding) ||
      funding.cycleId !== identity.cycleId ||
      funding.projectId !== identity.projectId ||
      funding.targetType !== "request" ||
      funding.subjectId !== attempt.requestHash ||
      funding.allowanceMicros < operation.estimateMicros ||
      ledger.filter(
        (entry) => Value.Check(explorationOperationSchema, entry) && entry.requestPermissionId === funding.id,
      ).length !== 1
    )
      throw new Error("Invalid retry intent funding.");
    const sources = attempt.sourceAttemptIds ?? [];
    const permissions = attempt.replacementPermissionIds;
    const prior = attempts.slice(0, index).filter((entry) => Value.Check(agentAttemptSchema, entry));
    if (
      !sources.length ||
      permissions === undefined ||
      sources.some((id) => !prior.some((entry) => entry.id === id)) ||
      (attempt.transitionMode === "retry" && permissions.length) ||
      (attempt.transitionMode === "replace" && permissions.length !== sources.length)
    )
      throw new Error("Invalid retry intent metadata.");
    const proof = attempt.retryAuthorization;
    if (!proof) throw new Error("Invalid retry intent authorization.");
    const currentFacts = retryAttemptFacts(attempts.slice(0, index), ledger, identity);
    const currentGrantIds = retryGrantIds(grants);
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    if (
      proof.history.length !== currentFacts.length ||
      !same(proof.grantIds, currentGrantIds.slice(0, proof.grantIds.length))
    )
      throw new Error("Invalid retry intent authorization.");
    for (const [factIndex, fact] of proof.history.entries()) {
      const current = currentFacts[factIndex];
      const compatible =
        fact.state === "unknown"
          ? ["unknown", "not-dispatched", "failed", "completed"]
          : fact.state === "failed"
            ? ["failed", "completed"]
            : ["not-dispatched"];
      if (
        fact.id !== current.id ||
        fact.operationId !== current.operationId ||
        fact.cycleId !== identity.cycleId ||
        fact.projectId !== identity.projectId ||
        !compatible.includes(current.state) ||
        !same(fact.replacementPermissionIds, current.replacementPermissionIds ?? [])
      )
        throw new Error("Invalid retry intent authorization.");
    }
    const operationIndex = ledger.findIndex((entry) => "id" in entry && entry.id === attempt.operationId);
    const immutableFinancialFacts = (entry: object) => {
      if (!Value.Check(explorationOperationSchema, entry)) throw new Error("Invalid retry intent authorization.");
      const { status: _status, reportedMicros: _reported, conflictingMicros: _conflicts, ...immutable } = entry;
      return immutable;
    };
    if (!same(proof.ledger.map(immutableFinancialFacts), ledger.slice(0, operationIndex).map(immutableFinancialFacts)))
      throw new Error("Invalid retry intent authorization.");
    for (const [ledgerIndex, previous] of proof.ledger.entries()) {
      const current = ledger[ledgerIndex];
      if (!Value.Check(explorationOperationSchema, current)) throw new Error("Invalid retry intent authorization.");
      const compatible =
        previous.status === "not-dispatched"
          ? ["not-dispatched"]
          : previous.status === "unknown"
            ? ["unknown", "reported", "not-dispatched"]
            : previous.status === "reported"
              ? ["reported", "unknown"]
              : ["reserved", "unknown", "reported", "not-dispatched"];
      if (
        !compatible.includes(current.status) ||
        (previous.reportedMicros !== undefined && previous.reportedMicros !== current.reportedMicros) ||
        previous.conflictingMicros?.some((amount) => !current.conflictingMicros?.includes(amount))
      )
        throw new Error("Invalid retry intent authorization.");
    }
    for (const fact of proof.history) {
      const original = proof.ledger.find((entry) => entry.id === fact.operationId);
      if (
        !original ||
        (fact.state === "not-dispatched"
          ? original.status !== "not-dispatched"
          : !["unknown", "reported"].includes(original.status)) ||
        fact.knownLiabilityMicros < Math.max(original.reportedMicros ?? 0, ...(original.conflictingMicros ?? []))
      )
        throw new Error("Invalid retry intent authorization.");
    }
    const historicalGrants = grants.filter((entry) => "id" in entry && proof.grantIds.includes(String(entry.id)));
    const eligibility = assessRetryHistory(
      proof.history,
      historicalGrants,
      identity,
      attempt.requestHash,
      attempt.transitionMode,
    );
    const held = assessExploration(
      historicalGrants,
      proof.ledger,
      { dollars: null, basis: "Historical intent assessment, not a vendor cap." },
      "web_research_exa",
      identity,
      attempt.requestHash,
    );
    if (
      !eligibility.eligible ||
      !same(eligibility.sourceAttemptIds, sources) ||
      !same(eligibility.replacementPermissionIds, permissions) ||
      !held.canDispatch ||
      held.requestPermissionId !== operation.requestPermissionId ||
      held.proposedMicros !== operation.estimateMicros
    )
      throw new Error("Invalid retry intent authorization.");
    const targets = new Set<string>();
    for (const id of permissions) {
      const permission = grants.find((entry) => "id" in entry && entry.id === id);
      if (
        consumed.has(id) ||
        !Value.Check(replacementPermissionSchema, permission) ||
        permission.requestHash !== attempt.requestHash ||
        !sources.includes(permission.attemptId) ||
        targets.has(permission.attemptId)
      )
        throw new Error("Invalid replacement permission consumption.");
      targets.add(permission.attemptId);
      const thenLatest = [...historicalGrants]
        .reverse()
        .find(
          (entry) =>
            Value.Check(uncertaintyPermissionSchema, entry) &&
            entry.targetType === "liability" &&
            entry.subjectId === permission.operationId,
        );
      const original = proof.history.find((fact) => fact.id === permission.attemptId);
      if (
        !Value.Check(uncertaintyPermissionSchema, thenLatest) ||
        thenLatest.id !== permission.liabilityPermissionId ||
        !original ||
        permission.originalAllowanceMicros < original.knownLiabilityMicros
      )
        throw new Error("Invalid retry intent authorization.");
      consumed.add(id);
    }
  }
}

export function assessRetryHistory(
  history: readonly RetryAttemptFact[],
  grants: readonly object[],
  identity: AccountingIdentity,
  requestHash: string,
  mode: "retry" | "replace",
) {
  if (
    typeof identity.cycleId !== "string" ||
    !identity.cycleId ||
    typeof identity.projectId !== "string" ||
    !identity.projectId
  )
    throw new Error("Invalid retry target identity.");
  if (!/^[a-f0-9]{64}$/.test(requestHash) || (mode !== "retry" && mode !== "replace"))
    throw new Error("Invalid retry request.");
  const ids = new Set<string>();
  const operations = new Set<string>();
  for (const fact of history) {
    if (!["completed", "failed", "not-dispatched", "unknown", "live", "unclassified"].includes(fact.state))
      throw new Error("Retry history requires classified durable facts.");
    if (
      fact.cycleId !== identity.cycleId ||
      fact.projectId !== identity.projectId ||
      !fact.id ||
      !fact.operationId ||
      ids.has(fact.id) ||
      operations.has(fact.operationId)
    )
      throw new Error("Retry history identity conflict.");
    ids.add(fact.id);
    operations.add(fact.operationId);
  }
  const base = {
    assessmentOnly: true,
    freshBudgetAssessmentRequired: true,
    sourceAttemptIds: [] as string[],
    replacementPermissionIds: [] as string[],
  };
  const blocked = (reason: string, blockedAttemptIds: string[] = []) => ({
    ...base,
    eligible: false as const,
    reason,
    blockedAttemptIds,
  });
  if (history.some((fact) => fact.state === "completed")) return blocked("CYCLE_SUCCEEDED");
  if (!history.length) return blocked("NO_SAVED_ATTEMPT");
  const live = history.filter((fact) => fact.state === "live");
  if (live.length)
    return blocked(
      "EXECUTION_IN_PROGRESS",
      live.map((fact) => fact.id),
    );
  const unclassified = history.filter((fact) => fact.state === "unclassified");
  if (unclassified.length)
    return blocked(
      "RECOVERY_REQUIRED",
      unclassified.map((fact) => fact.id),
    );
  const unknown = history.filter((fact) => fact.state === "unknown");
  if (!unknown.length)
    return mode === "retry"
      ? { ...base, eligible: true as const, sourceAttemptIds: history.map((fact) => fact.id), blockedAttemptIds: [] }
      : blocked("RETRY_REQUIRED");
  if (mode !== "replace")
    return blocked(
      "REPLACEMENT_APPROVAL_REQUIRED",
      unknown.map((fact) => fact.id),
    );
  const used = new Set(history.flatMap((fact) => [...(fact.replacementPermissionIds ?? [])]));
  const permissions = grants.filter((entry): entry is ReplacementPermission =>
    Value.Check(replacementPermissionSchema, entry),
  );
  const permissionIds = new Set<string>();
  for (const permission of permissions) {
    if (permissionIds.has(permission.id)) throw new Error("Replacement permission identity conflict.");
    permissionIds.add(permission.id);
  }
  const selected: ReplacementPermission[] = [];
  const blockedIds: string[] = [];
  for (const fact of unknown) {
    const permission = [...permissions]
      .reverse()
      .find(
        (entry) =>
          entry.cycleId === identity.cycleId &&
          entry.projectId === identity.projectId &&
          entry.attemptId === fact.id &&
          entry.operationId === fact.operationId &&
          entry.requestHash === requestHash,
      );
    if (!permission || used.has(permission.id)) blockedIds.push(fact.id);
    else selected.push(permission);
  }
  if (blockedIds.length) return blocked("REPLACEMENT_APPROVAL_REQUIRED", blockedIds);
  return {
    ...base,
    eligible: true as const,
    sourceAttemptIds: unknown.map((fact) => fact.id),
    replacementPermissionIds: selected.map((entry) => entry.id),
    blockedAttemptIds: [],
  };
}

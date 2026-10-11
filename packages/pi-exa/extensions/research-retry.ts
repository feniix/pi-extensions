/** History/risk assessment only. Never a spending grant or SDK dispatch guard. */
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { AccountingIdentity } from "./research-accounting.js";

export const replacementPermissionSchema = Type.Object(
  {
    kind: Type.Literal("exa-replacement-permission-v1"),
    source: Type.Literal("command"),
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
}

export function assessRetryHistory(
  history: readonly RetryAttemptFact[],
  grants: readonly object[],
  identity: AccountingIdentity,
  requestHash: string,
  mode: "retry" | "replace",
) {
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
    eligible: false,
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
      ? { ...base, eligible: true, sourceAttemptIds: history.map((fact) => fact.id), blockedAttemptIds: [] }
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
    eligible: true,
    sourceAttemptIds: unknown.map((fact) => fact.id),
    replacementPermissionIds: selected.map((entry) => entry.id),
    blockedAttemptIds: [],
  };
}

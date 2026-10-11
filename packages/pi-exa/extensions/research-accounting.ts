/** Local-only, deterministic Exa assessments. Published estimates are not billing caps. */
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

const micros = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const EXPLORATION_TOOLS = [
  "web_search_exa",
  "web_fetch_exa",
  "web_find_similar_exa",
  "web_search_advanced_exa",
  "web_answer_exa",
] as const;
export const spendingGrantSchema = Type.Object(
  {
    kind: Type.Literal("exa-grant-v1"),
    id: Type.String({ minLength: 1 }),
    cycleId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    issuerSessionId: Type.String({ minLength: 1 }),
    source: Type.Literal("command"),
    issuedAt: Type.String({ minLength: 1 }),
    ceilingMicros: micros,
    tools: Type.Array(
      Type.Union([
        Type.Literal("web_search_exa"),
        Type.Literal("web_fetch_exa"),
        Type.Literal("web_find_similar_exa"),
        Type.Literal("web_search_advanced_exa"),
        Type.Literal("web_answer_exa"),
      ]),
      {
        minItems: 1,
        uniqueItems: true,
      },
    ),
  },
  { additionalProperties: false },
);
export type SpendingGrant = Static<typeof spendingGrantSchema>;
export const explorationOperationSchema = Type.Object(
  {
    kind: Type.Literal("exa-exploration-v1"),
    id: Type.String({ minLength: 1 }),
    cycleId: Type.String({ minLength: 1 }),
    revision: micros,
    tool: Type.String({ minLength: 1 }),
    requestHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    estimateMicros: micros,
    basis: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("reserved"),
      Type.Literal("unknown"),
      Type.Literal("reported"),
      Type.Literal("not-dispatched"),
    ]),
    createdAt: Type.String({ minLength: 1 }),
    reportedMicros: Type.Optional(micros),
    conflictingMicros: Type.Optional(Type.Array(micros, { uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type ExplorationOperation = Static<typeof explorationOperationSchema>;

function addMoney(left: number, right: number) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Accounting sum exceeds safe precision.");
  return sum;
}

export interface AccountingIdentity {
  cycleId: string;
  projectId: string;
}

export function validateAccountingRecords(
  grants: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
) {
  if (!identity?.cycleId || !identity.projectId) throw new Error("Accounting target is required.");
  const ids = new Set<string>();
  for (const record of [...grants, ...ledger]) {
    const kind = "kind" in record ? record.kind : undefined;
    const schema =
      kind === "exa-grant-v1"
        ? spendingGrantSchema
        : kind === "exa-exploration-v1"
          ? explorationOperationSchema
          : undefined;
    if (!schema) continue;
    if (!Value.Check(schema, record)) throw new Error("Invalid accounting record.");
    if (
      !("cycleId" in record) ||
      record.cycleId !== identity.cycleId ||
      (kind === "exa-grant-v1" && (!("projectId" in record) || record.projectId !== identity.projectId))
    ) {
      throw new Error("Accounting identity conflict.");
    }
    if (!("id" in record) || typeof record.id !== "string") throw new Error("Invalid accounting record identity.");
    if (ids.has(record.id)) throw new Error("Duplicate accounting identity.");
    ids.add(record.id);
  }
}

export function moneyMicros(dollars: number, permission = false): number {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error("Invalid monetary amount.");
  const value = permission ? Math.floor(dollars * 1_000_000) : Math.ceil(dollars * 1_000_000);
  if (!Number.isSafeInteger(value)) throw new Error("Monetary amount exceeds safe precision.");
  return value;
}
export interface ExplorationEstimate {
  dollars: number | null;
  basis: string;
}

export const EXA_RATE_PROFILE = {
  version: "exa-published-2026-03-03-v1",
  source: "https://exa.ai/docs/changelog/pricing-update",
  publication: "March 3, 2026",
} as const;

export function estimateExploration(tool: string, args: Record<string, unknown>): ExplorationEstimate {
  if (tool === "web_search_exa") {
    const count = args.numResults ?? 5;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= 20) {
      return {
        dollars: (7 + Math.max(0, count - 10)) / 1000,
        basis: `${EXA_RATE_PROFILE.version}; ${EXA_RATE_PROFILE.publication}; bundled text/highlights; ${count} results; ${EXA_RATE_PROFILE.source}`,
      };
    }
  }
  return { dollars: null, basis: "No supported published-price assessment for this operation." };
}

export function assessExploration(
  grants: readonly object[],
  ledger: readonly object[],
  estimate: ExplorationEstimate,
  tool: string,
  identity: AccountingIdentity,
) {
  validateAccountingRecords(grants, ledger, identity);
  const known = grants.filter((grant): grant is SpendingGrant => Value.Check(spendingGrantSchema, grant));
  const latest = known.at(-1);
  const proposed = estimate.dollars === null ? null : moneyMicros(estimate.dollars);
  let reported = 0;
  let pending = 0;
  const unresolvedOperationIds: string[] = [];
  for (const operation of ledger) {
    if (!Value.Check(explorationOperationSchema, operation)) throw new Error("Unclassified or invalid liability.");
    if (operation.reportedMicros !== undefined) reported = addMoney(reported, operation.reportedMicros);
    if (operation.status === "reported") {
      if (operation.reportedMicros === undefined) throw new Error("Reported usage requires a total.");
      if (operation.conflictingMicros?.length) unresolvedOperationIds.push(operation.id);
    } else if (operation.status === "reserved") pending = addMoney(pending, operation.estimateMicros);
    else if (operation.status === "unknown") unresolvedOperationIds.push(operation.id);
  }
  const exposure = addMoney(reported, pending);
  const reason = !latest
    ? "APPROVAL_REQUIRED"
    : !latest.tools.some((allowed) => allowed === tool)
      ? "SCOPE_APPROVAL_REQUIRED"
      : unresolvedOperationIds.length > 0
        ? "UNKNOWN_LIABILITY"
        : proposed === null
          ? "UNCERTAINTY_APPROVAL_REQUIRED"
          : addMoney(exposure, proposed) > latest.ceilingMicros
            ? "INSUFFICIENT_BALANCE"
            : undefined;
  return {
    canDispatch: reason === undefined,
    reason,
    ceilingDollars: latest ? latest.ceilingMicros / 1_000_000 : 0,
    proposedDollars: proposed === null ? null : proposed / 1_000_000,
    reportedDollars: reported / 1_000_000,
    pendingEstimatedDollars: pending / 1_000_000,
    unresolvedOperationIds,
    billingVerified: false,
  };
}

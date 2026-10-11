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
        Type.Literal("web_research_exa"),
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
export const uncertaintyPermissionSchema = Type.Object(
  {
    kind: Type.Literal("exa-uncertainty-v1"),
    id: Type.String({ minLength: 1 }),
    cycleId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    issuerSessionId: Type.String({ minLength: 1 }),
    source: Type.Literal("command"),
    issuedAt: Type.String({ minLength: 1 }),
    targetType: Type.Union([Type.Literal("request"), Type.Literal("liability")]),
    subjectId: Type.String({ minLength: 1 }),
    allowanceMicros: micros,
  },
  { additionalProperties: false },
);
export type UncertaintyPermission = Static<typeof uncertaintyPermissionSchema>;
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
    requestPermissionId: Type.Optional(Type.String({ minLength: 1 })),
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
        : kind === "exa-uncertainty-v1"
          ? uncertaintyPermissionSchema
          : kind === "exa-exploration-v1"
            ? explorationOperationSchema
            : undefined;
    if (!schema) continue;
    if (!Value.Check(schema, record)) throw new Error("Invalid accounting record.");
    if (
      !("cycleId" in record) ||
      record.cycleId !== identity.cycleId ||
      ((kind === "exa-grant-v1" || kind === "exa-uncertainty-v1") &&
        (!("projectId" in record) || record.projectId !== identity.projectId))
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
  // Interpret the number's decimal representation, not a binary floating-point
  // multiplication that can move an exact micro-USD across its boundary.
  const [mantissa, exponent = "0"] = dollars.toString().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const significand = BigInt(whole + fraction);
  const shift = 6 + Number(exponent) - fraction.length;
  let micros: bigint;
  if (shift >= 0) {
    micros = significand * 10n ** BigInt(shift);
  } else {
    const denominator = 10n ** BigInt(-shift);
    micros = significand / denominator;
    if (!permission && significand % denominator !== 0n) micros++;
  }
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Monetary amount exceeds safe precision.");
  return Number(micros);
}
export interface ExplorationEstimate {
  dollars: number | null;
  basis: string;
}

export const EXA_RATE_PROFILE = {
  version: "exa-published-2026-03-03-v1",
  source: "https://exa.ai/docs/changelog/pricing-update",
  publication: "March 3, 2026",
  reviewed: "October 11, 2026",
} as const;

export function estimateExploration(tool: string, args: Record<string, unknown>): ExplorationEstimate {
  const unknown = { dollars: null, basis: "No supported published-price assessment for this operation." };
  const keys =
    tool === "web_search_exa"
      ? ["query", "numResults"]
      : tool === "web_fetch_exa"
        ? ["urls", "maxCharacters", "highlights", "summary", "maxAgeHours"]
        : tool === "web_search_advanced_exa"
          ? [
              "query",
              "numResults",
              "category",
              "type",
              "systemPrompt",
              "outputSchema",
              "startPublishedDate",
              "endPublishedDate",
              "includeDomains",
              "excludeDomains",
              "includeText",
              "excludeText",
              "userLocation",
              "moderation",
              "textMaxCharacters",
              "enableHighlights",
              "highlightsNumSentences",
              "highlightsMaxCharacters",
              "highlightsQuery",
              "enableSummary",
              "summaryQuery",
            ]
          : [];
  if (Object.keys(args).some((key) => !keys.includes(key))) return unknown;
  const priced = (units: number, basis: string): ExplorationEstimate => ({
    dollars: units / 1000,
    basis: `${EXA_RATE_PROFILE.version}; published ${EXA_RATE_PROFILE.publication}; reviewed ${EXA_RATE_PROFILE.reviewed}; ${basis}; ${EXA_RATE_PROFILE.source}`,
  });
  if (tool === "web_fetch_exa") {
    if (!Array.isArray(args.urls) || args.urls.length < 1 || args.urls.length > 50) return unknown;
    const summary =
      typeof args.summary === "object" &&
      args.summary !== null &&
      "query" in args.summary &&
      Boolean(args.summary.query);
    const types = 1 + (args.highlights === true ? 1 : 0) + (summary ? 1 : 0);
    return priced(args.urls.length * types, `${args.urls.length} pages; ${types} content types at $1/1000 pages/type`);
  }
  if (tool === "web_search_exa" || tool === "web_search_advanced_exa") {
    const count = args.numResults ?? (tool === "web_search_exa" ? 5 : 10);
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > (tool === "web_search_exa" ? 20 : 100)
    )
      return unknown;
    const mode = args.type ?? "auto";
    const base =
      mode === "deep"
        ? 12
        : mode === "deep-reasoning"
          ? 15
          : mode === "auto" || mode === "fast" || mode === "instant"
            ? 7
            : undefined;
    if (base === undefined) return unknown;
    const summaries =
      args.enableSummary !== false && (args.enableSummary === true || Boolean(args.summaryQuery)) ? count : 0;
    return priced(
      base + Math.max(0, count - 10) + summaries,
      `${mode}; ${count} results; bundled text/highlights; ${summaries} separately billed summaries`,
    );
  }
  return unknown;
}

export function assessExploration(
  grants: readonly object[],
  ledger: readonly object[],
  estimate: ExplorationEstimate,
  tool: string,
  identity: AccountingIdentity,
  requestHash?: string,
) {
  validateAccountingRecords(grants, ledger, identity);
  const known = grants.filter((grant): grant is SpendingGrant => Value.Check(spendingGrantSchema, grant));
  const latest = known.at(-1);
  const permissions = grants.filter((entry): entry is UncertaintyPermission =>
    Value.Check(uncertaintyPermissionSchema, entry),
  );
  const latestRequestPermission = requestHash
    ? [...permissions].reverse().find((entry) => entry.targetType === "request" && entry.subjectId === requestHash)
    : undefined;
  const requestPermission =
    latestRequestPermission &&
    !ledger.some(
      (operation) =>
        Value.Check(explorationOperationSchema, operation) &&
        operation.requestPermissionId === latestRequestPermission.id,
    )
      ? latestRequestPermission
      : undefined;
  const proposed =
    estimate.dollars === null ? (requestPermission?.allowanceMicros ?? null) : moneyMicros(estimate.dollars);
  let reported = 0;
  let pending = 0;
  let assessedUnknown = 0;
  const blockedOperationIds: string[] = [];
  const conflictingOperationIds: string[] = [];
  const unresolvedOperationIds: string[] = [];
  for (const operation of ledger) {
    if (!Value.Check(explorationOperationSchema, operation)) throw new Error("Unclassified or invalid liability.");
    if (operation.reportedMicros !== undefined) reported = addMoney(reported, operation.reportedMicros);
    let unresolved = false;
    if (operation.status === "reported") {
      if (operation.reportedMicros === undefined) throw new Error("Reported usage requires a total.");
      if (operation.conflictingMicros?.length) unresolved = true;
    } else if (operation.status === "reserved") pending = addMoney(pending, operation.estimateMicros);
    else if (operation.status === "unknown") unresolved = true;
    if (unresolved) {
      unresolvedOperationIds.push(operation.id);
      if (operation.conflictingMicros?.length) {
        blockedOperationIds.push(operation.id);
        conflictingOperationIds.push(operation.id);
        continue;
      }
      const permission = [...permissions]
        .reverse()
        .find((entry) => entry.targetType === "liability" && entry.subjectId === operation.id);
      if (!permission) blockedOperationIds.push(operation.id);
      else {
        const minimum = Math.max(operation.reportedMicros ?? 0, ...(operation.conflictingMicros ?? []));
        if (permission.allowanceMicros < minimum) blockedOperationIds.push(operation.id);
        assessedUnknown = addMoney(
          assessedUnknown,
          Math.max(minimum, permission.allowanceMicros) - (operation.reportedMicros ?? 0),
        );
      }
    }
  }
  const exposure = addMoney(addMoney(reported, pending), assessedUnknown);
  const reason = !latest
    ? "APPROVAL_REQUIRED"
    : !latest.tools.some((allowed) => allowed === tool)
      ? "SCOPE_APPROVAL_REQUIRED"
      : reported > latest.ceilingMicros
        ? "OVERSPEND"
        : blockedOperationIds.length > 0
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
    proposedMicros: proposed,
    requestPermissionId: estimate.dollars === null ? requestPermission?.id : undefined,
    assessedUnknownDollars: assessedUnknown / 1_000_000,
    reportedDollars: reported / 1_000_000,
    pendingEstimatedDollars: pending / 1_000_000,
    unresolvedOperationIds,
    blockedOperationIds,
    conflictingOperationIds,
    billingVerified: false,
  };
}

export class ExplorationApprovalError extends Error {
  constructor(
    readonly cycleId: string,
    readonly tool: string,
    readonly requestHash: string,
    readonly request: Record<string, unknown>,
    readonly assessment: ReturnType<typeof assessExploration>,
  ) {
    super(`${assessment.reason}: inspect accounting and obtain operator approval.`);
    this.name = "ExplorationApprovalError";
  }
}

export function summarizeAccounting(
  grants: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
) {
  const latest = grants.filter((grant): grant is SpendingGrant => Value.Check(spendingGrantSchema, grant)).at(-1);
  return {
    ...assessExploration(
      grants,
      ledger,
      { dollars: 0, basis: "Ledger overview only." },
      latest?.tools[0] ?? "web_search_exa",
      identity,
    ),
    assessmentOnly: true,
    rateProfile: EXA_RATE_PROFILE,
  };
}

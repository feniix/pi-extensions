/** Deterministic Agent execution policy. No SDK dispatch or inferred consent. */
import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  type AccountingIdentity,
  assessExploration,
  explorationOperationSchema,
  moneyMicros,
} from "./research-accounting.js";
import { canonicalResearchJson, taskSchemaValidator } from "./research-artifacts.js";
import { captureCandidates, type EvidenceProvenance } from "./research-evidence.js";

export const AGENT_RATE_PROFILE = {
  version: "exa-agent-published-2026-08-20-v1",
  source: "https://exa.ai/docs/reference/pricing",
  publication: "August 20, 2026",
  fixed: { minimal: 0.012, low: 0.025, medium: 0.1, high: 0.5, xhigh: 1 },
} as const;

export function agentRequestHash(request: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalResearchJson({ tool: "web_research_exa", request }))
    .digest("hex");
}

export function assessAgent(
  grants: readonly object[],
  ledger: readonly object[],
  request: Record<string, unknown>,
  identity: AccountingIdentity,
) {
  const effort = request.effort ?? "medium";
  if (typeof effort !== "string" || !["minimal", "low", "medium", "high", "xhigh", "auto"].includes(effort))
    throw new Error("Unsupported cycle Agent effort.");
  const fixedBaseDollars = Object.entries(AGENT_RATE_PROFILE.fixed).find(([name]) => name === effort)?.[1] ?? 0;
  const assessment = assessExploration(
    grants,
    ledger,
    {
      dollars: null,
      basis: `${AGENT_RATE_PROFILE.version}; explicit exact-request assessment includes possible contact/provider costs; ${AGENT_RATE_PROFILE.source}`,
    },
    "web_research_exa",
    identity,
    agentRequestHash(request),
  );
  if (
    assessment.canDispatch &&
    assessment.proposedMicros !== null &&
    assessment.proposedMicros < moneyMicros(fixedBaseDollars)
  ) {
    assessment.canDispatch = false;
    assessment.reason = "UNCERTAINTY_APPROVAL_REQUIRED";
  }
  return { ...assessment, fixedBaseDollars, rateProfile: AGENT_RATE_PROFILE };
}

const statuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export interface AgentObservation {
  remoteId: string;
  remoteStatus: (typeof statuses)[number];
  terminal: boolean;
  processing: "pending" | "validated" | "failed" | "not-applicable";
  usage: Record<string, number | Record<string, number>>;
  grounding: Array<{ field: string; citations: Array<{ url: string; title: string }>; confidence?: string }>;
  diagnostics: string[];
  createdAt?: string;
  completedAt?: string;
  stopReason?: string;
  taskOutput?: Record<string, unknown>;
  totalDollars?: number;
  provisionalTotalDollars?: number;
}

const jsonObjectSchema = Type.Object({}, { additionalProperties: true });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const statusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export const agentObservationSchema = Type.Object(
  {
    remoteId: Type.String({ pattern: "^[A-Za-z0-9_.:-]{1,200}$" }),
    remoteStatus: statusSchema,
    terminal: Type.Boolean(),
    processing: Type.Union([
      Type.Literal("pending"),
      Type.Literal("validated"),
      Type.Literal("failed"),
      Type.Literal("not-applicable"),
    ]),
    usage: jsonObjectSchema,
    grounding: Type.Array(
      Type.Object(
        {
          field: Type.String({ maxLength: 512 }),
          citations: Type.Array(
            Type.Object(
              { url: Type.String({ maxLength: 8192 }), title: Type.String({ maxLength: 512 }) },
              { additionalProperties: false },
            ),
          ),
          confidence: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    diagnostics: Type.Array(Type.String({ maxLength: 512 })),
    createdAt: Type.Optional(Type.String({ maxLength: 40 })),
    completedAt: Type.Optional(Type.String({ maxLength: 40 })),
    stopReason: Type.Optional(Type.String()),
    taskOutput: Type.Optional(jsonObjectSchema),
    totalDollars: Type.Optional(Type.Number({ minimum: 0 })),
    provisionalTotalDollars: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const agentAttemptSchema = Type.Object(
  {
    kind: Type.Literal("exa-agent-attempt-v1"),
    id: Type.String({ minLength: 1 }),
    cycleId: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    operationId: Type.String({ minLength: 1 }),
    revision: integer,
    requestHash: hash,
    artifact: Type.Object(
      {
        artifactVersion: Type.Literal(1),
        cycleId: Type.String(),
        revision: integer,
        hash,
        request: jsonObjectSchema,
        outputContract: Type.Object(
          {
            dialect: Type.Literal("draft-07"),
            taskSchema: jsonObjectSchema,
            evidenceExpectations: Type.Array(Type.String()),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: true },
    ),
    assessment: jsonObjectSchema,
    status: Type.Union([
      Type.Literal("intent"),
      Type.Literal("running"),
      Type.Literal("unknown"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("not-dispatched"),
    ]),
    createdAt: Type.String(),
    result: Type.Optional(agentObservationSchema),
    localInterruption: Type.Optional(Type.Literal("Local wait ended; remote outcome must be inspected, not replaced.")),
  },
  { additionalProperties: false },
);
export type AgentAttempt = Static<typeof agentAttemptSchema>;

export function validateAgentAttempts(
  attempts: readonly object[],
  ledger: readonly object[],
  identity: AccountingIdentity,
) {
  const ids = new Set<string>();
  const operations = new Set<string>();
  for (const attempt of attempts) {
    if (!("kind" in attempt) || attempt.kind !== "exa-agent-attempt-v1") continue;
    if (!Value.Check(agentAttemptSchema, attempt)) throw new Error("Invalid Agent attempt.");
    const { hash: artifactHash, ...artifactBody } = attempt.artifact;
    const operation = ledger.find((entry) => "id" in entry && entry.id === attempt.operationId);
    if (
      ids.has(attempt.id) ||
      operations.has(attempt.operationId) ||
      attempt.cycleId !== identity.cycleId ||
      attempt.projectId !== identity.projectId ||
      attempt.artifact.cycleId !== attempt.cycleId ||
      attempt.artifact.revision !== attempt.revision ||
      artifactHash !== createHash("sha256").update(canonicalResearchJson(artifactBody)).digest("hex") ||
      attempt.requestHash !== agentRequestHash(Object.fromEntries<unknown>(Object.entries(attempt.artifact.request))) ||
      !Value.Check(explorationOperationSchema, operation) ||
      operation.tool !== "web_research_exa" ||
      operation.cycleId !== attempt.cycleId ||
      operation.revision !== attempt.revision ||
      operation.requestHash !== attempt.requestHash
    )
      throw new Error("Agent attempt identity conflict.");
    taskSchemaValidator(attempt.artifact.outputContract.taskSchema);
    if (attempt.result) {
      if (
        attempt.result.terminal !== ["completed", "failed", "cancelled"].includes(attempt.result.remoteStatus) ||
        (attempt.status === "completed") !== (attempt.result.remoteStatus === "completed") ||
        (attempt.result.processing === "validated" &&
          (!attempt.result.taskOutput ||
            !taskSchemaValidator(attempt.artifact.outputContract.taskSchema)(attempt.result.taskOutput)))
      )
        throw new Error("Invalid Agent result.");
      for (const entry of attempt.result.grounding) {
        const safe = captureCandidates(
          { results: entry.citations },
          {
            operationId: attempt.operationId,
            revision: attempt.revision,
            requestHash: attempt.requestHash,
            tool: "web_research_exa",
            retrievedAt: attempt.createdAt,
          },
        );
        if (
          safe.length !== entry.citations.length ||
          safe.some((citation, i) => citation.url !== entry.citations[i].url)
        )
          throw new Error("Invalid Agent grounding URL.");
      }
    }
    ids.add(attempt.id);
    operations.add(attempt.operationId);
  }
}
const stopReasons = ["schema_satisfied", "budget_reached", "time_limit_reached", "stopped", "error", "cancelled"];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/** Snapshot only the package-owned execution envelope; raw request/text/error extras are never copied. */
export function curateAgentRun(
  raw: unknown,
  taskSchema: object,
  provenance: EvidenceProvenance,
  providers: readonly string[] = [],
): AgentObservation {
  if (!object(raw) || typeof raw.id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(raw.id))
    throw new Error("Invalid Agent run identity.");
  const remoteStatus = statuses.find((status) => status === raw.status);
  if (!remoteStatus) throw new Error("Invalid Agent run status.");
  const terminal = ["completed", "failed", "cancelled"].includes(remoteStatus);
  const usage: Record<string, number | Record<string, number>> = {};
  if (object(raw.usage)) {
    for (const key of ["agentComputeUnits", "searches", "emails", "phoneNumbers"])
      if (numeric(raw.usage[key])) usage[key] = raw.usage[key];
    if (object(raw.usage.dataSources)) {
      const dataSources = Object.fromEntries(
        Object.entries(raw.usage.dataSources).flatMap(([provider, count]): [string, number][] =>
          providers.includes(provider) && numeric(count) ? [[provider, count]] : [],
        ),
      );
      if (Object.keys(dataSources).length) usage.dataSources = dataSources;
    }
  }
  let totalDollars: number | undefined;
  if (object(raw.costDollars) && numeric(raw.costDollars.total)) {
    try {
      moneyMicros(raw.costDollars.total);
      totalDollars = raw.costDollars.total;
    } catch {
      /* Unknown, not zero. */
    }
  }
  const grounding: Array<{ field: string; citations: Array<{ url: string; title: string }>; confidence?: string }> = [];
  let processing: "pending" | "validated" | "failed" | "not-applicable" = terminal ? "not-applicable" : "pending";
  let taskOutput: Record<string, unknown> | undefined;
  const diagnostics: string[] = [];
  if (remoteStatus === "completed") {
    processing = "failed";
    if (object(raw.output)) {
      try {
        const copy: unknown = structuredClone(raw.output.structured);
        canonicalResearchJson(copy);
        if (object(copy) && taskSchemaValidator(taskSchema)(copy)) {
          taskOutput = copy;
          processing = "validated";
        }
      } catch {
        /* Processing failure is not a remote failure or retry permission. */
      }
      if (Array.isArray(raw.output.grounding)) {
        for (const entry of raw.output.grounding) {
          if (!object(entry) || typeof entry.field !== "string" || !entry.field.trim()) continue;
          const citations = captureCandidates({ results: entry.citations }, provenance).map(({ url, title }) => ({
            url,
            title,
          }));
          grounding.push({
            field: entry.field.slice(0, 512),
            citations,
            ...(typeof entry.confidence === "string" && ["low", "medium", "high"].includes(entry.confidence)
              ? { confidence: entry.confidence }
              : {}),
          });
        }
      }
    }
    if (processing === "failed")
      diagnostics.push("INVALID_TASK_OUTPUT: recover and validate the existing run; never submit a replacement.");
  }
  const timestamps: Record<string, string> = {};
  for (const field of ["createdAt", "completedAt"])
    if (typeof raw[field] === "string" && raw[field].length <= 40 && Number.isFinite(Date.parse(raw[field])))
      timestamps[field] = raw[field];
  return {
    remoteId: raw.id,
    remoteStatus,
    terminal,
    processing,
    usage,
    grounding,
    diagnostics,
    ...timestamps,
    ...(typeof raw.stopReason === "string" && stopReasons.includes(raw.stopReason)
      ? { stopReason: raw.stopReason }
      : {}),
    ...(taskOutput === undefined ? {} : { taskOutput }),
    ...(totalDollars === undefined ? {} : terminal ? { totalDollars } : { provisionalTotalDollars: totalDollars }),
  };
}

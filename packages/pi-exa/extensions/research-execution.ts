/** Deterministic Agent execution policy. No SDK dispatch or inferred consent. */
import { createHash } from "node:crypto";
import { type AccountingIdentity, assessExploration, moneyMicros } from "./research-accounting.js";
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
    assessment.reason = "INSUFFICIENT_BALANCE";
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

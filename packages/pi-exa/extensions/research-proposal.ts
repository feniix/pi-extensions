/**
 * Guided-flow proposal: a readable, non-spending rendering of the compiled
 * artifact plus the approval figures a trusted host dialog will show.
 *
 * The proposal ID is a deterministic digest of the exact artifact hash, plan
 * revision and estimate basis. It is recomputed at submission, so any plan edit
 * after the proposal was shown fails as PROPOSAL_STALE before a dialog or create.
 * Nothing here grants consent; only the host dialog's `true` branch writes grants.
 */

import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { type SpendingGrant, spendingGrantSchema, summarizeAccounting } from "./research-accounting.js";
import type { ResearchArtifact } from "./research-artifacts.js";
import type { ResearchCycle } from "./research-cycles.js";
import { AGENT_RATE_PROFILE, agentRequestHash } from "./research-execution.js";

/** Approval dialog timeout settled by #171; expiry grants nothing. */
export const APPROVAL_DIALOG_TIMEOUT_MS = 10 * 60_000;

export const DIALOG_APPROVAL_REASONS = [
  "APPROVAL_REQUIRED",
  "SCOPE_APPROVAL_REQUIRED",
  "INSUFFICIENT_BALANCE",
] as const;

export interface AgentEstimate {
  dollars: number | null;
  basis: string;
  effort: string;
}

export function roundUpCents(dollars: number): number {
  return Math.ceil(dollars * 100 - 1e-9) / 100;
}

export function grantedTools(record: ResearchCycle): string[] {
  const latest = record.grants
    .filter((grant): grant is SpendingGrant => Value.Check(spendingGrantSchema, grant))
    .at(-1);
  return latest ? [...latest.tools] : [];
}

export function estimateAgentRequest(request: Record<string, unknown>): AgentEstimate {
  const effort = typeof request.effort === "string" ? request.effort : "medium";
  const providers = Array.isArray(request.dataSources) ? request.dataSources.length : 0;
  if (providers > 0) {
    // Provider/contact add-ons are not priced by the package; a dialog allowance equal to the
    // base price would under-fund the run, so the operator assesses the exact request instead.
    return {
      dollars: null,
      effort,
      basis: `${providers} Exa Connect provider(s) requested; their add-on charges are not priced by the package. The operator assesses this exact request by command (a lifetime ceiling that keeps the existing tool scope plus web_research_exa, and approve-request for the exact request hash), then the dialog confirms it.`,
    };
  }
  const fixed = Object.entries(AGENT_RATE_PROFILE.fixed).find(([name]) => name === effort)?.[1];
  if (fixed !== undefined) {
    return {
      dollars: fixed,
      effort,
      basis: `${AGENT_RATE_PROFILE.version}: published fixed price for ${effort} effort (${AGENT_RATE_PROFILE.source}). Contact/provider add-ons are not included; this is an estimate, not a vendor-enforced cap.`,
    };
  }
  const budget = request.budget;
  const maxCostDollars =
    typeof budget === "object" && budget !== null && "maxCostDollars" in budget ? budget.maxCostDollars : undefined;
  if (typeof maxCostDollars === "number" && Number.isFinite(maxCostDollars) && maxCostDollars > 0) {
    return {
      dollars: maxCostDollars,
      effort,
      basis: `Requested budget.maxCostDollars for metered ${effort} effort: a server constraint on this run, not a published price, a cycle cap or a verified invoice.`,
    };
  }
  return {
    dollars: null,
    effort,
    basis: `No published fixed price for ${effort} effort and no budget.maxCostDollars; set a fixed effort or a budget before proposing.`,
  };
}

export function proposalIdFor(artifactHash: string, revision: number, estimate: AgentEstimate): string {
  return createHash("sha256")
    .update(JSON.stringify([artifactHash, revision, estimate.dollars, estimate.basis]))
    .digest("hex")
    .slice(0, 16);
}

export interface AccountingFigures {
  ceilingDollars: number;
  reportedDollars: number;
  pendingEstimatedDollars: number;
  assessedUnknownDollars: number;
}

/**
 * Shared approval arithmetic for every trusted dialog: current exposure, and the lifetime
 * ceiling that covers exposure plus the proposed call without ever lowering an existing one.
 */
export function approvalFigures(accounting: AccountingFigures, proposedDollars: number) {
  const exposure = accounting.reportedDollars + accounting.pendingEstimatedDollars + accounting.assessedUnknownDollars;
  return {
    exposure,
    ceilingDollars: roundUpCents(Math.max(accounting.ceilingDollars, exposure + proposedDollars)),
  };
}

export interface ProposalApproval {
  /** One-use exact-request allowance written on approval. */
  allowanceDollars: number;
  /** Lifetime ceiling written on approval; never below the current ceiling or exposure plus estimate. */
  ceilingDollars: number;
  tools: string[];
}

function list(values: readonly string[], fallback = "none"): string {
  return values.length ? values.join("; ") : fallback;
}

export function buildProposal(record: ResearchCycle, artifact: ResearchArtifact) {
  const estimate = estimateAgentRequest(artifact.request);
  const requestHash = agentRequestHash(artifact.request);
  const accounting = summarizeAccounting(record.grants, record.ledger, {
    cycleId: record.id,
    projectId: record.projectId,
  });
  const { exposure } = approvalFigures(accounting, 0);
  const approval: ProposalApproval | undefined =
    estimate.dollars === null
      ? undefined
      : {
          allowanceDollars: estimate.dollars,
          ceilingDollars: approvalFigures(accounting, estimate.dollars).ceilingDollars,
          tools: [...new Set([...grantedTools(record), "web_research_exa"])],
        };
  const id = proposalIdFor(artifact.hash, artifact.revision, estimate);
  const brief = artifact.brief;
  const controls = artifact.executionControls;
  const providers = (controls.dataSources ?? []).map((source) => source.provider);
  const inputRows = artifact.input?.data?.length ?? 0;
  const exclusionRows = artifact.input?.exclusion?.length ?? 0;
  const schemaFields = Object.keys(
    (artifact.outputContract.taskSchema as { properties?: Record<string, unknown> }).properties ?? {},
  );
  const money = (value: number) => `$${value.toFixed(2)}`;
  const text = [
    `Research proposal ${id} (cycle ${record.id}, revision ${artifact.revision})`,
    `Question: ${brief.goal}`,
    `Topic: ${brief.topic}`,
    `Scope: ${list(brief.scope)}`,
    `Constraints / exclusions: ${list(brief.constraints)}`,
    `Criteria (${brief.criteria.length}): ${list(brief.criteria.map((criterion) => `${criterion.id} ${criterion.label}`))}`,
    `Carried assumptions (${brief.assumptions.length}): ${list(brief.assumptions.map((entry) => entry.statement))}`,
    `Open gaps (${brief.gaps.length}): ${list(brief.gaps.map((gap) => `${gap.id} ${gap.description} [${gap.resolution}]`))}`,
    `Source strategy: ${artifact.selectedEvidence.length} selected source(s) passed as untrusted context; the Exa Agent gathers further public web evidence. Source context is not processed as input rows.`,
    `Expected deliverable: structured output matching the persisted draft-07 task schema (${schemaFields.length} top-level field(s): ${list(schemaFields)}); findings never satisfy criteria automatically.`,
    `Effort: ${controls.effort}. Providers / contact-capable work: ${list(providers)}. Input rows: ${inputRows}. Exclusion rows: ${exclusionRows}. Continuation: ${artifact.continuation?.previousRunId ?? "none"}.`,
    estimate.dollars === null
      ? `Estimated cost: unavailable. ${estimate.basis}`
      : `Estimated cost: ${money(estimate.dollars)}. Basis: ${estimate.basis}`,
    approval
      ? `Lifetime allowance after approval: ${money(approval.ceilingDollars)} total ceiling (currently ${money(accounting.ceilingDollars)}); scope ${approval.tools.join(", ")}.`
      : `Lifetime allowance: ${money(accounting.ceilingDollars)}; no approval figures can be derived without an estimate.`,
    `Existing liabilities: reported ${money(accounting.reportedDollars)}, pending estimates ${money(accounting.pendingEstimatedDollars)}, assessed unknown ${money(accounting.assessedUnknownDollars)}, unresolved operations ${accounting.unresolvedOperationIds.length}.`,
    "Material uncertainty: estimates and the lifetime ceiling are not vendor-enforced limits; API-reported usage is not independently verified billing; actual cost can overshoot.",
    "Approving through the host dialog submits exactly one Exa Agent run for this exact compiled request and nothing else.",
  ].join("\n");
  const dialog = [
    `${brief.topic}`,
    `Effort ${controls.effort}; estimate ${estimate.dollars === null ? "unavailable" : money(estimate.dollars)} (published rate, not a cap).`,
    approval
      ? `Lifetime ceiling becomes ${money(approval.ceilingDollars)}; scope ${approval.tools.join(", ")}.`
      : "No approval figures without an estimate.",
    `Providers: ${list(providers)}. Input rows ${inputRows}, exclusion rows ${exclusionRows}, continuation ${artifact.continuation?.previousRunId ?? "none"}.`,
    `Existing liabilities: ${money(exposure)} assessed, ${accounting.unresolvedOperationIds.length} unresolved.`,
    "Submits exactly one Exa Agent run.",
  ].join("\n");
  return {
    id,
    requestHash,
    artifactHash: artifact.hash,
    revision: artifact.revision,
    estimate,
    approval,
    accounting,
    text,
    dialog,
  };
}

export type ResearchProposal = ReturnType<typeof buildProposal>;

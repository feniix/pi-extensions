/** Opt-in Pi cycle wiring; not installed by the MCP adapter. */
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExaUsageObserver } from "./exa-client.js";
import {
  EXA_RATE_PROFILE,
  EXPLORATION_TOOLS,
  ExplorationApprovalError,
  explorationOperationSchema,
  moneyMicros,
  summarizeAccounting,
} from "./research-accounting.js";
import { assertArtifactTarget, executionPlanSchema, ResearchArtifactError } from "./research-artifacts.js";
import {
  createResearchCycles,
  projectResearchSummary,
  type ResearchCycle,
  type ResearchCycles,
} from "./research-cycles.js";
import { evidenceDecisionSchema } from "./research-evidence.js";
import { agentAttemptSchema, agentRequestHash } from "./research-execution.js";
import { createResearchPlanner } from "./research-planner.js";
import { retryAttemptFacts } from "./research-retry.js";
import { exaResearchStepParams, exaResearchSummaryParams } from "./schemas.js";
import type { AgentInspectionOptions, AgentLifecycleObserver } from "./web-research.js";

const targetProperties = {
  cycleId: Type.Optional(Type.String()),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
};
const referenceProperties = {
  ...targetProperties,
  artifactHash: Type.Optional(Type.String()),
};
const referenceParams = Type.Object(referenceProperties, { additionalProperties: false });
const statusParams = Type.Object(
  {
    ...targetProperties,
    action: Type.Optional(Type.Union([Type.Literal("status"), Type.Literal("resume")])),
  },
  { additionalProperties: false },
);
const stepParams = Type.Object(
  {
    ...exaResearchStepParams.properties,
    ...targetProperties,
    executionPlan: Type.Optional(executionPlanSchema),
    evidence: Type.Optional(Type.Array(evidenceDecisionSchema)),
  },
  { additionalProperties: false },
);
const summaryParams = Type.Object(
  {
    ...exaResearchSummaryParams.properties,
    ...referenceProperties,
  },
  { additionalProperties: false },
);

function view(record: ResearchCycle) {
  const { owner: _owner, ...visible } = record;
  let accounting: Record<string, unknown>;
  try {
    accounting = summarizeAccounting(record.grants, record.ledger, { cycleId: record.id, projectId: record.projectId });
  } catch (error) {
    accounting = {
      ledgerHealthy: false,
      assessmentOnly: true,
      billingVerified: false,
      reason: "UNKNOWN_LIABILITY",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const facts = retryAttemptFacts(record.attempts, record.ledger, { cycleId: record.id, projectId: record.projectId });
  const completedIds = facts.filter((fact) => fact.state === "completed").map((fact) => fact.id);
  const duplicateSuccess = completedIds.length > 1;
  const nextSafeAction =
    record.status === "completed" || completedIds.length
      ? `${duplicateSuccess ? "Review all duplicate successes and their separate costs. " : ""}Completion blocks further submissions; findings do not satisfy criteria automatically. Inspect the same saved attempt to recover failed local output processing.`
      : facts.some((fact) => fact.state === "live")
        ? "Existing local research remains live. Inspect the same saved Agent attempt; do not retry or replace live work."
        : facts.some((fact) => fact.state === "unclassified")
          ? "Legacy attempt has no frozen recovery contract. Inspect its original history manually; never submit automatic replacement research."
          : facts.some((fact) => fact.state === "unknown")
            ? "Preserve unknown original work and liabilities. No saved remote ID means the original remains unknown. Recover saved remote IDs with researchMode=recover. Any explicit researchMode=replace needs operator approve-replacement for EVERY unknown original, new exact-request funding and total exposure approval. No automatic replacement."
            : facts.length
              ? "Confirmed failure or proven nondispatch is retained. Revise and preview the draft; explicit researchMode=retry requires new exact-request funding and current total exposure approval. No automatic resubmission."
              : "Update the plan and preview the compiled request. Only operator grants and fresh request assessments can authorize spending.";
  return {
    ...visible,
    ...createResearchPlanner(record.plan).getStatus(),
    accounting,
    nextSafeAction,
    completionSummary: { remoteCompletedAttemptIds: completedIds, duplicateSuccess },
  };
}

function result(details: Record<string, unknown>, text = JSON.stringify(details, null, 2), isError = false) {
  return { content: [{ type: "text" as const, text }], details, isError };
}

function warning(record: ResearchCycle) {
  return record.status === "running" ||
    record.status === "unknown" ||
    record.ledger.some(
      (entry) =>
        Value.Check(explorationOperationSchema, entry) &&
        (entry.status === "reserved" || entry.status === "unknown" || Boolean(entry.conflictingMicros?.length)),
    ) ||
    record.attempts.some(
      (attempt) => "status" in attempt && (attempt.status === "running" || attempt.status === "unknown"),
    )
    ? " Outstanding/unknown execution remains; archive does not cancel it or clear its liability."
    : "";
}

export type CycleRetrievalFactory = (
  name: string,
  observer: ExaUsageObserver,
) => Parameters<PiToolRegistration["registerTool"]>[0] | undefined;
export type CycleAgentFactory = (
  observer: AgentLifecycleObserver,
) => Parameters<PiToolRegistration["registerTool"]>[0] | undefined;
export type CycleInspectionFactory = (
  runId: string,
  observer: NonNullable<AgentInspectionOptions["observer"]>,
) => Parameters<PiToolRegistration["registerTool"]>[0] | undefined;

export function cyclePiRegistration(
  pi: ExtensionAPI,
  retrievalFactory?: CycleRetrievalFactory,
  agentFactory?: CycleAgentFactory,
  inspectionFactory?: CycleInspectionFactory,
): PiToolRegistration {
  const controllers = new Map<string, Promise<ResearchCycles>>();
  const get = (ctx: ExtensionContext) => {
    const key = JSON.stringify([ctx.cwd, ctx.sessionManager.getSessionId()]);
    let controller = controllers.get(key);
    if (!controller) {
      controller = createResearchCycles({
        root: join(getAgentDir(), "research-cycles"),
        cwd: ctx.cwd,
        sessionId: ctx.sessionManager.getSessionId(),
      });
      controllers.set(key, controller);
    }
    return controller;
  };
  const detach = async () => {
    const pending = [...controllers.values()];
    controllers.clear();
    const outcomes = await Promise.allSettled(pending.map(async (controller) => (await controller).detach()));
    const errors = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (errors.length) throw new AggregateError(errors, "Cycle detached locally; ownership release failed.");
  };
  pi.on("session_start", detach);
  pi.on("session_before_switch", detach);
  pi.on("session_before_fork", detach);
  pi.on("session_tree", detach);
  pi.on("session_shutdown", detach);

  pi.registerCommand("exa-research", {
    description:
      "Manage research cycles: start <topic>, list, resume <id>, approve <cycle-id> <total-dollar-ceiling> [tool,tool...], approve-request <cycle-id> <request-hash> <assessed-dollars>, approve-liability <cycle-id> <operation-id> <assessed-dollars>, approve-replacement <cycle-id> <unknown-attempt-id> <new-request-hash> <assessed-original-dollars>, archive [id]. Explicit funded retry requires fresh exact-request approval and lifetime scope/exposure. Replacement additionally requires approval for every unknown original acknowledging duplicate work and possible additional charges. Recovery performs one existing-run GET, not replacement or spending consent. No automatic retry/replacement.",
    handler: async (args, ctx) => {
      try {
        const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
        const action = match?.[1];
        const value = match?.[2]?.trim() ?? "";
        const cycles = await get(ctx);
        let text: string;
        switch (action) {
          case "start":
            text = JSON.stringify(view(await cycles.start(value)), null, 2);
            break;
          case "list": {
            const found = await cycles.discover();
            text = JSON.stringify(
              [...found.cycles.map(view), ...found.unreadableCycleIds.map((id) => ({ id, unreadable: true }))],
              null,
              2,
            );
            break;
          }
          case "resume": {
            const record = await cycles.resume(value);
            text = JSON.stringify(view(record), null, 2) + warning(record);
            break;
          }
          case "archive": {
            const record = await cycles.archive(value || undefined);
            text = `Archived ${record.id}.${warning(record)}`;
            break;
          }
          case "approve": {
            const approval = /^(\S+)\s+(\d+(?:\.\d{1,6})?)(?:\s+(\S+))?$/.exec(value);
            if (!approval)
              throw new Error("Use approve <cycle-id> <total-dollar-ceiling> [tool,tool...]; no grant was issued.");
            const scope = approval[3]?.split(",") ?? [
              "web_search_exa",
              "web_fetch_exa",
              "web_find_similar_exa",
              "web_search_advanced_exa",
            ];
            const approved = await cycles.grantBudget(approval[1], Number(approval[2]), scope);
            text = `Recorded total lifetime Exa ceiling. Estimates are not billing caps; unsupported pricing remains gated.\n${JSON.stringify(EXA_RATE_PROFILE)}\n${JSON.stringify(view(approved), null, 2)}`;
            break;
          }
          case "approve-request":
          case "approve-liability": {
            const approval = /^(\S+)\s+(\S+)\s+(\d+(?:\.\d{1,6})?)$/.exec(value);
            if (!approval)
              throw new Error(
                `Use ${action} <cycle-id> <${action === "approve-request" ? "request-hash" : "operation-id"}> <assessed-dollars>; no grant was issued.`,
              );
            const approved = await cycles.grantUncertainty(
              approval[1],
              action === "approve-request" ? "request" : "liability",
              approval[2],
              Number(approval[3]),
            );
            text = `Recorded scoped uncertainty assessment, not a billing cap or reported cost. The total ceiling is unchanged; unknown liability remains unknown.\n${JSON.stringify(view(approved), null, 2)}`;
            break;
          }
          case "approve-replacement": {
            const approval = /^(\S+)\s+(\S+)\s+([a-f0-9]{64})\s+(\d+(?:\.\d{1,6})?)$/.exec(value);
            if (!approval)
              throw new Error(
                "Use approve-replacement <cycle-id> <unknown-attempt-id> <new-request-hash> <assessed-original-dollars>; no grant was issued.",
              );
            const approved = await cycles.grantReplacement(approval[1], approval[2], approval[3], Number(approval[4]));
            text = `Recorded explicit acknowledgment of duplicate work and possible additional charges, with the bound original-liability assessment. Not a vendor cap or verified invoice. This does not submit research or replace lifetime scope/new exact-request funding.\n${JSON.stringify(view(approved), null, 2)}`;
            break;
          }
          default:
            throw new Error(
              "Use /exa-research start <topic>, list, resume <id>, approve <cycle-id> <total-dollar-ceiling> [tool,tool...], approve-request <cycle-id> <request-hash> <assessed-dollars>, approve-liability <cycle-id> <operation-id> <assessed-dollars>, approve-replacement <cycle-id> <unknown-attempt-id> <new-request-hash> <assessed-original-dollars>, or archive [id].",
            );
        }
        ctx.ui.notify(text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  return {
    registerTool(tool) {
      const paid = tool.name.startsWith("web_");
      pi.registerTool({
        ...tool,
        ...(tool.name === "web_research_exa"
          ? {
              description: `${tool.description} Pi cycles: active mode executes only the approved compiled request. Explicit researchMode=retry after confirmed failure/nondispatch or researchMode=replace for unknown originals requires cycleId, fresh exact funding and total exposure approval. Replacement additionally requires an unused operator approve-replacement for EVERY unknown original; assistant risk flags/amounts never grant consent. No automatic retry, replacement or gap closing; any success blocks new submissions and duplicate successes remain visible. researchMode=recover performs one existing-run GET with explicit cycleId and optional attemptId; request overrides are forbidden and recovery never creates, polls or cancels. Explicitly resume saved state with exa_research_status action=resume first. previousRunId means new paid continuation, never recovery. Resume and inspection grant no spending permission.`,
            }
          : {}),
        ...(tool.name === "exa_research_status"
          ? {
              parameters: statusParams,
              description:
                "Inspect active cycle or discover saved cycle summaries without activating them. action=resume with explicit cycleId acquires exclusive saved-cycle ownership; it never grants spending permission. Recover an existing Agent attempt with web_research_exa researchMode=recover, never previousRunId continuation.",
            }
          : {}),
        ...(tool.name === "exa_research_step"
          ? {
              parameters: stepParams,
              description:
                "Update the active durable plan. evidence selects/rejects captured candidate IDs; selection requires a label and optional explicit notes. Record external evidence in sources, then select its ID with executionPlan.selectedEvidence. Use evidence decisions or selectedEvidence in one update, not both. executionPlan fields replace their whole persisted field; omitted fields remain unchanged. Processing rows remain explicit input.data/exclusion. Set a goal and draft-07 taskSchema before preview. This does not approve or dispatch work.",
            }
          : {}),
        ...(tool.name === "exa_research_summary"
          ? {
              parameters: summaryParams,
              description:
                "Preview the versioned compiled research request with mode execution_plan or payload; brief/source_pack inspect curated planner facts. Compile errors name fields to fix. Artifacts do not authorize paid work.",
            }
          : {}),
        ...(tool.name === "exa_research_reset"
          ? {
              description:
                "Detach and archive the active durable research cycle; retain history, attempts, grants and liabilities. Does not cancel remote work.",
            }
          : {}),
        ...(paid
          ? {
              parameters: Type.Evaluate(
                Type.Intersect([
                  tool.name === "web_research_exa" ? Type.Omit(tool.parameters, ["query"]) : tool.parameters,
                  Type.Object({
                    researchMode: Type.Optional(
                      Type.Union([
                        Type.Literal("active"),
                        Type.Literal("standalone"),
                        ...(tool.name === "web_research_exa"
                          ? [Type.Literal("recover"), Type.Literal("retry"), Type.Literal("replace")]
                          : []),
                      ]),
                    ),
                    ...targetProperties,
                    ...(tool.name === "web_research_exa"
                      ? {
                          query: Type.Optional(Type.String({ minLength: 1 })),
                          artifactHash: Type.Optional(Type.String()),
                          attemptId: Type.Optional(Type.String()),
                        }
                      : {}),
                  }),
                ]),
              ),
            }
          : {}),
        async execute(id, params, signal, onUpdate, ctx) {
          try {
            // Capture JSON input before the first await; caller-owned arrays
            // must not change the request after permission hashing/assessment.
            const paidInput = paid ? structuredClone(params) : undefined;
            const statusInput = tool.name === "exa_research_status" ? structuredClone(params) : undefined;
            const cycles = await get(ctx);
            if (tool.name === "exa_research_status") {
              if (!Value.Check(statusParams, statusInput)) throw new Error("Invalid cycle status action.");
              if (statusInput.action === "resume") {
                if (!statusInput.cycleId) throw new Error("Explicit cycleId is required to resume a saved cycle.");
                return result(
                  view(await cycles.resume(statusInput.cycleId, { expectedRevision: statusInput.expectedRevision })),
                );
              }
              const active = await cycles.status(statusInput);
              if (active) return result(view(active));
              const found = await cycles.discover();
              return result({
                active: false,
                savedCycles: found.cycles.map((cycle) => ({
                  id: cycle.id,
                  revision: cycle.revision,
                  status: cycle.status,
                  archived: cycle.archived ?? false,
                })),
                unreadableCycleIds: found.unreadableCycleIds,
                nextSafeAction:
                  "Explicitly resume a saved cycle with action=resume and cycleId, or use /exa-research start. Discovery never activates a cycle or grants spending permission.",
              });
            }
            const explicitStandalone =
              paid &&
              typeof paidInput === "object" &&
              paidInput !== null &&
              Reflect.get(paidInput, "researchMode") === "standalone";
            const record = explicitStandalone ? undefined : await cycles.status();
            if (paid) {
              if (typeof paidInput !== "object" || paidInput === null) throw new Error("Invalid tool arguments.");
              const { researchMode, cycleId, expectedRevision, artifactHash, attemptId, ...standalone } =
                paidInput as Record<string, unknown>;
              if (
                researchMode !== undefined &&
                researchMode !== "active" &&
                researchMode !== "standalone" &&
                researchMode !== "recover" &&
                researchMode !== "retry" &&
                researchMode !== "replace"
              ) {
                throw new Error("Invalid researchMode.");
              }
              const reference = { cycleId, expectedRevision, artifactHash };
              if (!Value.Check(referenceParams, reference)) throw new Error("Invalid artifact reference.");
              const transition = researchMode === "retry" || researchMode === "replace" ? researchMode : undefined;
              if (
                transition &&
                (tool.name !== "web_research_exa" || !record || typeof cycleId !== "string" || !cycleId)
              )
                throw new Error("Explicit retry/replacement requires a resumed cycleId and web_research_exa.");
              if (researchMode === "recover") {
                if (tool.name !== "web_research_exa")
                  throw new Error("Recovery is only supported by web_research_exa.");
                if (!record || typeof cycleId !== "string" || !cycleId)
                  throw new Error("Explicitly resume the saved cycle, then recover with its cycleId.");
                if (attemptId !== undefined && typeof attemptId !== "string") throw new Error("Invalid attemptId.");
                if (Object.keys(standalone).length)
                  throw new Error(
                    "EXECUTION_CONFLICT: Recovery accepts references only, never query/effort/continuation overrides.",
                  );
                if (!inspectionFactory)
                  throw new Error("Existing-run inspection is not enabled; no SDK request was dispatched.");
                const prepared = await cycles.prepareAgentRecovery({ ...reference, attemptId });
                let unavailable = false;
                try {
                  const inspector = inspectionFactory(prepared.runId, prepared.observer);
                  if (!inspector) throw new Error("Existing-run inspection is not enabled.");
                  const response = await inspector.execute(
                    id,
                    prepared.attempt.artifact.request,
                    signal,
                    onUpdate,
                    ctx,
                  );
                  unavailable = Boolean(response.isError);
                } catch {
                  unavailable = true;
                }
                if (unavailable) await prepared.onUnavailable();
                const current = await cycles.inspect(cycleId);
                const execution = current.attempts.find(
                  (entry) => Value.Check(agentAttemptSchema, entry) && entry.id === prepared.attempt.id,
                );
                const invalid =
                  !Value.Check(agentAttemptSchema, execution) ||
                  execution.result?.processing === "failed" ||
                  execution.status === "failed";
                return result(
                  {
                    cycleId,
                    attemptId: prepared.attempt.id,
                    inspectionOnly: true,
                    execution,
                    accounting: view(current).accounting,
                    status: current.status,
                    nextSafeAction: unavailable
                      ? "INSPECTION_UNAVAILABLE: This inspection did not confirm a fresh remote outcome; previously confirmed terminal outcomes remain. Inspect the same saved run again; this inspection grants no retry or replacement permission."
                      : "Review recovered state; pending/unknown work requires another explicit inspection, never automatic replacement. Findings do not satisfy criteria automatically.",
                  },
                  undefined,
                  unavailable || invalid,
                );
              }
              if (attemptId !== undefined) throw new Error("attemptId is only valid in explicit recovery mode.");
              if (
                researchMode === "standalone" &&
                (cycleId !== undefined || expectedRevision !== undefined || artifactHash !== undefined)
              )
                throw new Error(
                  "Standalone requests must omit cycle references; use active research for cycle-attributed spending.",
                );
              if (!record && (cycleId !== undefined || expectedRevision !== undefined))
                throw new Error("No active research cycle.");
              if (researchMode === "active" && !record) throw new Error("No active research cycle.");
              if (record && researchMode !== "standalone") {
                if (tool.name === "web_research_exa") {
                  if (!agentFactory) {
                    await cycles.preview({ ...reference, executionFields: standalone });
                    throw new Error(
                      "Integrated paid research is not available in this slice; no request was dispatched.",
                    );
                  }
                  const prepared = await cycles.reserveAgent({ ...reference, executionFields: standalone }, transition);
                  const { attempt, artifact, assessment } = prepared;
                  const observer = cycles.agentLifecycleObserver(attempt.cycleId, attempt.id, attempt.requestHash);
                  const callObserver: AgentLifecycleObserver = {
                    beforeCreate: observer.beforeCreate,
                    raw: async (phase, reply) => {
                      const remoteId = reply.id;
                      const remoteStatus = reply.status;
                      await observer.raw(phase, reply);
                      try {
                        const completionSummary = view(await cycles.inspect(attempt.cycleId)).completionSummary;
                        onUpdate?.(
                          result(
                            {
                              cycleId: attempt.cycleId,
                              attemptId: attempt.id,
                              phase,
                              remoteId,
                              remoteStatus,
                              completionSummary,
                            },
                            `Exa Agent ${remoteId}: ${remoteStatus}. ${completionSummary.duplicateSuccess ? "Duplicate successes are retained with separate costs; no further submission is permitted. " : ""}Progress is not final billing or criterion verification.`,
                          ),
                        );
                      } catch {
                        /* Display failure never authorizes replacement research. */
                      }
                    },
                  };
                  let response: Awaited<ReturnType<typeof tool.execute>>;
                  try {
                    const agent = agentFactory(callObserver);
                    if (!agent) throw new Error("Agent research is not enabled; no SDK request was dispatched.");
                    response = await agent.execute(id, artifact.request, signal, onUpdate, ctx);
                  } finally {
                    await observer.finish();
                  }
                  const current = await cycles.inspect(attempt.cycleId);
                  const execution = current.attempts.find(
                    (entry) => Value.Check(agentAttemptSchema, entry) && entry.id === attempt.id,
                  );
                  const currentView = view(current);
                  const accounting = currentView.accounting;
                  const incompleteOrInvalid =
                    !Value.Check(agentAttemptSchema, execution) || execution.result?.processing !== "validated";
                  return result(
                    {
                      tool: "web_research_exa",
                      cycleId: attempt.cycleId,
                      attemptId: attempt.id,
                      artifactHash: artifact.hash,
                      requestHash: attempt.requestHash,
                      assessment,
                      execution,
                      accounting,
                      status: current.status,
                      completionSummary: currentView.completionSummary,
                      nextSafeAction: currentView.nextSafeAction,
                    },
                    `Exa cycle ${attempt.cycleId}; Agent attempt ${attempt.id}; status ${current.status}.\n${JSON.stringify(execution, null, 2)}\nUsage classification: ${JSON.stringify(accounting)}\n${currentView.nextSafeAction}\nNo automatic retry, replacement or gap closing. Estimates are not vendor caps; API-reported costs are not independently verified invoices.`,
                    response.isError || incompleteOrInvalid,
                  );
                }
                if (!retrievalFactory || !EXPLORATION_TOOLS.some((name) => name === tool.name))
                  throw new Error(
                    "Integrated paid research is not available in this slice; no request was dispatched.",
                  );
                if (cycleId === undefined)
                  throw new Error("APPROVAL_REQUIRED: Explicit cycleId is required to attribute exploratory spending.");
                if (artifactHash !== undefined)
                  throw new Error("Artifact hashes apply to synthesis previews, not exploration.");
                if (!Value.Check(tool.parameters, standalone)) throw new Error("Invalid exploratory tool arguments.");
                const { operation, assessment } = await cycles.reserveExploration(tool.name, standalone, reference);
                const { cycleId: savedCycle, id: operationId, requestHash } = operation;
                const capture = cycles.explorationEvidenceObserver(savedCycle, operationId, requestHash);
                let started = false;
                let observed = false;
                let closed = false;
                let receivedReceipt: { totalDollars?: number } | undefined;
                let candidateCaptureError: string | undefined;
                const finish = async () => {
                  closed = true;
                  if (!started) await cycles.releaseUndispatchedExploration(savedCycle, operationId, requestHash);
                  else if (!observed) {
                    await cycles.reconcileExploration(savedCycle, operationId, requestHash, receivedReceipt ?? {});
                    observed = true;
                  }
                };
                const observer: ExaUsageObserver = {
                  before: async () => {
                    const guard = await cycles.explorationDispatchGuard(savedCycle, operationId, requestHash);
                    return () => {
                      guard();
                      if (closed || signal?.aborted) throw new Error("Exploration cancelled before SDK invocation.");
                      started = true;
                    };
                  },
                  raw: async (response) => {
                    let sourceSnapshot: unknown;
                    let snapshotError: string | undefined;
                    try {
                      sourceSnapshot = structuredClone(response);
                    } catch (error) {
                      snapshotError = error instanceof Error ? error.message : String(error);
                    }
                    const costs =
                      typeof response === "object" && response !== null && "costDollars" in response
                        ? response.costDollars
                        : undefined;
                    const total =
                      typeof costs === "object" && costs !== null && "total" in costs ? costs.total : undefined;
                    receivedReceipt = {};
                    if (typeof total === "number") {
                      try {
                        moneyMicros(total);
                        receivedReceipt = { totalDollars: total };
                      } catch {
                        // Malformed totals remain unknown, never genuine reported spend.
                      }
                    }
                    await cycles.reconcileExploration(savedCycle, operationId, requestHash, receivedReceipt);
                    observed = true;
                    try {
                      if (snapshotError !== undefined) throw new Error(snapshotError);
                      await capture(sourceSnapshot);
                    } catch (error) {
                      candidateCaptureError = `Candidate metadata was not confirmed durable; explicitly curate the returned content without repeating paid work. ${error instanceof Error ? error.message : String(error)}`;
                    }
                  },
                };
                try {
                  const retrieval = retrievalFactory(tool.name, observer);
                  if (!retrieval) throw new Error("Retrieval is not enabled; no SDK request was dispatched.");
                  const response = await retrieval.execute(id, standalone, signal, onUpdate, ctx);
                  await finish();
                  const current = await cycles.inspect(savedCycle);
                  const accounting = view(current).accounting;
                  const candidates =
                    current.candidates?.filter((candidate) =>
                      candidate.provenance.some((entry) => entry.operationId === operationId),
                    ) ?? [];
                  return {
                    ...response,
                    content: [
                      ...response.content,
                      ...(candidateCaptureError === undefined
                        ? []
                        : [{ type: "text" as const, text: candidateCaptureError }]),
                      {
                        type: "text" as const,
                        text: `Exa cycle ${savedCycle}; operation ${operationId}.\nPre-call assessment: ${JSON.stringify(assessment)}\nBasis: ${operation.basis}\nLedger overview (not new-call permission): ${JSON.stringify(accounting)}\nCandidate metadata (not automatic evidence selection): ${JSON.stringify(candidates)}\nPublished estimates are not vendor caps; API-reported usage is not verified billing.`,
                      },
                    ],
                    details: {
                      ...response.details,
                      cycleId: savedCycle,
                      operationId,
                      requestHash,
                      assessment,
                      accounting,
                      candidates,
                      ...(candidateCaptureError === undefined ? {} : { candidateCaptureError }),
                    },
                  };
                } catch (error) {
                  try {
                    await finish();
                  } catch (storageError) {
                    return result(
                      {
                        cycleId: savedCycle,
                        operationId,
                        requestHash,
                        sdkInvoked: started,
                        apiReportedReceipt: receivedReceipt,
                        receiptDurability: "unconfirmed",
                        billingVerified: false,
                      },
                      `ACCOUNTING_UNAVAILABLE: Usage could not be durably saved. Repair storage, reload and explicitly resume to inspect unknown liabilities. SDK receipt: ${JSON.stringify(receivedReceipt ?? {})}. ${storageError instanceof Error ? storageError.message : String(storageError)}`,
                      true,
                    );
                  }
                  throw error;
                }
              }
              if (record) assertArtifactTarget(record, reference);
              if (artifactHash !== undefined) throw new Error("Artifact references require active-cycle research.");
              const metadata = standalone.metadata;
              const attributedCycleId =
                typeof metadata === "object" && metadata !== null && "cycleId" in metadata
                  ? metadata.cycleId
                  : undefined;
              if (standalone.previousRunId !== undefined && typeof standalone.previousRunId !== "string")
                throw new Error("Invalid previousRunId.");
              if (attributedCycleId !== undefined || standalone.previousRunId !== undefined) {
                const saved = await cycles.list();
                if (saved.some((cycle) => cycle.id === attributedCycleId)) {
                  throw new Error("Attributed cycle requests cannot be dispatched as unrelated standalone work.");
                }
                if (
                  saved.some((cycle) =>
                    cycle.attempts.some(
                      (attempt) =>
                        ("runId" in attempt && attempt.runId === standalone.previousRunId) ||
                        (Value.Check(agentAttemptSchema, attempt) &&
                          attempt.result?.remoteId === standalone.previousRunId),
                    ),
                  )
                ) {
                  throw new Error("Recorded cycle attempts cannot be continued as unrelated standalone work.");
                }
              }
              if (!Value.Check(tool.parameters, standalone)) throw new Error("Invalid standalone tool arguments.");
              return tool.execute(id, standalone, signal, onUpdate, ctx);
            }
            if (!record) throw new Error("No active research cycle. Use /exa-research start or resume.");
            switch (tool.name) {
              case "exa_research_step":
                if (!Value.Check(stepParams, params)) throw new Error("Invalid research step arguments.");
                {
                  const updated = await cycles.recordStep(params);
                  return result({ ...updated, cycle: view(updated.cycle) });
                }
              case "exa_research_summary":
                if (!Value.Check(summaryParams, params)) throw new Error("Invalid research summary arguments.");
                if (params.mode === undefined || params.mode === "payload" || params.mode === "execution_plan") {
                  const artifact = await cycles.preview(params);
                  return result({
                    artifact,
                    requestHash: agentRequestHash(artifact.request),
                    previewOnly: true,
                  });
                }
                {
                  const current = await cycles.status(params);
                  if (!current) throw new Error("No active research cycle. Use /exa-research start or resume.");
                  const summary = projectResearchSummary(current, params);
                  return result({ ...view(summary.record), selectedEvidence: summary.selectedEvidence }, summary.text);
                }
              case "exa_research_reset": {
                const archived = await cycles.archive();
                return result(view(archived), `Archived ${archived.id}.${warning(archived)}`);
              }
              default:
                return tool.execute(id, params, signal, onUpdate, ctx);
            }
          } catch (error) {
            return result(
              error instanceof ResearchArtifactError
                ? { issues: error.issues }
                : error instanceof ExplorationApprovalError
                  ? {
                      cycleId: error.cycleId,
                      tool: error.tool,
                      requestHash: error.requestHash,
                      request: error.request,
                      assessment: error.assessment,
                      operatorCommands: [
                        `/exa-research approve ${error.cycleId} <total-dollar-ceiling>${error.tool === "web_research_exa" ? " web_research_exa" : ""}`,
                        ...(error.assessment.reason === "UNCERTAINTY_APPROVAL_REQUIRED"
                          ? [`/exa-research approve-request ${error.cycleId} ${error.requestHash} <assessed-dollars>`]
                          : []),
                        ...error.assessment.blockedOperationIds
                          .filter((operationId) => !error.assessment.conflictingOperationIds.includes(operationId))
                          .map(
                            (operationId) =>
                              `/exa-research approve-liability ${error.cycleId} ${operationId} <assessed-dollars>`,
                          ),
                      ],
                      ...(error.assessment.conflictingOperationIds.length
                        ? {
                            actionRequired:
                              "Investigate conflicting API receipts; uncertainty permission cannot resolve them.",
                          }
                        : {}),
                    }
                  : {},
              error instanceof Error ? error.message : String(error),
              true,
            );
          }
        },
      });
    },
  };
}

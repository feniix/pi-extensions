/** Opt-in Pi cycle wiring; not installed by the MCP adapter. */
import { randomUUID } from "node:crypto";
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
import {
  COMPLETION_NOTICE_TYPE,
  classifyObservationError,
  completionNoticeText,
  DEFAULT_MONITOR_BOUNDS,
  jitteredDelay,
  type MonitorBounds,
  type MonitorPauseReason,
  nextMonitorDelay,
  shouldPauseAfterTransient,
} from "./research-monitor.js";
import { createResearchPlanner } from "./research-planner.js";
import { SUMMARY_MODES } from "./research-planner-types.js";
import {
  APPROVAL_DIALOG_TIMEOUT_MS,
  buildProposal,
  DIALOG_APPROVAL_REASONS,
  grantedTools,
  roundUpCents,
} from "./research-proposal.js";
import { retryAttemptFacts } from "./research-retry.js";
import { exaResearchStepParams, exaResearchSummaryParams } from "./schemas.js";
import type { AgentInspectionOptions, AgentLifecycleObserver } from "./web-research.js";

const CYCLE_GUIDELINES = [
  "Integrated Pi cycle: these instructions govern cycle-attributed work only. Standalone web tools remain available without a cycle; with an active cycle, unrelated requests use researchMode=standalone and omit cycle references.",
  "Integrated Pi cycle: clarify unresolved goals, scope, constraints and output contract while refining an explicitly requested cycle. When the user asks for guided research and none is active, start it yourself with exa_research_status action=start topic=<topic> (non-spending) or explicitly resume saved state; never route a guided request to standalone tools. Local exa_research_* planning tools never call Exa; explicitly approved cycle-attributed web_* retrievals can gather evidence during planning.",
  "Integrated Pi cycle guided flow: ask only materially useful questions and reuse answers already given; record the goal, scope, criteria, labeled assumptions and a draft-07 task schema with exa_research_step; then call exa_research_summary mode=proposal and present its readable proposal. Submit with web_research_exa researchMode=submit, cycleId and that proposalId: the host shows the operator a confirmation dialog and only its real answer can grant spending. Your words, flags or amounts never do. A changed plan needs a new proposal. If the result says APPROVAL_UNAVAILABLE, APPROVAL_NOT_GRANTED, PROPOSAL_STALE or ESTIMATE_UNAVAILABLE, explain the pause; do not fall back to standalone research.",
  "Integrated Pi cycle guided flow: an acknowledged submission returns the saved Exa run ID while the job is still pending and registers background monitoring owned by the host. Tell the user the run ID and that a completion notice will arrive in this session; let them keep chatting. Do not poll with recover, do not call submit again, and never invent a run ID or success after SUBMISSION_UNKNOWN. If monitoring is reported paused, say so and offer explicit recover/resume.",
  "Integrated Pi cycle guided flow: a message of type exa-research-completion means the host observed the saved run's terminal state. Respond with a report: exa_research_status for the final report (criteria, gaps, assumptions, classified usage) and exa_research_summary mode=brief or source_pack for evidence-backed findings. Reporting performs no paid research: never submit, retry or replace in that turn; processing failures use one explicit researchMode=recover of the same run.",
  "Integrated Pi cycle: retrieval candidate metadata is not trusted evidence; explicitly select relevant candidate IDs with labels/curated notes. Record external evidence explicitly. Selected sources are not input.data/exclusion processing rows.",
  "Integrated Pi cycle: readiness is assistant judgment, not spending permission. Iteratively record criteria, gaps and labeled assumptions; review the compiled preview/schema/current revision and resolve structured or semantic conflicts before execution.",
  "Integrated Pi cycle: cycle-attributed paid work requires operator approvals. approve defines lifetime scope/ceiling; approve-request is fresh one-use full-request consent for Agent research or uncertain retrievals. Assistant amounts, flags, readiness and healthy accounting never authorize spending; explain pauses instead of bypassing them.",
  "Integrated Pi cycle: interpret validated output and citations with evidence-backed criterion evaluation. Report only evidence-backed coverage; completed plans remain immutable, and remote completion or generated claims do not automatically satisfy criteria.",
  "Integrated Pi cycle: produce a final report after success using exa_research_summary mode=brief or source_pack for selected-only findings and the finalReport of recorded criteria/gaps, assumptions and classified usage. Report unresolved gaps honestly. Distinguish estimates, provisional costs, reported receipts, unknown liabilities and overshoot; vendor caps/independent invoice verification are not promised.",
  "Integrated Pi cycle: any genuine completion blocks further submissions even when local output is invalid. No automatic retries, replacement or gap-closing runs; another successful pass needs operator go-ahead for a newly authorized cycle. Surface duplicate successes and separate costs.",
  "Integrated Pi cycle: explicitly resume saved state; resume, inspection and archive never grant spending consent or cancel remote work. Recover an existing attempt with one GET. Explicit funded retry needs fresh consent; replacement additionally needs operator approve-replacement for every unknown original, acknowledging duplicate work/additional charges and preserving original liabilities.",
];

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
    action: Type.Optional(Type.Union([Type.Literal("status"), Type.Literal("resume"), Type.Literal("start")])),
    topic: Type.Optional(Type.String({ minLength: 1 })),
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
    mode: Type.Optional(Type.Union([...SUMMARY_MODES.map((mode) => Type.Literal(mode)), Type.Literal("proposal")])),
    ...referenceProperties,
  },
  { additionalProperties: false },
);

function view(record: ResearchCycle) {
  const { owner: _owner, ...visible } = record;
  const planningStatus = createResearchPlanner(record.plan).getStatus();
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
  const completionSummary = { remoteCompletedAttemptIds: completedIds, duplicateSuccess };
  const finalReport =
    record.status === "completed"
      ? {
          cycleId: record.id,
          status: record.status,
          completionSummary,
          recordedCriteria: planningStatus.criteria,
          criteriaRequiringReview: planningStatus.criteria.filter(
            (criterion) =>
              (criterion.status !== "supported" && criterion.status !== "excluded") ||
              criterion.evidenceIssues.length > 0,
          ),
          recordedGaps: record.plan.gaps,
          assumptions: record.plan.assumptions,
          automaticCriterionSatisfaction: false,
          usage: accounting,
          nextSafeAction,
          furtherResearchRequiresNewCycleAndOperatorPermission: true,
        }
      : undefined;
  return {
    ...visible,
    ...planningStatus,
    accounting,
    nextSafeAction,
    completionSummary,
    ...(finalReport ? { finalReport } : {}),
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
export type CycleSubmissionFactory = (
  observer: AgentLifecycleObserver,
) => Parameters<PiToolRegistration["registerTool"]>[0] | undefined;
/** One bounded same-run GET for the background monitor; throws SDK/host errors unchanged. */
export type CycleMonitorInspector = (
  runId: string,
  observer: NonNullable<AgentInspectionOptions["observer"]>,
  timeoutMs: number,
) => Promise<unknown>;

export function cyclePiRegistration(
  pi: ExtensionAPI,
  retrievalFactory?: CycleRetrievalFactory,
  agentFactory?: CycleAgentFactory,
  inspectionFactory?: CycleInspectionFactory,
  submissionFactory?: CycleSubmissionFactory,
  monitorInspector?: CycleMonitorInspector,
  monitorBounds: Partial<MonitorBounds> = {},
): PiToolRegistration & { sessionStarted: (ctx: ExtensionContext) => Promise<void> } {
  const bounds: MonitorBounds = { ...DEFAULT_MONITOR_BOUNDS, ...monitorBounds };
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
  // ---- host-owned background monitor runtime (in-process, this session only) ----
  interface ScheduledMonitor {
    cycles: ResearchCycles;
    cycleId: string;
    attemptId: string;
    /** Session that registered the monitor; delivery never targets another one. */
    sessionId: string;
    timer?: NodeJS.Timeout;
  }
  const scheduled = new Map<string, ScheduledMonitor>();
  const observations = new Map<string, Promise<void>>();
  let currentSessionId: string | undefined;
  let shuttingDown = false;
  const monitorKey = (cycleId: string, attemptId: string) => `${cycleId}/${attemptId}`;
  const awaitObservations = async (cycleId: string) => {
    await Promise.allSettled(
      [...observations].filter(([key]) => key.startsWith(`${cycleId}/`)).map(([, promise]) => promise),
    );
  };
  const trackObservation = (key: string, work: Promise<void>) => {
    const tracked = work.finally(() => {
      if (observations.get(key) === tracked) observations.delete(key);
    });
    observations.set(key, tracked);
    return tracked;
  };
  const pauseMonitor = async (entry: ScheduledMonitor, reason: MonitorPauseReason) => {
    if (entry.timer) clearTimeout(entry.timer);
    scheduled.delete(monitorKey(entry.cycleId, entry.attemptId));
    try {
      await entry.cycles.updateMonitor(entry.cycleId, entry.attemptId, (monitor) => {
        if (monitor.state === "stopped") return;
        monitor.state = "paused";
        monitor.reason = reason;
      });
    } catch {
      /* Pausing is best effort; a stale or unreadable record never spawns new work. */
    }
  };
  const pauseAllMonitors = async (reason: MonitorPauseReason) => {
    shuttingDown = true;
    await Promise.all([...scheduled.values()].map((entry) => pauseMonitor(entry, reason)));
  };
  const pauseCycleMonitors = async (cycleId: string, reason: MonitorPauseReason) => {
    await Promise.all(
      [...scheduled.values()].filter((entry) => entry.cycleId === cycleId).map((entry) => pauseMonitor(entry, reason)),
    );
  };
  const deliverNotice = async (entry: ScheduledMonitor) => {
    const record = await entry.cycles.inspect(entry.cycleId);
    const monitor = record.monitors?.find((candidate) => candidate.attemptId === entry.attemptId);
    const notice = monitor?.notice;
    if (!monitor || !notice || notice.state !== "pending") return;
    // Deliver only into the originating session; foreign/detached origins keep the pending notice.
    if (shuttingDown || monitor.originSessionId !== entry.sessionId) return;
    try {
      pi.sendMessage(
        {
          customType: COMPLETION_NOTICE_TYPE,
          content: completionNoticeText({
            cycleId: entry.cycleId,
            attemptId: entry.attemptId,
            runId: monitor.runId,
            outcome: notice.outcome,
            processing: notice.processing,
          }),
          display: true,
          details: {
            noticeId: notice.id,
            cycleId: entry.cycleId,
            attemptId: entry.attemptId,
            runId: monitor.runId,
            outcome: notice.outcome,
            processing: notice.processing,
          },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
      await entry.cycles.updateMonitor(entry.cycleId, entry.attemptId, (current) => {
        if (current.notice?.state === "pending") {
          current.notice.state = "sent";
          current.notice.sentAt = new Date().toISOString();
        }
      });
    } catch (error) {
      // A stale runtime throws here: keep the notice pending for reconciliation.
      await entry.cycles.updateMonitor(entry.cycleId, entry.attemptId, (current) => {
        if (current.notice) current.notice.deliveryError = error instanceof Error ? error.message : String(error);
      });
    }
  };
  const scheduleMonitor = (entry: ScheduledMonitor, delayMs: number) => {
    if (shuttingDown) return;
    const key = monitorKey(entry.cycleId, entry.attemptId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => {
        entry.timer = undefined;
        void trackObservation(key, observeMonitor(entry));
      },
      jitteredDelay(delayMs, bounds),
    );
    scheduled.set(key, entry);
  };
  const observeMonitor = async (entry: ScheduledMonitor): Promise<void> => {
    if (shuttingDown) return;
    const key = monitorKey(entry.cycleId, entry.attemptId);
    if (!scheduled.has(key)) return;
    const { cycles, cycleId, attemptId } = entry;
    try {
      const record = await cycles.inspect(cycleId);
      const found = record.monitors?.find((candidate) => candidate.attemptId === attemptId);
      if (!found || found.state === "paused" || found.state === "stopped") {
        scheduled.delete(key);
        return;
      }
      if (Date.now() - Date.parse(found.startedAt) >= bounds.maxMonitorMs) {
        await pauseMonitor(entry, "MONITOR_LIFETIME");
        return;
      }
      if (found.state !== "running")
        await cycles.updateMonitor(cycleId, attemptId, (monitor) => {
          monitor.state = "running";
        });
    } catch {
      await pauseMonitor(entry, "DETACHED");
      return;
    }
    if (!monitorInspector) {
      await pauseMonitor(entry, "REGISTRATION_FAILED");
      return;
    }
    try {
      const prepared = await cycles.prepareAgentRecovery({ cycleId, attemptId });
      await monitorInspector(prepared.runId, prepared.observer, bounds.getDeadlineMs);
    } catch (error) {
      const failure = classifyObservationError(error);
      if (failure.pause) {
        await cycles
          .updateMonitor(cycleId, attemptId, (monitor) => {
            monitor.lastErrorKind = failure.kind;
          })
          .catch(() => {});
        await pauseMonitor(entry, failure.pause);
        return;
      }
      const updated = await cycles.updateMonitor(cycleId, attemptId, (monitor) => {
        monitor.consecutiveTransientErrors += 1;
        monitor.lastErrorKind = failure.kind;
        monitor.nextDelayMs = nextMonitorDelay(monitor.nextDelayMs, bounds);
      });
      if (shouldPauseAfterTransient(updated, Date.now(), bounds)) {
        await pauseMonitor(entry, "TRANSIENT_EXHAUSTED");
        return;
      }
      scheduleMonitor(entry, updated.nextDelayMs ?? bounds.initialDelayMs);
      return;
    }
    // The lifecycle observer already persisted the remote facts, results and accounting.
    const after = await cycles.inspect(cycleId);
    const execution = after.attempts.find((item) => Value.Check(agentAttemptSchema, item) && item.id === attemptId);
    const result = Value.Check(agentAttemptSchema, execution) ? execution.result : undefined;
    const updated = await cycles.updateMonitor(cycleId, attemptId, (monitor) => {
      monitor.gets += 1;
      monitor.consecutiveTransientErrors = 0;
      monitor.lastSuccessAt = new Date().toISOString();
      delete monitor.lastErrorKind;
      if (!result?.terminal) monitor.nextDelayMs = nextMonitorDelay(monitor.nextDelayMs, bounds);
    });
    if (!result?.terminal) {
      scheduleMonitor(entry, updated.nextDelayMs ?? bounds.initialDelayMs);
      return;
    }
    // Terminal facts are durable; schedule exactly one notice per attempt, then deliver.
    scheduled.delete(key);
    const outcome =
      result.remoteStatus === "completed" ? "completed" : result.remoteStatus === "cancelled" ? "cancelled" : "failed";
    await cycles.updateMonitor(cycleId, attemptId, (monitor) => {
      monitor.state = "stopped";
      delete monitor.reason;
      monitor.notice ??= {
        id: randomUUID(),
        outcome,
        processing: result.processing,
        state: "pending",
        createdAt: new Date().toISOString(),
      };
    });
    await deliverNotice(entry);
  };
  const registerMonitoring = async (cycles: ResearchCycles, cycleId: string, attemptId: string, sessionId: string) => {
    const { monitor } = await cycles.registerMonitor(cycleId, attemptId);
    const entry: ScheduledMonitor = { cycles, cycleId, attemptId, sessionId };
    scheduleMonitor(entry, bounds.initialDelayMs);
    return monitor;
  };
  /** Notice IDs carried by this session's persisted completion messages, when the host exposes entries. */
  const deliveredNoticeIds = (ctx: ExtensionContext): Map<string, string> => {
    const seen = new Map<string, string>();
    if (typeof ctx.sessionManager.getEntries !== "function") return seen;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom_message" || entry.customType !== COMPLETION_NOTICE_TYPE) continue;
      const noticeId = (entry as { details?: { noticeId?: string } }).details?.noticeId;
      if (noticeId) seen.set(noticeId, entry.id);
    }
    return seen;
  };
  const acknowledgeNotices = async (ctx: ExtensionContext) => {
    const seen = deliveredNoticeIds(ctx);
    if (!seen.size) return;
    const cycles = await get(ctx);
    const found = await cycles.discover();
    for (const record of found.cycles) {
      for (const monitor of record.monitors ?? []) {
        const notice = monitor.notice;
        if (!notice || notice.state === "acknowledged") continue;
        const entryId = seen.get(notice.id);
        if (!entryId) continue;
        await cycles
          .updateMonitor(record.id, monitor.attemptId, (current) => {
            if (current.notice && current.notice.id === notice.id) {
              current.notice.state = "acknowledged";
              current.notice.acknowledgedEntryId = entryId;
            }
          })
          .catch(() => {});
      }
    }
  };

  const detach = async () => {
    await pauseAllMonitors("SHUTDOWN");
    const pending = [...controllers.values()];
    controllers.clear();
    const outcomes = await Promise.allSettled(pending.map(async (controller) => (await controller).detach()));
    const errors = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (errors.length) throw new AggregateError(errors, "Cycle detached locally; ownership release failed.");
  };
  pi.on("session_before_switch", detach);
  pi.on("session_before_fork", detach);
  pi.on("session_tree", detach);
  pi.on("session_shutdown", detach);
  const sessionStarted = async (ctx: ExtensionContext) => {
    await detach();
    // Discovery only: previous runtimes' monitors pause, pending notices surface,
    // and sent notices without a session entry become uncertain. Nothing resumes.
    currentSessionId = ctx.sessionManager.getSessionId();
    shuttingDown = false;
    let cycles: ResearchCycles;
    try {
      cycles = await get(ctx);
    } catch {
      return;
    }
    const found = await cycles.discover().catch(() => ({ cycles: [] as ResearchCycle[], unreadableCycleIds: [] }));
    const entryIds = new Set(deliveredNoticeIds(ctx).keys());
    for (const record of found.cycles) {
      for (const monitor of record.monitors ?? []) {
        const stale = monitor.state === "registered" || monitor.state === "running";
        const notice = monitor.notice;
        const sentWithoutEntry =
          notice?.state === "sent" && monitor.originSessionId === currentSessionId && !entryIds.has(notice.id);
        if (stale || sentWithoutEntry) {
          await cycles
            .updateMonitor(record.id, monitor.attemptId, (current) => {
              if (current.state === "registered" || current.state === "running") {
                current.state = "paused";
                current.reason = "RESTART";
              }
              if (sentWithoutEntry && current.notice?.state === "sent") current.notice.state = "uncertain";
            })
            .catch(() => {});
        }
        if (notice && notice.state !== "acknowledged" && ctx.hasUI) {
          const where = monitor.originSessionId === currentSessionId ? "this session" : "another session";
          const state = sentWithoutEntry ? "uncertain" : notice.state;
          ctx.ui.notify(
            `Pending Exa completion notice for cycle ${record.id} attempt ${monitor.attemptId} (${state}) belongs to ${where}; it was not delivered automatically. Explicitly resume the cycle to report it.`,
            "warning",
          );
        }
      }
    }
    await acknowledgeNotices(ctx).catch(() => {});
  };
  // The registration is installed during Pi's own session_start dispatch, so the
  // entry point invokes sessionStarted for the current session explicitly.
  pi.on("session_start", (_event, ctx) => sessionStarted(ctx));
  pi.on("agent_settled", async (_event, ctx) => {
    await acknowledgeNotices(ctx).catch(() => {});
  });

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
            await pauseCycleMonitors(record.id, "ARCHIVED");
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
    sessionStarted,
    registerTool(tool) {
      const paid = tool.name.startsWith("web_");
      pi.registerTool({
        ...tool,
        ...(paid || tool.name.startsWith("exa_research_")
          ? { promptGuidelines: [...(tool.promptGuidelines ?? []), ...CYCLE_GUIDELINES] }
          : {}),
        ...(tool.name === "web_research_exa"
          ? {
              description: `${tool.description} Pi cycles guided flow: researchMode=submit with cycleId and the proposalId from exa_research_summary mode=proposal asks the operator through the host confirmation dialog, then submits exactly one compiled request, registers host-owned background monitoring and returns the saved run ID while the job is pending; a completion notice wakes this session when the run finishes. Assistant-supplied approvals never count. Pi cycles: active mode executes only the approved compiled request. Explicit researchMode=retry after confirmed failure/nondispatch or researchMode=replace for unknown originals requires cycleId, fresh exact funding and total exposure approval. Replacement additionally requires an unused operator approve-replacement for EVERY unknown original; assistant risk flags/amounts never grant consent. No automatic retry, replacement or gap closing; any success blocks new submissions and duplicate successes remain visible. researchMode=recover performs one existing-run GET with explicit cycleId and optional attemptId; request overrides are forbidden and recovery never creates, polls or cancels. Explicitly resume saved state with exa_research_status action=resume first. previousRunId means new paid continuation, never recovery. Resume and inspection grant no spending permission.`,
            }
          : {}),
        ...(tool.name === "exa_research_status"
          ? {
              parameters: statusParams,
              description:
                "Inspect active cycle or discover saved cycle summaries without activating them. action=start with topic creates a new non-spending guided cycle. action=resume with explicit cycleId acquires exclusive saved-cycle ownership; it never grants spending permission. Recover an existing Agent attempt with web_research_exa researchMode=recover, never previousRunId continuation.",
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
                "Preview the versioned compiled research request with mode execution_plan or payload; mode=proposal renders the readable scope/cost proposal and its proposalId for guided submission; brief/source_pack inspect curated planner facts. Compile errors name fields to fix. Artifacts and proposals do not authorize paid work.",
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
                          ? [
                              Type.Literal("submit"),
                              Type.Literal("recover"),
                              Type.Literal("retry"),
                              Type.Literal("replace"),
                            ]
                          : []),
                      ]),
                    ),
                    ...targetProperties,
                    ...(tool.name === "web_research_exa"
                      ? {
                          query: Type.Optional(Type.String({ minLength: 1 })),
                          artifactHash: Type.Optional(Type.String()),
                          attemptId: Type.Optional(Type.String()),
                          proposalId: Type.Optional(Type.String({ minLength: 1 })),
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
              if (statusInput.action === "start") {
                if (!statusInput.topic) throw new Error("A topic is required to start a guided research cycle.");
                const started = await cycles.start(statusInput.topic);
                return result({
                  ...view(started),
                  spending: false,
                  nextSafeAction:
                    "Guided draft created without spending. Clarify only material questions, record goal/scope/criteria/assumptions and a task schema with exa_research_step, then preview exa_research_summary mode=proposal.",
                });
              }
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
              const { researchMode, cycleId, expectedRevision, artifactHash, attemptId, proposalId, ...standalone } =
                paidInput as Record<string, unknown>;
              if (
                researchMode !== undefined &&
                researchMode !== "active" &&
                researchMode !== "standalone" &&
                researchMode !== "submit" &&
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
                // Explicit recovery shares observation coordination with the monitor: never overlap GETs.
                await awaitObservations(cycleId);
                let releaseRecovery: () => void = () => {};
                void trackObservation(
                  `${cycleId}/recover-${randomUUID()}`,
                  new Promise<void>((resolve) => {
                    releaseRecovery = resolve;
                  }),
                );
                let prepared: Awaited<ReturnType<typeof cycles.prepareAgentRecovery>>;
                try {
                  prepared = await cycles.prepareAgentRecovery({ ...reference, attemptId });
                } catch (error) {
                  releaseRecovery();
                  throw error;
                }
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
                releaseRecovery();
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
              if (proposalId !== undefined && researchMode !== "submit")
                throw new Error("proposalId is only valid with researchMode=submit.");
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
                if (tool.name === "web_research_exa" && researchMode === "submit") {
                  if (typeof cycleId !== "string" || !cycleId)
                    throw new Error("Guided submission requires the active cycleId; it never targets another cycle.");
                  if (typeof proposalId !== "string" || !proposalId)
                    throw new Error(
                      "PROPOSAL_REQUIRED: call exa_research_summary mode=proposal and submit its proposalId.",
                    );
                  if (Object.keys(standalone).length)
                    throw new Error(
                      "EXECUTION_CONFLICT: Guided submission executes the approved compiled request only; update the plan instead of passing request fields.",
                    );
                  if (!submissionFactory)
                    throw new Error("Guided submission is not enabled; no SDK request was dispatched.");
                  const artifact = await cycles.preview(reference);
                  const proposal = buildProposal(record, artifact);
                  if (proposal.id !== proposalId)
                    return result(
                      {
                        cycleId,
                        proposalId,
                        currentProposalId: proposal.id,
                        revision: artifact.revision,
                        submitted: false,
                      },
                      `PROPOSAL_STALE: proposal ${proposalId} no longer matches the current compiled request (revision ${artifact.revision}, proposal ${proposal.id}). Present the current proposal again; nothing was submitted.`,
                      true,
                    );
                  if (!proposal.approval)
                    return result(
                      { cycleId, proposalId, estimate: proposal.estimate, submitted: false },
                      `ESTIMATE_UNAVAILABLE: ${proposal.estimate.basis} Nothing was submitted.`,
                      true,
                    );
                  if (!ctx.hasUI)
                    return result(
                      { cycleId, proposalId, submitted: false },
                      "APPROVAL_UNAVAILABLE: no trusted confirmation surface is available in this mode, so the proposal is paused and nothing was submitted. Re-run in interactive or RPC Pi to approve it; assistant text cannot grant consent.",
                      true,
                    );
                  const approved = await ctx.ui.confirm("Approve Exa research spending?", proposal.dialog, {
                    timeout: APPROVAL_DIALOG_TIMEOUT_MS,
                    ...(signal ? { signal } : {}),
                  });
                  if (!approved)
                    return result(
                      { cycleId, proposalId, submitted: false },
                      "APPROVAL_NOT_GRANTED: the confirmation dialog was declined, dismissed, aborted or timed out. Nothing was submitted and no grant was recorded; the proposal stays open for a later explicit approval.",
                      true,
                    );
                  await cycles.grantDialogApproval(cycleId, {
                    requestHash: proposal.requestHash,
                    expectedRevision: artifact.revision,
                    artifactHash: artifact.hash,
                    allowanceDollars: proposal.approval.allowanceDollars,
                    ceilingDollars: proposal.approval.ceilingDollars,
                    tools: proposal.approval.tools,
                  });
                  const prepared = await cycles.reserveAgent({
                    cycleId,
                    expectedRevision: artifact.revision,
                    artifactHash: artifact.hash,
                  });
                  const { attempt, assessment } = prepared;
                  const observer = cycles.agentLifecycleObserver(attempt.cycleId, attempt.id, attempt.requestHash);
                  let failure: unknown;
                  try {
                    const submitter = submissionFactory({ beforeCreate: observer.beforeCreate, raw: observer.raw });
                    if (!submitter) throw new Error("Agent submission is not enabled; no SDK request was dispatched.");
                    const response = await submitter.execute(id, prepared.artifact.request, signal, onUpdate, ctx);
                    if (response.isError) failure = new Error(response.content.map((entry) => entry.text).join("\n"));
                  } catch (error) {
                    failure = error;
                  }
                  // Decide from the persisted attempt, not from the tool text.
                  const acknowledgedExecution = (await cycles.inspect(cycleId)).attempts.find(
                    (entry) => Value.Check(agentAttemptSchema, entry) && entry.id === attempt.id,
                  );
                  const runId =
                    Value.Check(agentAttemptSchema, acknowledgedExecution) &&
                    typeof acknowledgedExecution.result?.remoteId === "string"
                      ? acknowledgedExecution.result.remoteId
                      : undefined;
                  if (runId === undefined) {
                    // Nothing acknowledged: close the local wait (unknown if dispatched, not-dispatched otherwise).
                    await observer.finish();
                    const closed = await cycles.inspect(cycleId);
                    const execution = closed.attempts.find(
                      (entry) => Value.Check(agentAttemptSchema, entry) && entry.id === attempt.id,
                    );
                    const state = Value.Check(agentAttemptSchema, execution) ? execution.status : "unknown";
                    const detail = failure instanceof Error ? failure.message : String(failure ?? "");
                    return result(
                      {
                        cycleId,
                        attemptId: attempt.id,
                        proposalId,
                        runId: null,
                        state,
                        accounting: view(closed).accounting,
                        status: closed.status,
                        nextSafeAction: view(closed).nextSafeAction,
                      },
                      state === "not-dispatched"
                        ? `SUBMISSION_NOT_DISPATCHED: the approved request was not sent to Exa (${detail}). The reservation was released; approve and submit again explicitly if still wanted.`
                        : `SUBMISSION_UNKNOWN: Exa did not acknowledge attempt ${attempt.id} (${detail}). The request may have reached Exa; its liability is retained, no run ID was invented, and a genuine late acknowledgement will be saved on this attempt. Inspect with researchMode=recover; never resubmit automatically.`,
                      true,
                    );
                  }
                  // Submission and monitor registration fail independently: a saved ID with
                  // paused monitoring is still an acknowledged submission.
                  let monitoring: "registered" | "paused" = "paused";
                  let monitoringDetail = "";
                  try {
                    await registerMonitoring(cycles, cycleId, attempt.id, ctx.sessionManager.getSessionId());
                    monitoring = "registered";
                  } catch (error) {
                    monitoringDetail = error instanceof Error ? error.message : String(error);
                  }
                  const currentView = view(await cycles.inspect(cycleId));
                  return result(
                    {
                      tool: "web_research_exa",
                      cycleId,
                      attemptId: attempt.id,
                      proposalId,
                      artifactHash: artifact.hash,
                      requestHash: attempt.requestHash,
                      runId,
                      remoteStatus:
                        Value.Check(agentAttemptSchema, acknowledgedExecution) && acknowledgedExecution.result
                          ? acknowledgedExecution.result.remoteStatus
                          : "running",
                      assessment,
                      monitoring,
                      ...(monitoringDetail ? { monitoringDetail } : {}),
                      accounting: currentView.accounting,
                      status: currentView.status,
                      nextSafeAction: currentView.nextSafeAction,
                    },
                    monitoring === "registered"
                      ? `Research started: Exa run ${runId} (cycle ${cycleId}, attempt ${attempt.id}). Background monitoring is registered; a completion notice will arrive in this session when the run finishes, and the user can keep chatting meanwhile. No polling, cancellation or further submission is needed. Estimates are not vendor caps; API-reported costs are not verified invoices.`
                      : `Research started: Exa run ${runId} (cycle ${cycleId}, attempt ${attempt.id}), but background monitoring is PAUSED (${monitoringDetail}). The run continues remotely; inspect the same attempt later with researchMode=recover or explicitly resume the cycle. Nothing was cancelled or resubmitted.`,
                  );
                }
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
                      ...(currentView.finalReport ? { finalReport: currentView.finalReport } : {}),
                    },
                    `Exa cycle ${attempt.cycleId}; Agent attempt ${attempt.id}; status ${current.status}.\n${JSON.stringify(execution, null, 2)}\nUsage classification: ${JSON.stringify(accounting)}\n${currentView.finalReport ? `Final report (recorded gaps and criteria, not automatic verification): ${JSON.stringify(currentView.finalReport)}\n` : ""}${currentView.nextSafeAction}\nNo automatic retry, replacement or gap closing. Estimates are not vendor caps; API-reported costs are not independently verified invoices.`,
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
                let reservation: Awaited<ReturnType<typeof cycles.reserveExploration>>;
                try {
                  reservation = await cycles.reserveExploration(tool.name, standalone, reference);
                } catch (error) {
                  // Trusted-dialog approval for the simple lifetime scope/ceiling cases only;
                  // unknown liabilities and uncertain requests keep their operator commands.
                  const dialogReason =
                    error instanceof ExplorationApprovalError &&
                    DIALOG_APPROVAL_REASONS.some((reason) => reason === error.assessment.reason) &&
                    error.assessment.proposedDollars !== null &&
                    !error.assessment.blockedOperationIds.length;
                  if (!dialogReason || !ctx.hasUI) throw error;
                  const assessed = error.assessment;
                  const proposedDollars = assessed.proposedDollars ?? 0;
                  const exposure =
                    assessed.reportedDollars + assessed.pendingEstimatedDollars + assessed.assessedUnknownDollars;
                  const ceilingDollars = roundUpCents(Math.max(assessed.ceilingDollars, exposure + proposedDollars));
                  const tools = [...new Set([...grantedTools(record), tool.name])];
                  const approved = await ctx.ui.confirm(
                    "Approve exploratory Exa retrieval?",
                    [
                      `${tool.name} for cycle ${error.cycleId} (${record.plan.topic})`,
                      `Estimated $${proposedDollars.toFixed(2)} (published rate; not a cap). Lifetime ceiling becomes $${ceilingDollars.toFixed(2)}; scope ${tools.join(", ")}.`,
                      `Existing liabilities: $${exposure.toFixed(2)} assessed, ${assessed.unresolvedOperationIds.length} unresolved.`,
                      "Approving dispatches this one retrieval and does not authorize Agent research.",
                    ].join("\n"),
                    { timeout: APPROVAL_DIALOG_TIMEOUT_MS, ...(signal ? { signal } : {}) },
                  );
                  if (!approved)
                    throw new Error(
                      "APPROVAL_NOT_GRANTED: the exploratory retrieval dialog was declined, dismissed, aborted or timed out; nothing was dispatched and no grant was recorded.",
                    );
                  await cycles.grantBudget(error.cycleId, ceilingDollars, tools, "dialog");
                  reservation = await cycles.reserveExploration(tool.name, standalone, reference);
                }
                const { operation, assessment } = reservation;
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
                if (params.mode === "proposal") {
                  const { mode: _mode, ...reference } = params;
                  const artifact = await cycles.preview(reference);
                  const proposal = buildProposal(record, artifact);
                  return result(
                    {
                      proposalId: proposal.id,
                      cycleId: record.id,
                      revision: proposal.revision,
                      artifactHash: proposal.artifactHash,
                      requestHash: proposal.requestHash,
                      estimate: proposal.estimate,
                      approval: proposal.approval,
                      accounting: proposal.accounting,
                      proposal: proposal.text,
                      spending: false,
                      nextSafeAction: proposal.approval
                        ? "Present this proposal to the user. To submit, call web_research_exa with researchMode=submit, this cycleId and proposalId; the host dialog asks the operator. Any plan change requires a new proposal."
                        : `ESTIMATE_UNAVAILABLE: ${proposal.estimate.basis}`,
                    },
                    `${proposal.text}\n\nNothing was submitted or approved. Approval happens only through the host dialog on researchMode=submit.`,
                  );
                }
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
                  const summaryView = view(summary.record);
                  return result(
                    { ...summaryView, selectedEvidence: summary.selectedEvidence },
                    `${summary.text}${summaryView.finalReport ? `\nFinal report (recorded gaps and criteria, not automatic verification): ${JSON.stringify(summaryView.finalReport)}` : ""}`,
                  );
                }
              case "exa_research_reset": {
                const archived = await cycles.archive();
                await pauseCycleMonitors(archived.id, "ARCHIVED");
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

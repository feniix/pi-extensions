/**
 * #171 prototype: guided background research against a mocked Exa job.
 *
 * This is design evidence for PRD-010 v1.3, not the production implementation.
 * It exercises the host boundaries the 6.1.0 contract depends on:
 *
 * - proposal-bound consent through `ctx.ui.confirm` inside the submitting tool;
 * - one bounded create, remote-ID publication and immediate acknowledgement;
 * - a host-owned, non-overlapping monitor with backoff and pause limits;
 * - durable terminal facts before a durable completion notice;
 * - delivery through `pi.sendMessage` and acknowledgement by observing the
 *   appended `custom_message` session entry;
 * - fail-closed behavior without a trusted UI and after runtime invalidation.
 *
 * No real cycle controller, accounting or compiler is involved; the names mirror
 * the settled public contract (`propose` / `submit` / `status`) with a `proto`
 * prefix so the real tools are untouched.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { processAlive } from "../../../extensions/process-identity.js";
import type { MockExa, MockRun } from "./mock-exa.js";

export const COMPLETION_CUSTOM_TYPE = "exa-proto-completion";

/** Numeric design gates settled by #171; the production contract records the basis. */
export interface MonitorBounds {
  /** Bounded wait for the create acknowledgement before the attempt becomes unknown. */
  createWaitMs: number;
  /** Per-GET deadline. */
  getDeadlineMs: number;
  /** Delay before the first background check after acknowledgement. */
  initialDelayMs: number;
  /** Multiplier applied after every pending observation or transient failure. */
  backoffFactor: number;
  /** Cap on the delay between checks. */
  maxDelayMs: number;
  /** Fraction of the delay randomized in both directions; 0 disables jitter. */
  jitterRatio: number;
  /** Consecutive transient failures before monitoring pauses. */
  maxConsecutiveTransientErrors: number;
  /** Time without a successful GET before monitoring pauses. */
  maxSilenceMs: number;
  /** Total observation time before monitoring pauses for explicit resume. */
  maxMonitorMs: number;
  /** Approval dialog timeout; expiry grants nothing. */
  approvalTimeoutMs: number;
}

export const SETTLED_BOUNDS: MonitorBounds = {
  createWaitMs: 30_000,
  getDeadlineMs: 15_000,
  initialDelayMs: 5_000,
  backoffFactor: 1.5,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
  maxConsecutiveTransientErrors: 8,
  maxSilenceMs: 10 * 60_000,
  maxMonitorMs: 3 * 60 * 60_000,
  approvalTimeoutMs: 10 * 60_000,
};

export type MonitorPauseReason =
  | "AUTH"
  | "NOT_FOUND"
  | "TRANSIENT_EXHAUSTED"
  | "MONITOR_LIFETIME"
  | "SHUTDOWN"
  | "RESTART"
  | "LATE_ACKNOWLEDGEMENT"
  | "STORAGE";

export interface Proposal {
  id: string;
  revision: number;
  topic: string;
  effort: "medium" | "high";
  estimateDollars: number;
  superseded: boolean;
  consumedByAttemptId?: string;
}

export interface Notice {
  id: string;
  state: "pending" | "sent" | "acknowledged" | "uncertain";
  sentAt?: number;
  acknowledgedEntryId?: string;
  deliveryError?: string;
}

export interface Attempt {
  id: string;
  proposalId: string;
  topic: string;
  originSessionId: string;
  /** Local submission lifecycle; separate from remote, monitoring and delivery. */
  /** `rejected`: Exa refused the create definitively before any run existed; no liability. */
  state: "submitting" | "acknowledged" | "unknown" | "rejected";
  runId?: string;
  remote?: { status: MockRun["status"]; stopReason?: MockRun["stopReason"]; error?: string };
  monitor: {
    state: "none" | "registered" | "running" | "paused" | "stopped";
    reason?: MonitorPauseReason;
    gets: number;
    consecutiveTransientErrors: number;
    nextDelayMs?: number;
    lastSuccessAt?: number;
    startedAt?: number;
    deliveryError?: string;
  };
  outcome?: { status: MockRun["status"]; output?: unknown; costDollars?: number; persistedAt: number };
  notice?: Notice;
  createdAt: number;
}

export interface PrototypeStore {
  version: 1;
  proposals: Proposal[];
  attempts: Attempt[];
}

export interface GuidedPrototypeOptions {
  exa: MockExa;
  stateFile?: string;
  bounds?: Partial<MonitorBounds>;
  now?: () => number;
  random?: () => number;
}

export interface ObservedEvent {
  at: number;
  event: string;
}

const emptyStore = (): PrototypeStore => ({ version: 1, proposals: [], attempts: [] });

/**
 * Read the store. A missing file is an empty store; an unreadable or unknown-version file is
 * moved aside (never overwritten) so recorded attempts and liabilities are not lost.
 */
function loadStore(path: string): PrototypeStore {
  if (!existsSync(path)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PrototypeStore;
    if (parsed.version === 1 && Array.isArray(parsed.proposals) && Array.isArray(parsed.attempts)) return parsed;
  } catch {
    /* fall through: preserve the unreadable file below */
  }
  renameSync(path, `${path}.corrupt-${Date.now()}`);
  return emptyStore();
}

/**
 * Short exclusive lock around read-merge-write, so runtimes sharing the file never erase each
 * other's records. A lock whose owner process is gone is reclaimed; a live one is waited for.
 */
function withStoreLock<T>(path: string, action: () => T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lock, "utf8"));
      if (Number.isInteger(owner) && owner > 0 && !processAlive(owner)) {
        unlinkSync(lock);
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Prototype store is locked at ${lock}.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    if (existsSync(lock) && statSync(lock).isFile()) unlinkSync(lock);
  }
}

/** Merge records another runtime added; this runtime's own records win on the same id. */
function mergeStore(into: PrototypeStore, disk: PrototypeStore): void {
  for (const proposal of disk.proposals)
    if (!into.proposals.some((entry) => entry.id === proposal.id)) into.proposals.push(proposal);
  for (const attempt of disk.attempts)
    if (!into.attempts.some((entry) => entry.id === attempt.id)) into.attempts.push(attempt);
}

/** Atomic replace under the store lock: merge, same-directory temporary file, then rename. */
function saveStore(path: string, store: PrototypeStore): void {
  withStoreLock(path, () => {
    mergeStore(store, loadStore(path));
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
  });
}

function statusCodeOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function proposalText(proposal: Proposal): string {
  return [
    `Research proposal r${proposal.revision} (${proposal.id})`,
    `Question: ${proposal.topic}`,
    "Scope: public web sources; no contact-capable providers; no input or exclusion rows.",
    `Effort: ${proposal.effort}. Estimated cost: $${proposal.estimateDollars.toFixed(2)} (published fixed-effort basis; not a vendor cap).`,
    "Lifetime allowance and existing liabilities: none recorded in this prototype.",
    "Approving submits exactly one Exa Agent run and registers background monitoring.",
  ].join("\n");
}

const params = Type.Object(
  {
    action: Type.Union([
      Type.Literal("propose"),
      Type.Literal("submit"),
      Type.Literal("status"),
      Type.Literal("resume"),
    ]),
    topic: Type.Optional(Type.String({ minLength: 1 })),
    effort: Type.Optional(Type.Union([Type.Literal("medium"), Type.Literal("high")])),
    proposalId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

function result(text: string, details: Record<string, unknown>, isError = false) {
  return { content: [{ type: "text" as const, text }], details, isError };
}

export function createGuidedPrototype(pi: ExtensionAPI, options: GuidedPrototypeOptions) {
  const bounds: MonitorBounds = { ...SETTLED_BOUNDS, ...options.bounds };
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const stateFile = options.stateFile ?? join(getAgentDir(), "research-cycles-prototype", "state.json");
  const exa = options.exa;
  const observed: ObservedEvent[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  let store = loadStore(stateFile);
  let sessionId: string | undefined;
  let shuttingDown = false;

  const note = (event: string) => {
    observed.push({ at: now(), event });
  };
  const persist = () => saveStore(stateFile, store);
  const attempt = (id: string) => store.attempts.find((entry) => entry.id === id);
  // A function call, so TypeScript does not narrow the state across the awaited GET.
  const isFenced = (entry: Attempt) => entry.monitor.state === "paused" || entry.monitor.state === "stopped";

  const pauseMonitor = (entry: Attempt, reason: MonitorPauseReason, deliveryError?: string) => {
    entry.monitor.state = "paused";
    entry.monitor.reason = reason;
    if (deliveryError) entry.monitor.deliveryError = deliveryError;
    const timer = timers.get(entry.id);
    if (timer) clearTimeout(timer);
    timers.delete(entry.id);
    persist();
    note(`monitor_paused:${entry.id}:${reason}`);
  };

  const deliver = (entry: Attempt) => {
    const notice = entry.notice;
    if (!notice || notice.state !== "pending") return;
    try {
      // Fire-and-forget on the host side: idle → new turn now; streaming → queued
      // after pending work. Rejections surface only as extension errors.
      pi.sendMessage(
        {
          customType: COMPLETION_CUSTOM_TYPE,
          content: `Exa research attempt ${entry.id} (run ${entry.runId}) reached a terminal state: ${entry.remote?.status}. Report the recorded outcome with exa_proto_research action=status; reporting performs no further paid research.`,
          display: true,
          details: { noticeId: notice.id, attemptId: entry.id, runId: entry.runId, status: entry.remote?.status },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
      notice.state = "sent";
      notice.sentAt = now();
      persist();
      note(`notice_sent:${notice.id}`);
    } catch (error) {
      // A stale runtime (after dispose/replacement) throws here. Keep the notice
      // pending for reconciliation instead of pretending it was delivered.
      notice.deliveryError = error instanceof Error ? error.message : String(error);
      persist();
      note(`notice_delivery_failed:${notice.id}`);
    }
  };

  const schedule = (entry: Attempt, delayMs: number) => {
    if (shuttingDown) return;
    const jitter = bounds.jitterRatio ? 1 + (random() * 2 - 1) * bounds.jitterRatio : 1;
    const delay = Math.max(1, Math.round(delayMs * jitter));
    entry.monitor.nextDelayMs = delayMs;
    const timer = setTimeout(() => {
      timers.delete(entry.id);
      // A failing tick (storage, unexpected error) pauses instead of an unhandled rejection.
      void tick(entry.id).catch(() => {
        try {
          pauseMonitor(entry, "STORAGE");
        } catch {
          entry.monitor.state = "paused";
          entry.monitor.reason = "STORAGE";
        }
      });
    }, delay);
    timers.set(entry.id, timer);
  };

  const nextDelay = (entry: Attempt) =>
    Math.min(
      bounds.maxDelayMs,
      Math.round((entry.monitor.nextDelayMs ?? bounds.initialDelayMs) * bounds.backoffFactor),
    );

  const tick = async (attemptId: string) => {
    const entry = attempt(attemptId);
    if (!entry?.runId || shuttingDown || entry.monitor.state === "paused" || entry.monitor.state === "stopped") return;
    entry.monitor.state = "running";
    const startedAt = entry.monitor.startedAt ?? now();
    if (now() - startedAt >= bounds.maxMonitorMs) {
      pauseMonitor(entry, "MONITOR_LIFETIME");
      return;
    }
    let run: MockRun;
    try {
      run = await withDeadline(exa.get(entry.runId), bounds.getDeadlineMs, "Agent run GET");
    } catch (error) {
      if (shuttingDown || isFenced(entry)) return;
      const statusCode = statusCodeOf(error);
      note(`get_failed:${entry.id}:${statusCode ?? "transient"}`);
      if (statusCode === 401 || statusCode === 403) {
        pauseMonitor(entry, "AUTH");
        return;
      }
      if (statusCode === 404) {
        pauseMonitor(entry, "NOT_FOUND");
        return;
      }
      entry.monitor.consecutiveTransientErrors += 1;
      const silentFor = now() - (entry.monitor.lastSuccessAt ?? startedAt);
      if (
        entry.monitor.consecutiveTransientErrors >= bounds.maxConsecutiveTransientErrors ||
        silentFor >= bounds.maxSilenceMs
      ) {
        pauseMonitor(entry, "TRANSIENT_EXHAUSTED");
        return;
      }
      persist();
      schedule(entry, nextDelay(entry));
      return;
    }
    // A GET in flight across shutdown or a pause records nothing for the fenced runtime.
    if (shuttingDown || isFenced(entry)) return;
    // Persist pending observations only when something material changed: the remote status,
    // or recovery from transient errors. Plain counters are not worth a full store rewrite.
    const materialChange = entry.remote?.status !== run.status || entry.monitor.consecutiveTransientErrors > 0;
    entry.monitor.gets += 1;
    entry.monitor.consecutiveTransientErrors = 0;
    entry.monitor.lastSuccessAt = now();
    entry.remote = { status: run.status, stopReason: run.stopReason, error: run.error?.message };
    note(`get_ok:${entry.id}:${run.status}`);
    if (run.status === "queued" || run.status === "running") {
      // Persist only when the remote status changes; counters are not worth a full rewrite.
      if (materialChange) persist();
      schedule(entry, nextDelay(entry));
      return;
    }
    // Terminal: persist facts first, then schedule one durable notice.
    entry.monitor.state = "stopped";
    timers.delete(entry.id);
    if (!entry.outcome) {
      entry.outcome = {
        status: run.status,
        output: run.output?.structured,
        costDollars: run.costDollars?.total,
        persistedAt: now(),
      };
      persist();
      note(`outcome_persisted:${entry.id}:${run.status}`);
    }
    if (!entry.notice) {
      entry.notice = { id: `notice_${entry.id}`, state: "pending" };
      persist();
      note(`notice_pending:${entry.notice.id}`);
    } else {
      note(`notice_deduplicated:${entry.notice.id}`);
    }
    deliver(entry);
  };

  const registerMonitor = (entry: Attempt) => {
    entry.monitor = {
      ...entry.monitor,
      state: "registered",
      reason: undefined,
      startedAt: now(),
      consecutiveTransientErrors: 0,
    };
    persist();
    schedule(entry, bounds.initialDelayMs);
    note(`monitor_registered:${entry.id}`);
  };

  const view = () => ({
    sessionId,
    proposals: store.proposals,
    attempts: store.attempts,
    counters: { ...exa.counters },
    bounds,
  });

  pi.on("session_start", (event, ctx) => {
    store = loadStore(stateFile);
    sessionId = ctx.sessionManager.getSessionId();
    shuttingDown = false;
    note(`session_start:${event.reason}:hasUI=${ctx.hasUI}:mode=${ctx.mode}`);
    // Discovery only: a previous runtime's monitors are paused, never implicitly resumed.
    let changed = false;
    for (const entry of store.attempts) {
      if (entry.monitor.state === "registered" || entry.monitor.state === "running") {
        entry.monitor.state = "paused";
        entry.monitor.reason = "RESTART";
        changed = true;
      }
    }
    // Acknowledge by observation at start too, and mark sent-but-unconfirmed notices uncertain.
    const entryNotices = new Map<string, string>();
    for (const entry of ctx.sessionManager.getEntries?.() ?? []) {
      if (entry.type !== "custom_message" || entry.customType !== COMPLETION_CUSTOM_TYPE) continue;
      const noticeId = (entry.details as { noticeId?: string } | undefined)?.noticeId;
      if (noticeId) entryNotices.set(noticeId, entry.id);
    }
    for (const entry of store.attempts) {
      const notice = entry.notice;
      if (!notice || notice.state !== "sent") continue;
      const entryId = entryNotices.get(notice.id);
      if (entryId) {
        notice.state = "acknowledged";
        notice.acknowledgedEntryId = entryId;
        changed = true;
        note(`notice_acknowledged:${notice.id}`);
      } else if (entry.originSessionId === sessionId) {
        notice.state = "uncertain";
        changed = true;
        note(`notice_uncertain:${notice.id}`);
      }
    }
    if (changed) persist();
    const pending = store.attempts.filter((entry) => entry.notice && entry.notice.state !== "acknowledged");
    for (const entry of pending) {
      const where = entry.originSessionId === sessionId ? "this session" : `session ${entry.originSessionId}`;
      note(
        `pending_notice_discovered:${entry.notice?.id}:${entry.originSessionId === sessionId ? "origin" : "foreign"}`,
      );
      if (ctx.hasUI)
        ctx.ui.notify(
          `Pending Exa completion notice for attempt ${entry.id} belongs to ${where}; it was not delivered automatically.`,
          "warning",
        );
    }
  });

  pi.on("session_shutdown", (event) => {
    shuttingDown = true;
    note(`session_shutdown:${event.reason}`);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const entry of store.attempts) {
      if (entry.monitor.state === "registered" || entry.monitor.state === "running") {
        entry.monitor.state = "paused";
        entry.monitor.reason = "SHUTDOWN";
      }
    }
    persist();
  });

  pi.on("agent_settled", (event, ctx) => {
    note(`agent_settled:aborted=${event.aborted}`);
    // Nothing to acknowledge unless a notice is in flight: skip the session scan.
    if (!store.attempts.some((entry) => entry.notice?.state === "sent")) return;
    // Acknowledgement by observation: Pi appended our custom message to the session.
    let changed = false;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom_message" || entry.customType !== COMPLETION_CUSTOM_TYPE) continue;
      const noticeId = (entry.details as { noticeId?: string } | undefined)?.noticeId;
      const owner = store.attempts.find((candidate) => candidate.notice?.id === noticeId);
      if (owner?.notice && owner.notice.state === "sent") {
        owner.notice.state = "acknowledged";
        owner.notice.acknowledgedEntryId = entry.id;
        changed = true;
        note(`notice_acknowledged:${noticeId}`);
      }
    }
    if (changed) persist();
  });

  pi.registerTool({
    name: "exa_proto_research",
    label: "Exa research (prototype)",
    description:
      "Prototype of the guided Exa research flow. action=propose drafts a readable, non-spending proposal; action=submit requests trusted operator approval for that exact proposal and, if granted, submits one mocked Agent run and returns its saved run ID while background monitoring continues; action=status reports saved attempts, monitoring and notices without spending.",
    promptSnippet: "exa_proto_research: propose, submit (after trusted approval) or inspect mocked guided research.",
    promptGuidelines: [
      "exa_proto_research: call action=propose first, then action=submit with the returned proposalId; approval comes from the host dialog, never from your own words.",
    ],
    parameters: params,
    async execute(_toolCallId, input, _signal, _onUpdate, ctx: ExtensionContext) {
      if (input.action === "status") return result(JSON.stringify(view(), null, 2), view());
      if (input.action === "resume") {
        // Explicit resume: deliver this session's pending or uncertain notices.
        const delivered: string[] = [];
        for (const entry of store.attempts) {
          const notice = entry.notice;
          if (!notice || entry.originSessionId !== sessionId) continue;
          if (notice.state === "uncertain") notice.state = "pending";
          if (notice.state !== "pending") continue;
          deliver(entry);
          if (entry.notice?.state === "sent") delivered.push(notice.id);
        }
        return result(`Resumed; delivered ${delivered.length} notice(s).`, { delivered });
      }
      if (input.action === "propose") {
        if (!input.topic) return result("PROPOSAL_INVALID: topic is required.", {}, true);
        const effort = input.effort ?? "medium";
        const estimateDollars = effort === "high" ? 0.5 : 0.1;
        const revision = store.proposals.length + 1;
        const id = createHash("sha256")
          .update(JSON.stringify([input.topic, effort, estimateDollars, revision]))
          .digest("hex")
          .slice(0, 16);
        for (const previous of store.proposals) if (!previous.consumedByAttemptId) previous.superseded = true;
        const proposal: Proposal = { id, revision, topic: input.topic, effort, estimateDollars, superseded: false };
        store.proposals.push(proposal);
        persist();
        note(`proposal:${id}`);
        return result(
          `${proposalText(proposal)}\n\nNothing was submitted. Approval happens through the host dialog on submit.`,
          {
            proposalId: id,
            revision,
            spending: false,
          },
        );
      }
      // submit
      const proposal = store.proposals.find((entry) => entry.id === input.proposalId);
      if (!proposal) return result("PROPOSAL_UNKNOWN: propose first; nothing was submitted.", {}, true);
      if (proposal.superseded || proposal.consumedByAttemptId)
        return result(
          `PROPOSAL_STALE: proposal ${proposal.id} was ${proposal.consumedByAttemptId ? "already submitted" : "superseded by a newer proposal"}; approval for it cannot submit the current request. Propose again.`,
          { proposalId: proposal.id },
          true,
        );
      if (!ctx.hasUI) {
        note("approval_unavailable");
        return result(
          "APPROVAL_UNAVAILABLE: no trusted confirmation surface is available in this mode; the proposal is paused and nothing was submitted. Re-run in interactive or RPC Pi to approve.",
          { proposalId: proposal.id, submitted: false },
          true,
        );
      }
      const approved = await ctx.ui.confirm("Approve Exa research spending?", proposalText(proposal), {
        timeout: bounds.approvalTimeoutMs,
      });
      note(`confirm:${approved}`);
      if (!approved)
        return result(
          "APPROVAL_NOT_GRANTED: the dialog was declined, dismissed or timed out; nothing was submitted and the proposal remains open for a later explicit approval.",
          { proposalId: proposal.id, submitted: false },
          true,
        );
      // Re-check after the dialog: a parallel submit or a newer proposal may have consumed or
      // superseded this one while the dialog was open. Consumption below is synchronous.
      if (proposal.superseded || proposal.consumedByAttemptId)
        return result(
          `PROPOSAL_STALE: proposal ${proposal.id} was ${proposal.consumedByAttemptId ? "already submitted" : "superseded"} while the dialog was open; nothing was submitted.`,
          { proposalId: proposal.id, submitted: false },
          true,
        );
      const entry: Attempt = {
        id: `attempt_${store.attempts.length + 1}`,
        proposalId: proposal.id,
        topic: proposal.topic,
        originSessionId: sessionId ?? ctx.sessionManager.getSessionId(),
        state: "submitting",
        monitor: { state: "none", gets: 0, consecutiveTransientErrors: 0 },
        createdAt: now(),
      };
      proposal.consumedByAttemptId = entry.id;
      store.attempts.push(entry);
      persist(); // durable intent before the create
      note(`intent_persisted:${entry.id}`);
      const createPromise = exa.create({
        query: proposal.topic,
        effort: proposal.effort,
        metadata: { attemptId: entry.id },
      });
      // Genuine late acknowledgements settle the original attempt but do not
      // re-register monitoring; that needs an eligible origin context (resume).
      createPromise.then(
        (run) => {
          const current = attempt(entry.id);
          if (!current || current.runId) return;
          current.runId = run.id;
          current.remote = { status: run.status };
          if (current.state === "unknown") {
            current.state = "acknowledged";
            current.monitor.state = "paused";
            current.monitor.reason = "LATE_ACKNOWLEDGEMENT";
            persist();
            note(`late_ack:${current.id}:${run.id}`);
          }
        },
        () => {
          /* a rejected create after timeout stays unknown; nothing to fabricate */
        },
      );
      let run: MockRun;
      try {
        run = await withDeadline(createPromise, bounds.createWaitMs, "Agent run create");
      } catch (error) {
        const statusCode = statusCodeOf(error);
        if (
          statusCode !== undefined &&
          statusCode >= 400 &&
          statusCode < 500 &&
          statusCode !== 408 &&
          statusCode !== 429
        ) {
          // A definitive refusal before any run exists: no liability, and the proposal reopens.
          entry.state = "rejected";
          proposal.consumedByAttemptId = undefined;
          persist();
          note(`create_rejected:${entry.id}:${statusCode}`);
          return result(
            `SUBMISSION_REJECTED: Exa refused the create (${statusCode}) before any run existed; nothing is running and no charge is pending. Fix the request and approve again.`,
            { attemptId: entry.id, runId: null, state: "rejected", statusCode },
            true,
          );
        }
        if (entry.runId) {
          // The genuine acknowledgement landed just after the deadline fired.
          entry.state = "acknowledged";
          entry.monitor.state = "paused";
          entry.monitor.reason = "LATE_ACKNOWLEDGEMENT";
          persist();
          note(`late_ack:${entry.id}:${entry.runId}`);
          return result(
            `Research acknowledged late: ${entry.runId} (attempt ${entry.id}). Background monitoring is paused; resume explicitly to observe it.`,
            { attemptId: entry.id, runId: entry.runId, state: "acknowledged", monitoring: "paused" },
            true,
          );
        }
        entry.state = "unknown";
        persist();
        note(`create_unknown:${entry.id}`);
        return result(
          `SUBMISSION_UNKNOWN: Exa did not acknowledge attempt ${entry.id} within ${bounds.createWaitMs}ms. The request may have reached Exa; its liability is retained, no run ID was invented and nothing will be resubmitted automatically. ${error instanceof Error ? error.message : String(error)}`,
          { attemptId: entry.id, runId: null, state: "unknown" },
          true,
        );
      }
      entry.runId = run.id;
      entry.remote = { status: run.status };
      entry.state = "acknowledged";
      persist();
      note(`acknowledged:${entry.id}:${run.id}`);
      registerMonitor(entry);
      return result(
        `Research started: ${run.id} (attempt ${entry.id}, status ${run.status}). Background monitoring is registered; I will notify you when it finishes. You can continue chatting.`,
        { attemptId: entry.id, runId: run.id, remoteStatus: run.status, monitoring: "registered" },
      );
    },
  });

  pi.registerCommand("exa-proto", {
    description:
      "Control the mocked Exa job: complete <run>, fail <run>, transient <run> <n>, auth <run>, lose <run>, state",
    handler: async (args, ctx) => {
      const [action, runId, count] = args.trim().split(/\s+/);
      try {
        switch (action) {
          case "complete":
            exa.complete(runId);
            break;
          case "fail":
            exa.fail(runId);
            break;
          case "transient":
            exa.failNextGets(
              runId,
              Array.from({ length: Number(count ?? 1) }, () => 503),
            );
            break;
          case "auth":
            exa.failNextGets(runId, [401]);
            break;
          case "lose":
            exa.lose(runId);
            break;
          case "state":
            ctx.ui.notify(JSON.stringify(view()), "info");
            return;
          default:
            throw new Error("Use complete <run>, fail <run>, transient <run> <n>, auth <run>, lose <run> or state.");
        }
        ctx.ui.notify(`mock ${action} ${runId}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  return {
    stateFile,
    bounds,
    observed,
    view,
    readStore: () => loadStore(stateFile),
    activeTimers: () => timers.size,
  };
}

export type GuidedPrototype = ReturnType<typeof createGuidedPrototype>;

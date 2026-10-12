/**
 * #173 regressions: host-owned background monitoring and completion delivery on
 * the real registered Pi extension, real private filesystem controller and a
 * mocked Exa SDK. The host is simulated at the extension API boundary:
 * pi.sendMessage appends a custom_message entry the way an idle Pi does.
 */

import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import type { AgentRun } from "exa-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import exaExtension from "../extensions/index.js";
import { COMPLETION_NOTICE_TYPE } from "../extensions/research-monitor.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, rename: vi.fn(original.rename) };
});

const offlineCreate = vi.hoisted(() =>
  vi.fn<(params: unknown) => Promise<AgentRun>>(async () => ({ id: "agent_run_pending", status: "running" })),
);
const offlineGet = vi.hoisted(() =>
  vi.fn<(runId: string) => Promise<AgentRun>>(async (runId) => ({ id: runId, status: "running" })),
);
const offlineCancel = vi.hoisted(() => vi.fn<(runId: string) => Promise<AgentRun>>());
vi.mock("exa-js", () => ({
  Exa: class {
    search = vi.fn();
    getContents = vi.fn();
    findSimilar = vi.fn();
    answer = vi.fn();
    agent = { runs: { create: offlineCreate, get: offlineGet, cancel: offlineCancel } };
  },
}));

const directories: string[] = [];
const shutdowns: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const shutdown of shutdowns.splice(0)) await shutdown().catch(() => {});
  vi.restoreAllMocks();
  vi.mocked(fs.rename).mockReset();
  offlineCreate.mockReset().mockResolvedValue({ id: "agent_run_pending", status: "running" });
  offlineGet.mockReset().mockImplementation(async (runId) => ({ id: runId, status: "running" }));
  offlineCancel.mockReset();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const completedRun = (id: string): AgentRun => ({
  id,
  status: "completed",
  stopReason: "schema_satisfied",
  costDollars: { total: 0.1 },
  usage: { searches: 2 },
  output: { structured: { summary: "Laya and Jev trade off latency against calibration." } },
});

interface HostOptions {
  sessionId?: string;
  directory?: string;
  hasUI?: boolean;
}

interface Entry {
  type: string;
  id: string;
  customType?: string;
  details?: unknown;
}

async function host(options: HostOptions = {}) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "exa-guided-monitor-")));
  if (!options.directory) directories.push(directory);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(directory, "agent"));
  const config = join(directory, "exa.json");
  await writeFile(
    config,
    JSON.stringify({
      enabledTools: [
        "exa_research_step",
        "exa_research_status",
        "exa_research_summary",
        "exa_research_reset",
        "web_research_exa",
      ],
      apiKey: "offline-fixture-key",
    }),
  );
  const tools = new Map<string, Parameters<PiToolRegistration["registerTool"]>[0]>();
  const handlers = new Map<string, Array<(event: unknown, context: ExtensionContext) => Promise<void>>>();
  const commands = new Map<string, { handler: (args: string, context: ExtensionContext) => Promise<void> }>();
  const notify = vi.fn();
  const entries: Entry[] = [];
  const sent: Array<{
    message: { customType: string; content: string; details: Record<string, unknown> };
    options: unknown;
  }> = [];
  const sendMessage = vi.fn(
    (message: { customType: string; content: string; details: Record<string, unknown> }, sendOptions: unknown) => {
      sent.push({ message, options: sendOptions });
      // An idle Pi appends the custom message to the session immediately.
      entries.push({
        type: "custom_message",
        id: `entry-${entries.length + 1}`,
        customType: message.customType,
        details: message.details,
      });
    },
  );
  const context = {
    cwd: directory,
    hasUI: options.hasUI ?? true,
    mode: "tui",
    signal: undefined,
    sessionManager: { getSessionId: () => options.sessionId ?? "session-one", getEntries: () => [...entries] },
    ui: { notify, confirm: vi.fn(async () => true) },
  } as unknown as ExtensionToolContext;
  const pi = {
    registerFlag: vi.fn(),
    getFlag: (name: string) =>
      name === "exa-enable-cycles"
        ? true
        : name === "--exa-config-file"
          ? config
          : name === "--exa-monitor-interval-ms"
            ? "20"
            : undefined,
    registerTool: (tool: Parameters<PiToolRegistration["registerTool"]>[0]) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: { handler: (args: string, context: ExtensionContext) => Promise<void> }) =>
      commands.set(name, command),
    on: (event: string, handler: (event: unknown, context: ExtensionContext) => Promise<void>) =>
      handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendMessage,
  } as unknown as ExtensionAPI;
  exaExtension(pi);
  const emit = async (event: string, payload: unknown = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, context);
  };
  await emit("session_start", { reason: "startup" });
  shutdowns.push(() => emit("session_shutdown", { reason: "quit" }));
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.execute("call", args, undefined, undefined, context);
  };
  const record = async (cycleId: string, projectId: string) =>
    JSON.parse(await readFile(join(directory, "agent", "research-cycles", projectId, `${cycleId}.json`), "utf8"));
  return { directory, context, notify, sendMessage, sent, entries, commands, call, emit, record };
}
type Host = Awaited<ReturnType<typeof host>>;

async function submitted(pi: Host, topic = "Laya versus Jev", beforeSubmit: () => void = () => {}) {
  const started = await pi.call("exa_research_status", { action: "start", topic });
  const cycleId = String(started.details.id);
  const projectId = String(started.details.projectId);
  await pi.call("exa_research_step", {
    topic,
    stage: "framing",
    note: "guided",
    thought_number: 1,
    total_thoughts: 1,
    next_step_needed: false,
    criteria: [{ id: "C1", label: "Calibration", status: "proposed" }],
    executionPlan: {
      goal: `Compare ${topic}`,
      taskSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      controls: { effort: "medium" },
    },
  });
  const proposal = await pi.call("exa_research_summary", { mode: "proposal", cycleId });
  beforeSubmit();
  const result = await pi.call("web_research_exa", {
    researchMode: "submit",
    cycleId,
    proposalId: proposal.details.proposalId,
  });
  return { cycleId, projectId, result, attemptId: String(result.details.attemptId) };
}

const monitorOf = (record: { monitors?: Array<Record<string, unknown>> }, attemptId: string) =>
  record.monitors?.find((monitor) => monitor.attemptId === attemptId) as
    | { state: string; reason?: string; gets: number; notice?: Record<string, unknown> }
    | undefined;

describe("background monitoring and completion delivery", () => {
  it("returns control with a registered monitor, observes with bounded GETs, persists the outcome, delivers one notice and acknowledges it", async () => {
    const pi = await host();
    offlineGet
      .mockResolvedValueOnce({ id: "agent_run_pending", status: "running" })
      .mockResolvedValueOnce({ id: "agent_run_pending", status: "running" })
      .mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, result, attemptId } = await submitted(pi);
    expect(result.isError).toBe(false);
    expect(result.details).toMatchObject({ runId: "agent_run_pending", monitoring: "registered" });
    expect(result.content[0].text).toContain("completion notice will arrive in this session");
    expect(offlineGet).not.toHaveBeenCalled();
    let record = await pi.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "registered", gets: 0 });
    // The user keeps chatting: an unrelated status call neither spawns a competing monitor nor polls.
    const status = await pi.call("exa_research_status", { cycleId });
    expect((status.details.monitors as unknown[]).length).toBe(1);

    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 5_000 });
    expect(offlineGet).toHaveBeenCalledTimes(3);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
    const [{ message, options }] = pi.sent;
    expect(options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
    expect(message.customType).toBe(COMPLETION_NOTICE_TYPE);
    expect(message.content).toContain(`attempt ${attemptId}`);
    expect(message.content).toContain("completed; local output validated");
    expect(message.content).toContain("exa_research_status");
    expect(message.content).toContain("must not submit");
    expect(message.content).not.toContain("Laya and Jev trade off");
    expect(message.details).toMatchObject({
      cycleId,
      attemptId,
      runId: "agent_run_pending",
      outcome: "completed",
      processing: "validated",
    });

    // The sent state is persisted right after the host accepted the message.
    await vi.waitFor(async () => {
      record = await pi.record(cycleId, projectId);
      expect(monitorOf(record, attemptId)?.notice).toMatchObject({ state: "sent" });
    });
    expect(record.status).toBe("completed");
    expect(record.attempts[0]).toMatchObject({
      status: "completed",
      result: { terminal: true, processing: "validated", totalDollars: 0.1 },
    });
    let monitor = monitorOf(record, attemptId);
    expect(monitor).toMatchObject({ state: "stopped", gets: 3 });
    expect(monitor?.notice).toMatchObject({ state: "sent", outcome: "completed", processing: "validated" });

    // Pi settles the wakeup turn: the persisted custom_message acknowledges the notice.
    await pi.emit("agent_settled", { aborted: false });
    record = await pi.record(cycleId, projectId);
    monitor = monitorOf(record, attemptId);
    expect(monitor?.notice).toMatchObject({ state: "acknowledged", acknowledgedEntryId: "entry-1" });

    // The reporting turn reads; a repeated terminal observation produces no second notice or create.
    const report = await pi.call("exa_research_status", { cycleId });
    expect(report.details.finalReport).toMatchObject({ status: "completed", automaticCriterionSatisfaction: false });
    const recovered = await pi.call("web_research_exa", { researchMode: "recover", cycleId, attemptId });
    expect(recovered.details.inspectionOnly).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pi.sent).toHaveLength(1);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    const blocked = await pi.call("web_research_exa", { researchMode: "submit", cycleId, proposalId: "whatever" });
    expect(blocked.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("reports a saved run ID with monitoring paused when registration fails after the create", async () => {
    const pi = await host();
    const original = vi.mocked(fs.rename).getMockImplementation() as typeof fs.rename;
    // After approval the first asynchronous publication is the create acknowledgement;
    // the second is the monitor record.
    const { cycleId, projectId, result, attemptId } = await submitted(pi, "Laya versus Jev", () => {
      vi.mocked(fs.rename)
        .mockImplementationOnce((from, to) => original(from, to))
        .mockRejectedValueOnce(new Error("EIO: monitor record publication failed"));
    });
    expect(result.isError).toBe(false);
    expect(result.details).toMatchObject({ runId: "agent_run_pending", monitoring: "paused" });
    expect(String(result.details.monitoringDetail)).toContain("EIO");
    expect(result.content[0].text).toContain("monitoring is PAUSED");
    expect(result.content[0].text).toContain("Nothing was cancelled or resubmitted");
    const record = await pi.record(cycleId, projectId);
    expect(record.attempts[0]).toMatchObject({ status: "running", result: { remoteId: "agent_run_pending" } });
    expect(monitorOf(record, attemptId)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(offlineGet).not.toHaveBeenCalled();
    expect(pi.sent).toHaveLength(0);
  });

  it("backs off transient GET errors, pauses when exhausted and pauses immediately on auth or not-found without fabricating remote failure", async () => {
    const transient = await host();
    offlineGet.mockRejectedValue(Object.assign(new Error("503 upstream"), { statusCode: 503 }));
    const first = await submitted(transient);
    await vi.waitFor(
      async () =>
        expect(monitorOf(await transient.record(first.cycleId, first.projectId), first.attemptId)).toMatchObject({
          state: "paused",
          reason: "TRANSIENT_EXHAUSTED",
        }),
      { timeout: 8_000, interval: 25 },
    );
    expect(offlineGet).toHaveBeenCalledTimes(8);
    let record = await transient.record(first.cycleId, first.projectId);
    expect(record.attempts[0]).toMatchObject({ status: "running" });
    expect(record.status).toBe("running");
    expect(monitorOf(record, first.attemptId)?.notice).toBeUndefined();
    expect(transient.sent).toHaveLength(0);
    const calls = offlineGet.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(offlineGet).toHaveBeenCalledTimes(calls);

    offlineGet.mockReset().mockRejectedValue(Object.assign(new Error("401"), { statusCode: 401 }));
    const auth = await host({ sessionId: "session-auth" });
    const second = await submitted(auth);
    await vi.waitFor(
      async () =>
        expect(monitorOf(await auth.record(second.cycleId, second.projectId), second.attemptId)).toMatchObject({
          state: "paused",
          reason: "AUTH",
        }),
      { timeout: 3_000, interval: 25 },
    );
    expect(offlineGet).toHaveBeenCalledTimes(1);
    record = await auth.record(second.cycleId, second.projectId);
    expect(record.attempts[0]).toMatchObject({ status: "running" });

    offlineGet.mockReset().mockRejectedValue(Object.assign(new Error("404"), { statusCode: 404 }));
    const lost = await host({ sessionId: "session-lost" });
    const third = await submitted(lost);
    await vi.waitFor(
      async () =>
        expect(monitorOf(await lost.record(third.cycleId, third.projectId), third.attemptId)).toMatchObject({
          state: "paused",
          reason: "NOT_FOUND",
        }),
      { timeout: 3_000, interval: 25 },
    );
    expect(offlineCreate).toHaveBeenCalledTimes(3);
    expect(offlineCancel).not.toHaveBeenCalled();
    expect(auth.sent.length + lost.sent.length + transient.sent.length).toBe(0);
  });

  it("delivers failure and local-invalid completion notices with recovery guidance and no further research", async () => {
    const failed = await host();
    offlineGet.mockResolvedValue({
      id: "agent_run_pending",
      status: "failed",
      stopReason: "error",
      error: { message: "boom", code: "INTERNAL_ERROR" },
    } as AgentRun);
    const first = await submitted(failed);
    await vi.waitFor(() => expect(failed.sent).toHaveLength(1), { timeout: 3_000 });
    expect(failed.sent[0].message.content).toContain("terminal state: failed");
    let record = await failed.record(first.cycleId, first.projectId);
    expect(record.status).toBe("failed");
    expect(monitorOf(record, first.attemptId)?.notice).toMatchObject({ outcome: "failed" });

    offlineGet.mockReset().mockResolvedValue({
      id: "agent_run_pending",
      status: "completed",
      stopReason: "schema_satisfied",
      costDollars: { total: 0.1 },
      output: { structured: { unexpected: 1 } },
    });
    const invalid = await host({ sessionId: "session-invalid" });
    const second = await submitted(invalid);
    await vi.waitFor(() => expect(invalid.sent).toHaveLength(1), { timeout: 3_000 });
    expect(invalid.sent[0].message.content).toContain("local output processing FAILED");
    expect(invalid.sent[0].message.content).toContain("researchMode=recover");
    record = await invalid.record(second.cycleId, second.projectId);
    expect(record.status).toBe("completed");
    expect(record.attempts[0].result).toMatchObject({ processing: "failed", terminal: true });
    expect(offlineCreate).toHaveBeenCalledTimes(2);
  });

  it("fences shutdown, restart and archive: timers stop, notices stay pending for the origin session and nothing is redirected", async () => {
    const pi = await host();
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(offlineGet.mock.calls.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });
    await pi.emit("session_shutdown", { reason: "quit" });
    let record = await pi.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "SHUTDOWN" });
    const calls = offlineGet.mock.calls.length;
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(offlineGet).toHaveBeenCalledTimes(calls);
    expect(pi.sent).toHaveLength(0);

    // A later runtime for a different session discovers but never delivers or resumes.
    const other = await host({ directory: pi.directory, sessionId: "session-two" });
    expect(other.notify).not.toHaveBeenCalled();
    record = await other.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "SHUTDOWN" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(other.sent).toHaveLength(0);
    expect(offlineGet).toHaveBeenCalledTimes(calls);

    // Archive from the origin runtime pauses observation and warns that remote work may continue.
    const origin = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await origin.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.isError).toBe(false);
    const reset = await origin.call("exa_research_reset", {});
    expect(reset.content[0].text).toContain("Outstanding/unknown execution remains; archive does not cancel it");
    record = await origin.record(cycleId, projectId);
    expect(record.archived).toBe(true);
    expect(monitorOf(record, attemptId)?.state).toBe("paused");
    expect(offlineCancel).not.toHaveBeenCalled();
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("surfaces a sent-but-unconfirmed notice as uncertain on restart instead of resending or dropping it", async () => {
    const pi = await host();
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });
    // Simulate a crash between sendMessage and the session append: the entry never persisted.
    pi.entries.splice(0);
    await pi.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const record = await restarted.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)?.notice).toMatchObject({ state: "uncertain" });
    expect(restarted.notify).toHaveBeenCalledWith(expect.stringContaining("uncertain"), "warning");
    expect(restarted.sent).toHaveLength(0);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps two approved cycles in different sessions isolated: distinct runs, monitors, results and notices", async () => {
    const one = await host({ sessionId: "session-one" });
    const two = await host({ directory: one.directory, sessionId: "session-two" });
    offlineCreate
      .mockResolvedValueOnce({ id: "run_one", status: "running" })
      .mockResolvedValueOnce({ id: "run_two", status: "running" });
    offlineGet.mockImplementation(async (runId) => completedRun(runId));
    const first = await submitted(one, "Laya versus Jev");
    const second = await submitted(two, "Jev versus Julia");
    expect(first.result.details.runId).toBe("run_one");
    expect(second.result.details.runId).toBe("run_two");
    await vi.waitFor(() => expect(one.sent.length + two.sent.length).toBe(2), { timeout: 4_000 });
    expect(one.sent[0].message.details).toMatchObject({ cycleId: first.cycleId, runId: "run_one" });
    expect(two.sent[0].message.details).toMatchObject({ cycleId: second.cycleId, runId: "run_two" });
    expect(one.sent).toHaveLength(1);
    expect(two.sent).toHaveLength(1);
    const records = [
      await one.record(first.cycleId, first.projectId),
      await two.record(second.cycleId, second.projectId),
    ];
    expect(records.map((record) => record.attempts[0].result.remoteId)).toEqual(["run_one", "run_two"]);
    expect(records.map((record) => record.grants.length)).toEqual([2, 2]);
    expect(offlineCreate).toHaveBeenCalledTimes(2);
    expect(offlineCancel).not.toHaveBeenCalled();
  });
});

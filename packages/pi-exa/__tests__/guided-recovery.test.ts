/**
 * #174 regressions: monitoring and notification recovery across interruptions on
 * the real registered Pi extension, real private filesystem controller and a
 * mocked Exa SDK. Restart is simulated by emitting session_shutdown and loading a
 * fresh extension runtime over the same private store.
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

// Real filesystem controllers plus timer-driven monitors need headroom on loaded CI runners.
vi.setConfig({ testTimeout: 30_000 });

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
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
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
  submitTimeoutMs?: number;
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
        : name === "exa-config-file"
          ? config
          : name === "exa-monitor-interval-ms"
            ? "20"
            : name === "exa-submit-timeout-ms" && options.submitTimeoutMs !== undefined
              ? String(options.submitTimeoutMs)
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
    | { state: string; reason?: string; gets: number; originSessionId?: string; notice?: Record<string, unknown> }
    | undefined;

describe("recovering monitoring and notifications across interruptions", () => {
  it("preserves state across shutdown, discovers without resuming, then an explicit conversational resume re-registers monitoring and delivers once", async () => {
    const pi = await host();
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(offlineGet.mock.calls.length).toBeGreaterThanOrEqual(1), { timeout: 3_000 });
    await pi.emit("session_shutdown", { reason: "quit" });
    let record = await pi.record(cycleId, projectId);
    // Local interruption keeps the attempt unknown while the saved remote ID, frozen
    // artifact, grants and liability survive; the remote run is not declared failed.
    expect(record.attempts[0]).toMatchObject({ status: "unknown", result: { remoteId: "agent_run_pending" } });
    expect(record.attempts[0].artifact.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.grants).toHaveLength(2);
    expect(record.ledger[0]).toMatchObject({ tool: "web_research_exa" });
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "SHUTDOWN" });

    // Restart: discovery only, no ownership, no GET, no create.
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const calls = offlineGet.mock.calls.length;
    const discovered = await restarted.call("exa_research_status", {});
    expect(discovered.details.active).toBe(false);
    expect((discovered.details.savedCycles as Array<{ id: string }>).map((cycle) => cycle.id)).toEqual([cycleId]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(offlineGet).toHaveBeenCalledTimes(calls);
    record = await restarted.record(cycleId, projectId);
    expect(record.owner).toBeUndefined();

    // Explicit resume through the tool: ownership reacquired, monitor re-registered, run observed.
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.isError).toBe(false);
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "monitoring resumed" }]);
    expect(resumed.details.spending).toBe(false);
    await vi.waitFor(() => expect(restarted.sent).toHaveLength(1), { timeout: 4_000 });
    expect(restarted.sent[0].message.details).toMatchObject({ cycleId, attemptId, outcome: "completed" });
    await restarted.emit("agent_settled", { aborted: false });
    record = await restarted.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "stopped", notice: { state: "acknowledged" } });
    expect(record.status).toBe("completed");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
    expect(pi.sent).toHaveLength(0);
  });

  it("refuses a competing live runtime and never duplicates an active monitor", async () => {
    const owner = await host({ sessionId: "session-owner" });
    const { cycleId, projectId, attemptId } = await submitted(owner);
    const rival = await host({ directory: owner.directory, sessionId: "session-rival" });
    const takeover = await rival.call("exa_research_status", { action: "resume", cycleId });
    expect(takeover.isError).toBe(true);
    expect(takeover.content[0].text).toContain("owned by another live session/runtime");
    const record = await rival.record(cycleId, projectId);
    expect(record.monitors).toHaveLength(1);
    expect(monitorOf(record, attemptId)?.originSessionId).toBe("session-owner");
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    await vi.waitFor(() => expect(owner.sent).toHaveLength(1), { timeout: 4_000 });
    expect(rival.sent).toHaveLength(0);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("recovers a terminal attempt whose notice scheduling crashed: restart shows the outcome, resume creates and delivers the notice", async () => {
    const pi = await host();
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const original = vi.mocked(fs.rename).getMockImplementation() as typeof fs.rename;
    const { cycleId, projectId, attemptId } = await submitted(pi, "Laya versus Jev", () => {
      // ack, registration, running-state, receipt, counters publish; the notice-scheduling write fails.
      vi.mocked(fs.rename)
        .mockImplementationOnce((from, to) => original(from, to))
        .mockImplementationOnce((from, to) => original(from, to))
        .mockImplementationOnce((from, to) => original(from, to))
        .mockImplementationOnce((from, to) => original(from, to))
        .mockImplementationOnce((from, to) => original(from, to))
        .mockRejectedValueOnce(new Error("EIO: notice publication failed"));
    });
    await vi.waitFor(
      async () => expect(monitorOf(await pi.record(cycleId, projectId), attemptId)?.state).toBe("paused"),
      { timeout: 4_000, interval: 25 },
    );
    let record = await pi.record(cycleId, projectId);
    expect(record.status).toBe("completed");
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "STORAGE" });
    expect(monitorOf(record, attemptId)?.notice).toBeUndefined();
    expect(pi.sent).toHaveLength(0);
    await pi.emit("session_shutdown", { reason: "quit" });

    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "notice delivered" }]);
    expect(restarted.sent).toHaveLength(1);
    expect(restarted.sent[0].message.details).toMatchObject({ outcome: "completed" });
    expect(restarted.sent[0].message.details).not.toHaveProperty("possibleDuplicate");
    record = await restarted.record(cycleId, projectId);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "stopped", notice: { state: "sent" } });
    const calls = offlineGet.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(offlineGet).toHaveBeenCalledTimes(calls);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("re-sends an uncertain notice only on explicit resume, labeled as a possible duplicate, instead of claiming exactly-once", async () => {
    const pi = await host();
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });
    await vi.waitFor(async () =>
      expect(monitorOf(await pi.record(cycleId, projectId), attemptId)?.notice).toMatchObject({ state: "sent" }),
    );
    pi.entries.splice(0); // the session append never persisted
    await pi.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    expect(monitorOf(await restarted.record(cycleId, projectId), attemptId)?.notice).toMatchObject({
      state: "uncertain",
    });
    expect(restarted.sent).toHaveLength(0);
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "notice re-sent" }]);
    expect(restarted.sent).toHaveLength(1);
    expect(restarted.sent[0].message.details).toMatchObject({ possibleDuplicate: true });
    expect(restarted.sent[0].message.content).toContain("may duplicate an earlier report");
    await restarted.emit("agent_settled", { aborted: false });
    expect(monitorOf(await restarted.record(cycleId, projectId), attemptId)?.notice).toMatchObject({
      state: "acknowledged",
    });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("lets late original facts settle after archive without reactivating monitoring or delivering into the archived context", async () => {
    const pi = await host();
    let releaseGet: ((run: AgentRun) => void) | undefined;
    offlineGet.mockImplementationOnce(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseGet = resolve;
        }),
    );
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(releaseGet).toBeDefined(), { timeout: 3_000 });
    const archived = await pi.call("exa_research_reset", {});
    expect(archived.content[0].text).toContain("Outstanding/unknown execution remains");
    let record = await pi.record(cycleId, projectId);
    expect(record.archived).toBe(true);
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "ARCHIVED" });
    (releaseGet as (run: AgentRun) => void)(completedRun("agent_run_pending"));
    await vi.waitFor(async () => expect((await pi.record(cycleId, projectId)).status).toBe("completed"), {
      timeout: 3_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    record = await pi.record(cycleId, projectId);
    expect(record.attempts[0]).toMatchObject({ status: "completed", result: { totalDollars: 0.1 } });
    expect(monitorOf(record, attemptId)).toMatchObject({ state: "paused", reason: "ARCHIVED" });
    expect(monitorOf(record, attemptId)?.notice).toBeUndefined();
    expect(pi.sent).toHaveLength(0);
    // Explicit resume of the archived cycle reports the late success without a new run.
    const resumed = await pi.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "notice delivered" }]);
    expect(pi.sent).toHaveLength(1);
    const blocked = await pi.call("web_research_exa", { researchMode: "submit", cycleId, proposalId: "x" });
    expect(blocked.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
  });

  it("never duplicates ticks on repeated resume, and resume after tree navigation delivers a pending notice honestly", async () => {
    const pi = await host();
    let releaseGet: ((run: AgentRun) => void) | undefined;
    offlineGet.mockImplementation(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseGet = resolve;
        }),
    );
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(releaseGet).toBeDefined(), { timeout: 3_000 });
    const first = await pi.call("exa_research_status", { action: "resume", cycleId });
    const second = await pi.call("exa_research_status", { action: "resume", cycleId });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(offlineGet).toHaveBeenCalledTimes(1);
    (releaseGet as (run: AgentRun) => void)(completedRun("agent_run_pending"));
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });

    // Tree navigation detaches while a GET is in flight: the late terminal facts are kept
    // without a notice, and the explicit resume afterwards delivers it despite the detach.
    const second_pi = await host({ sessionId: "session-tree" });
    let releaseLate: ((run: AgentRun) => void) | undefined;
    offlineGet.mockReset().mockImplementation(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseLate = resolve;
        }),
    );
    const other = await submitted(second_pi);
    await vi.waitFor(() => expect(releaseLate).toBeDefined(), { timeout: 3_000 });
    await second_pi.emit("session_tree", {});
    (releaseLate as (run: AgentRun) => void)(completedRun("agent_run_pending"));
    await vi.waitFor(
      async () => expect((await second_pi.record(other.cycleId, other.projectId)).status).toBe("completed"),
      {
        timeout: 3_000,
      },
    );
    expect(second_pi.sent).toHaveLength(0);
    expect(monitorOf(await second_pi.record(other.cycleId, other.projectId), other.attemptId)?.notice).toBeUndefined();
    const resumed = await second_pi.call("exa_research_status", { action: "resume", cycleId: other.cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId: other.attemptId, action: "notice delivered" }]);
    expect(second_pi.sent).toHaveLength(1);
    expect((await second_pi.record(other.cycleId, other.projectId)).attempts).toHaveLength(1);
    expect(monitorOf(await pi.record(cycleId, projectId), attemptId)?.state).toBe("stopped");
    expect(offlineCreate).toHaveBeenCalledTimes(2);
  });

  it("resumes monitoring for a saved run whose registration failed after the create", async () => {
    const pi = await host();
    const original = vi.mocked(fs.rename).getMockImplementation() as typeof fs.rename;
    const { cycleId, projectId, result, attemptId } = await submitted(pi, "Laya versus Jev", () => {
      vi.mocked(fs.rename)
        .mockImplementationOnce((from, to) => original(from, to))
        .mockRejectedValueOnce(new Error("EIO: monitor record publication failed"));
    });
    expect(result.details).toMatchObject({ runId: "agent_run_pending", monitoring: "paused" });
    expect(monitorOf(await pi.record(cycleId, projectId), attemptId)).toBeUndefined();
    await pi.emit("session_shutdown", { reason: "quit" });
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "monitoring resumed" }]);
    await vi.waitFor(() => expect(restarted.sent).toHaveLength(1), { timeout: 3_000 });
    expect(monitorOf(await restarted.record(cycleId, projectId), attemptId)).toMatchObject({ state: "stopped" });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps a remote-ID publication crash unknown: no fabricated ID, no monitor, recovery names the missing ID, submission stays blocked", async () => {
    const pi = await host();
    const original = vi.mocked(fs.rename).getMockImplementation() as typeof fs.rename;
    const { cycleId, projectId, result, attemptId } = await submitted(pi, "Laya versus Jev", () => {
      // The create acknowledgement receipt write and its single retry both fail.
      vi.mocked(fs.rename)
        .mockRejectedValueOnce(new Error("EIO: receipt publication failed"))
        .mockRejectedValueOnce(new Error("EIO: receipt publication failed again"));
    });
    void original;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("SUBMISSION_UNKNOWN");
    expect(result.details).toMatchObject({ runId: null, state: "unknown" });
    let record = await pi.record(cycleId, projectId);
    expect(record.attempts[0]).toMatchObject({ status: "unknown" });
    expect(record.attempts[0].result).toBeUndefined();
    expect(record.monitors ?? []).toHaveLength(0);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([]);
    const recovered = await restarted.call("web_research_exa", { researchMode: "recover", cycleId, attemptId });
    expect(recovered.isError).toBe(true);
    expect(recovered.content[0].text).toContain("RECOVERY_UNAVAILABLE");
    expect(recovered.content[0].text).toContain("No saved remote ID");
    const blocked = await restarted.call("web_research_exa", { researchMode: "submit", cycleId, proposalId: "x" });
    expect(blocked.isError).toBe(true);
    record = await restarted.record(cycleId, projectId);
    expect(record.attempts).toHaveLength(1);
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(restarted.sent).toHaveLength(0);
  });

  it("pauses monitors of a proven-dead owner on start and lets the next session resume them", async () => {
    const pi = await host({ sessionId: "session-crashed" });
    let releaseGet: ((run: AgentRun) => void) | undefined;
    offlineGet.mockImplementation(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseGet = resolve;
        }),
    );
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(releaseGet).toBeDefined(), { timeout: 3_000 });
    // Simulate a crashed owner: the record still carries an owner whose process no longer exists.
    const path = join(pi.directory, "agent", "research-cycles", projectId, `${cycleId}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.owner.pid = 2_147_483_000;
    await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    const next = await host({ directory: pi.directory, sessionId: "session-next" });
    expect(monitorOf(await next.record(cycleId, projectId), attemptId)).toMatchObject({
      state: "paused",
      reason: "RESTART",
    });
    offlineGet.mockReset().mockResolvedValue(completedRun("agent_run_pending"));
    const resumed = await next.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.isError).toBe(false);
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "monitoring resumed" }]);
    await vi.waitFor(() => expect(next.sent).toHaveLength(1), { timeout: 3_000 });
    expect(pi.sent).toHaveLength(0);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps local-invalid results recoverable within the frozen contract, and resume grants no consent", async () => {
    offlineGet.mockResolvedValue({
      id: "agent_run_pending",
      status: "completed",
      stopReason: "schema_satisfied",
      costDollars: { total: 0.1 },
      output: { structured: { unexpected: 1 } },
    });
    const invalid = await host({ sessionId: "session-invalid" });
    const second = await submitted(invalid);
    await vi.waitFor(() => expect(invalid.sent).toHaveLength(1), { timeout: 3_000 });
    expect(invalid.sent[0].message.details).toMatchObject({ processing: "failed" });
    await invalid.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: invalid.directory, sessionId: "session-invalid" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId: second.cycleId });
    expect(resumed.details.spending).toBe(false);
    let record = await restarted.record(second.cycleId, second.projectId);
    expect(record.grants).toHaveLength(2);
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const recovered = await restarted.call("web_research_exa", {
      researchMode: "recover",
      cycleId: second.cycleId,
      attemptId: second.attemptId,
    });
    expect(recovered.details.inspectionOnly).toBe(true);
    record = await restarted.record(second.cycleId, second.projectId);
    expect(record.attempts[0].result).toMatchObject({ processing: "validated", remoteId: "agent_run_pending" });
    expect(record.attempts).toHaveLength(1);
    const forged = await restarted.call("web_research_exa", { researchMode: "active", cycleId: second.cycleId });
    expect(forged.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("adopts a genuine late create acknowledgement: monitors it and delivers one notice without resubmitting", async () => {
    const pi = await host({ submitTimeoutMs: 1_500 });
    let releaseCreate: ((run: AgentRun) => void) | undefined;
    offlineCreate.mockImplementationOnce(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const { cycleId, projectId, result, attemptId } = await submitted(pi);
    expect(result.content[0].text).toContain("SUBMISSION_UNKNOWN");
    expect(result.content[0].text).toContain("monitored in the background");
    offlineGet.mockResolvedValue(completedRun("agent_run_late"));
    (releaseCreate as (run: AgentRun) => void)({ id: "agent_run_late", status: "running" });
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 4_000 });
    expect(pi.sent[0].message.details).toMatchObject({ attemptId, runId: "agent_run_late", outcome: "completed" });
    const record = await pi.record(cycleId, projectId);
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0].result).toMatchObject({ remoteId: "agent_run_late", terminal: true });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a terminal outcome reported by an explicit recover so a later resume never reports it again", async () => {
    const pi = await host();
    offlineGet.mockRejectedValueOnce(Object.assign(new Error("404"), { statusCode: 404 }));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(
      async () =>
        expect(monitorOf(await pi.record(cycleId, projectId), attemptId)).toMatchObject({ reason: "NOT_FOUND" }),
      { timeout: 3_000 },
    );
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const recovered = await pi.call("web_research_exa", { researchMode: "recover", cycleId, attemptId });
    expect(recovered.details.inspectionOnly).toBe(true);
    expect(monitorOf(await pi.record(cycleId, projectId), attemptId)).toMatchObject({
      state: "stopped",
      notice: { state: "acknowledged", channel: "tool-result" },
    });
    const status = await pi.call("exa_research_status", { cycleId });
    expect(String(status.details.nextSafeAction)).not.toContain("Background monitoring is paused");
    const resumed = await pi.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([]);
    expect(pi.sent).toHaveLength(0);
  });

  it("does not notify on resume for a run that was already terminal when acknowledged", async () => {
    const pi = await host();
    offlineCreate.mockResolvedValueOnce(completedRun("agent_run_fast"));
    const { cycleId, result } = await submitted(pi);
    expect(result.details).toMatchObject({ monitoring: "terminal", remoteStatus: "completed" });
    await pi.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([]);
    expect(restarted.sent).toHaveLength(0);
  });

  it("keeps the possible-duplicate label on an uncertain notice when the first re-send fails", async () => {
    const pi = await host();
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });
    await vi.waitFor(async () =>
      expect(monitorOf(await pi.record(cycleId, projectId), attemptId)?.notice).toMatchObject({ state: "sent" }),
    );
    pi.entries.splice(0);
    await pi.emit("session_shutdown", { reason: "quit" });
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    restarted.sendMessage.mockImplementationOnce(() => {
      throw new Error("This extension ctx is stale after session replacement or reload.");
    });
    const first = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(first.details.resumedMonitoring).toEqual([{ attemptId, action: "notice pending" }]);
    expect(monitorOf(await restarted.record(cycleId, projectId), attemptId)?.notice).toMatchObject({
      state: "pending",
      possibleDuplicate: true,
    });
    const second = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(second.details.resumedMonitoring).toEqual([{ attemptId, action: "notice re-sent" }]);
    expect(restarted.sent.at(-1)?.message.details).toMatchObject({ possibleDuplicate: true });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps monitoring through a vetoed session switch", async () => {
    const pi = await host();
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    // Another extension cancels the switch: no detach event follows, so monitoring continues.
    await pi.emit("session_before_switch", { reason: "resume" });
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });
    expect(monitorOf(await pi.record(cycleId, projectId), attemptId)).toMatchObject({ state: "stopped" });
  });

  it("notifies on resume a terminal late acknowledgement that arrived after the cycle detached", async () => {
    const pi = await host({ submitTimeoutMs: 1_500 });
    let releaseCreate: ((run: AgentRun) => void) | undefined;
    offlineCreate.mockImplementationOnce(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const { cycleId, projectId, result, attemptId } = await submitted(pi);
    expect(result.content[0].text).toContain("SUBMISSION_UNKNOWN");
    await pi.emit("session_shutdown", { reason: "quit" });
    // The genuine acknowledgement lands after detach, already terminal: facts persist, no monitor record.
    (releaseCreate as (run: AgentRun) => void)(completedRun("agent_run_after_detach"));
    await vi.waitFor(
      async () => expect((await pi.record(cycleId, projectId)).attempts[0].result?.terminal).toBe(true),
      { timeout: 4_000 },
    );
    expect(monitorOf(await pi.record(cycleId, projectId), attemptId)).toBeUndefined();
    const restarted = await host({ directory: pi.directory, sessionId: "session-one" });
    const resumed = await restarted.call("exa_research_status", { action: "resume", cycleId });
    expect(resumed.details.resumedMonitoring).toEqual([{ attemptId, action: "notice delivered" }]);
    expect(restarted.sent).toHaveLength(1);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("summarizes other sessions' undelivered notices at start without delivering them", async () => {
    const pi = await host({ sessionId: "session-origin" });
    offlineGet.mockResolvedValue(completedRun("agent_run_pending"));
    const { cycleId, projectId, attemptId } = await submitted(pi);
    await vi.waitFor(() => expect(pi.sent).toHaveLength(1), { timeout: 3_000 });
    await vi.waitFor(async () =>
      expect(monitorOf(await pi.record(cycleId, projectId), attemptId)?.notice).toMatchObject({ state: "sent" }),
    );
    pi.entries.splice(0);
    await pi.emit("session_shutdown", { reason: "quit" });
    // The origin restarts once (notice becomes uncertain) and then never returns.
    await (await host({ directory: pi.directory, sessionId: "session-origin" })).emit("session_shutdown", {
      reason: "quit",
    });
    const other = await host({ directory: pi.directory, sessionId: "session-other" });
    expect(other.notify).toHaveBeenCalledWith(expect.stringContaining("from other sessions"), "warning");
    expect(other.notify).toHaveBeenCalledWith(expect.stringContaining(cycleId), "warning");
    expect(other.sent).toHaveLength(0);
  });
});

/**
 * #171 runnable experiment: the guided background research prototype driven
 * through a real Pi 1.x SDK session with a scripted model and a mocked Exa job.
 *
 * Evidence for PRD-010 v1.3 design gates, not production qualification. The
 * capability write-up lives in docs/research/2026-10-12-pi-guided-background-host-capabilities.md.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createMockExa, type MockExa } from "./fixtures/guided-prototype/mock-exa.js";
import {
  COMPLETION_CUSTOM_TYPE,
  createGuidedPrototype,
  type GuidedPrototype,
  type MonitorBounds,
  type PrototypeStore,
} from "./fixtures/guided-prototype/prototype.js";

const FAST_BOUNDS: MonitorBounds = {
  createWaitMs: 150,
  getDeadlineMs: 200,
  initialDelayMs: 20,
  backoffFactor: 1.5,
  maxDelayMs: 60,
  jitterRatio: 0,
  maxConsecutiveTransientErrors: 3,
  maxSilenceMs: 10_000,
  maxMonitorMs: 60_000,
  approvalTimeoutMs: 1_000,
};

const directories: string[] = [];
const sessions: AgentSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) session.dispose();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function uiContext(
  confirm: (title: string, message: string) => Promise<boolean>,
  confirms: string[],
): ExtensionUIContext {
  const noop = () => {};
  return {
    select: async () => undefined,
    confirm: async (title: string, message: string) => {
      confirms.push(message);
      return confirm(title, message);
    },
    input: async () => undefined,
    editor: async () => undefined,
    notify: noop,
    onTerminalInput: () => noop,
    setStatus: noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    custom: async () => undefined,
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => "",
  } as unknown as ExtensionUIContext;
}

type Step = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0][number];

const proposeCall = () =>
  fauxAssistantMessage(fauxToolCall("exa_proto_research", { action: "propose", topic: "Laya versus Jev" }), {
    stopReason: "toolUse",
  });
const submitLatestProposal = (context: TranscriptContext) => {
  const last = context.messages.at(-1) as { content?: unknown } | undefined;
  const proposalId = /\(([0-9a-f]{16})\)/.exec(JSON.stringify(last?.content ?? ""))?.[1] ?? "missing";
  return fauxAssistantMessage(fauxToolCall("exa_proto_research", { action: "submit", proposalId }), {
    stopReason: "toolUse",
  });
};
const say = (text: string) => fauxAssistantMessage(text);

interface HostOptions {
  ui?: "approve" | "decline" | "none";
  bounds?: Partial<MonitorBounds>;
  exa?: MockExa;
  root?: string;
  responses: Step[];
}

async function host(options: HostOptions) {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "exa-guided-proto-")));
  if (!options.root) directories.push(root);
  const exa = options.exa ?? createMockExa();
  const faux = fauxProvider({ provider: "exa-proto", models: [{ id: "scripted" }] });
  faux.setResponses(options.responses);
  let prototype: GuidedPrototype | undefined;
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, "agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    extensionFactories: [
      { name: "faux", factory: (pi) => pi.registerProvider(faux.provider) },
      {
        name: "guided-prototype",
        factory: (pi) => {
          prototype = createGuidedPrototype(pi, {
            exa,
            stateFile: join(root, "agent", "research-cycles-prototype", "state.json"),
            bounds: { ...FAST_BOUNDS, ...options.bounds },
          });
        },
      },
    ],
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.create(root, join(root, "sessions"));
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, "agent"),
    resourceLoader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    model: faux.getModel(),
    thinkingLevel: "off",
    noTools: "builtin",
  });
  sessions.push(session);
  const confirms: string[] = [];
  const settled: boolean[] = [];
  const assistantTexts: string[] = [];
  const customMessages: unknown[] = [];
  session.subscribe((event) => {
    if (event.type === "agent_settled") settled.push(event.aborted);
    if (event.type === "message_end" && event.message.role === "assistant")
      assistantTexts.push(JSON.stringify(event.message.content));
    if (event.type === "message_end" && event.message.role === "custom") customMessages.push(event.message);
  });
  const ui = options.ui ?? "approve";
  await session.bindExtensions({
    mode: ui === "none" ? "print" : "rpc",
    ...(ui === "none" ? {} : { uiContext: uiContext(async () => ui === "approve", confirms) }),
  });
  if (!prototype) throw new Error("prototype did not load");
  const events = () => (prototype as GuidedPrototype).observed.map((entry) => entry.event);
  const waitFor = (predicate: () => boolean, ms = 5_000) =>
    new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > ms) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting; observed: ${events().join(", ")}`));
        }
      }, 10);
    });
  const store = async () =>
    JSON.parse(await readFile((prototype as GuidedPrototype).stateFile, "utf8")) as PrototypeStore;
  return {
    root,
    exa,
    faux,
    session,
    sessionManager,
    prototype,
    confirms,
    settled,
    assistantTexts,
    customMessages,
    events,
    waitFor,
    store,
    toolResults: () =>
      sessionManager
        .getEntries()
        .flatMap((entry) =>
          entry.type === "message" && entry.message.role === "toolResult"
            ? [JSON.stringify((entry.message as { content: unknown }).content)]
            : [],
        ),
    completionEntries: () =>
      sessionManager
        .getEntries()
        .filter((entry) => entry.type === "custom_message" && entry.customType === COMPLETION_CUSTOM_TYPE),
  };
}

describe("guided background research prototype (Pi 1.x SDK session, mocked Exa)", () => {
  it("approves through the trusted dialog, returns the saved run ID while pending, survives an intervening turn and delivers one completion notice", async () => {
    const h = await host({
      responses: [
        proposeCall(),
        submitLatestProposal,
        say("Research started; keep chatting."),
        say("Chatting."),
        say("Report."),
      ],
    });
    await h.session.prompt("research Laya versus Jev");
    expect(h.confirms).toHaveLength(1);
    expect(h.confirms[0]).toContain("Laya versus Jev");
    expect(h.confirms[0]).toContain("Estimated cost: $0.10");
    expect(h.exa.counters.create).toBe(1);
    expect(h.exa.runs.get("run_1")?.status).toBe("running");
    const ack = h.toolResults().at(-1) ?? "";
    expect(ack).toContain("Research started: run_1");
    expect(ack).toContain("monitoring is registered");
    expect(h.events()).toEqual(
      expect.arrayContaining([
        "intent_persisted:attempt_1",
        "acknowledged:attempt_1:run_1",
        "monitor_registered:attempt_1",
      ]),
    );
    // An intervening user turn while the mock job is still pending.
    await h.session.prompt("something unrelated");
    expect(h.exa.runs.get("run_1")?.status).toBe("running");
    expect(h.customMessages).toHaveLength(0);
    await h.waitFor(() => (h.exa.counters.get ?? 0) >= 2);
    // Terminal transition → persisted outcome → durable notice → wakeup → acknowledgement.
    h.exa.complete("run_1", { winner: "neither; depends on the task" });
    await h.waitFor(() => h.events().includes("notice_acknowledged:notice_attempt_1"));
    const events = h.events();
    expect(events.indexOf("outcome_persisted:attempt_1:completed")).toBeLessThan(
      events.indexOf("notice_pending:notice_attempt_1"),
    );
    expect(events.indexOf("notice_pending:notice_attempt_1")).toBeLessThan(
      events.indexOf("notice_sent:notice_attempt_1"),
    );
    expect(h.completionEntries()).toHaveLength(1);
    expect(h.session.getLastAssistantText()).toBe("Report.");
    const store = await h.store();
    const attempt = store.attempts[0];
    expect(attempt.state).toBe("acknowledged");
    expect(attempt.outcome?.status).toBe("completed");
    expect(attempt.outcome?.costDollars).toBe(0.1);
    expect(attempt.notice).toMatchObject({ state: "acknowledged", acknowledgedEntryId: h.completionEntries()[0]?.id });
    expect(attempt.monitor.state).toBe("stopped");
    expect(h.exa.counters.cancel).toBe(0);
    expect(h.exa.counters.create).toBe(1);
    expect(h.settled).toEqual([false, false, false]);
    // The persisted session file carries the notice as a custom_message entry.
    const file = h.sessionManager.getSessionFile();
    expect(file).toBeDefined();
    expect(await readFile(file as string, "utf8")).toContain(`"customType":"${COMPLETION_CUSTOM_TYPE}"`);
  });

  it("fails closed without a trusted confirmation surface", async () => {
    const h = await host({ ui: "none", responses: [proposeCall(), submitLatestProposal, say("Paused.")] });
    await h.session.prompt("research Laya versus Jev");
    expect(h.events()).toContain("session_start:startup:hasUI=false:mode=print");
    expect(h.toolResults().at(-1)).toContain("APPROVAL_UNAVAILABLE");
    expect(h.exa.counters.create).toBe(0);
    expect((await h.store()).attempts).toHaveLength(0);
  });

  it("a declined dialog submits nothing and leaves the proposal open", async () => {
    const h = await host({ ui: "decline", responses: [proposeCall(), submitLatestProposal, say("Declined.")] });
    await h.session.prompt("research Laya versus Jev");
    expect(h.confirms).toHaveLength(1);
    expect(h.toolResults().at(-1)).toContain("APPROVAL_NOT_GRANTED");
    expect(h.exa.counters.create).toBe(0);
    const store = await h.store();
    expect(store.attempts).toHaveLength(0);
    expect(store.proposals[0].superseded).toBe(false);
    expect(store.proposals[0].consumedByAttemptId).toBeUndefined();
  });

  it("a superseded proposal cannot be submitted with the old approval target", async () => {
    let firstProposalId = "";
    const h = await host({
      responses: [
        proposeCall(),
        (context: TranscriptContext) => {
          const last = context.messages.at(-1) as { content?: unknown } | undefined;
          firstProposalId = /\(([0-9a-f]{16})\)/.exec(JSON.stringify(last?.content ?? ""))?.[1] ?? "";
          return fauxAssistantMessage(
            fauxToolCall("exa_proto_research", { action: "propose", topic: "Laya versus Jev", effort: "high" }),
            { stopReason: "toolUse" },
          );
        },
        () =>
          fauxAssistantMessage(fauxToolCall("exa_proto_research", { action: "submit", proposalId: firstProposalId }), {
            stopReason: "toolUse",
          }),
        say("Stale."),
      ],
    });
    await h.session.prompt("research Laya versus Jev, then make it thorough");
    expect(h.confirms).toHaveLength(0);
    expect(h.toolResults().at(-1)).toContain("PROPOSAL_STALE");
    expect(h.exa.counters.create).toBe(0);
  });

  it("queues a completion that lands during an active response until the turn settles", async () => {
    let releaseSlowTurn: (() => void) | undefined;
    const slowTurn = new Promise<void>((resolve) => {
      releaseSlowTurn = resolve;
    });
    const h = await host({
      responses: [
        proposeCall(),
        submitLatestProposal,
        say("Started."),
        async () => {
          await slowTurn;
          return say("Long answer finished.");
        },
        say("Report."),
      ],
    });
    await h.session.prompt("research Laya versus Jev");
    const streaming = h.session.prompt("tell me something long");
    await h.waitFor(() => h.exa.counters.get >= 1);
    h.exa.complete("run_1");
    await h.waitFor(() => h.events().includes("notice_sent:notice_attempt_1"));
    // The notice was sent while the assistant was still streaming: nothing appended yet.
    expect(h.customMessages).toHaveLength(0);
    expect(h.completionEntries()).toHaveLength(0);
    (releaseSlowTurn as () => void)();
    await streaming;
    await h.waitFor(() => h.events().includes("notice_acknowledged:notice_attempt_1"));
    const roles = h.sessionManager
      .getEntries()
      .map((entry) =>
        entry.type === "message" ? entry.message.role : entry.type === "custom_message" ? entry.customType : entry.type,
      );
    const longAnswer = roles.lastIndexOf("assistant", roles.indexOf(COMPLETION_CUSTOM_TYPE));
    expect(longAnswer).toBeGreaterThan(-1);
    expect(roles.indexOf(COMPLETION_CUSTOM_TYPE)).toBeGreaterThan(longAnswer);
    expect(h.completionEntries()).toHaveLength(1);
    // A later explicit observation of the same terminal run creates no second notice.
    expect(h.events().filter((event) => event.startsWith("notice_pending"))).toHaveLength(1);
    expect(h.session.getLastAssistantText()).toBe("Report.");
  });

  it("aborting the chat turn neither cancels the saved run nor lets the monitor create anything", async () => {
    let releaseSlowTurn: (() => void) | undefined;
    const slowTurn = new Promise<void>((resolve) => {
      releaseSlowTurn = resolve;
    });
    const h = await host({
      responses: [
        proposeCall(),
        submitLatestProposal,
        say("Started."),
        async () => {
          await slowTurn;
          return say("never shown");
        },
        say("Report."),
      ],
    });
    await h.session.prompt("research Laya versus Jev");
    const streaming = h.session.prompt("tell me something long");
    await h.waitFor(() => h.exa.counters.get >= 1);
    // The scripted stream ignores the abort signal until its factory resolves, so
    // release it while abort() waits for the session to become idle.
    const aborting = h.session.abort();
    (releaseSlowTurn as () => void)();
    await aborting;
    await streaming;
    expect(h.settled.at(-1)).toBe(true);
    expect(h.exa.counters.cancel).toBe(0);
    expect(h.exa.runs.get("run_1")?.status).toBe("running");
    h.exa.complete("run_1");
    await h.waitFor(() => h.events().includes("notice_acknowledged:notice_attempt_1"));
    expect(h.exa.counters.create).toBe(1);
    expect(h.session.getLastAssistantText()).toBe("Report.");
  });

  it("backs off transient GET errors and pauses when they are exhausted without fabricating remote failure", async () => {
    const h = await host({ responses: [proposeCall(), submitLatestProposal, say("Started.")] });
    await h.session.prompt("research Laya versus Jev");
    await h.waitFor(() => h.exa.counters.get >= 1);
    h.exa.failNextGets("run_1", [503, 503]);
    await h.waitFor(() => h.events().filter((event) => event.startsWith("get_failed")).length === 2);
    await h.waitFor(() => h.events().filter((event) => event.startsWith("get_ok")).length >= 3);
    let store = await h.store();
    expect(store.attempts[0].monitor.state).toMatch(/registered|running/);
    expect(store.attempts[0].monitor.consecutiveTransientErrors).toBe(0);
    h.exa.failNextGets("run_1", [503, 503, 503]);
    await h.waitFor(() => h.events().includes("monitor_paused:attempt_1:TRANSIENT_EXHAUSTED"));
    store = await h.store();
    expect(store.attempts[0].monitor).toMatchObject({ state: "paused", reason: "TRANSIENT_EXHAUSTED" });
    expect(store.attempts[0].remote?.status).toBe("running");
    expect(store.attempts[0].outcome).toBeUndefined();
    expect(store.attempts[0].notice).toBeUndefined();
    expect(h.prototype.activeTimers()).toBe(0);
    expect(h.exa.counters.create).toBe(1);
    // Gaps between checks grow (x1.5 up to the 60 ms test cap) instead of polling at a fixed rate.
    const checks = h.prototype.observed.filter((entry) => entry.event.startsWith("get_")).map((entry) => entry.at);
    expect(checks.length).toBeGreaterThanOrEqual(8);
    const gaps = checks.slice(1).map((at, index) => at - checks[index]);
    expect(Math.max(...gaps.slice(-3))).toBeGreaterThan(Math.min(...gaps.slice(0, 2)));
  });

  it("pauses immediately on authentication and not-found errors", async () => {
    const h = await host({ responses: [proposeCall(), submitLatestProposal, say("Started.")] });
    await h.session.prompt("research Laya versus Jev");
    h.exa.failNextGets("run_1", [401]);
    await h.waitFor(() => h.events().includes("monitor_paused:attempt_1:AUTH"));
    expect((await h.store()).attempts[0].remote?.status).toBe("running");

    const lost = await host({ responses: [proposeCall(), submitLatestProposal, say("Started.")] });
    await lost.session.prompt("research Laya versus Jev");
    lost.exa.lose("run_1");
    await lost.waitFor(() => lost.events().includes("monitor_paused:attempt_1:NOT_FOUND"));
    expect((await lost.store()).attempts[0].outcome).toBeUndefined();
    expect(lost.exa.counters.cancel + h.exa.counters.cancel).toBe(0);
  });

  it("keeps an unacknowledged create unknown and saves a genuine late run ID without resubmitting", async () => {
    const h = await host({
      exa: createMockExa({ holdCreate: true }),
      responses: [proposeCall(), submitLatestProposal, say("Unknown.")],
    });
    await h.session.prompt("research Laya versus Jev");
    expect(h.toolResults().at(-1)).toContain("SUBMISSION_UNKNOWN");
    let store = await h.store();
    expect(store.attempts[0].state).toBe("unknown");
    expect(store.attempts[0].runId).toBeUndefined();
    expect(h.exa.counters.create).toBe(1);
    h.exa.releaseCreate();
    await h.waitFor(() => h.events().includes("late_ack:attempt_1:run_1"));
    store = await h.store();
    expect(store.attempts[0]).toMatchObject({ state: "acknowledged", runId: "run_1" });
    expect(store.attempts[0].monitor).toMatchObject({ state: "paused", reason: "LATE_ACKNOWLEDGEMENT" });
    expect(h.exa.counters.create).toBe(1);
  });

  it("fences delivery after the runtime is invalidated and never redirects a pending notice to another session", async () => {
    const exa = createMockExa();
    const h = await host({ exa, responses: [proposeCall(), submitLatestProposal, say("Started.")] });
    await h.session.prompt("research Laya versus Jev");
    await h.waitFor(() => exa.counters.get >= 1);
    // SDK dispose invalidates the runtime without a session_shutdown event, so the
    // monitor timer is still alive: its delivery must fail closed.
    h.session.dispose();
    exa.complete("run_1");
    await h.waitFor(() => h.events().includes("notice_delivery_failed:notice_attempt_1"));
    let store = await h.store();
    expect(store.attempts[0].notice).toMatchObject({ state: "pending" });
    expect(store.attempts[0].notice?.deliveryError).toContain("stale");
    expect(store.attempts[0].outcome?.status).toBe("completed");
    // A different session on the same store discovers the foreign pending notice but does not deliver it.
    const other = await host({ exa, root: h.root, responses: [say("Hello.")] });
    expect(other.sessionManager.getSessionId()).not.toBe(h.sessionManager.getSessionId());
    expect(other.events()).toContain("pending_notice_discovered:notice_attempt_1:foreign");
    await other.session.prompt("hello");
    expect(other.completionEntries()).toHaveLength(0);
    store = await other.store();
    expect(store.attempts[0].notice?.state).toBe("pending");
    expect(store.attempts[0].originSessionId).toBe(h.sessionManager.getSessionId());
    expect(exa.counters.create).toBe(1);
  });
});

/**
 * #172 regressions: guided research from request through approved submission on
 * the real registered Pi extension, real private filesystem controller and a
 * mocked Exa SDK. Approval comes only from the host confirmation dialog.
 */

import * as nativeFs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import type { AgentRun } from "exa-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import exaExtension from "../extensions/index.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof nativeFs>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});

const offlineSearch = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(async () => ({
    results: [{ id: "https://example.com/pricing", url: "https://example.com/pricing", title: "Pricing" }],
    costDollars: { total: 0.005 },
    requestId: "offline",
  })),
);
const offlineCreate = vi.hoisted(() =>
  vi.fn<(params: unknown) => Promise<AgentRun>>(async () => ({ id: "agent_run_pending", status: "running" })),
);
const offlineGet = vi.hoisted(() => vi.fn<(runId: string) => Promise<AgentRun>>());
const offlineCancel = vi.hoisted(() => vi.fn<(runId: string) => Promise<AgentRun>>());
vi.mock("exa-js", () => ({
  Exa: class {
    search = (...args: unknown[]) => offlineSearch(...args);
    getContents = (...args: unknown[]) => offlineSearch(...args);
    findSimilar = (...args: unknown[]) => offlineSearch(...args);
    answer = (...args: unknown[]) => offlineSearch(...args);
    agent = { runs: { create: offlineCreate, get: offlineGet, cancel: offlineCancel } };
  },
}));

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(nativeFs.renameSync).mockReset();
  offlineSearch.mockReset().mockResolvedValue({
    results: [{ id: "https://example.com/pricing", url: "https://example.com/pricing", title: "Pricing" }],
    costDollars: { total: 0.005 },
    requestId: "offline",
  });
  offlineCreate.mockReset().mockResolvedValue({ id: "agent_run_pending", status: "running" });
  offlineGet.mockReset();
  offlineCancel.mockReset();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface HostOptions {
  ui?: "approve" | "decline" | "none";
  submitTimeoutMs?: number;
  sessionId?: string;
  directory?: string;
}

async function host(options: HostOptions = {}) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "exa-guided-submission-")));
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
        "web_search_exa",
        "web_research_exa",
      ],
      apiKey: "offline-fixture-key",
    }),
  );
  const tools = new Map<string, Parameters<PiToolRegistration["registerTool"]>[0]>();
  const handlers = new Map<string, (event: never, context: ExtensionContext) => Promise<void>>();
  const commands = new Map<string, { handler: (args: string, context: ExtensionContext) => Promise<void> }>();
  const notify = vi.fn();
  const confirms: Array<{ title: string; message: string; options?: { timeout?: number } }> = [];
  const ui = options.ui ?? "approve";
  const confirm = vi.fn(async (title: string, message: string, dialogOptions?: { timeout?: number }) => {
    confirms.push({ title, message, options: dialogOptions });
    return ui === "approve";
  });
  const context = {
    cwd: directory,
    hasUI: ui !== "none",
    mode: ui === "none" ? "print" : "tui",
    signal: undefined,
    sessionManager: { getSessionId: () => options.sessionId ?? "session-one" },
    ui: { notify, confirm },
  } as unknown as ExtensionToolContext;
  const pi = {
    registerFlag: vi.fn(),
    getFlag: (name: string) =>
      name === "exa-enable-cycles"
        ? true
        : name === "--exa-config-file"
          ? config
          : name === "--exa-submit-timeout-ms" && options.submitTimeoutMs !== undefined
            ? String(options.submitTimeoutMs)
            : undefined,
    registerTool: (tool: Parameters<PiToolRegistration["registerTool"]>[0]) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: { handler: (args: string, context: ExtensionContext) => Promise<void> }) =>
      commands.set(name, command),
    on: (event: string, handler: (event: never, context: ExtensionContext) => Promise<void>) =>
      handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  exaExtension(pi);
  await handlers.get("session_start")?.({} as never, context);
  const call = (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.execute("call", args, undefined, undefined, context);
  };
  const recordPath = async (cycleId: string, projectId: string) =>
    join(directory, "agent", "research-cycles", projectId, `${cycleId}.json`);
  return { directory, tools, context, notify, confirm, confirms, commands, call, recordPath };
}

type Host = Awaited<ReturnType<typeof host>>;

/** Start a guided cycle conversationally and record a submittable plan. */
async function readyCycle(pi: Host) {
  const started = await pi.call("exa_research_status", { action: "start", topic: "Laya versus Jev" });
  expect(started.isError).toBe(false);
  const cycleId = String(started.details.id);
  const projectId = String(started.details.projectId);
  const step = await pi.call("exa_research_step", {
    topic: "Laya versus Jev",
    stage: "framing",
    note: "guided draft",
    thought_number: 1,
    total_thoughts: 2,
    next_step_needed: true,
    criteria: [{ id: "C1", label: "Decision quality on classification tasks", status: "proposed" }],
    assumptions: ["Only public documentation counts"],
    gaps: [
      { id: "G1", description: "No pricing comparison yet", severity: "important", resolution: "carry_assumption" },
    ],
    executionPlan: {
      goal: "Compare Laya and Jev for small structured decisions",
      scope: ["public docs", "pricing pages"],
      constraints: ["exclude marketing claims"],
      taskSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { summary: { type: "string" }, winner: { type: "string" } },
        required: ["summary"],
      },
      controls: { effort: "medium" },
    },
  });
  expect(step.isError).toBe(false);
  return { cycleId, projectId };
}

async function propose(pi: Host, cycleId: string) {
  const proposal = await pi.call("exa_research_summary", { mode: "proposal", cycleId });
  expect(proposal.isError).toBe(false);
  return proposal.details as {
    proposalId: string;
    revision: number;
    artifactHash: string;
    requestHash: string;
    estimate: { dollars: number | null; basis: string };
    approval?: { allowanceDollars: number; ceilingDollars: number; tools: string[] };
    proposal: string;
    spending: boolean;
  };
}

describe("guided research from request through approved submission", () => {
  it("creates a non-spending draft, renders a readable proposal, approves through the host dialog and returns the pending run ID", async () => {
    const pi = await host();
    const { cycleId, projectId } = await readyCycle(pi);
    expect(offlineSearch).not.toHaveBeenCalled();
    const proposal = await propose(pi, cycleId);
    expect(proposal.spending).toBe(false);
    expect(proposal.proposalId).toMatch(/^[0-9a-f]{16}$/);
    expect(proposal.estimate).toMatchObject({ dollars: 0.1 });
    expect(proposal.approval).toMatchObject({
      allowanceDollars: 0.1,
      ceilingDollars: 0.1,
      tools: ["web_research_exa"],
    });
    for (const fragment of [
      "Compare Laya and Jev",
      "Scope: public docs; pricing pages",
      "exclude marketing claims",
      "C1 Decision quality",
      "Only public documentation counts",
      "G1 No pricing comparison yet",
      "Effort: medium",
      "Estimated cost: $0.10",
      "Lifetime allowance after approval: $0.10",
      "Existing liabilities: reported $0.00",
      "not vendor-enforced",
      "exactly one Exa Agent run",
    ])
      expect(proposal.proposal).toContain(fragment);
    expect(offlineCreate).not.toHaveBeenCalled();

    const submitted = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(submitted.isError).toBe(false);
    expect(pi.confirms).toHaveLength(1);
    expect(pi.confirms[0].title).toBe("Approve Exa research spending?");
    expect(pi.confirms[0].message).toContain("Laya versus Jev");
    expect(pi.confirms[0].message).toContain("estimate $0.10");
    expect(pi.confirms[0].options).toMatchObject({ timeout: 600_000 });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: "medium",
        query: expect.stringContaining("Compare Laya and Jev"),
        metadata: { cycleId, revision: String(proposal.revision) },
      }),
    );
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
    expect(submitted.details).toMatchObject({
      cycleId,
      proposalId: proposal.proposalId,
      runId: "agent_run_pending",
      remoteStatus: "running",
      monitoring: "unavailable",
      status: "running",
      requestHash: proposal.requestHash,
      artifactHash: proposal.artifactHash,
    });
    expect(submitted.content[0].text).toContain("Research started: Exa run agent_run_pending");
    expect(submitted.content[0].text).toContain("monitoring is not available in this version");

    const record = JSON.parse(await readFile(await pi.recordPath(cycleId, projectId), "utf8"));
    expect(record.grants).toEqual([
      expect.objectContaining({
        kind: "exa-grant-v1",
        source: "dialog",
        tools: ["web_research_exa"],
        ceilingMicros: 100_000,
      }),
      expect.objectContaining({
        kind: "exa-uncertainty-v1",
        source: "dialog",
        targetType: "request",
        subjectId: proposal.requestHash,
        allowanceMicros: 100_000,
      }),
    ]);
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0]).toMatchObject({
      status: "running",
      result: { remoteId: "agent_run_pending", remoteStatus: "running" },
    });
    expect(record.status).toBe("running");

    const status = await pi.call("exa_research_status", { cycleId });
    expect(status.details.nextSafeAction).toContain("Existing local research remains live");
    // The approved request is consumed: a second submission is blocked without another create.
    const again = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(again.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale proposal after a plan edit before any dialog or create", async () => {
    const pi = await host();
    const { cycleId } = await readyCycle(pi);
    const stale = await propose(pi, cycleId);
    const edit = await pi.call("exa_research_step", {
      topic: "Laya versus Jev",
      stage: "framing",
      note: "narrow the scope",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      executionPlan: { scope: ["public docs only"] },
    });
    expect(edit.isError).toBe(false);
    const submitted = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: stale.proposalId,
    });
    expect(submitted.isError).toBe(true);
    expect(submitted.content[0].text).toContain("PROPOSAL_STALE");
    expect(pi.confirm).not.toHaveBeenCalled();
    expect(offlineCreate).not.toHaveBeenCalled();
    const fresh = await propose(pi, cycleId);
    expect(fresh.proposalId).not.toBe(stale.proposalId);
    expect(fresh.revision).toBeGreaterThan(stale.revision);
  });

  it("grants nothing when the dialog is declined or no trusted surface exists, and rejects forged approval inputs", async () => {
    const declined = await host({ ui: "decline" });
    const first = await readyCycle(declined);
    const proposal = await propose(declined, first.cycleId);
    const refused = await declined.call("web_research_exa", {
      researchMode: "submit",
      cycleId: first.cycleId,
      proposalId: proposal.proposalId,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("APPROVAL_NOT_GRANTED");
    expect(declined.confirms).toHaveLength(1);
    expect(offlineCreate).not.toHaveBeenCalled();
    let record = JSON.parse(await readFile(await declined.recordPath(first.cycleId, first.projectId), "utf8"));
    expect(record.grants).toEqual([]);
    expect(record.attempts).toEqual([]);
    // The proposal stays open: the same ID still matches.
    expect((await propose(declined, first.cycleId)).proposalId).toBe(proposal.proposalId);

    const headless = await host({ ui: "none" });
    const second = await readyCycle(headless);
    const headlessProposal = await propose(headless, second.cycleId);
    const paused = await headless.call("web_research_exa", {
      researchMode: "submit",
      cycleId: second.cycleId,
      proposalId: headlessProposal.proposalId,
    });
    expect(paused.isError).toBe(true);
    expect(paused.content[0].text).toContain("APPROVAL_UNAVAILABLE");
    expect(headless.confirm).not.toHaveBeenCalled();
    expect(offlineCreate).not.toHaveBeenCalled();
    record = JSON.parse(await readFile(await headless.recordPath(second.cycleId, second.projectId), "utf8"));
    expect(record.grants).toEqual([]);

    // Assistant-written request fields or approval-looking parameters cannot replace the dialog.
    const forged = await headless.call("web_research_exa", {
      researchMode: "submit",
      cycleId: second.cycleId,
      proposalId: headlessProposal.proposalId,
      effort: "medium",
    });
    expect(forged.isError).toBe(true);
    expect(forged.content[0].text).toContain("EXECUTION_CONFLICT");
    const unknownProposal = await headless.call("web_research_exa", {
      researchMode: "submit",
      cycleId: second.cycleId,
      proposalId: "0000000000000000",
    });
    expect(unknownProposal.content[0].text).toContain("PROPOSAL_STALE");
    const activeWithProposal = await headless.call("web_research_exa", {
      researchMode: "active",
      cycleId: second.cycleId,
      proposalId: headlessProposal.proposalId,
    });
    expect(activeWithProposal.isError).toBe(true);
    expect(activeWithProposal.content[0].text).toContain("proposalId is only valid with researchMode=submit");
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it("does not submit when the approved intent cannot be published durably", async () => {
    const pi = await host();
    const { cycleId, projectId } = await readyCycle(pi);
    const proposal = await propose(pi, cycleId);
    // The dialog approval publishes first (one atomic write); the frozen intent publication fails.
    const original = vi.mocked(nativeFs.renameSync).getMockImplementation();
    vi.mocked(nativeFs.renameSync)
      .mockImplementationOnce((from, to) => (original as typeof nativeFs.renameSync)(from, to))
      .mockImplementationOnce(() => {
        throw new Error("EIO: simulated publication failure");
      });
    const submitted = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(submitted.isError).toBe(true);
    expect(submitted.content[0].text).toContain("EIO");
    expect(pi.confirms).toHaveLength(1);
    expect(offlineCreate).not.toHaveBeenCalled();
    const record = JSON.parse(await readFile(await pi.recordPath(cycleId, projectId), "utf8"));
    // Both approval records landed together; no half-approval and no attempt.
    expect(record.grants).toHaveLength(2);
    expect(record.attempts).toEqual([]);
    expect(record.status).toBe("planning");
  });

  it("keeps an unacknowledged create unknown, saves a genuine late run ID on the original attempt and never resubmits", async () => {
    const pi = await host({ submitTimeoutMs: 100 });
    const { cycleId, projectId } = await readyCycle(pi);
    const proposal = await propose(pi, cycleId);
    let releaseCreate: ((run: AgentRun) => void) | undefined;
    offlineCreate.mockImplementationOnce(
      () =>
        new Promise<AgentRun>((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const submitted = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(submitted.isError).toBe(true);
    expect(submitted.content[0].text).toContain("SUBMISSION_UNKNOWN");
    expect(submitted.content[0].text).not.toContain("agent_run");
    expect(submitted.details).toMatchObject({ runId: null, state: "unknown" });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
    let record = JSON.parse(await readFile(await pi.recordPath(cycleId, projectId), "utf8"));
    expect(record.attempts[0]).toMatchObject({ status: "unknown" });
    expect(record.attempts[0].result).toBeUndefined();
    expect(record.status).toBe("unknown");
    // A genuine late acknowledgement settles the original attempt without a new create.
    (releaseCreate as (run: AgentRun) => void)({ id: "agent_run_late", status: "running" });
    await vi.waitFor(async () => {
      record = JSON.parse(await readFile(await pi.recordPath(cycleId, projectId), "utf8"));
      expect(record.attempts[0].result?.remoteId).toBe("agent_run_late");
    });
    expect(record.attempts[0].status).toBe("unknown");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    const retry = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(retry.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("discloses and approves optional exploratory retrieval through the dialog before dispatch", async () => {
    const pi = await host();
    const { cycleId, projectId } = await readyCycle(pi);
    const searched = await pi.call("web_search_exa", { query: "Laya vs Jev pricing", cycleId });
    expect(searched.isError).not.toBe(true);
    expect(pi.confirms).toHaveLength(1);
    expect(pi.confirms[0].title).toBe("Approve exploratory Exa retrieval?");
    expect(pi.confirms[0].message).toContain("web_search_exa");
    expect(pi.confirms[0].message).toContain("does not authorize Agent research");
    expect(offlineSearch).toHaveBeenCalledTimes(1);
    const record = JSON.parse(await readFile(await pi.recordPath(cycleId, projectId), "utf8"));
    expect(record.grants[0]).toMatchObject({ kind: "exa-grant-v1", source: "dialog", tools: ["web_search_exa"] });
    expect(record.candidates?.length ?? 0).toBeGreaterThan(0);
    // Agent research still needs its own proposal approval; the exploration grant does not cover it.
    const proposal = await propose(pi, cycleId);
    expect(proposal.approval?.tools).toEqual(["web_search_exa", "web_research_exa"]);
    expect(proposal.proposal).toContain("1 selected source(s)".replace("1 selected", "0 selected"));

    const declined = await host({ ui: "decline" });
    const other = await readyCycle(declined);
    const refused = await declined.call("web_search_exa", { query: "Laya vs Jev pricing", cycleId: other.cycleId });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("APPROVAL_NOT_GRANTED");
    expect(offlineSearch).toHaveBeenCalledTimes(1);
  });

  it("fails actionably instead of falling back to standalone when guided setup is missing", async () => {
    const pi = await host();
    const noCycle = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId: "missing",
      proposalId: "abc",
    });
    expect(noCycle.isError).toBe(true);
    expect(noCycle.content[0].text).toContain("No active research cycle");
    const { cycleId } = await readyCycle(pi);
    const noProposal = await pi.call("web_research_exa", { researchMode: "submit", cycleId });
    expect(noProposal.isError).toBe(true);
    expect(noProposal.content[0].text).toContain("PROPOSAL_REQUIRED");
    const noCycleId = await pi.call("web_research_exa", { researchMode: "submit", proposalId: "abc" });
    expect(noCycleId.isError).toBe(true);
    expect(noCycleId.content[0].text).toContain("requires the active cycleId");
    const bare = await pi.call("exa_research_status", { action: "start" });
    expect(bare.isError).toBe(true);
    expect(offlineCreate).not.toHaveBeenCalled();
    expect(offlineSearch).not.toHaveBeenCalled();
    // Explicit standalone work stays available and never touches the cycle.
    offlineCreate.mockResolvedValueOnce({
      id: "standalone_run",
      status: "completed",
      output: { text: "unrelated synthesis", structured: { summary: "unrelated" } },
    });
    const standalone = await pi.call("web_research_exa", { researchMode: "standalone", query: "unrelated" });
    expect(standalone.isError).not.toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
  });

  it("requires a derivable estimate before proposing metered auto effort", async () => {
    const pi = await host();
    const { cycleId } = await readyCycle(pi);
    await pi.call("exa_research_step", {
      topic: "Laya versus Jev",
      stage: "framing",
      note: "metered",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      executionPlan: { controls: { effort: "auto" } },
    });
    const proposal = await propose(pi, cycleId);
    expect(proposal.estimate.dollars).toBeNull();
    expect(proposal.approval).toBeUndefined();
    const submitted = await pi.call("web_research_exa", {
      researchMode: "submit",
      cycleId,
      proposalId: proposal.proposalId,
    });
    expect(submitted.isError).toBe(true);
    expect(submitted.content[0].text).toContain("ESTIMATE_UNAVAILABLE");
    expect(pi.confirm).not.toHaveBeenCalled();
    expect(offlineCreate).not.toHaveBeenCalled();
  });
});

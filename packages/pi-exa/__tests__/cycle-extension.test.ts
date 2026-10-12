import * as nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import type { AgentRun } from "exa-js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { cyclePiRegistration } from "../extensions/cycle-pi.js";
import exaExtension from "../extensions/index.js";
import { agentAttemptSchema } from "../extensions/research-execution.js";
import * as researchPlanner from "../extensions/research-planner.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, unlink: vi.fn(original.unlink), rename: vi.fn(original.rename) };
});
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof nativeFs>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});

const offlineSearch = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(async () => ({ results: [], requestId: "offline" })),
);
const offlineCreate = vi.hoisted(() =>
  vi.fn<(params: unknown) => Promise<AgentRun>>(async () => ({ id: "offline", status: "completed" })),
);
const offlineGet = vi.hoisted(() => vi.fn<(runId: string) => Promise<AgentRun>>());
const offlineCancel = vi.hoisted(() => vi.fn<(runId: string) => Promise<AgentRun>>());
const offlineEndpoints = vi.hoisted(() => ({
  search: vi.fn(),
  getContents: vi.fn(),
  findSimilar: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("exa-js", () => ({
  Exa: class {
    search = (...args: unknown[]) => {
      offlineEndpoints.search(...args);
      return offlineSearch(...args);
    };
    getContents = (...args: unknown[]) => {
      offlineEndpoints.getContents(...args);
      return offlineSearch(...args);
    };
    findSimilar = (...args: unknown[]) => {
      offlineEndpoints.findSimilar(...args);
      return offlineSearch(...args);
    };
    answer = (...args: unknown[]) => {
      offlineEndpoints.answer(...args);
      return offlineSearch(...args);
    };
    agent = { runs: { create: offlineCreate, get: offlineGet, cancel: offlineCancel } };
  },
}));

const directories: string[] = [];
const hostToolNames = [
  "exa_research_step",
  "exa_research_status",
  "exa_research_summary",
  "exa_research_reset",
  "web_search_exa",
  "web_search_advanced_exa",
  "web_fetch_exa",
  "web_find_similar_exa",
  "web_answer_exa",
  "web_research_exa",
];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(fs.unlink).mockReset();
  vi.mocked(fs.rename).mockReset();
  vi.mocked(nativeFs.renameSync).mockReset();
  offlineSearch.mockReset().mockResolvedValue({ results: [], requestId: "offline" });
  offlineCreate.mockReset().mockResolvedValue({ id: "offline", status: "completed" });
  offlineGet.mockReset();
  offlineCancel.mockReset();
  for (const endpoint of Object.values(offlineEndpoints)) endpoint.mockClear();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function host(enabled = true, timeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), "exa-cycle-host-"));
  directories.push(directory);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(directory, "agent"));
  const config = join(directory, "exa.json");
  await writeFile(
    config,
    JSON.stringify({
      enabledTools: hostToolNames,
      apiKey: "offline-fixture-key",
    }),
  );
  const tools = new Map<string, Parameters<PiToolRegistration["registerTool"]>[0]>();
  const handlers = new Map<string, (event: never, context: ExtensionContext) => Promise<void>>();
  const commands = new Map<
    string,
    { description?: string; handler: (args: string, context: ExtensionContext) => Promise<void> }
  >();
  const notify = vi.fn();
  const flags = vi.fn();
  // The trusted host dialog: approve by default; tests override per call.
  const confirm = vi.fn(async (_title: string, _message: string, _options?: { timeout?: number }) => true);
  const sendMessage = vi.fn();
  const entries: Array<{ type: string; id: string; customType?: string; details?: unknown }> = [];
  sendMessage.mockImplementation((message: { customType: string; details?: unknown }) => {
    entries.push({
      type: "custom_message",
      id: `entry-${entries.length + 1}`,
      customType: message.customType,
      details: message.details,
    });
  });
  const context = {
    cwd: directory,
    hasUI: true,
    mode: "tui",
    signal: undefined,
    sessionManager: { getSessionId: () => "session-one", getEntries: () => [...entries] },
    ui: { notify, confirm },
  } as unknown as ExtensionToolContext;
  const pi = {
    registerFlag: flags,
    sendMessage,
    getFlag: (name: string) =>
      name === "exa-enable-cycles"
        ? enabled
        : name === "exa-config-file"
          ? config
          : name === "exa-monitor-interval-ms"
            ? "20"
            : name === "exa-timeout-ms" && timeoutMs !== undefined
              ? String(timeoutMs)
              : undefined,
    registerTool: (tool: Parameters<PiToolRegistration["registerTool"]>[0]) => tools.set(tool.name, tool),
    registerCommand: (
      name: string,
      command: { description?: string; handler: (args: string, context: ExtensionContext) => Promise<void> },
    ) => commands.set(name, command),
    on: (event: string, handler: (event: never, context: ExtensionContext) => Promise<void>) =>
      handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  exaExtension(pi);
  await handlers.get("session_start")?.({} as never, context);
  const command = commands.get("exa-research");
  const call = (name: string, args = {}, signal?: AbortSignal) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.execute("call", args, signal, undefined, context);
  };
  return {
    tools,
    handlers,
    context,
    notify,
    flags,
    confirm,
    sendMessage,
    command,
    call,
    /** Guided submission: propose the current compiled request, then submit it through the dialog. */
    submit: async (cycleIdValue: unknown, signal?: AbortSignal) => {
      const cycleId = String(cycleIdValue);
      const proposal = await call("exa_research_summary", { mode: "proposal", cycleId });
      if (proposal.isError) return proposal;
      return call(
        "web_research_exa",
        { researchMode: "submit", cycleId, proposalId: proposal.details.proposalId },
        signal,
      );
    },
  };
}

describe("Pi standalone and cycle discovery availability", () => {
  it("keeps explicit standalone search available despite lost cycle ownership or a blocked store", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    const directory = join(pi.context.cwd, "agent", "research-cycles", String(status.projectId));
    const path = join(directory, `${status.id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.owner.token = "another-runtime";
    await writeFile(path, JSON.stringify(record));
    expect((await pi.call("web_search_exa", { query: "unrelated", researchMode: "standalone" })).isError).not.toBe(
      true,
    );
    await writeFile(join(directory, ".lock"), "", { mode: 0o600 });
    expect((await pi.call("web_search_exa", { query: "unrelated", researchMode: "standalone" })).isError).not.toBe(
      true,
    );
    expect(offlineSearch).toHaveBeenCalledTimes(2);
    expect(
      (await pi.call("web_search_exa", { query: "unrelated", researchMode: "standalone", cycleId: status.id })).isError,
    ).toBe(true);
    expect(offlineSearch).toHaveBeenCalledTimes(2);
  });

  it("lists readable cycles with coarse unreadable IDs without displaying malformed contents", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    const directory = join(pi.context.cwd, "agent", "research-cycles", String(status.projectId));
    const broken = "00000000-0000-4000-8000-000000000003";
    await pi.command?.handler("list", pi.context);
    expect(JSON.parse(pi.notify.mock.lastCall?.[0] ?? "null")).toEqual([expect.objectContaining({ id: status.id })]);
    await writeFile(join(directory, `${broken}.json`), "{SECRET_UNREADABLE_RECORD", { mode: 0o600 });
    await pi.command?.handler("list", pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining(broken), "info");
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining(String(status.id)), "info");
    expect(JSON.stringify(pi.notify.mock.calls.at(-1))).not.toContain("SECRET_UNREADABLE_RECORD");
    expect(JSON.parse(pi.notify.mock.lastCall?.[0] ?? "null")).toEqual([
      expect.objectContaining({ id: status.id }),
      { id: broken, unreadable: true },
    ]);
  });
});

describe("Pi cycle commands and tools", () => {
  it("qualifies a complete offline Pi cycle through curation, final gaps, restart and archival inspection", async () => {
    const pi = await host();
    await pi.command?.handler("start US pricing", pi.context);
    const initial = (await pi.call("exa_research_status")).details;
    const cycleId = initial.id;
    await pi.call("exa_research_step", {
      topic: "US pricing",
      stage: "framing",
      note: "PRIVATE_PLANNING_CHATTER",
      thought_number: 1,
      total_thoughts: 3,
      next_step_needed: true,
      criteria: [
        { id: "C1", label: "Regional caveats", status: "proposed" },
        { id: "C2", label: "Unsupported recorded claim", status: "supported" },
      ],
      gaps: [
        {
          id: "G1",
          description: "EU pricing remains outside the evidence",
          severity: "important",
          resolution: "carry_assumption",
        },
      ],
      assumptions: ["Prices may vary by region"],
      executionPlan: {
        goal: "Compare public US pricing",
        scope: ["US"],
        constraints: ["Primary sources"],
        taskSchema: {
          type: "object",
          required: ["summary", "claimsCriterionSatisfied"],
          properties: { summary: { type: "string" }, claimsCriterionSatisfied: { type: "boolean" } },
          additionalProperties: false,
        },
        input: { data: [{ region: "US" }], exclusion: [{ region: "EU" }] },
      },
    });
    pi.confirm.mockResolvedValueOnce(false);
    const deniedSearch = await pi.call("web_search_exa", { query: "official US pricing", cycleId });
    expect(deniedSearch.isError).toBe(true);
    expect(deniedSearch.content[0].text).toContain("APPROVAL_NOT_GRANTED");
    expect(offlineSearch).not.toHaveBeenCalled();
    await pi.command?.handler(`approve ${cycleId} 1 web_search_exa,web_research_exa`, pi.context);
    offlineSearch.mockResolvedValueOnce({
      requestId: "offline_discovery",
      costDollars: { total: 0.007 },
      results: [
        { id: "one", url: "https://example.com/pricing", title: "Official pricing", text: "RAW_PAGE_BODY_NOT_CURATED" },
        { id: "two", url: "https://example.com/unselected", title: "UNSELECTED_CANDIDATE" },
      ],
    });
    const searched = await pi.call("web_search_exa", { query: "official US pricing", cycleId });
    expect(searched.isError).not.toBe(true);
    const candidates = searched.details.candidates;
    if (!Array.isArray(candidates)) throw new Error("Missing captured candidates");
    const chosen = candidates.find((candidate) => candidate.url === "https://example.com/pricing");
    if (!chosen) throw new Error("Missing selected candidate");
    const uncurated = await pi.call("exa_research_summary");
    expect(JSON.stringify(uncurated.details)).not.toContain("https://example.com/pricing");
    const curated = await pi.call("exa_research_step", {
      topic: "US pricing",
      stage: "synthesis_plan",
      note: "PRIVATE_SECOND_STEP",
      thought_number: 2,
      total_thoughts: 3,
      next_step_needed: true,
      evidence: [
        { candidateId: chosen.id, decision: "select", label: "Official pricing", notes: "Curated regional table" },
      ],
      sources: [{ id: "external", title: "Explicit external observation", contentNotes: "External curated caveat" }],
    });
    expect(curated.isError, JSON.stringify(curated.content)).not.toBe(true);
    expect(
      (
        await pi.call("exa_research_step", {
          topic: "US pricing",
          stage: "synthesis_plan",
          note: "Keep source evidence separate from rows",
          thought_number: 3,
          total_thoughts: 3,
          next_step_needed: false,
          executionPlan: {
            selectedEvidence: [
              { sourceId: chosen.id, label: "Official pricing", notes: "Curated regional table" },
              { sourceId: "external", label: "External context" },
            ],
          },
        })
      ).isError,
    ).not.toBe(true);
    const preview = await pi.call("exa_research_summary");
    const artifact = preview.details.artifact;
    if (!artifact || typeof artifact !== "object" || !("hash" in artifact) || !("request" in artifact))
      throw new Error("Missing compiled preview");
    expect(JSON.stringify(artifact)).toContain("Curated regional table");
    expect(JSON.stringify(artifact)).toContain("External curated caveat");
    expect(JSON.stringify(artifact)).not.toMatch(
      /PRIVATE_PLANNING_CHATTER|PRIVATE_SECOND_STEP|RAW_PAGE_BODY_NOT_CURATED|UNSELECTED_CANDIDATE/,
    );
    const conflict = await pi.call("web_research_exa", { cycleId, query: "unapproved override" });
    expect(conflict.isError).toBe(true);
    const blockedActive = await pi.call("web_research_exa", { cycleId });
    expect(blockedActive.isError).toBe(true);
    expect(blockedActive.content[0].text).toContain("GUIDED_SUBMISSION_REQUIRED");
    expect(offlineCreate).not.toHaveBeenCalled();
    const completedReply = {
      id: "offline_full_cycle",
      status: "completed",
      stopReason: "budget_reached",
      costDollars: { total: 0.1 },
      usage: { searches: 2 },
      output: {
        structured: { summary: "US findings with unresolved regional caveats", claimsCriterionSatisfied: true },
      },
    } satisfies AgentRun;
    offlineCreate.mockResolvedValueOnce(completedReply);
    const completed = await pi.submit(cycleId);
    expect(completed.isError).toBe(false);
    // One declined exploration dialog, one approved submission dialog.
    expect(pi.confirm).toHaveBeenCalledTimes(2);
    expect(offlineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { data: [{ region: "US" }], exclusion: [{ region: "EU" }] },
        query: expect.stringContaining("Compare public US pricing"),
      }),
    );
    expect(completed.details.finalReport).toMatchObject({
      cycleId,
      status: "completed",
      automaticCriterionSatisfaction: false,
      criteriaRequiringReview: [
        expect.objectContaining({ id: "C1", status: "proposed" }),
        expect.objectContaining({
          id: "C2",
          status: "supported",
          evidenceIssues: ["Supported criterion has no evidence refs."],
        }),
      ],
      recordedGaps: [expect.objectContaining({ id: "G1", description: "EU pricing remains outside the evidence" })],
      usage: { reportedDollars: 0.107, pendingEstimatedDollars: 0, billingVerified: false },
      furtherResearchRequiresNewCycleAndOperatorPermission: true,
    });
    const report = await pi.call("exa_research_summary", { mode: "brief" });
    expect(report.details.finalReport).toEqual(completed.details.finalReport);
    expect(report.content[0]).toMatchObject({ text: expect.stringContaining("0.107") });
    const preserved = (await pi.call("exa_research_status")).details;
    expect(preserved.plan).toMatchObject({
      criteria: expect.arrayContaining([expect.objectContaining({ id: "C1", status: "proposed" })]),
    });
    expect((await pi.call("web_research_exa", { cycleId })).isError).toBe(true);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
    await pi.handlers.get("session_start")?.({} as never, pi.context);
    const discovery = await pi.call("exa_research_status");
    expect(discovery.details).toMatchObject({
      active: false,
      savedCycles: [expect.objectContaining({ id: cycleId, status: "completed" })],
    });
    await pi.command?.handler(`resume ${cycleId}`, pi.context);
    offlineGet.mockResolvedValueOnce(completedReply);
    expect((await pi.call("web_research_exa", { researchMode: "recover", cycleId })).isError).toBe(false);
    const archived = await pi.call("exa_research_reset");
    expect(archived.details).toMatchObject({ id: cycleId, archived: true, status: "completed" });
    await pi.command?.handler("list", pi.context);
    expect(JSON.parse(pi.notify.mock.lastCall?.[0] ?? "[]")).toEqual([
      expect.objectContaining({
        id: cycleId,
        archived: true,
        finalReport: expect.objectContaining({ recordedGaps: [expect.objectContaining({ id: "G1" })] }),
      }),
    ]);
    expect(offlineSearch).toHaveBeenCalledOnce();
    expect(offlineCreate).toHaveBeenCalledOnce();
    expect(offlineGet).toHaveBeenCalledExactlyOnceWith(completedReply.id);
    expect(offlineCancel).not.toHaveBeenCalled();
  }, 20000);

  it("adds complete assistant cycle guidance only to opted-in Pi tool registration without dispatch", async () => {
    const plain = await host(false);
    const pi = await host();
    expect([...plain.tools.keys()].sort()).toEqual([...hostToolNames].sort());
    expect([...pi.tools.keys()].sort()).toEqual([...hostToolNames].sort());
    for (const name of hostToolNames) {
      const original = plain.tools.get(name)?.promptGuidelines ?? [];
      expect(original.join("\n")).not.toContain("Integrated Pi cycle");
      const integrated = pi.tools.get(name)?.promptGuidelines ?? [];
      expect(integrated.slice(0, original.length)).toEqual(original);
      expect(integrated.length).toBeGreaterThan(original.length);
      const guidance = integrated.join("\n");
      expect(guidance).toContain("Integrated Pi cycle");
      expect(guidance).toMatch(/cycle-attributed work only/i);
      expect(guidance).toMatch(/standalone web tools remain available without a cycle/i);
      expect(guidance).toMatch(/unrelated requests use researchMode=standalone.*omit cycle references/i);
      expect(guidance).toMatch(/local exa_research_\* planning tools never call Exa/i);
      expect(guidance).toMatch(/cycle-attributed web_\* retrievals.*during planning/i);
      expect(guidance).toMatch(/cycle-attributed paid work requires operator approvals/i);
      expect(guidance).toMatch(/clarify.*goals.*constraints.*output contract/i);
      expect(guidance).toMatch(/candidate.*not trusted.*select/i);
      expect(guidance).toMatch(/readiness.*judgment.*not.*permission/i);
      expect(guidance).toMatch(/operator.*approve-request/i);
      expect(guidance).toMatch(/evidence-backed.*criterion/i);
      expect(guidance).toMatch(/final report.*gaps.*usage/i);
      expect(guidance).toMatch(/no automatic.*gap-closing/i);
      expect(guidance).toMatch(/explicit.*resume.*never.*spending/i);
    }
    for (const name of ["exa_research_step", "web_search_exa"]) {
      expect(plain.tools.get(name)?.promptGuidelines?.length).toBeGreaterThan(0);
    }
    expect(offlineCreate).not.toHaveBeenCalled();
    expect(offlineSearch).not.toHaveBeenCalled();
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
    for (const endpoint of Object.values(offlineEndpoints)) expect(endpoint).not.toHaveBeenCalled();
  });

  it("documents single-GET recovery in opted-in Agent tool guidance without changing default descriptions", async () => {
    const plain = await host(false);
    expect(plain.tools.get("web_research_exa")?.description).not.toMatch(/researchMode=recover/);
    const pi = await host();
    const description = pi.tools.get("web_research_exa")?.description;
    expect(description).toMatch(/researchMode=recover.*one existing-run GET/);
    expect(description).toMatch(/cycleId.*attemptId/);
    expect(description).toMatch(/never creates, polls or cancels/);
    expect(description).toMatch(/request overrides are forbidden/);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });
  it("marks an unassessable aggregate-liability status fallback as assessment-only, never dispatch permission", async () => {
    const pi = await host();
    await pi.command?.handler("start question", pi.context);
    const started = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${started.id} 1`, pi.context);
    await pi.call("web_search_exa", { query: "offline", cycleId: started.id });
    const status = (await pi.call("exa_research_status")).details;
    const path = join(pi.context.cwd, "agent", "research-cycles", String(status.projectId), `${status.id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.ledger = [
      { ...record.ledger[0], status: "reported", reportedMicros: Number.MAX_SAFE_INTEGER },
      {
        ...record.ledger[0],
        id: "second-reported-operation",
        status: "reported",
        reportedMicros: Number.MAX_SAFE_INTEGER,
      },
    ];
    await writeFile(path, JSON.stringify(record));
    const response = await pi.call("exa_research_status");
    expect(response.details.accounting).toMatchObject({
      ledgerHealthy: false,
      assessmentOnly: true,
      reason: "UNKNOWN_LIABILITY",
      error: expect.any(String),
    });
    expect(response.details.accounting).not.toHaveProperty("canDispatch");
    expect(offlineCreate).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  async function readyAgentHost(timeoutMs?: number) {
    const pi = await host(true, timeoutMs);
    await pi.command?.handler("start question", pi.context);
    await pi.call("exa_research_step", {
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: {
        goal: "answer",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const preview = await pi.call("exa_research_summary");
    const artifact = preview.details.artifact as { cycleId: string; revision: number; hash: string; request: object };
    // Blocking researchMode=active is gone: the guided dialog grants scope and exact-request permission.
    const blocked = await pi.call("web_research_exa", { researchMode: "active", cycleId: artifact.cycleId });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("GUIDED_SUBMISSION_REQUIRED");
    expect(offlineCreate).not.toHaveBeenCalled();
    return { pi, artifact };
  }

  it("keeps completed selected-only final-report diagnostics consistent without changing saved criteria", async () => {
    const { pi, artifact } = await readyAgentHost();
    expect(
      (
        await pi.call("exa_research_step", {
          topic: "question",
          stage: "synthesis_plan",
          note: "Curate only one source",
          thought_number: 2,
          total_thoughts: 2,
          next_step_needed: false,
          criteria: [
            { id: "C1", label: "Selected support", status: "supported", evidenceRefs: ["S1"] },
            { id: "C2", label: "Recorded support", status: "supported", evidenceRefs: ["U1"] },
          ],
          sources: [
            { id: "S1", title: "Selected", contentNotes: "Selected curated notes" },
            { id: "U1", title: "Unselected", contentNotes: "UNSELECTED_PRIVATE_NOTES" },
          ],
          executionPlan: { selectedEvidence: [{ sourceId: "S1", label: "Selected" }] },
        })
      ).isError,
    ).not.toBe(true);
    offlineCreate.mockResolvedValueOnce({
      id: "offline_projected_criteria",
      status: "completed",
      costDollars: { total: 0.1 },
      output: { structured: { answer: "Selected evidence only" } },
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(false);
    const before = (await pi.call("exa_research_status")).details;
    expect(before.finalReport).toMatchObject({ criteriaRequiringReview: [] });
    for (const mode of ["brief", "source_pack"]) {
      const summary = await pi.call("exa_research_summary", { mode });
      const report = summary.details.finalReport;
      if (!report || typeof report !== "object") throw new Error("Missing final report");
      expect(report).toMatchObject({
        recordedCriteria: summary.details.criteria,
        criteriaRequiringReview: [
          expect.objectContaining({ id: "C2", status: "supported", evidenceIssues: ["Unresolved evidence ref: U1"] }),
        ],
      });
      expect(JSON.stringify(summary)).not.toContain("UNSELECTED_PRIVATE_NOTES");
    }
    expect((await pi.call("exa_research_status")).details).toEqual(before);
    expect(offlineCreate).toHaveBeenCalledOnce();
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
  });

  it.each([
    { originalDollars: 0.000123, conflict: false },
    { originalDollars: 0.000124, conflict: true },
  ])("uses a real mock SDK GET to distinguish legacy receipt replay from changed dollars $originalDollars", async ({
    originalDollars,
    conflict,
  }) => {
    const { pi, artifact } = await readyAgentHost();
    const reply = {
      id: "agent_historical_receipt",
      status: "completed",
      output: { structured: { answer: "done" } },
      costDollars: { total: originalDollars },
    } satisfies AgentRun;
    offlineCreate.mockResolvedValueOnce(reply);
    const initial = await pi.submit(artifact.cycleId);
    expect(initial.isError).toBe(false);
    const status = (await pi.call("exa_research_status")).details;
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
    const path = join(pi.context.cwd, "agent", "research-cycles", String(status.projectId), `${artifact.cycleId}.json`);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    legacy.ledger[0].reportedMicros = Math.ceil(originalDollars * 1_000_000);
    await writeFile(path, JSON.stringify(legacy));
    await pi.command?.handler(`resume ${artifact.cycleId}`, pi.context);
    offlineGet.mockResolvedValueOnce({ ...reply, costDollars: { total: 0.000123 } });
    const recovered = await pi.call("web_research_exa", {
      researchMode: "recover",
      cycleId: artifact.cycleId,
      attemptId: initial.details.attemptId,
    });
    expect(recovered.isError).toBe(false);
    const retained = JSON.parse(await readFile(path, "utf8"));
    expect(retained.ledger[0].reportedMicros).toBe(124);
    expect(retained.ledger[0].conflictingMicros ?? []).toEqual(conflict ? [123] : []);
    expect(retained.grants).toEqual(legacy.grants);
    expect(retained.attempts).toHaveLength(1);
    expect(offlineCreate).toHaveBeenCalledOnce();
    expect(offlineGet).toHaveBeenCalledExactlyOnceWith(reply.id);
    expect(offlineCancel).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("projects Agent progress and final response once each with consistent completion guidance", async () => {
    const { pi, artifact } = await readyAgentHost();
    const original = researchPlanner.createResearchPlanner;
    const views = vi.fn();
    vi.spyOn(researchPlanner, "createResearchPlanner").mockImplementation((...args) => {
      const planner = original(...args);
      return {
        ...planner,
        getStatus: () => {
          views();
          return planner.getStatus();
        },
      };
    });
    offlineCreate.mockResolvedValueOnce({
      id: "agent_project_once",
      status: "completed",
      costDollars: { total: 0.1 },
      output: { structured: { answer: "done" } },
    });
    views.mockClear();
    const response = await pi.submit(artifact.cycleId);
    expect(response.isError).toBe(false);
    // A completed-on-acknowledgement submission builds exactly one status projection.
    expect(views).toHaveBeenCalledTimes(1);
    expect(response.details).toMatchObject({
      status: "completed",
      completionSummary: { remoteCompletedAttemptIds: [response.details.attemptId], duplicateSuccess: false },
    });
    expect(response.content[0]).toMatchObject({
      text: expect.stringContaining(String(response.details.nextSafeAction)),
    });
    expect(offlineCreate).toHaveBeenCalledOnce();
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("requires explicit Pi retry mode, cycle and fresh exact funding after confirmed failure, never automatic resubmission", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate
      .mockResolvedValueOnce({ id: "agent_run_pi_failed", status: "failed", costDollars: { total: 0.01 } })
      .mockResolvedValueOnce({
        id: "agent_run_pi_retry",
        status: "completed",
        costDollars: { total: 0.1 },
        output: { structured: { answer: "retry" } },
      });
    const failed = await pi.submit(artifact.cycleId);
    expect(failed.isError).toBe(true);
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    expect((await pi.call("web_research_exa", { researchMode: "retry" })).isError).toBe(true);
    const denied = await pi.call("web_research_exa", { researchMode: "retry", cycleId: artifact.cycleId });
    expect(JSON.stringify(denied.content)).toContain("UNCERTAINTY_APPROVAL_REQUIRED");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.command?.handler(`approve-request ${artifact.cycleId} ${failed.details.requestHash} 0.2`, pi.context);
    // Fresh exact funding alone is not enough: the lifetime ceiling must cover the total exposure.
    const underfunded = await pi.call("web_research_exa", { researchMode: "retry", cycleId: artifact.cycleId });
    expect(JSON.stringify(underfunded.content)).toContain("INSUFFICIENT_BALANCE");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.command?.handler(`approve ${artifact.cycleId} 1 web_research_exa`, pi.context);
    const retried = await pi.call("web_research_exa", {
      researchMode: "retry",
      cycleId: artifact.cycleId,
      artifactHash: artifact.hash,
      expectedRevision: artifact.revision,
    });
    expect(retried.isError).toBe(false);
    expect(retried.details.execution).toMatchObject({
      transitionMode: "retry",
      result: { taskOutput: { answer: "retry" } },
    });
    const status = await pi.call("exa_research_status");
    expect(status.details).toMatchObject({ status: "completed", completionSummary: { duplicateSuccess: false } });
    expect(status.details.nextSafeAction).toMatch(/Completion blocks further submissions/);
    expect((await pi.call("web_research_exa", { researchMode: "retry", cycleId: artifact.cycleId })).isError).toBe(
      true,
    );
    expect(offlineCreate).toHaveBeenCalledTimes(2);
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("requires the specific operator replacement command and surfaces both late duplicate successes without another run", async () => {
    const { pi, artifact } = await readyAgentHost();
    let resolveOriginal!: (reply: AgentRun) => void;
    const signal = new AbortController();
    offlineCreate
      .mockImplementationOnce(() => {
        signal.abort();
        return new Promise((done) => {
          resolveOriginal = done;
        });
      })
      .mockResolvedValueOnce({
        id: "agent_run_pi_replacement",
        status: "completed",
        costDollars: { total: 0.1 },
        output: { structured: { replacement: "new schema" } },
      });
    const interrupted = await pi.submit(artifact.cycleId, signal.signal);
    expect(interrupted.isError).toBe(true);
    expect(interrupted.content[0].text).toContain("SUBMISSION_UNKNOWN");
    if (!Value.Check(agentAttemptSchema, interrupted.details.execution)) throw new Error("Saved original missing");
    const first = interrupted.details.execution;
    const amended = await pi.call("exa_research_step", {
      topic: "question",
      stage: "source_retrieval",
      note: "Replacement draft",
      thought_number: 2,
      total_thoughts: 2,
      next_step_needed: false,
      executionPlan: {
        goal: "new question",
        taskSchema: {
          type: "object",
          required: ["replacement"],
          properties: { replacement: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    expect(amended.isError).toBe(false);
    const preview = await pi.call("exa_research_summary");
    expect(preview.details).toMatchObject({ previewOnly: true, requestHash: expect.any(String) });
    const draftHash = preview.details.requestHash;
    expect(draftHash).not.toBe(first.requestHash);
    await pi.command?.handler(`approve-request ${artifact.cycleId} ${draftHash} 0.2`, pi.context);
    await pi.command?.handler(`approve-liability ${artifact.cycleId} ${first.operationId} 0.2`, pi.context);
    const noRisk = await pi.call("web_research_exa", { researchMode: "replace", cycleId: artifact.cycleId });
    expect(JSON.stringify(noRisk.content)).toContain("REPLACEMENT_APPROVAL_REQUIRED");
    const flags = await pi.call("web_research_exa", {
      researchMode: "replace",
      cycleId: artifact.cycleId,
      acceptDuplicateRisk: true,
      assessedOriginalDollars: 0.2,
    });
    expect(flags.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    const beforeRisk = (await pi.call("exa_research_status")).details.grants;
    for (const command of [
      `approve-replacement ${artifact.cycleId} ${first.id} ${"f".repeat(64)} 0.2`,
      `approve-replacement ${artifact.cycleId} ${first.id} ${draftHash} 0`,
      `approve-replacement ${artifact.cycleId} ${first.id} ${draftHash} 1e-1`,
      `approve-replacement ${artifact.cycleId} missing-attempt ${draftHash} 0.2`,
    ]) {
      await pi.command?.handler(command, pi.context);
      expect((await pi.call("exa_research_status")).details.grants).toEqual(beforeRisk);
      expect(offlineCreate).toHaveBeenCalledTimes(1);
    }
    await pi.command?.handler(`approve-replacement ${artifact.cycleId} ${first.id} ${draftHash} 0.2`, pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringMatching(/duplicate work.*additional charges/i), "info");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    // The dialog ceiling covered one run; replacement needs a fresh total-exposure ceiling.
    const underfunded = await pi.call("web_research_exa", { researchMode: "replace", cycleId: artifact.cycleId });
    expect(underfunded.content[0].text).toContain("INSUFFICIENT_BALANCE");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.command?.handler(`approve ${artifact.cycleId} 1 web_research_exa`, pi.context);
    const replaced = await pi.call("web_research_exa", { researchMode: "replace", cycleId: artifact.cycleId });
    expect(replaced.isError).toBe(false);
    resolveOriginal({
      id: "agent_run_pi_original_late",
      status: "completed",
      costDollars: { total: 0.1 },
      output: { structured: { answer: "original" } },
    });
    // The late original acknowledgement settles its own attempt without another run.
    await vi.waitFor(
      async () =>
        expect((await pi.call("exa_research_status")).details.completionSummary).toMatchObject({
          duplicateSuccess: true,
        }),
      { timeout: 10_000, interval: 50 },
    );
    const status = await pi.call("exa_research_status");
    expect(status.details).toMatchObject({
      status: "completed",
      completionSummary: { duplicateSuccess: true, remoteCompletedAttemptIds: [first.id, replaced.details.attemptId] },
    });
    expect(status.details.nextSafeAction).toMatch(/duplicate successes/i);
    expect(status.details.attempts).toEqual([
      expect.objectContaining({
        id: first.id,
        requestHash: first.requestHash,
        result: expect.objectContaining({ taskOutput: { answer: "original" } }),
      }),
      expect.objectContaining({
        requestHash: draftHash,
        result: expect.objectContaining({ taskOutput: { replacement: "new schema" } }),
      }),
    ]);
    expect((await pi.call("web_research_exa", { researchMode: "replace", cycleId: artifact.cycleId })).isError).toBe(
      true,
    );
    expect(offlineCreate).toHaveBeenCalledTimes(2);
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCancel).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("requires explicit assistant resume after session restart and recovers the existing invalid result with one GET", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_recover",
      status: "completed",
      output: { structured: { answer: 42 } },
      costDollars: { total: 0.1 },
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    const before = (await pi.call("exa_research_status")).details;
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
    const inactive = await pi.call("exa_research_status");
    expect(inactive.details).toMatchObject({ active: false, savedCycles: [{ id: artifact.cycleId }] });
    expect(offlineGet).not.toHaveBeenCalled();
    expect((await pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId })).isError).toBe(
      true,
    );
    expect((await pi.call("exa_research_status", { action: "resume", cycleId: artifact.cycleId })).details.id).toBe(
      artifact.cycleId,
    );
    offlineGet.mockResolvedValueOnce({
      id: "agent_run_recover",
      status: "completed",
      output: { structured: { answer: "recovered" } },
      costDollars: { total: 0.1 },
    });
    const response = await pi.call("web_research_exa", {
      researchMode: "recover",
      cycleId: artifact.cycleId,
      artifactHash: artifact.hash,
    });
    expect(response.isError).toBeFalsy();
    expect(response.details).toMatchObject({
      inspectionOnly: true,
      status: "completed",
      execution: { result: { processing: "validated", taskOutput: { answer: "recovered" } } },
      accounting: { reportedDollars: 0.1 },
    });
    const after = (await pi.call("exa_research_status")).details;
    expect(after.grants).toEqual(before.grants);
    expect(after.ledger).toHaveLength(1);
    expect(after.attempts).toHaveLength(1);
    expect(offlineGet).toHaveBeenCalledExactlyOnceWith("agent_run_recover");
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("keeps unavailable existing-run GET unknown and rejects recovery request overrides without SDK work", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_pending",
      status: "running",
      costDollars: { total: 0.02 },
    });
    offlineGet.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    await pi.submit(artifact.cycleId);
    // The background monitor's single GET pauses it on not-found; recovery remains explicit.
    await vi.waitFor(
      async () =>
        expect((await pi.call("exa_research_status")).details.monitors).toMatchObject([
          { state: "paused", reason: "NOT_FOUND" },
        ]),
      { timeout: 10_000, interval: 50 },
    );
    offlineGet.mockClear();
    expect(
      (
        await pi.call("web_research_exa", {
          researchMode: "recover",
          cycleId: artifact.cycleId,
          query: "new paid query",
        })
      ).isError,
    ).toBe(true);
    expect(offlineGet).not.toHaveBeenCalled();
    const response = await pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId });
    expect(response.isError).toBe(true);
    expect(response.details).toMatchObject({
      status: "unknown",
      inspectionOnly: true,
      execution: { status: "unknown" },
      accounting: { reason: "UNKNOWN_LIABILITY" },
    });
    expect(offlineGet).toHaveBeenCalledTimes(1);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("reports pending inspection as provisional without polling or releasing interrupted liability", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({ id: "agent_run_pending", status: "running" });
    offlineGet.mockRejectedValueOnce(Object.assign(new Error("not found"), { statusCode: 404 }));
    await pi.submit(artifact.cycleId);
    await vi.waitFor(
      async () =>
        expect((await pi.call("exa_research_status")).details.monitors).toMatchObject([
          { state: "paused", reason: "NOT_FOUND" },
        ]),
      { timeout: 10_000, interval: 50 },
    );
    offlineGet.mockClear().mockResolvedValueOnce({
      id: "agent_run_pending",
      status: "running",
      costDollars: { total: 0.05 },
    });
    const response = await pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId });
    expect(response.isError).toBeFalsy();
    // A paused monitor is not a failed or unknown run: the remote work stays running and its
    // reservation stays pending until a terminal receipt.
    expect(response.details).toMatchObject({
      status: "running",
      execution: { result: { remoteStatus: "running", processing: "pending", provisionalTotalDollars: 0.05 } },
      accounting: { reportedDollars: 0, pendingEstimatedDollars: 0.1 },
    });
    expect(offlineGet).toHaveBeenCalledTimes(1);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("keeps an interrupted submission unknown and its liability unresolved when a pending GET comes back", async () => {
    const { pi, artifact } = await readyAgentHost();
    let enter!: () => void;
    let resolveCreate!: (run: AgentRun) => void;
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    offlineCreate.mockImplementationOnce(() => {
      enter();
      return new Promise((done) => {
        resolveCreate = done;
      });
    });
    offlineGet.mockResolvedValue({ id: "agent_run_interrupted", status: "running", costDollars: { total: 0.05 } });
    const interruption = new AbortController();
    const call = pi.submit(artifact.cycleId, interruption.signal);
    await entered;
    interruption.abort();
    expect((await call).content[0].text).toContain("SUBMISSION_UNKNOWN");
    // The genuine create acknowledgement arrives after the local wait ended.
    resolveCreate({ id: "agent_run_interrupted", status: "running" });
    await vi.waitFor(
      async () =>
        expect((await pi.call("exa_research_status")).details.attempts).toMatchObject([
          { result: { remoteId: "agent_run_interrupted" } },
        ]),
      { timeout: 10_000, interval: 50 },
    );
    const response = await pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId });
    expect(response.details).toMatchObject({
      status: "unknown",
      execution: { status: "unknown", result: { remoteStatus: "running", processing: "pending" } },
      accounting: { reason: "UNKNOWN_LIABILITY" },
    });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("keeps missing-ID submissions unknown after assistant resume and performs no recovery GET", async () => {
    const { pi, artifact } = await readyAgentHost();
    const interruption = new AbortController();
    offlineCreate.mockImplementationOnce(() => {
      interruption.abort();
      return new Promise(() => {});
    });
    await pi.submit(artifact.cycleId, interruption.signal);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
    await pi.call("exa_research_status", { action: "resume", cycleId: artifact.cycleId });
    const response = await pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId });
    expect(response.isError).toBe(true);
    expect(response.content).toMatchObject([{ text: expect.stringMatching(/RECOVERY_UNAVAILABLE.*saved remote ID/) }]);
    const status = (await pi.call("exa_research_status")).details;
    expect(status).toMatchObject({ status: "unknown", attempts: [{ status: "unknown" }] });
    expect(status.nextSafeAction).toMatch(/no saved remote ID.*unknown/i);
    expect(offlineGet).not.toHaveBeenCalled();
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("does not let assistant resume steal another live runtime's cycle ownership", async () => {
    const { pi, artifact } = await readyAgentHost();
    const tool = pi.tools.get("exa_research_status");
    if (!tool) throw new Error("Missing status tool");
    const other = {
      ...pi.context,
      sessionManager: { getSessionId: () => "other-session" },
    } as unknown as ExtensionToolContext;
    const response = await tool.execute(
      "other",
      { action: "resume", cycleId: artifact.cycleId },
      undefined,
      undefined,
      other,
    );
    expect(response.isError).toBe(true);
    expect(response.content).toMatchObject([{ text: expect.stringMatching(/another live session/) }]);
    expect((await pi.call("exa_research_status")).details.id).toBe(artifact.cycleId);
    expect(offlineCreate).not.toHaveBeenCalled();
    expect(offlineGet).not.toHaveBeenCalled();
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("retains a late recovery reply after local timeout and archive without remote cancellation or replacement", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_late_recovery",
      status: "completed",
      output: { structured: { answer: 42 } },
      costDollars: { total: 0.1 },
    });
    await pi.submit(artifact.cycleId);
    const before = (await pi.call("exa_research_status")).details;
    let started!: () => void;
    const reachedGet = new Promise<void>((resolve) => {
      started = resolve;
    });
    let reply!: (run: AgentRun) => void;
    offlineGet.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        reply = resolve;
      });
    });
    vi.useFakeTimers();
    const pending = pi.call("web_research_exa", { researchMode: "recover", cycleId: artifact.cycleId });
    await reachedGet;
    await vi.advanceTimersByTimeAsync(180_000);
    const response = await pending;
    expect(response.isError).toBe(true);
    expect(response.details).toMatchObject({ status: "completed", inspectionOnly: true });
    vi.useRealTimers();
    await pi.call("exa_research_reset");
    reply({
      id: "agent_run_late_recovery",
      status: "completed",
      output: { structured: { answer: "late recovered" } },
      costDollars: { total: 0.1 },
    });
    const path = join(pi.context.cwd, "agent", "research-cycles", String(before.projectId), `${artifact.cycleId}.json`);
    await vi.waitFor(async () => {
      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(saved).toMatchObject({
        archived: true,
        status: "completed",
        attempts: [{ result: { processing: "validated", taskOutput: { answer: "late recovered" } } }],
        ledger: [{ status: "reported", reportedMicros: 100_000 }],
      });
      expect(saved.owner).toBeUndefined();
      expect(saved.attempts).toHaveLength(1);
      expect(saved.ledger).toHaveLength(1);
    });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    expect(offlineGet).toHaveBeenCalledTimes(1);
    expect(offlineCancel).not.toHaveBeenCalled();
    expect((await pi.call("exa_research_status")).details.active).toBe(false);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("persists and exposes privacy-safe remote failure diagnostics without allowing replacement", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_failure",
      status: "failed",
      stopReason: "error",
      error: {
        code: "INVALID_REQUEST",
        message: "secret credential and private excerpt",
        actual: { apiKey: "secret" },
      },
      costDollars: { total: 0.01 },
    });
    const response = await pi.submit(artifact.cycleId);
    expect(response.isError).toBe(true);
    expect(response.details).toMatchObject({
      status: "failed",
      execution: { result: { remoteError: { category: "invalid-request", code: "INVALID_REQUEST" } } },
      accounting: { reportedDollars: 0.01 },
    });
    expect(JSON.stringify(response)).not.toMatch(/secret|credential|private excerpt/);
    const record = (await pi.call("exa_research_status")).details;
    expect(record).toMatchObject({ attempts: [{ result: { remoteError: { category: "invalid-request" } } }] });
    expect(JSON.stringify(record)).not.toMatch(/secret|credential|private excerpt/);
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("does not submit when the frozen Agent intent cannot be published durably", async () => {
    const { pi, artifact } = await readyAgentHost();
    vi.mocked(nativeFs.renameSync).mockImplementationOnce(() => {
      throw new Error("intent publication denied");
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    expect(offlineCreate).not.toHaveBeenCalled();
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      status: "planning",
      attempts: [],
      ledger: [],
    });
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("surfaces completed invalid output as local processing failure rather than buying a replacement", async () => {
    const { pi, artifact } = await readyAgentHost();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_invalid",
      status: "completed",
      output: { structured: { answer: 7 } },
      costDollars: { total: 0.1 },
    });
    const response = await pi.submit(artifact.cycleId);
    expect(response.isError).toBe(true);
    expect(response.details).toMatchObject({
      status: "completed",
      execution: { result: { processing: "failed" } },
      accounting: { reportedDollars: 0.1 },
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    const override = await pi.call("web_research_exa", {
      query: "continue it",
      previousRunId: "agent_run_invalid",
      researchMode: "standalone",
    });
    expect(override.isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });

  it("retains a missing-ID interruption and settles a late original create without a duplicate submission", async () => {
    const { pi, artifact } = await readyAgentHost();
    let enter!: () => void;
    let resolve!: (run: AgentRun) => void;
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    offlineCreate.mockImplementationOnce(() => {
      enter();
      return new Promise((done) => {
        resolve = done;
      });
    });
    const signal = new AbortController();
    const call = pi.submit(artifact.cycleId, signal.signal);
    await entered;
    signal.abort();
    expect((await call).isError).toBe(true);
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      status: "unknown",
      attempts: [{ status: "unknown" }],
      ledger: [{ status: "unknown" }],
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    resolve({
      id: "agent_run_late",
      status: "completed",
      output: { structured: { answer: "late" } },
      costDollars: { total: 0.1 },
    });
    await vi.waitFor(async () => {
      expect((await pi.call("exa_research_status")).details).toMatchObject({
        status: "completed",
        accounting: { reportedDollars: 0.1 },
      });
    });
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });
  it("executes the exact compiled request only after scoped operator approval, then stops at one successful Agent result", async () => {
    const pi = await host();
    await pi.command?.handler("start question", pi.context);
    await pi.call("exa_research_step", {
      topic: "question",
      stage: "source_retrieval",
      note: "Prepare",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      executionPlan: {
        goal: "answer",
        taskSchema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    const preview = await pi.call("exa_research_summary", { mode: "execution_plan" });
    const artifact = preview.details.artifact as { cycleId: string; revision: number; hash: string; request: object };
    await pi.command?.handler(`approve ${artifact.cycleId} 1 web_research_exa`, pi.context);
    const status = await pi.call("exa_research_status");
    expect(status.details.accounting).toMatchObject({ ledgerHealthy: true, assessmentOnly: true });
    expect(status.details.accounting).not.toHaveProperty("canDispatch");
    const blocked = await pi.call("web_research_exa", {
      cycleId: artifact.cycleId,
      expectedRevision: artifact.revision,
      artifactHash: artifact.hash,
    });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("GUIDED_SUBMISSION_REQUIRED");
    expect(offlineCreate).not.toHaveBeenCalled();
    // The host dialog records the lifetime scope and exact-request permission together.
    pi.confirm.mockResolvedValueOnce(false);
    const declined = await pi.submit(artifact.cycleId);
    expect(declined.isError).toBe(true);
    expect(declined.content[0].text).toContain("APPROVAL_NOT_GRANTED");
    expect(offlineCreate).not.toHaveBeenCalled();
    offlineCreate.mockResolvedValueOnce({
      id: "agent_run_final",
      status: "completed",
      stopReason: "schema_satisfied",
      output: { structured: { answer: "result" } },
      costDollars: { total: 0.1 },
    });
    const finished = await pi.submit(artifact.cycleId);
    expect(finished.isError).not.toBe(true);
    expect(offlineCreate).toHaveBeenCalledExactlyOnceWith(artifact.request);
    expect(await pi.call("exa_research_status")).toMatchObject({
      details: {
        status: "completed",
        attempts: [{ result: { processing: "validated", taskOutput: { answer: "result" } } }],
        accounting: { reportedDollars: 0.1 },
      },
    });
    expect((await pi.submit(artifact.cycleId)).isError).toBe(true);
    expect(offlineCreate).toHaveBeenCalledTimes(1);
    await pi.handlers.get("session_shutdown")?.({} as never, pi.context);
  });
  it("does not persist a signed URL signature from SDK results or expose it as selectable candidate metadata", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    offlineSearch.mockResolvedValue({
      results: [
        {
          id: "signed-document",
          title: "Signed document",
          url: "https://blob.example/file?sig=DO_NOT_RETAIN_SAS_SIGNATURE&se=expiry",
          text: "Returned content",
        },
      ],
      costDollars: { total: 0.007 },
    });
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    expect(response.isError).not.toBe(true);
    expect(response.details.candidates).toEqual([]);
    const current = (await pi.call("exa_research_status")).details;
    expect(JSON.stringify(current)).not.toContain("DO_NOT_RETAIN_SAS_SIGNATURE");
    expect(current.ledger).toMatchObject([{ reportedMicros: 7_000 }]);
    const projects = await fs.readdir(join(String(process.env.PI_CODING_AGENT_DIR), "research-cycles"));
    const stored = await readFile(
      join(String(process.env.PI_CODING_AGENT_DIR), "research-cycles", projects[0], `${status.id}.json`),
      "utf8",
    );
    expect(stored).not.toContain("DO_NOT_RETAIN_SAS_SIGNATURE");
  });
  it("returns an actionable same-step source conflict while retaining an inspectable original cycle", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    offlineSearch.mockResolvedValue({
      results: [{ id: "candidate", url: "https://candidate.example", title: "Candidate" }],
      costDollars: { total: 0.007 },
    });
    const retrieved = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    const candidates = retrieved.details.candidates;
    if (!Array.isArray(candidates) || !candidates[0]) throw new Error("Missing candidate");
    const before = (await pi.call("exa_research_status")).details;
    const conflict = await pi.call("exa_research_step", {
      topic: "topic",
      stage: "source_retrieval",
      note: "Conflicting selection",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      evidence: [{ candidateId: candidates[0].id, decision: "select", label: "Useful" }],
      sources: [{ id: candidates[0].id, title: "Other", url: "https://other.example" }],
    });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.content)).toContain("Invalid candidate source reference");
    expect((await pi.call("exa_research_status")).details).toEqual(before);
    expect(offlineSearch).toHaveBeenCalledTimes(1);
  });
  it("snapshots SDK evidence before receipt persistence can yield to another response mutation", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    const fixture = {
      results: [{ id: "source", url: "https://example.com/original", title: "Original", text: "body" }],
      costDollars: { total: 0.007 },
    };
    offlineSearch.mockImplementationOnce(async () => {
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        fixture.results[0].url = "https://example.com/mutated";
        fixture.results[0].title = "Mutated";
        return original.rename(...args);
      });
      return fixture;
    });
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    expect(response.details.candidates).toMatchObject([{ url: "https://example.com/original", title: "Original" }]);
  });
  it("keeps concurrent reversed SDK completions bound to their own operation and candidates", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.014`, pi.context);
    const pending = new Map<string, (response: Record<string, unknown>) => void>();
    let entered!: () => void;
    const bothEntered = new Promise<void>((done) => {
      entered = done;
    });
    offlineSearch.mockImplementation(
      (query) =>
        new Promise((resolve) => {
          if (typeof query !== "string") throw new Error("Unexpected query");
          pending.set(query, resolve);
          if (pending.size === 2) entered();
        }),
    );
    const first = pi.call("web_search_exa", { query: "first", cycleId: status.id });
    const second = pi.call("web_search_exa", { query: "second", cycleId: status.id });
    await bothEntered;
    for (const query of ["second", "first"])
      pending.get(query)?.({
        results: [{ id: query, title: query, url: `https://example.com/${query}` }],
        costDollars: { total: 0.007 },
      });
    const responses = await Promise.all([first, second]);
    for (const [index, query] of ["first", "second"].entries()) {
      expect(responses[index].isError, JSON.stringify(responses[index])).not.toBe(true);
      expect(responses[index].details).toMatchObject({
        candidates: [
          {
            title: query,
            url: `https://example.com/${query}`,
            provenance: [{ operationId: responses[index].details.operationId }],
          },
        ],
      });
    }
    const final = (await pi.call("exa_research_status")).details;
    expect(final.candidates).toHaveLength(2);
    expect(final.accounting).toMatchObject({ reportedDollars: 0.014, pendingEstimatedDollars: 0 });
  });
  it("does not capture late results after archive, while reconciling their genuine cost", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    let resolve!: (response: Record<string, unknown>) => void;
    let enter!: () => void;
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    offlineSearch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          enter();
        }),
    );
    const pending = pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    await entered;
    await pi.call("exa_research_reset");
    resolve({
      results: [{ id: "https://late.example", url: "https://late.example", title: "Late", text: "Late content" }],
      costDollars: { total: 0.009 },
    });
    expect((await pending).details.candidates).toEqual([]);
    await pi.command?.handler("list", pi.context);
    const saved = JSON.parse(String(pi.notify.mock.lastCall?.[0]));
    expect(saved).toMatchObject([
      {
        archived: true,
        ledger: [{ status: "reported", reportedMicros: 9_000 }],
      },
    ]);
    expect(JSON.stringify(saved)).not.toContain("late.example");
  });
  it("preserves successful returned content and reported accounting when candidate persistence fails", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    offlineSearch.mockImplementationOnce(async () => {
      vi.mocked(nativeFs.renameSync).mockImplementationOnce(() => {
        throw new Error("candidate persistence denied");
      });
      return {
        results: [
          {
            id: "https://example.com/source",
            url: "https://example.com/source",
            title: "Source",
            text: "Useful returned body",
          },
        ],
        costDollars: { total: 0.007 },
      };
    });
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(JSON.stringify(response.content)).toContain("Useful returned body");
    expect(response.details).toMatchObject({
      candidateCaptureError: expect.stringContaining("candidate persistence denied"),
      candidates: [],
      accounting: { reportedDollars: 0.007, billingVerified: false },
    });
    expect(offlineSearch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { tool: "web_search_exa", endpoint: "search", args: { query: "topic" } },
    { tool: "web_search_advanced_exa", endpoint: "search", args: { query: "topic", type: "deep" } },
    { tool: "web_fetch_exa", endpoint: "getContents", args: { urls: ["https://example.com/source"] } },
    { tool: "web_find_similar_exa", endpoint: "findSimilar", args: { url: "https://example.com/source" } },
    { tool: "web_answer_exa", endpoint: "answer", args: { query: "topic" } },
  ] as const)("captures $tool results from its actual SDK endpoint after spending authorization", async ({
    tool,
    endpoint,
    args,
  }) => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1 ${tool}`, pi.context);
    offlineSearch.mockResolvedValue({
      results: [{ id: "https://example.com/source", url: "https://example.com/source", title: "Source", text: "body" }],
      citations: [
        { id: "https://example.com/source", url: "https://example.com/source", title: "Source", text: "body" },
      ],
      answer: "Generated answer",
      requestId: "offline",
      costDollars: { total: 0 },
    });
    let response = await pi.call(tool, { ...args, cycleId: status.id });
    if (response.isError && typeof response.details.requestHash === "string") {
      await pi.command?.handler(`approve-request ${status.id} ${response.details.requestHash} 0.02`, pi.context);
      response = await pi.call(tool, { ...args, cycleId: status.id });
    }
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    for (const [name, spy] of Object.entries(offlineEndpoints)) {
      expect(spy).toHaveBeenCalledTimes(name === endpoint ? 1 : 0);
    }
    expect(response.details).toMatchObject({
      candidates: [{ url: "https://example.com/source", decision: "candidate", provenance: [{ tool }] }],
    });
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      sources: [],
      criteriaCoverage: { supported: 0 },
      ledger: [{ reportedMicros: 0 }],
    });
  });
  it("captures attributed SDK candidates, curates them explicitly, and isolates unrelated standalone results", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    const fixture = {
      results: [
        { id: "https://example.com/source", url: "https://example.com/source", title: "Candidate", text: "Raw body" },
      ],
      costDollars: { total: 0.007 },
    };
    offlineSearch.mockResolvedValue(fixture);
    pi.confirm.mockResolvedValueOnce(false);
    expect((await pi.call("web_search_exa", { query: "topic", cycleId: status.id })).isError).toBe(true);
    expect(offlineSearch).not.toHaveBeenCalled();
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const captured = (await pi.call("exa_research_status")).details;
    expect(captured.candidates).toMatchObject([
      {
        title: "Candidate",
        decision: "candidate",
        provenance: [{ operationId: response.details.operationId }],
      },
    ]);
    const candidates = captured.candidates;
    if (!Array.isArray(candidates) || !candidates[0]) throw new Error("Missing candidates");
    const curated = await pi.call("exa_research_step", {
      topic: "topic",
      stage: "source_retrieval",
      note: "Explicit selection",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      evidence: [
        { candidateId: candidates[0].id, decision: "select", label: "Useful evidence", notes: "Explicit note" },
      ],
      sources: [{ id: "external-unselected", title: "UNSELECTED EXTERNAL", contentNotes: "UNSELECTED NOTES" }],
      executionPlan: { goal: "topic", taskSchema: { type: "object" } },
    });
    expect(curated.isError).not.toBe(true);
    const preview = await pi.call("exa_research_summary", { mode: "execution_plan" });
    expect(preview.details).toMatchObject({
      artifact: {
        selectedEvidence: [{ title: "Candidate", notes: "Explicit note", provenance: [{ tool: "web_search_exa" }] }],
      },
    });
    for (const mode of ["brief", "source_pack"]) {
      const summary = await pi.call("exa_research_summary", { mode });
      expect(JSON.stringify(summary)).not.toMatch(/UNSELECTED EXTERNAL|UNSELECTED NOTES/);
      expect(JSON.stringify(summary)).toContain("Explicit note");
    }
    offlineSearch.mockResolvedValue({
      results: [{ id: "https://unrelated.example", url: "https://unrelated.example", title: "Unrelated" }],
    });
    await pi.call("web_search_exa", { query: "unrelated", researchMode: "standalone" });
    expect((await pi.call("exa_research_status")).details).toEqual(curated.details.cycle);
  });
  it("documents explicit funded retry and operator duplicate-risk replacement consent in public Pi help", async () => {
    const pi = await host();
    expect(pi.flags).toHaveBeenCalledWith("exa-enable-cycles", {
      type: "boolean",
      description:
        "Opt in to durable Pi research cycles with operator-approved exploration, compiled Agent research, explicit existing-run GET recovery and explicit funded retry/replacement; unknown-work replacement requires operator duplicate-work/additional-charge consent.",
    });
    expect(pi.command?.description).toContain(
      "approve-replacement <cycle-id> <unknown-attempt-id> <new-request-hash> <assessed-original-dollars>",
    );
    expect(pi.command?.description).toMatch(/every unknown original.*duplicate work and possible additional charges/i);
    expect(pi.command?.description).toMatch(/explicit funded retry.*fresh exact-request approval/i);
    expect(pi.command?.description).toMatch(/recovery performs one existing-run GET/i);
    expect(pi.command?.description).not.toMatch(/replacement remain[s]? gated|recovery.*remain[s]? gated/i);
  });

  it.each([
    "cycleId",
    "expectedRevision",
    "artifactHash",
  ])("rejects standalone requests carrying %s without dispatch or ledger mutation", async (field) => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const before = (await pi.call("exa_research_status")).details;
    const reference = field === "cycleId" ? before.id : field === "expectedRevision" ? before.revision : "a".repeat(64);
    const response = await pi.call("web_search_exa", {
      query: "topic",
      researchMode: "standalone",
      [field]: reference,
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]).toMatchObject({
      text: expect.stringContaining("Standalone requests must omit cycle references"),
    });
    expect(offlineSearch).not.toHaveBeenCalled();
    expect((await pi.call("exa_research_status")).details).toEqual(before);
  });

  it("retries the original genuine total after a transient write failure rather than replacing it with missing evidence", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    let resolve!: (response: Record<string, unknown>) => void;
    let entered!: () => void;
    const sdk = new Promise<Record<string, unknown>>((done) => {
      resolve = done;
    });
    const barrier = new Promise<void>((done) => {
      entered = done;
    });
    offlineSearch.mockImplementationOnce(async () => {
      entered();
      return sdk;
    });
    const pending = pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    await barrier;
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("transient receipt write failure"));
    resolve({ results: [], costDollars: { total: 0.003 } });
    const response = await pending;
    expect(response.details.accounting).toMatchObject({
      reportedDollars: 0.003,
      pendingEstimatedDollars: 0,
      unresolvedOperationIds: [],
    });
    expect((await pi.call("exa_research_status")).details.ledger).toMatchObject([
      { status: "reported", reportedMicros: 3_000 },
    ]);
    expect((await pi.call("web_search_exa", { query: "another", cycleId: status.id })).isError).not.toBe(true);
    expect(offlineSearch).toHaveBeenCalledTimes(2);
  });

  it("exposes genuine unsaved usage and blocks spending after receipt durability fails", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    let resolve!: (response: Record<string, unknown>) => void;
    let entered!: () => void;
    const sdk = new Promise<Record<string, unknown>>((done) => {
      resolve = done;
    });
    const barrier = new Promise<void>((done) => {
      entered = done;
    });
    offlineSearch.mockImplementationOnce(async () => {
      entered();
      return sdk;
    });
    const args = { query: "topic", cycleId: status.id };
    const pending = pi.call("web_search_exa", args);
    await barrier;
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let fail = true;
    vi.mocked(fs.rename).mockImplementation(async (...values) => {
      if (fail) throw new Error("offline receipt write failure");
      await original.rename(...values);
    });
    resolve({ results: [], costDollars: { total: 0.05 } });
    const response = await pending;
    expect(response.isError).toBe(true);
    expect(response.details).toMatchObject({
      apiReportedReceipt: { totalDollars: 0.05 },
      receiptDurability: "unconfirmed",
      billingVerified: false,
    });
    fail = false;
    const denied = await pi.call("web_search_exa", args);
    expect(denied.isError).toBe(true);
    expect(denied.content[0]).toMatchObject({ text: expect.stringContaining("ACCOUNTING_UNAVAILABLE") });
    expect(offlineSearch).toHaveBeenCalledOnce();
  });

  it.each([
    ["web_fetch_exa", { urls: ["https://a.test"] }],
    ["web_find_similar_exa", { url: "https://a.test" }],
    ["web_answer_exa", { query: "topic" }],
  ])("captures explicit zero raw costs on scoped %s calls", async (tool, args) => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1 ${tool}`, pi.context);
    const request = { ...args, cycleId: status.id };
    if (tool !== "web_fetch_exa") {
      const denied = await pi.call(tool, request);
      await pi.command?.handler(`approve-request ${status.id} ${denied.details.requestHash} 0.01`, pi.context);
    }
    offlineSearch.mockResolvedValueOnce({ results: [], answer: "answer", citations: [], costDollars: { total: 0 } });
    const response = await pi.call(tool, request);
    expect(response.isError).not.toBe(true);
    expect(offlineSearch).toHaveBeenCalledOnce();
    expect((await pi.call("exa_research_status")).details.ledger).toMatchObject([
      { tool, status: "reported", reportedMicros: 0 },
    ]);
  });

  it("prevents a timed-out async preflight from starting the SDK after its reservation is released", async () => {
    const pi = await host(true, 100);
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let releases = 0;
    let entered!: () => void;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fs.unlink).mockImplementation(async (...args) => {
      await original.unlink(...args);
      if (String(args[0]).endsWith(".lock") && ++releases === 3) {
        entered();
        await blocked;
      }
    });
    vi.useFakeTimers();
    try {
      const pending = pi.call("web_search_exa", { query: "topic", cycleId: status.id });
      await barrier;
      await vi.advanceTimersByTimeAsync(100);
      release();
      const response = await pending;
      expect(response.isError).toBe(true);
      expect(offlineSearch).not.toHaveBeenCalled();
      expect((await pi.call("exa_research_status")).details.ledger).toMatchObject([{ status: "not-dispatched" }]);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it("freezes caller-owned nested request values at entry before hashing or dispatch", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    const queries = ["original"];
    const args = { query: "topic", type: "deep", additionalQueries: queries, cycleId: status.id };
    const denied = await pi.call("web_search_advanced_exa", args);
    await pi.command?.handler(`approve-request ${status.id} ${denied.details.requestHash} 0.02`, pi.context);
    offlineSearch.mockResolvedValueOnce({ results: [], costDollars: { total: 0 } });
    const pending = pi.call("web_search_advanced_exa", args);
    queries[0] = "changed after entry";
    const response = await pending;
    expect(response.isError).not.toBe(true);
    expect(response.details.requestHash).toBe(denied.details.requestHash);
    expect(offlineSearch).toHaveBeenCalledWith("topic", expect.objectContaining({ additionalQueries: ["original"] }));
  });

  it("releases a reservation only when a pre-aborted call provably never invokes the SDK", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    const abort = new AbortController();
    abort.abort();
    await pi.call("web_search_exa", { query: "topic", cycleId: status.id }, abort.signal);
    expect(offlineSearch).not.toHaveBeenCalled();
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      ledger: [{ status: "not-dispatched", estimateMicros: 7_000 }],
      accounting: { pendingEstimatedDollars: 0, reportedDollars: 0, unresolvedOperationIds: [] },
    });
  });

  it("binds concurrent out-of-order SDK receipts to separate immutable operations", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    let one!: (response: Record<string, unknown>) => void;
    let two!: (response: Record<string, unknown>) => void;
    const firstSdk = new Promise<Record<string, unknown>>((resolve) => {
      one = resolve;
    });
    const secondSdk = new Promise<Record<string, unknown>>((resolve) => {
      two = resolve;
    });
    offlineSearch.mockImplementation((query) => (query === "one" ? firstSdk : secondSdk));
    const first = pi.call("web_search_exa", { query: "one", cycleId: status.id });
    const second = pi.call("web_search_exa", { query: "two", cycleId: status.id });
    await vi.waitFor(() => expect(offlineSearch).toHaveBeenCalledTimes(2));
    two({ results: [], costDollars: { total: 0.006 } });
    const secondResult = await second;
    one({ results: [], costDollars: { total: 0.004 } });
    const firstResult = await first;
    const saved = (await pi.call("exa_research_status")).details;
    expect(saved.ledger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstResult.details.operationId, reportedMicros: 4_000 }),
        expect.objectContaining({ id: secondResult.details.operationId, reportedMicros: 6_000 }),
      ]),
    );
    expect(saved.accounting).toMatchObject({ reportedDollars: 0.01, pendingEstimatedDollars: 0 });
    expect(firstResult.details.requestHash).not.toBe(secondResult.details.requestHash);
  });

  it("holds pending exposure across another call and reports actual overspend before further dispatch", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    let resolve!: (response: Record<string, unknown>) => void;
    let entered!: () => void;
    const barrier = new Promise<void>((done) => {
      entered = done;
    });
    const sdk = new Promise<Record<string, unknown>>((done) => {
      resolve = done;
    });
    offlineSearch.mockImplementationOnce(async () => {
      entered();
      return sdk;
    });
    const args = { query: "topic", cycleId: status.id };
    const first = pi.call("web_search_exa", args);
    await barrier;
    pi.confirm.mockResolvedValueOnce(false);
    const denied = await pi.call("web_search_exa", args);
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("APPROVAL_NOT_GRANTED");
    expect(pi.confirm).toHaveBeenLastCalledWith(
      "Approve exploratory Exa retrieval?",
      expect.stringContaining("Existing liabilities: $0.01 assessed"),
      expect.anything(),
    );
    resolve({ results: [], costDollars: { total: 0.02 } });
    expect((await first).details.accounting).toMatchObject({
      reason: "OVERSPEND",
      reportedDollars: 0.02,
      pendingEstimatedDollars: 0,
    });
    expect((await pi.call("web_search_exa", args)).details.assessment).toMatchObject({ reason: "OVERSPEND" });
    expect(offlineSearch).toHaveBeenCalledOnce();
  });

  it("retains genuine raw usage when local formatting fails and never archives raw response data", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    offlineSearch.mockResolvedValueOnce({
      results: "not an array",
      costDollars: { total: 0.003 },
      rawSecretMarker: "DO_NOT_ARCHIVE_RESPONSE",
    });
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id });
    expect(response.isError).toBe(true);
    const saved = (await pi.call("exa_research_status")).details;
    expect(saved.ledger).toMatchObject([{ status: "reported", reportedMicros: 3_000 }]);
    expect(saved.accounting).toMatchObject({ reportedDollars: 0.003, pendingEstimatedDollars: 0 });
    expect(JSON.stringify(saved)).not.toContain("DO_NOT_ARCHIVE_RESPONSE");
  });

  it.each([
    "abort",
    "timeout",
  ])("keeps %s liability until its late raw receipt, including after archive", async (mode) => {
    const pi = await host(true, mode === "timeout" ? 500 : undefined);
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    let resolve!: (response: Record<string, unknown>) => void;
    let entered!: () => void;
    const barrier = new Promise<void>((done) => {
      entered = done;
    });
    const sdk = new Promise<Record<string, unknown>>((done) => {
      resolve = done;
    });
    offlineSearch.mockImplementationOnce(async () => {
      entered();
      return sdk;
    });
    const abort = new AbortController();
    const pending = pi.call("web_search_exa", { query: "topic", cycleId: status.id }, abort.signal);
    await Promise.race([
      barrier,
      pending.then(() => {
        throw new Error("SDK did not start.");
      }),
    ]);
    if (mode === "abort") abort.abort();
    const interrupted = await pending;
    expect(interrupted.details.accounting).toMatchObject({ reason: "UNKNOWN_LIABILITY" });
    await pi.command?.handler(`archive ${status.id}`, pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining("does not cancel"), "info");
    resolve({ results: [], costDollars: { total: 0.009 } });
    await vi.waitFor(async () => {
      await pi.command?.handler("list", pi.context);
      const saved = JSON.parse(pi.notify.mock.lastCall?.[0] ?? "[]")[0];
      expect(saved).toMatchObject({
        archived: true,
        ledger: [{ status: "reported", reportedMicros: 9_000 }],
        accounting: { reportedDollars: 0.009, pendingEstimatedDollars: 0 },
      });
      expect(saved).not.toHaveProperty("owner");
      expect(saved.grants).toHaveLength(1);
    });
    expect(offlineSearch).toHaveBeenCalledOnce();
  });

  it("requires and consumes operator permission for an exact unsupported request", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 1`, pi.context);
    const args = { query: "topic", type: "deep-lite", cycleId: status.id };
    const denied = await pi.call("web_search_advanced_exa", args);
    expect(denied.details.assessment).toMatchObject({ reason: "UNCERTAINTY_APPROVAL_REQUIRED" });
    expect(offlineSearch).not.toHaveBeenCalled();
    await pi.command?.handler(`approve-request ${status.id} ${denied.details.requestHash} 0.02`, pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining("uncertainty"), "info");
    offlineSearch.mockResolvedValueOnce({ results: [], costDollars: { total: 0 } });
    expect((await pi.call("web_search_advanced_exa", args)).isError).not.toBe(true);
    expect((await pi.call("web_search_advanced_exa", args)).isError).toBe(true);
    expect(offlineSearch).toHaveBeenCalledOnce();
  });

  it("keeps missing cost unknown and scopes operator liability assessment to only that operation", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.02`, pi.context);
    const args = { query: "topic", cycleId: status.id };
    const first = await pi.call("web_search_exa", args);
    expect(first.details.accounting).toMatchObject({ reason: "UNKNOWN_LIABILITY", reportedDollars: 0 });
    expect((await pi.call("web_search_exa", args)).details.assessment).toMatchObject({ reason: "UNKNOWN_LIABILITY" });
    await pi.command?.handler(`approve-liability ${status.id} ${first.details.operationId} 0.005`, pi.context);
    expect((await pi.call("web_search_exa", args)).isError).not.toBe(true);
    const blocked = await pi.call("web_search_exa", args);
    expect(blocked.details.assessment).toMatchObject({ reason: "UNKNOWN_LIABILITY", assessedUnknownDollars: 0.005 });
    expect(offlineSearch).toHaveBeenCalledTimes(2);
    expect((await pi.call("exa_research_status")).details.ledger).toMatchObject([
      { status: "unknown" },
      { status: "unknown" },
    ]);
  });

  it("dispatches a budget-approved explicitly attributed search and keeps raw usage on an empty result", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    offlineSearch.mockResolvedValueOnce({ results: [], costDollars: { total: 0.002, search: { total: 0.002 } } });
    const response = await pi.call("web_search_exa", { query: "topic", cycleId: status.id, expectedRevision: 0 });
    expect(response.isError).not.toBe(true);
    expect(offlineSearch).toHaveBeenCalledOnce();
    expect((await pi.call("exa_research_status")).details.ledger).toMatchObject([
      { status: "reported", reportedMicros: 2_000, estimateMicros: 7_000 },
    ]);
  });

  it("makes total-ceiling approval discoverable in command help and invalid-action usage", async () => {
    const pi = await host();
    expect(pi.command?.description).toContain("approve <cycle-id> <total-dollar-ceiling>");
    await pi.command?.handler("", pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("approve <cycle-id> <total-dollar-ceiling>"),
      "error",
    );
    expect(offlineSearch).not.toHaveBeenCalled();
  });

  it("records total-ceiling operator grants without accepting assistant approval fields or dispatching work", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    await pi.command?.handler(`approve ${status.id} 0.01`, pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining("ceiling"), "info");
    await pi.command?.handler(`approve ${status.id} 0.02`, pi.context);
    expect((await pi.call("exa_research_status")).details.grants).toMatchObject([
      { ceilingMicros: 10_000, source: "command" },
      { ceilingMicros: 20_000, source: "command" },
    ]);
    expect((await pi.call("web_search_exa", { query: "topic", approved: true })).isError).toBe(true);
    expect(offlineSearch).not.toHaveBeenCalled();
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it.each([
    { tool: "exa_research_summary", mode: undefined, reference: "revision" },
    { tool: "exa_research_summary", mode: "payload", reference: "revision" },
    { tool: "exa_research_summary", mode: "execution_plan", reference: "revision" },
    { tool: "web_research_exa", mode: undefined, reference: "revision" },
    { tool: "exa_research_summary", mode: "brief", reference: "revision" },
    { tool: "exa_research_summary", mode: "source_pack", reference: "revision" },
    { tool: "exa_research_summary", mode: "payload", reference: "hash" },
    { tool: "exa_research_summary", mode: "brief", reference: "hash" },
    { tool: "exa_research_summary", mode: "source_pack", reference: "hash" },
    { tool: "web_research_exa", mode: undefined, reference: "hash" },
    { tool: "exa_research_summary", mode: "payload", reference: "current-revision" },
    { tool: "web_research_exa", mode: undefined, reference: "current-revision" },
    { tool: "exa_research_summary", mode: "brief", reference: "current-revision" },
    { tool: "exa_research_summary", mode: "source_pack", reference: "current-revision" },
  ])("validates $reference against the current plan for $tool/$mode", async ({ tool, mode, reference }) => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const step = (number: number, goal: string) => ({
      topic: "topic",
      stage: "framing",
      note: "",
      thought_number: number,
      total_thoughts: 2,
      next_step_needed: true,
      executionPlan: { goal, taskSchema: { type: "object" } },
    });
    expect((await pi.call("exa_research_step", step(1, "OLD GOAL"))).isError).not.toBe(true);
    const initial = (await pi.call("exa_research_summary")).details.artifact;
    if (!initial || typeof initial !== "object" || !("hash" in initial)) throw new Error("Missing initial artifact");
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let interleave = true;
    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      await original.unlink(path);
      // Finish a real sibling edit after the first read releases its lock,
      // before the outer tool can consume that now-stale snapshot.
      if (interleave && String(path).endsWith(".lock")) {
        interleave = false;
        expect((await pi.call("exa_research_step", step(2, "NEW GOAL"))).isError).not.toBe(true);
      }
    });
    const preview = await pi.call(tool, {
      ...(mode === undefined ? {} : { mode }),
      ...(reference === "hash"
        ? { artifactHash: initial.hash }
        : {
            expectedRevision: reference === "current-revision" ? 2 : 1,
          }),
    });
    if (reference === "current-revision") {
      if (tool === "exa_research_summary") {
        expect(preview.isError).not.toBe(true);
        if (mode === "brief" || mode === "source_pack") {
          expect(preview.details).toMatchObject({ revision: 2, executionPlan: { goal: "NEW GOAL" } });
        } else {
          expect(preview.details.artifact).toMatchObject({ revision: 2, brief: { goal: "NEW GOAL" } });
        }
      } else {
        expect(preview.isError).toBe(true);
        expect(preview.content[0]).toMatchObject({ text: expect.stringContaining("GUIDED_SUBMISSION_REQUIRED") });
        expect(offlineCreate).not.toHaveBeenCalled();
        expect(preview.details).not.toHaveProperty("issues");
      }
    } else {
      expect(preview.isError).toBe(true);
      expect(preview.details).toMatchObject({
        issues: [expect.objectContaining({ code: reference === "hash" ? "STALE_ARTIFACT" : "STALE_REVISION" })],
      });
    }
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      revision: 2,
      executionPlan: { goal: "NEW GOAL" },
    });
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it("keeps query optional for active compilation but mandatory for unrelated standalone research", async () => {
    const pi = await host();
    const schema = pi.tools.get("web_research_exa")?.parameters;
    if (!schema) throw new Error("Missing research schema");
    expect(Value.Check(schema, { researchMode: "active" })).toBe(true);
    expect((await pi.call("web_research_exa", { researchMode: "standalone" })).isError).toBe(true);
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it("does not let compiled cycle attribution become unrelated standalone work", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    const attributed = await pi.call("web_research_exa", {
      query: "topic",
      metadata: { cycleId: status.id, revision: "0" },
      researchMode: "standalone",
    });
    expect(attributed.isError).toBe(true);
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it("previews the compiled artifact and reports conflicts without dispatching paid work", async () => {
    const pi = await host();
    await pi.command?.handler("start pricing", pi.context);
    const incomplete = await pi.call("exa_research_summary", { mode: "payload" });
    expect(incomplete.isError).toBe(true);
    expect(incomplete.details).toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "MISSING_TASK_SCHEMA" })]),
    });
    expect(
      (
        await pi.call("exa_research_step", {
          topic: "pricing",
          stage: "framing",
          note: "PRIVATE_STEP_CHATTER",
          thought_number: 1,
          total_thoughts: 1,
          next_step_needed: false,
          expectedRevision: 0,
          executionPlan: { goal: "Compare prices", taskSchema: { type: "object" } },
        })
      ).isError,
    ).not.toBe(true);
    const summary = await pi.call("exa_research_summary", { mode: "payload", expectedRevision: 1 });
    expect(summary.isError).not.toBe(true);
    const artifact = summary.details.artifact;
    expect(artifact).toMatchObject({ artifactVersion: 1, revision: 1, request: { effort: "medium" } });
    expect((await pi.call("exa_research_summary")).details.artifact).toEqual(artifact);
    if (typeof artifact !== "object" || !artifact || !("hash" in artifact)) throw new Error("Missing artifact hash");
    expect((await pi.call("web_research_exa", { artifactHash: artifact.hash, effort: "high" })).details).toMatchObject({
      issues: [expect.objectContaining({ code: "EXECUTION_CONFLICT", path: "request.effort" })],
    });
    const gated = await pi.call("web_research_exa", { artifactHash: artifact.hash });
    expect(gated.isError).toBe(true);
    expect(gated.content[0]).toMatchObject({ text: expect.stringContaining("GUIDED_SUBMISSION_REQUIRED") });
    expect(offlineCreate).not.toHaveBeenCalled();
    expect((await pi.call("exa_research_summary", { mode: "payload", expectedRevision: 0 })).details).toMatchObject({
      issues: [expect.objectContaining({ code: "STALE_REVISION" })],
    });
    expect(JSON.stringify(artifact)).not.toContain("PRIVATE_STEP_CHATTER");
    expect(offlineSearch).not.toHaveBeenCalled();
    expect(offlineCreate).not.toHaveBeenCalled();
  });

  it("activates after real Pi flag application on startup and reload", async () => {
    const hostContext = await host(false);
    expect([...parseArgs(["--exa-enable-cycles"]).unknownFlags.keys()]).toEqual(["exa-enable-cycles"]);
    for (let reload = 0; reload < 2; reload++) {
      const runtime = createExtensionRuntime();
      // Isolate tool selection from the operator's Exa config; only the cycle
      // flag deliberately arrives after factory loading.
      runtime.flagValues.set("exa-config-file", join(hostContext.context.cwd, "exa.json"));
      const extension = await loadExtensionFromFactory(
        exaExtension,
        hostContext.context.cwd,
        createEventBus(),
        runtime,
      );
      expect(extension.commands.has("exa-research")).toBe(false);
      expect(extension.flags.has("exa-enable-cycles")).toBe(true);
      runtime.flagValues.set("exa-enable-cycles", true);
      for (const handler of [...(extension.handlers.get("session_start") ?? [])]) {
        await handler({ type: "session_start" }, hostContext.context);
      }
      expect(extension.commands.has("exa-research")).toBe(true);
      expect(extension.tools.get("exa_research_reset")?.definition.description).toContain("archive");
    }
  });

  it.each([
    "completed",
    "unknown",
  ])("blocks %s attempts after archive while unrelated continuations remain standalone", async (lifecycle) => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const status = (await pi.call("exa_research_status")).details;
    const path = join(pi.context.cwd, "agent", "research-cycles", String(status.projectId), `${status.id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.status = lifecycle;
    record.attempts = [{ id: "attempt-one", status: lifecycle, runId: "remote-one" }];
    await writeFile(path, JSON.stringify(record));
    const forwarded = vi.fn(async () => ({ content: [{ type: "text" as const, text: "offline" }], details: {} }));
    const tools = new Map<string, Parameters<PiToolRegistration["registerTool"]>[0]>();
    const registration = cyclePiRegistration({
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerTool: (tool: Parameters<PiToolRegistration["registerTool"]>[0]) => {
        tools.set(tool.name, tool);
      },
    } as unknown as ExtensionAPI);
    registration.registerTool({
      name: "web_research_exa",
      label: "Offline",
      description: "Offline",
      parameters: Type.Object({ query: Type.String() }),
      execute: forwarded,
    });
    const tool = tools.get("web_research_exa");
    if (!tool) throw new Error("Missing offline research tool");
    const call = () =>
      tool.execute(
        "test",
        {
          query: "continuation",
          previousRunId: "remote-one",
          researchMode: "standalone",
        },
        undefined,
        undefined,
        pi.context,
      );
    // This decorator has no local active pointer: identifiable durable attempts
    // still belong to their project cycle, not an unrelated standalone call.
    expect((await call()).isError).toBe(true);
    await pi.command?.handler("archive", pi.context);
    expect((await call()).isError).toBe(true);
    expect(forwarded).not.toHaveBeenCalled();
    const unrelated = await tool.execute(
      "test",
      {
        query: "unrelated",
        previousRunId: "unrelated-run",
        researchMode: "standalone",
      },
      undefined,
      undefined,
      pi.context,
    );
    expect(unrelated.isError).not.toBe(true);
    expect(forwarded).toHaveBeenCalledTimes(1);
  });

  it("publishes a root-object schema for provider-compatible routing arguments", async () => {
    const pi = await host();
    const schema = pi.tools.get("web_search_exa")?.parameters;
    expect(schema).toMatchObject({
      type: "object",
      properties: { researchMode: expect.any(Object), query: expect.any(Object) },
    });
  });

  it("allows explicit unrelated standalone retrieval without mutating the cycle", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    const before = (await pi.call("exa_research_status")).details;
    const result = await pi.call("web_search_exa", { query: "unrelated", researchMode: "standalone" });
    expect(result.isError).not.toBe(true);
    expect(offlineSearch).toHaveBeenCalledTimes(1);
    const after = (await pi.call("exa_research_status")).details;
    expect(after).toEqual(before);
  });

  it("rejects assistant approval flags, stale attribution, and command approval in this slice", async () => {
    const pi = await host();
    await pi.command?.handler("start topic", pi.context);
    await pi.command?.handler("approve 10", pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining("no grant"), "error");
    const status = (await pi.call("exa_research_status")).details;
    expect(status.grants).toEqual([]);
    expect((await pi.call("web_search_exa", { query: "topic", approved: true, budget: 10 })).isError).toBe(true);
    expect((await pi.call("web_search_exa", { query: "topic", cycleId: "wrong" })).isError).toBe(true);
    expect((await pi.call("web_search_exa", { query: "topic", expectedRevision: 100 })).isError).toBe(true);
    expect(offlineSearch).not.toHaveBeenCalled();
  });

  it("starts a durable plan, detaches on tree navigation, and resumes explicitly", async () => {
    const pi = await host();
    expect(pi.command).toBeDefined();
    await pi.command?.handler("start pricing", pi.context);
    const step = await pi.call("exa_research_step", {
      topic: "pricing",
      stage: "framing",
      note: "private note",
      thought_number: 1,
      total_thoughts: 1,
      next_step_needed: false,
      criteria: [{ label: "Primary evidence" }],
    });
    expect(step.isError).not.toBe(true);
    const status = await pi.call("exa_research_status");
    expect(status.details).toMatchObject({ revision: 1, status: "planning" });
    const id = status.details.id;
    await pi.handlers.get("session_tree")?.({} as never, pi.context);
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      active: false,
      savedCycles: [{ id }],
    });
    await pi.command?.handler(`resume ${id}`, pi.context);
    const resumed = await pi.call("exa_research_status");
    expect(resumed.details).toMatchObject({ id, revision: 1 });
    const reset = await pi.call("exa_research_reset");
    expect(reset.details).toMatchObject({ id, archived: true });
    expect((await pi.call("exa_research_status")).details).toMatchObject({
      active: false,
      savedCycles: [{ id, archived: true }],
    });
  });

  it("requires explicit attribution before exploratory dispatch", async () => {
    const pi = await host();
    await pi.command?.handler("start pricing", pi.context);
    const result = await pi.call("web_search_exa", { query: "pricing" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("APPROVAL_REQUIRED") });
  });

  it("does not register cycle commands or lifecycle state when opt-in is disabled", async () => {
    const pi = await host(false);
    expect(pi.command).toBeUndefined();
    expect([...pi.handlers.keys()]).toEqual(["session_start"]);
    expect((await pi.call("exa_research_status")).isError).not.toBe(true);
  });
});

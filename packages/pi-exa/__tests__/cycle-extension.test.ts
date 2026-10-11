import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { cyclePiRegistration } from "../extensions/cycle-pi.js";
import exaExtension from "../extensions/index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, unlink: vi.fn(original.unlink), rename: vi.fn(original.rename) };
});

const offlineSearch = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(async () => ({ results: [], requestId: "offline" })),
);
const offlineCreate = vi.hoisted(() => vi.fn(async () => ({ id: "offline", status: "completed" })));
vi.mock("exa-js", () => ({
  Exa: class {
    search = offlineSearch;
    getContents = offlineSearch;
    findSimilar = offlineSearch;
    answer = offlineSearch;
    agent = { runs: { create: offlineCreate } };
  },
}));

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(fs.unlink).mockReset();
  vi.mocked(fs.rename).mockReset();
  offlineSearch.mockReset().mockResolvedValue({ results: [], requestId: "offline" });
  offlineCreate.mockClear();
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
      enabledTools: [
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
      ],
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
  const context = {
    cwd: directory,
    sessionManager: { getSessionId: () => "session-one" },
    ui: { notify },
  } as unknown as ExtensionToolContext;
  const pi = {
    registerFlag: vi.fn(),
    getFlag: (name: string) =>
      name === "exa-enable-cycles"
        ? enabled
        : name === "--exa-config-file"
          ? config
          : name === "--exa-timeout-ms" && timeoutMs !== undefined
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
  return {
    tools,
    handlers,
    context,
    notify,
    command,
    call: (name: string, args = {}, signal?: AbortSignal) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute("call", args, signal, undefined, context);
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
    const denied = await pi.call("web_search_exa", args);
    expect(denied.details.assessment).toMatchObject({
      reason: "INSUFFICIENT_BALANCE",
      pendingEstimatedDollars: 0.007,
    });
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
        expect(preview.content[0]).toMatchObject({ text: expect.stringContaining("no request was dispatched") });
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
    expect(gated.content[0]).toMatchObject({ text: expect.stringContaining("no request was dispatched") });
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
      runtime.flagValues.set("--exa-config-file", join(hostContext.context.cwd, "exa.json"));
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
    expect((await pi.call("exa_research_status")).isError).toBe(true);
    await pi.command?.handler(`resume ${id}`, pi.context);
    const resumed = await pi.call("exa_research_status");
    expect(resumed.details).toMatchObject({ id, revision: 1 });
    const reset = await pi.call("exa_research_reset");
    expect(reset.details).toMatchObject({ id, archived: true });
    expect((await pi.call("exa_research_status")).isError).toBe(true);
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

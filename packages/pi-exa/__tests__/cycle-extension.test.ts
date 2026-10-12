import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import type { PiToolRegistration } from "@feniix/bridgekit/pi";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { cyclePiRegistration } from "../extensions/cycle-pi.js";
import exaExtension from "../extensions/index.js";

const offlineSearch = vi.hoisted(() => vi.fn(async () => ({ results: [], requestId: "offline" })));
vi.mock("exa-js", () => ({
  Exa: class {
    search = offlineSearch;
  },
}));

const directories: string[] = [];
afterEach(async () => {
  offlineSearch.mockClear();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function host(enabled = true) {
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
      ],
      apiKey: "offline-fixture-key",
    }),
  );
  const tools = new Map<string, Parameters<PiToolRegistration["registerTool"]>[0]>();
  const handlers = new Map<string, (event: never, context: ExtensionContext) => Promise<void>>();
  const commands = new Map<string, { handler: (args: string, context: ExtensionContext) => Promise<void> }>();
  const notify = vi.fn();
  const context = {
    cwd: directory,
    sessionManager: { getSessionId: () => "session-one" },
    ui: { notify },
  } as unknown as ExtensionToolContext;
  const pi = {
    registerFlag: vi.fn(),
    getFlag: (name: string) =>
      name === "exa-enable-cycles" ? enabled : name === "--exa-config-file" ? config : undefined,
    registerTool: (tool: Parameters<PiToolRegistration["registerTool"]>[0]) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: { handler: (args: string, context: ExtensionContext) => Promise<void> }) =>
      commands.set(name, command),
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
    call: (name: string, args = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute("call", args, undefined, undefined, context);
    },
  };
}

describe("Pi cycle commands and tools", () => {
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
    await writeFile(join(directory, `${broken}.json`), "{SECRET_UNREADABLE_RECORD", { mode: 0o600 });
    await pi.command?.handler("list", pi.context);
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining(broken), "info");
    expect(pi.notify).toHaveBeenLastCalledWith(expect.stringContaining(String(status.id)), "info");
    expect(JSON.stringify(pi.notify.mock.calls.at(-1))).not.toContain("SECRET_UNREADABLE_RECORD");
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

  it("gates paid integrated calls while cycle execution is incomplete", async () => {
    const pi = await host();
    await pi.command?.handler("start pricing", pi.context);
    const result = await pi.call("web_search_exa", { query: "pricing" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("not available") });
  });

  it("does not register cycle commands or lifecycle state when opt-in is disabled", async () => {
    const pi = await host(false);
    expect(pi.command).toBeUndefined();
    expect([...pi.handlers.keys()]).toEqual(["session_start"]);
    expect((await pi.call("exa_research_status")).isError).not.toBe(true);
  });
});

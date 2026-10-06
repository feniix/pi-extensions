import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ThemeStyle } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { stripAnsi } from "../extensions/format.js";
import statuslineExtension from "../extensions/index.js";
import type { SessionEntryLike } from "../extensions/types.js";

async function setup(mode: "tui" | "rpc" | "print" | "json" = "tui", cwd = "/tmp/project") {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    getThinkingLevel: vi.fn(() => "medium"),
    getCommands: vi.fn(() => []),
    exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "", killed: false })),
  };
  const ctx = {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    cwd,
    model: { id: "opus", contextWindow: 1000000 },
    sessionManager: {
      getBranch: vi.fn<() => SessionEntryLike[]>(() => []),
      getLeafId: vi.fn(() => "root"),
      getSessionId: () => "session",
    },
    getContextUsage: vi.fn<() => { percent: number | null }>(() => ({ percent: 12 })),
    ui: { setFooter: vi.fn() },
  };
  statuslineExtension(pi as unknown as ExtensionAPI);
  const emit = async (name: string, event: object = {}) => {
    const handler = pi.on.mock.calls.find(([registered]) => registered === name)?.[1];
    expect(handler, `registered ${name} handler`).toBeDefined();
    return handler(event, ctx);
  };
  await emit("session_start");
  const statuses = new Map<string, string>();
  const theme = { style: vi.fn((text: string, _style: ThemeStyle) => text) };
  const text = (width = 500) => {
    const factory = ctx.ui.setFooter.mock.calls.at(-1)?.[0];
    const footer = factory?.({ requestRender: vi.fn() }, theme, {
      getGitBranch: () => null,
      getExtensionStatuses: () => statuses,
      onBranchChange: () => vi.fn(),
    });
    return stripAnsi(footer?.render(width).join("\n") ?? "");
  };
  return { pi, ctx, emit, text, statuses, theme };
}

describe("pi 1.x statusline lifecycle", () => {
  it("applies project palette overrides and optional live cost/cache details", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-statusline-runtime-"));
    try {
      await mkdir(join(cwd, ".pi"));
      await writeFile(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({
          "pi-statusline": { palette: { model: "#112233" }, showCost: true, showCache: true },
        }),
      );
      const { emit, text, theme } = await setup("tui", cwd);
      await emit("message_update", {
        message: {
          role: "assistant",
          usage: { input: 100, output: 40, cacheRead: 2000, cacheWrite: 500, cost: { total: 0.125 } },
        },
        assistantMessageEvent: { type: "text_delta" },
      });
      expect(text()).toContain("↑100/↓40 R2.0k W500 $0.125");
      expect(theme.style).toHaveBeenCalledWith("Model: opus (1.0M context)", {
        fg: { kind: "rgb", r: 17, g: 34, b: 51 },
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it("exposes a plain-text snapshot in RPC without installing or updating a terminal footer", async () => {
    const { pi, ctx, emit } = await setup("rpc");
    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
    expect(pi.exec).not.toHaveBeenCalled();
    await emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } });
    expect(ctx.sessionManager.getBranch).not.toHaveBeenCalled();
    const tool = pi.registerTool.mock.calls[0]?.[0];
    expect(tool).toBeDefined();
    const result = await tool.execute("snapshot", {}, undefined, undefined, ctx);
    expect(result.content[0].text).toContain("Model: opus");
    expect(result.content[0].text).not.toContain("\u001B");
  });
  it.each(["print", "json"] as const)("stays inert in %s mode", async (mode) => {
    const { pi, ctx, emit } = await setup(mode);
    await emit("agent_start");
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.exec).not.toHaveBeenCalled();
    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
  });
  it("renders through the supplied native theme", async () => {
    const { text, theme } = await setup();
    expect(text()).toContain("Model: opus");
    expect(theme.style).toHaveBeenCalled();
  });
  it("does not rescan the branch for streaming deltas or double count committed live usage", async () => {
    const { ctx, emit, text } = await setup();
    const entries: SessionEntryLike[] = [
      { type: "message", message: { role: "assistant", usage: { input: 100, output: 40 } } },
    ];
    ctx.sessionManager.getBranch.mockReturnValue(entries);
    await emit("session_tree");
    ctx.sessionManager.getBranch.mockClear();
    const message = { role: "assistant", usage: { input: 25, output: 9 } };
    await emit("message_update", { message, assistantMessageEvent: { type: "text_delta" } });
    await emit("message_update", { message, assistantMessageEvent: { type: "text_delta" } });
    expect(text()).toContain("↑125/↓49");
    expect(ctx.sessionManager.getBranch).not.toHaveBeenCalled();
    await emit("message_end", { message });
    expect(text()).toContain("↑125/↓49");
    entries.push({ type: "message", message });
    ctx.sessionManager.getLeafId.mockReturnValue("committed");
    await emit("tool_execution_start", { toolCallId: "a", toolName: "read" });
    expect(text()).toContain("↑125/↓49");
  });
  it("keeps live extension statuses and activity visible ahead of long paths", async () => {
    const { ctx, emit, text, statuses } = await setup();
    ctx.cwd = `/tmp/${"long".repeat(50)}`;
    await emit("session_start");
    statuses.set("z", "\u001B[31mMemory ready\u001B[0m");
    statuses.set("a", "Review running");
    const narrow = text(80);
    expect(narrow).toContain("Ctx: 12.0%");
    expect(narrow).toContain("Act: idle");
    expect(narrow).toContain("Review running | Memory ready");
    for (const line of narrow.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    statuses.delete("a");
    expect(text()).not.toContain("Review running");
  });
  it.each(["assistant", "toolResult"])("reconciles replaced %s usage after message_end", async (role) => {
    const { ctx, emit, text } = await setup();
    const entries = [{ id: "root", type: "message", message: { role: "assistant", usage: { input: 10, output: 4 } } }];
    ctx.sessionManager.getBranch.mockReturnValue(entries);
    await emit("session_tree");
    const message = { role, usage: { input: 100, output: 40 } };
    await emit("message_end", { message });
    expect(text()).toContain("↑110/↓44");
    // A later pi message_end handler replaces the object and may change its usage.
    entries.push({ id: "replaced", type: "message", message: { ...message, usage: { input: 120, output: 50 } } });
    ctx.sessionManager.getLeafId.mockReturnValue("replaced");
    await emit("thinking_level_select");
    expect(text()).toContain("↑130/↓54");
    await emit("message_update", {
      message: { role: "assistant", usage: { input: 5, output: 2 } },
      assistantMessageEvent: { type: "text_delta" },
    });
    expect(text()).toContain("↑135/↓56");
  });
  it("normalizes multiline extension statuses into exactly two bounded footer rows", async () => {
    const { text, statuses } = await setup();
    statuses.set("a", "\u001B[31mReady\nSecond row\r\tDone\u001B[0m");
    statuses.set("b", " \n\t ");
    for (const width of [20, 40, 80, 500]) {
      const rows = text(width).split("\n");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).not.toMatch(/[\r\t]/);
        expect(visibleWidth(row)).toBeLessThanOrEqual(width);
      }
    }
    expect(text()).toContain("Ready Second row Done");
  });
  it("refreshes thinking, compaction context, and tree navigation immediately", async () => {
    const { pi, ctx, emit, text } = await setup();
    pi.getThinkingLevel.mockReturnValue("high");
    await emit("thinking_level_select", { level: "high" });
    expect(text()).toContain("Thinking: high");
    ctx.getContextUsage.mockReturnValue({ percent: null });
    await emit("session_compact");
    expect(text()).toContain("Ctx: n/a");
    ctx.getContextUsage.mockReturnValue({ percent: 3 });
    await emit("session_tree");
    expect(text()).toContain("Ctx: 3.0%");
  });
  it("tracks parallel and nested calls by identity rather than naming a finished call", async () => {
    const { emit, text } = await setup();
    await emit("tool_execution_start", { toolCallId: "a", toolName: "codemode" });
    await emit("tool_execution_start", { toolCallId: "a/1", parentToolCallId: "a", toolName: "read" });
    await emit("tool_execution_start", { toolCallId: "b", toolName: "bash" });
    await emit("tool_execution_start", { toolCallId: "b", toolName: "bash" });
    expect(text()).toContain("Act: bash x3");
    await emit("tool_execution_end", { toolCallId: "b", toolName: "bash" });
    expect(text()).toContain("Act: read x2");
    await emit("tool_execution_end", { toolCallId: "b", toolName: "bash" });
    await emit("tool_execution_end", { toolCallId: "unknown", toolName: "write" });
    await emit("tool_execution_update", { toolCallId: "b", toolName: "bash" });
    expect(text()).toContain("Act: read x2");
    await emit("tool_execution_end", { toolCallId: "a/1", toolName: "read" });
    expect(text()).toContain("Act: codemode");
    await emit("tool_execution_end", { toolCallId: "a", toolName: "codemode" });
    expect(text()).toContain("Act: running");
  });
  it("restores underlying activity after nested user prompts", async () => {
    const { emit, text } = await setup();
    await emit("agent_start");
    await emit("ui_prompt_start", { kind: "confirm" });
    await emit("ui_prompt_start", { kind: "input" });
    await emit("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta" } });
    expect(text()).toContain("Act: waiting for user");
    await emit("ui_prompt_end");
    expect(text()).toContain("Act: waiting for user");
    await emit("ui_prompt_end");
    expect(text()).toContain("Act: thinking");
  });
  it("does not report idle until automatic continuations have settled", async () => {
    const { emit, text } = await setup();
    await emit("agent_start");
    await emit("agent_end");
    expect(text()).toContain("Act: running");
    await emit("agent_settled");
    expect(text()).toContain("Act: idle");
  });
});

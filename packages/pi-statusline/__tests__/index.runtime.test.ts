import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripAnsi } from "../extensions/format.js";
import statuslineExtension, {
  buildLines,
  createInitialGitSnapshot,
  createInitialState,
  extractSkillName,
  getBranchLabel,
  getDirtyLabel,
  getWorktreeLabel,
} from "../extensions/index.js";

function createMockPi() {
  return {
    on: vi.fn(),
    getThinkingLevel: vi.fn(() => "medium"),
    exec: vi.fn(async (_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("rev-parse --is-inside-work-tree"))
        return { code: 0, stdout: "true", stderr: "", killed: false };
      if (joined.includes("rev-parse --show-toplevel"))
        return { code: 0, stdout: "/tmp/project", stderr: "", killed: false };
      if (joined.includes("rev-parse --git-dir")) return { code: 0, stdout: ".git", stderr: "", killed: false };
      if (joined.includes("branch --show-current")) return { code: 0, stdout: "main", stderr: "", killed: false };
      if (joined.includes("status --porcelain")) return { code: 0, stdout: " M file.ts\n", stderr: "", killed: false };
      if (joined.includes("worktree list --porcelain")) {
        return {
          code: 0,
          stdout: "worktree /tmp/project\nHEAD abc\nbranch refs/heads/main\n",
          stderr: "",
          killed: false,
        };
      }
      return { code: 1, stdout: "", stderr: "", killed: false };
    }),
    getCommands: vi.fn(() => [{ name: "release", source: "skill" }]),
    registerTool: vi.fn(),
  };
}

describe("pi-statusline runtime helpers", () => {
  it("builds initial snapshots and labels", () => {
    expect(createInitialGitSnapshot()).toEqual({
      repoName: null,
      branch: null,
      dirtyCount: 0,
      worktreeLabel: "no git",
    });
    expect(createInitialState().modelLabel).toBe("Model: none");
    expect(createInitialState().activityLabel).toBe("Act: idle");
    expect(getBranchLabel("main")).toBe("⎇ main");
    expect(getBranchLabel(null)).toBe("⎇ no git");
    expect(getWorktreeLabel("feature")).toBe("𖠰 feature");
    expect(getDirtyLabel(2)).toBe("dirty: +2");
  });

  it("builds and truncates status lines", () => {
    const lines = buildLines(
      "/tmp/project",
      {
        ...createInitialState(),
        modelLabel: "Model: opus",
        thinkingLabel: "Thinking: medium",
        contextLabel: "Ctx: 10.0%",
        tokenLabel: "↑1.0k/↓2.0k",
        gitSnapshot: { repoName: "project", branch: "main", dirtyCount: 3, worktreeLabel: "main" },
        lastSkill: "release",
        activityLabel: "Act: responding",
      },
      "main",
      30,
    );

    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines[0] ?? "").length).toBeLessThanOrEqual(30);
    expect(stripAnsi(lines[1] ?? "").length).toBeLessThanOrEqual(30);
  });

  it("extracts and ignores skill commands", () => {
    expect(extractSkillName("/release now", [{ name: "release", source: "skill" }])).toBe("release");
    expect(extractSkillName("plain text", [])).toBeNull();
    expect(extractSkillName("/skill:", [])).toBeNull();
  });
});

describe("pi-statusline extension runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits status lines on non-UI session start and updates footer in UI mode", async () => {
    const mockPi = createMockPi();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const setFooter = vi.fn();

    await sessionStartHandler?.(
      {},
      {
        cwd: "/tmp/project",
        hasUI: false,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: {
          getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 10, output: 20 } } }],
        },
        getContextUsage: () => ({ percent: 12 }),
        ui: { setFooter },
      },
    );

    expect(logSpy).toHaveBeenCalled();

    await sessionStartHandler?.(
      {},
      {
        cwd: "/tmp/project",
        hasUI: true,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: { getBranch: () => [] },
        getContextUsage: () => ({ percent: 12 }),
        ui: { setFooter },
      },
    );

    expect(setFooter).toHaveBeenCalledTimes(1);
  });

  it("throttles footer rerenders during rapid streaming updates", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const messageUpdateHandler = mockPi.on.mock.calls.find(([name]) => name === "message_update")?.[1];
    const setFooter = vi.fn();
    const ctx = {
      cwd: "/tmp/project",
      hasUI: true,
      model: { id: "opus", contextWindow: 1000000 },
      sessionManager: { getBranch: () => [] },
      getContextUsage: () => ({ percent: 12 }),
      ui: { setFooter },
    };

    await sessionStartHandler?.({}, ctx);

    const footerFactory = setFooter.mock.calls[0]?.[0];
    const requestRender = vi.fn();
    footerFactory?.(
      { requestRender },
      {},
      {
        getGitBranch: () => "main",
        onBranchChange: () => vi.fn(),
      },
    );

    await messageUpdateHandler?.(
      { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } },
      ctx,
    );
    await messageUpdateHandler?.(
      { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } },
      ctx,
    );
    await messageUpdateHandler?.(
      { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } },
      ctx,
    );

    expect(requestRender).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it("does not read stale session context from footer render callbacks", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const setFooter = vi.fn();

    let stale = false;
    const ctx = {
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      getContextUsage: () => ({ percent: 12 }),
      ui: { setFooter },
      get model() {
        if (stale) {
          throw new Error("Extension instance is stale");
        }
        return { id: "opus", contextWindow: 1000000 };
      },
      get cwd() {
        if (stale) {
          throw new Error("Extension instance is stale");
        }
        return "/tmp/project";
      },
    } as unknown as {
      hasUI: true;
      sessionManager: { getBranch: () => [] };
      getContextUsage: () => { percent: number };
      ui: { setFooter: typeof setFooter };
      model: { id: string; contextWindow: number };
      cwd: string;
    };

    await sessionStartHandler?.({}, ctx);

    const footerFactory = setFooter.mock.calls[0]?.[0];
    const footer = footerFactory?.(
      { requestRender: vi.fn() },
      {},
      {
        getGitBranch: () => "main",
        onBranchChange: () => vi.fn(),
      },
    );
    expect(footer).toBeDefined();

    stale = true;

    expect(() => {
      footer?.render(120);
    }).not.toThrow();
  });

  it("tracks activity and live token usage during tool execution", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const inputHandler = mockPi.on.mock.calls.find(([name]) => name === "input")?.[1];
    const messageUpdateHandler = mockPi.on.mock.calls.find(([name]) => name === "message_update")?.[1];
    const toolStartHandler = mockPi.on.mock.calls.find(([name]) => name === "tool_execution_start")?.[1];
    const toolDef = mockPi.registerTool.mock.calls[0]?.[0];

    const branchEntries = [
      { type: "message", message: { role: "assistant", usage: { input: 100, output: 40 } } },
      { type: "message", message: { role: "assistant", usage: { input: 10, output: 5 } } },
    ];
    const ctx = {
      cwd: "/tmp/project",
      hasUI: false,
      model: { id: "opus", contextWindow: 1000000 },
      sessionManager: { getBranch: () => branchEntries },
      getContextUsage: () => ({ percent: 12 }),
    };

    await inputHandler?.({ text: "/release" }, ctx);
    await messageUpdateHandler?.(
      {
        message: { role: "assistant", usage: { input: 25, output: 9 } },
        assistantMessageEvent: { type: "text_delta" },
      },
      ctx,
    );
    await toolStartHandler?.({ toolName: "bash", args: {} }, ctx);

    const result = await toolDef.execute("tool-id", {}, new AbortController().signal, undefined, ctx);

    const text = stripAnsi(result.content[0]?.text ?? "");
    expect(text).toContain("Skill: release");
    expect(text).toContain("Act: bash");
    expect(text).toContain("↑125/↓49");
  });
});

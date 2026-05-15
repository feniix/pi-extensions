import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

  it("skips non-UI session starts and updates footer in UI mode", async () => {
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

    expect(logSpy).not.toHaveBeenCalled();
    expect(setFooter).not.toHaveBeenCalled();
    expect(mockPi.registerTool).not.toHaveBeenCalled();

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
    expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
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

  it("ignores stale async session-start git refreshes", async () => {
    vi.useRealTimers();
    const mockPi = createMockPi();
    let releaseSlowGit: (() => void) | undefined;
    let slowGitReleased = false;

    mockPi.exec.mockImplementation(async (_cmd: string, args: string[], options?: { cwd?: string }) => {
      const cwd = options?.cwd ?? "/tmp/fast";
      const joined = args.join(" ");
      if (cwd === "/tmp/slow" && joined.includes("rev-parse --is-inside-work-tree") && !slowGitReleased) {
        await new Promise<void>((resolve) => {
          releaseSlowGit = () => {
            slowGitReleased = true;
            resolve();
          };
        });
      }

      if (joined.includes("rev-parse --is-inside-work-tree"))
        return { code: 0, stdout: "true", stderr: "", killed: false };
      if (joined.includes("rev-parse --show-toplevel")) {
        return {
          code: 0,
          stdout: cwd === "/tmp/slow" ? "/tmp/slow-repo" : "/tmp/fast-repo",
          stderr: "",
          killed: false,
        };
      }
      if (joined.includes("rev-parse --git-dir")) return { code: 0, stdout: ".git", stderr: "", killed: false };
      if (joined.includes("branch --show-current")) {
        return { code: 0, stdout: cwd === "/tmp/slow" ? "slow-branch" : "fast-branch", stderr: "", killed: false };
      }
      if (joined.includes("status --porcelain")) {
        return { code: 0, stdout: cwd === "/tmp/slow" ? " M slow.ts\n" : "", stderr: "", killed: false };
      }
      if (joined.includes("worktree list --porcelain")) {
        return {
          code: 0,
          stdout: `worktree ${cwd === "/tmp/slow" ? "/tmp/slow-repo" : "/tmp/fast-repo"}\nHEAD abc\nbranch refs/heads/main\n`,
          stderr: "",
          killed: false,
        };
      }
      return { code: 1, stdout: "", stderr: "", killed: false };
    });

    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const setFooter = vi.fn();
    const slowStart = sessionStartHandler?.(
      {},
      {
        cwd: "/tmp/slow",
        hasUI: true,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: { getBranch: () => [] },
        getContextUsage: () => ({ percent: 12 }),
        ui: { setFooter },
      },
    );

    for (let i = 0; i < 20 && !releaseSlowGit; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(releaseSlowGit).toBeDefined();

    const fastStart = sessionStartHandler?.(
      {},
      {
        cwd: "/tmp/fast",
        hasUI: true,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: { getBranch: () => [] },
        getContextUsage: () => ({ percent: 12 }),
        ui: { setFooter },
      },
    );

    await fastStart;
    releaseSlowGit?.();
    await slowStart;

    const footerFactory = setFooter.mock.calls[0]?.[0];
    const footer = footerFactory?.(
      { requestRender: vi.fn() },
      {},
      {
        getGitBranch: () => "fast-branch",
        onBranchChange: () => vi.fn(),
      },
    );

    const text = stripAnsi(footer?.render(120).join("\n") ?? "");
    expect(text).toContain("fast-repo");
    expect(text).not.toContain("slow-repo");
  });

  it("reinstalls the footer for repeated UI session starts", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
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
    await sessionStartHandler?.({}, ctx);

    expect(setFooter).toHaveBeenCalledTimes(2);
  });

  it("does not rerender when async agent-end refresh loses the session race", async () => {
    vi.useRealTimers();
    const mockPi = createMockPi();
    let releaseGit: (() => void) | undefined;
    let blockNextGitRefresh = false;

    mockPi.exec.mockImplementation(async (_cmd: string, args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("rev-parse --is-inside-work-tree")) {
        if (blockNextGitRefresh) {
          await new Promise<void>((resolve) => {
            releaseGit = resolve;
          });
        }
        return { code: 0, stdout: "true", stderr: "", killed: false };
      }
      if (joined.includes("rev-parse --show-toplevel"))
        return { code: 0, stdout: "/tmp/project", stderr: "", killed: false };
      if (joined.includes("rev-parse --git-dir")) return { code: 0, stdout: ".git", stderr: "", killed: false };
      if (joined.includes("branch --show-current")) return { code: 0, stdout: "main", stderr: "", killed: false };
      if (joined.includes("status --porcelain")) return { code: 0, stdout: "", stderr: "", killed: false };
      if (joined.includes("worktree list --porcelain")) {
        return {
          code: 0,
          stdout: "worktree /tmp/project\nHEAD abc\nbranch refs/heads/main\n",
          stderr: "",
          killed: false,
        };
      }
      return { code: 1, stdout: "", stderr: "", killed: false };
    });

    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const sessionShutdownHandler = mockPi.on.mock.calls.find(([name]) => name === "session_shutdown")?.[1];
    const agentEndHandler = mockPi.on.mock.calls.find(([name]) => name === "agent_end")?.[1];
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

    blockNextGitRefresh = true;
    const result = agentEndHandler?.({}, ctx);
    for (let i = 0; i < 20 && !releaseGit; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(releaseGit).toBeDefined();

    await sessionShutdownHandler?.({}, ctx);
    releaseGit?.();
    await result;

    expect(requestRender).not.toHaveBeenCalled();
  });

  it("does not read session context after async agent-end refreshes", async () => {
    const mockPi = createMockPi();
    mockPi.exec.mockImplementation(async (_cmd: string, args: string[]) => {
      await Promise.resolve();
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
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const agentEndHandler = mockPi.on.mock.calls.find(([name]) => name === "agent_end")?.[1];

    let stale = false;
    const ctx = {
      get cwd() {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
        return "/tmp/project";
      },
      get hasUI() {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
        return true;
      },
      get model() {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
        return { id: "opus", contextWindow: 1000000 };
      },
      sessionManager: {
        getBranch: () => {
          if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
          return [];
        },
      },
      getContextUsage: () => {
        if (stale) throw new Error("This extension ctx is stale after session replacement or reload");
        return { percent: 12 };
      },
    };

    const result = agentEndHandler?.({}, ctx);
    stale = true;

    await expect(result).resolves.not.toThrow();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("continues input handling when the input context is stale", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const inputHandler = mockPi.on.mock.calls.find(([name]) => name === "input")?.[1];
    const ctx = {
      get hasUI() {
        throw new Error("This extension ctx is stale after session replacement or reload");
      },
    };

    await expect(Promise.resolve(inputHandler?.({ text: "/release" }, ctx))).resolves.toEqual({ action: "continue" });
  });

  it("keeps statusline tool inert in non-UI sessions after a UI session", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const setFooter = vi.fn();

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
    await sessionStartHandler?.(
      {},
      {
        cwd: "/tmp/project",
        hasUI: false,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: { getBranch: () => [] },
        getContextUsage: () => ({ percent: 12 }),
        ui: { setFooter },
      },
    );

    const toolDef = mockPi.registerTool.mock.calls[0]?.[0];
    const result = await toolDef.execute("tool-id", {}, new AbortController().signal, undefined, {
      cwd: "/tmp/project",
      hasUI: false,
    });

    expect(result.content[0]?.text).toContain("unavailable in non-UI sessions");
  });

  it("tracks activity and live token usage during tool execution", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const sessionStartHandler = mockPi.on.mock.calls.find(([name]) => name === "session_start")?.[1];
    const inputHandler = mockPi.on.mock.calls.find(([name]) => name === "input")?.[1];
    const messageUpdateHandler = mockPi.on.mock.calls.find(([name]) => name === "message_update")?.[1];
    const toolStartHandler = mockPi.on.mock.calls.find(([name]) => name === "tool_execution_start")?.[1];

    const branchEntries = [
      { type: "message", message: { role: "assistant", usage: { input: 100, output: 40 } } },
      { type: "message", message: { role: "assistant", usage: { input: 10, output: 5 } } },
    ];
    const ctx = {
      cwd: "/tmp/project",
      hasUI: true,
      model: { id: "opus", contextWindow: 1000000 },
      sessionManager: { getBranch: () => branchEntries },
      getContextUsage: () => ({ percent: 12 }),
      ui: { setFooter: vi.fn() },
    };

    await sessionStartHandler?.({}, ctx);
    const toolDef = mockPi.registerTool.mock.calls[0]?.[0];

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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
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
      if (joined.includes("rev-parse --is-inside-work-tree")) return { code: 0, stdout: "true", stderr: "", killed: false };
      if (joined.includes("rev-parse --show-toplevel")) return { code: 0, stdout: "/tmp/project", stderr: "", killed: false };
      if (joined.includes("rev-parse --git-dir")) return { code: 0, stdout: ".git", stderr: "", killed: false };
      if (joined.includes("branch --show-current")) return { code: 0, stdout: "main", stderr: "", killed: false };
      if (joined.includes("status --porcelain")) return { code: 0, stdout: " M file.ts\n", stderr: "", killed: false };
      if (joined.includes("worktree list --porcelain")) {
        return { code: 0, stdout: "worktree /tmp/project\nHEAD abc\nbranch refs/heads/main\n", stderr: "", killed: false };
      }
      return { code: 1, stdout: "", stderr: "", killed: false };
    }),
    getCommands: vi.fn(() => [{ name: "release", source: "skill" }]),
    registerTool: vi.fn(),
  };
}

describe("pi-statusline runtime helpers", () => {
  it("builds initial snapshots and labels", () => {
    expect(createInitialGitSnapshot()).toEqual({ repoName: null, branch: null, dirtyCount: 0, worktreeLabel: "no git" });
    expect(createInitialState().modelLabel).toBe("Model: none");
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
      },
      "main",
      30,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]?.length).toBeLessThanOrEqual(30);
    expect(lines[1]?.length).toBeLessThanOrEqual(30);
  });

  it("extracts and ignores skill commands", () => {
    expect(extractSkillName("/release now", [{ name: "release", source: "skill" }])).toBe("release");
    expect(extractSkillName("plain text", [])).toBeNull();
    expect(extractSkillName("/skill:", [])).toBeNull();
  });
});

describe("pi-statusline extension runtime", () => {
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
        sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 10, output: 20 } } }] },
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
    logSpy.mockRestore();
  });

  it("captures skill usage from input and tool execution events", async () => {
    const mockPi = createMockPi();
    statuslineExtension(mockPi as unknown as ExtensionAPI);

    const inputHandler = mockPi.on.mock.calls.find(([name]) => name === "input")?.[1];
    const toolHandler = mockPi.on.mock.calls.find(([name]) => name === "tool_execution_start")?.[1];
    const toolDef = mockPi.registerTool.mock.calls[0]?.[0];

    await inputHandler?.({ text: "/release" });
    await toolHandler?.({ toolName: "Skill", args: { skill: "coverage" } });

    const result = await toolDef.execute(
      "tool-id",
      {},
      new AbortController().signal,
      undefined,
      {
        cwd: "/tmp/project",
        hasUI: false,
        model: { id: "opus", contextWindow: 1000000 },
        sessionManager: { getBranch: () => [] },
        getContextUsage: () => ({ percent: 12 }),
      },
    );

    expect(result.content[0]?.text).toContain("Skill: coverage");
  });
});

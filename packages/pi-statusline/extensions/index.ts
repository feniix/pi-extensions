import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadStatuslinePalette } from "./config.js";
import { buildStatusLines } from "./format.js";
import { getGitSnapshot } from "./git.js";
import { defaultPalette } from "./palette.js";
import {
  getContextLabel,
  getCwdLabel,
  getModelLabel,
  getRepoFallbackLabel,
  getThinkingLabel,
  getTokenLabel,
} from "./session.js";
import type {
  ActivityPhase,
  AssistantUsageLike,
  CommandLike,
  GitSnapshot,
  StatuslinePalette,
  StatuslineState,
} from "./types.js";

const FOOTER_RENDER_THROTTLE_MS = 100;

type StatuslineInput = {
  modelLabel: string;
  thinkingLabel: string;
  contextLabel: string;
  branchLabel: string;
  dirtyLabel: string;
  tokenLabel: string;
  repoLabel: string;
  cwdLabel: string;
  worktreeLabel: string;
  skillLabel: string;
  activityLabel: string;
};

type DynamicCtx = Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage" | "hasUI">;
type GitCtx = Pick<ExtensionContext, "cwd" | "hasUI">;
type SkillToolEvent = { args?: { skill?: string }; tool_input?: { skill?: string } };
type AssistantMessageEventLike = { type?: string };
type AssistantMessageLike = { role?: string; usage?: AssistantUsageLike };

export function createInitialGitSnapshot(): GitSnapshot {
  return {
    repoName: null,
    branch: null,
    dirtyCount: 0,
    worktreeLabel: "no git",
  };
}

export function getActivityLabel(phase: ActivityPhase, activeToolName?: string | null, activeToolCount = 0): string {
  if (phase === "tool") {
    const toolName = activeToolName || "tool";
    const countSuffix = activeToolCount > 1 ? ` x${activeToolCount}` : "";
    return `Act: ${toolName}${countSuffix}`;
  }

  return `Act: ${phase}`;
}

export function createInitialState(): StatuslineState {
  return {
    modelLabel: "Model: none",
    thinkingLabel: "Thinking: off",
    contextLabel: "Ctx: n/a",
    tokenLabel: "↑0/↓0",
    gitSnapshot: createInitialGitSnapshot(),
    lastSkill: null,
    activityLabel: getActivityLabel("idle"),
    activityPhase: "idle",
    activeToolCount: 0,
    activeToolName: null,
    liveAssistantUsage: null,
  };
}

export function extractSkillName(text: string, commands: ReadonlyArray<CommandLike>): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const firstToken = trimmed.split(/\s+/, 1)[0]?.slice(1);
  if (!firstToken) {
    return null;
  }

  if (firstToken.startsWith("skill:")) {
    const name = firstToken.slice("skill:".length).trim();
    return name.length > 0 ? name : null;
  }

  const matchingSkill = commands.find((command) => command.source === "skill" && command.name === firstToken);
  if (!matchingSkill) {
    return null;
  }

  return matchingSkill.name.replace(/^skill:/, "");
}

export function getBranchLabel(branch: string | null | undefined): string {
  return `⎇ ${branch || "no git"}`;
}

export function getWorktreeLabel(worktreeLabel: string): string {
  return `𖠰 ${worktreeLabel || "no git"}`;
}

export function getDirtyLabel(dirtyCount: number): string {
  return `dirty: +${dirtyCount}`;
}

export function buildLines(
  cwd: string,
  state: StatuslineState,
  branchLabel: string | null,
  width?: number,
  palette: StatuslinePalette = defaultPalette,
): string[] {
  const input: StatuslineInput = {
    modelLabel: state.modelLabel,
    thinkingLabel: state.thinkingLabel,
    contextLabel: state.contextLabel,
    branchLabel: getBranchLabel(branchLabel),
    dirtyLabel: getDirtyLabel(state.gitSnapshot.dirtyCount),
    tokenLabel: state.tokenLabel,
    repoLabel: state.gitSnapshot.repoName || getRepoFallbackLabel(cwd),
    cwdLabel: getCwdLabel(cwd),
    worktreeLabel: getWorktreeLabel(state.gitSnapshot.worktreeLabel),
    skillLabel: `Skill: ${state.lastSkill || "none"}`,
    activityLabel: state.activityLabel,
  };

  return buildStatusLines(input, width, palette);
}

export default function statuslineExtension(pi: ExtensionAPI) {
  let state = createInitialState();
  let footerRegistered = false;
  let requestFooterRender: (() => void) | null = null;
  let footerRenderTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastFooterRenderAt = 0;
  let currentPalette = defaultPalette;
  let footerCwd = "";

  const clearFooterRenderTimeout = () => {
    if (footerRenderTimeout) {
      clearTimeout(footerRenderTimeout);
      footerRenderTimeout = null;
    }
  };

  const updateActivity = (
    phase: ActivityPhase,
    activeToolName = state.activeToolName,
    activeToolCount = state.activeToolCount,
  ) => {
    state = {
      ...state,
      activityPhase: phase,
      activeToolName,
      activeToolCount,
      activityLabel: getActivityLabel(phase, activeToolName, activeToolCount),
    };
  };

  const updateLiveUsage = (message?: AssistantMessageLike) => {
    if (message?.role !== "assistant" || !message.usage) {
      return;
    }

    state = {
      ...state,
      liveAssistantUsage: {
        input: message.usage.input ?? 0,
        output: message.usage.output ?? 0,
      },
    };
  };

  const clearLiveUsage = () => {
    state = {
      ...state,
      liveAssistantUsage: null,
    };
  };

  const refreshDynamicState = (ctx: Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage">) => {
    state = {
      ...state,
      modelLabel: getModelLabel(ctx.model),
      thinkingLabel: getThinkingLabel(pi.getThinkingLevel()),
      contextLabel: getContextLabel(ctx.getContextUsage(), ctx.model),
      tokenLabel: getTokenLabel(ctx.sessionManager.getBranch(), state.liveAssistantUsage),
    };
  };

  const refreshGitState = async (cwd: string) => {
    state = {
      ...state,
      gitSnapshot: await getGitSnapshot(pi, cwd),
    };
  };

  const setSkill = (skillName: string | null | undefined) => {
    if (!skillName) {
      return;
    }
    state = {
      ...state,
      lastSkill: skillName,
    };
  };

  const rerenderFooter = (immediate = false) => {
    if (!requestFooterRender) {
      return;
    }

    const now = Date.now();
    if (immediate || lastFooterRenderAt === 0 || now - lastFooterRenderAt >= FOOTER_RENDER_THROTTLE_MS) {
      clearFooterRenderTimeout();
      lastFooterRenderAt = now;
      requestFooterRender();
      return;
    }

    if (footerRenderTimeout) {
      return;
    }

    footerRenderTimeout = setTimeout(
      () => {
        footerRenderTimeout = null;
        lastFooterRenderAt = Date.now();
        requestFooterRender?.();
      },
      FOOTER_RENDER_THROTTLE_MS - (now - lastFooterRenderAt),
    );
  };

  const refreshDynamicFooter = (ctx: DynamicCtx, immediate = false) => {
    refreshDynamicState(ctx);
    if (ctx.hasUI) {
      rerenderFooter(immediate);
    }
  };

  const refreshGitFooter = async (ctx: GitCtx, immediate = false) => {
    await refreshGitState(ctx.cwd);
    if (ctx.hasUI) {
      rerenderFooter(immediate);
    }
  };

  const emitStatusLines = (ctx: Pick<ExtensionContext, "cwd">) => {
    const lines = buildLines(ctx.cwd, state, state.gitSnapshot.branch, undefined, currentPalette);
    for (const line of lines) {
      console.log(line);
    }
  };

  const updateAndLog = async (ctx: ExtensionContext, emit = true) => {
    refreshDynamicState(ctx);
    await refreshGitState(ctx.cwd);
    if (!ctx.hasUI && emit) {
      emitStatusLines(ctx);
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    state = createInitialState();
    currentPalette = await loadStatuslinePalette(ctx.cwd);
    footerCwd = ctx.cwd;
    requestFooterRender = null;
    clearFooterRenderTimeout();
    lastFooterRenderAt = 0;
    await updateAndLog(ctx);

    if (!ctx.hasUI || footerRegistered) {
      return;
    }

    footerRegistered = true;
    ctx.ui.setFooter((tui, _theme, footerData) => {
      requestFooterRender = () => tui.requestRender();
      lastFooterRenderAt = 0;
      const disposeBranchChange = footerData.onBranchChange(() => {
        void refreshGitState(footerCwd).then(() => rerenderFooter(true));
      });

      return {
        dispose() {
          clearFooterRenderTimeout();
          requestFooterRender = null;
          lastFooterRenderAt = 0;
          disposeBranchChange();
        },
        invalidate() {},
        render(width: number): string[] {
          return buildLines(footerCwd, state, footerData.getGitBranch(), width, currentPalette);
        },
      };
    });
  });

  pi.on("session_shutdown", async () => {
    clearFooterRenderTimeout();
    requestFooterRender = null;
    lastFooterRenderAt = 0;
    footerCwd = "";
  });

  pi.on("input", async (event, ctx) => {
    clearLiveUsage();
    updateActivity("queued", null, 0);
    refreshDynamicFooter(ctx, true);

    const skillName = extractSkillName(event.text, pi.getCommands() as CommandLike[]);
    if (!skillName) {
      return { action: "continue" };
    }

    setSkill(skillName);
    if (ctx.hasUI) {
      rerenderFooter(true);
    }
    return { action: "continue" };
  });

  pi.on("agent_start", async (_event, ctx) => {
    clearLiveUsage();
    updateActivity("running", null, 0);
    refreshDynamicFooter(ctx, true);
  });

  pi.on("turn_start", async (_event, ctx) => {
    updateActivity("thinking", null, state.activeToolCount);
    refreshDynamicFooter(ctx, true);
  });

  pi.on("message_start", async (event, ctx) => {
    updateLiveUsage((event as { message?: AssistantMessageLike }).message);

    const message = (event as { message?: AssistantMessageLike }).message;
    if (message?.role === "assistant") {
      updateActivity("responding", null, state.activeToolCount);
    }

    refreshDynamicFooter(ctx, true);
  });

  pi.on("message_update", async (event, ctx) => {
    updateLiveUsage((event as { message?: AssistantMessageLike }).message);

    const assistantMessageEvent = (event as { assistantMessageEvent?: AssistantMessageEventLike })
      .assistantMessageEvent;
    if (assistantMessageEvent?.type?.startsWith("thinking")) {
      updateActivity("thinking", null, state.activeToolCount);
    } else {
      updateActivity("responding", null, state.activeToolCount);
    }

    refreshDynamicFooter(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    updateLiveUsage((event as { message?: AssistantMessageLike }).message);
    updateActivity(state.activeToolCount > 0 ? "tool" : "running", state.activeToolName, state.activeToolCount);
    refreshDynamicFooter(ctx, true);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    updateActivity("tool", event.toolName, state.activeToolCount + 1);
    refreshDynamicFooter(ctx, true);

    if (event.toolName !== "Skill" && event.toolName !== "skill") {
      return;
    }

    const args = (event as SkillToolEvent).args;
    const toolInput = args ?? (event as SkillToolEvent).tool_input;
    if (typeof toolInput?.skill === "string" && toolInput.skill.length > 0) {
      setSkill(toolInput.skill);
      if (ctx.hasUI) {
        rerenderFooter(true);
      }
    }
  });

  pi.on("tool_execution_update", async (event, ctx) => {
    const activeToolCount = state.activeToolCount > 0 ? state.activeToolCount : 1;
    updateActivity("tool", event.toolName, activeToolCount);
    refreshDynamicFooter(ctx);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const activeToolCount = Math.max(0, state.activeToolCount - 1);
    const nextPhase: ActivityPhase = activeToolCount > 0 ? "tool" : "running";
    const nextToolName = activeToolCount > 0 ? event.toolName : null;
    updateActivity(nextPhase, nextToolName, activeToolCount);
    refreshDynamicFooter(ctx, true);
    await refreshGitFooter(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    clearLiveUsage();
    updateActivity("idle", null, 0);
    await updateAndLog(ctx);
    rerenderFooter(true);
  });

  pi.on("model_select", async (_event, ctx) => {
    await updateAndLog(ctx);
    rerenderFooter(true);
  });

  pi.registerTool({
    name: "statusline",
    label: "Statusline",
    description:
      "Show the current status line with model, thinking effort, context, git info, token counts, and live activity",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      await updateAndLog(ctx, false);
      const text = buildLines(ctx.cwd, state, state.gitSnapshot.branch, undefined, currentPalette).join("\n");
      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });
}

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadStatuslinePalette } from "./config.js";
import { getGitSnapshot } from "./git.js";
import { buildLines } from "./lines.js";
import { defaultPalette } from "./palette.js";
import { createRenderScheduler } from "./render-scheduler.js";
import { getContextLabel, getModelLabel, getThinkingLabel, getTokenLabel } from "./session.js";
import { createInitialState, getActivityLabel } from "./state.js";
import type { ActivityPhase, AssistantUsageLike, CommandLike, GitSnapshot } from "./types.js";
import { createUiOnlyHandler } from "./ui-mode.js";

export { buildLines, getBranchLabel, getDirtyLabel, getWorktreeLabel } from "./lines.js";
export { createInitialGitSnapshot, createInitialState, getActivityLabel } from "./state.js";

const FOOTER_RENDER_THROTTLE_MS = 100;
const STALE_EXTENSION_CONTEXT_MESSAGE = "This extension ctx is stale after session replacement or reload";

type DynamicCtx = Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage" | "hasUI">;
type GitCtx = Pick<ExtensionContext, "cwd" | "hasUI">;
type SkillToolEvent = { args?: { skill?: string }; tool_input?: { skill?: string } };
type AssistantMessageEventLike = { type?: string };
type AssistantMessageLike = { role?: string; usage?: AssistantUsageLike };

function isStaleExtensionContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STALE_EXTENSION_CONTEXT_MESSAGE);
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

export default function statuslineExtension(pi: ExtensionAPI) {
  let state = createInitialState();
  let footerRegistered = false;
  const footerRenderScheduler = createRenderScheduler(FOOTER_RENDER_THROTTLE_MS, isStaleExtensionContextError);
  let currentPalette = defaultPalette;
  let footerCwd = "";
  let sessionEpoch = 0;
  let statuslineToolRegistered = false;

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

  const readDynamicState = (ctx: Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage">) => ({
    modelLabel: getModelLabel(ctx.model),
    thinkingLabel: getThinkingLabel(pi.getThinkingLevel()),
    contextLabel: getContextLabel(ctx.getContextUsage(), ctx.model),
    tokenLabel: getTokenLabel(ctx.sessionManager.getBranch(), state.liveAssistantUsage),
  });

  const refreshDynamicState = (ctx: Pick<ExtensionContext, "model" | "sessionManager" | "getContextUsage">) => {
    state = {
      ...state,
      ...readDynamicState(ctx),
    };
  };

  const applyGitSnapshot = (gitSnapshot: GitSnapshot) => {
    state = {
      ...state,
      gitSnapshot,
    };
  };

  const refreshGitState = async (cwd: string, epoch = sessionEpoch): Promise<boolean> => {
    const gitSnapshot = await getGitSnapshot(pi, cwd);
    if (epoch !== sessionEpoch) {
      return false;
    }

    applyGitSnapshot(gitSnapshot);
    return true;
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

  const rerenderFooter = (immediate = false) => footerRenderScheduler.rerender(immediate);

  const refreshDynamicFooter = (ctx: DynamicCtx, immediate = false) => {
    refreshDynamicState(ctx);
    if (ctx.hasUI) {
      rerenderFooter(immediate);
    }
  };

  const refreshGitFooter = async (ctx: GitCtx, immediate = false) => {
    const cwd = ctx.cwd;
    const hasUI = ctx.hasUI;
    const epoch = sessionEpoch;

    const updated = await refreshGitState(cwd, epoch);
    if (hasUI && updated) {
      rerenderFooter(immediate);
    }
  };

  const refreshState = async (ctx: ExtensionContext): Promise<boolean> => {
    const cwd = ctx.cwd;
    const epoch = sessionEpoch;
    const dynamicState = readDynamicState(ctx);
    const gitSnapshot = await getGitSnapshot(pi, cwd);
    if (epoch !== sessionEpoch) {
      return false;
    }

    state = {
      ...state,
      ...dynamicState,
      gitSnapshot,
    };
    return true;
  };

  const registerStatuslineTool = () => {
    if (statuslineToolRegistered) {
      return;
    }

    statuslineToolRegistered = true;
    pi.registerTool({
      name: "statusline",
      label: "Statusline",
      description:
        "Show the current status line with model, thinking effort, context, git info, token counts, and live activity",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
        const unavailable = () => ({
          content: [{ type: "text" as const, text: "Statusline is unavailable in non-UI sessions." }],
          details: {},
        });

        try {
          if (!ctx.hasUI) {
            return unavailable();
          }
        } catch (error) {
          if (!isStaleExtensionContextError(error)) {
            throw error;
          }
          return unavailable();
        }

        const cwd = ctx.cwd;
        if (!(await refreshState(ctx))) {
          return unavailable();
        }

        const text = buildLines(cwd, state, state.gitSnapshot.branch, undefined, currentPalette).join("\n");
        return {
          content: [{ type: "text", text }],
          details: {},
        };
      },
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    const epoch = ++sessionEpoch;
    const cwd = ctx.cwd;
    const hasUI = ctx.hasUI;
    const ui = ctx.ui;

    state = createInitialState();
    footerCwd = cwd;
    footerRegistered = false;
    footerRenderScheduler.clear();

    if (!hasUI) {
      return;
    }

    refreshDynamicState(ctx);
    registerStatuslineTool();

    const [palette, gitSnapshot] = await Promise.all([loadStatuslinePalette(cwd), getGitSnapshot(pi, cwd)]);
    if (epoch !== sessionEpoch) {
      return;
    }

    currentPalette = palette;
    applyGitSnapshot(gitSnapshot);

    if (footerRegistered) {
      return;
    }

    footerRegistered = true;
    ui.setFooter((tui, _theme, footerData) => {
      footerRenderScheduler.setRenderCallback(() => tui.requestRender());
      const disposeBranchChange = footerData.onBranchChange(() => {
        const branchChangeEpoch = sessionEpoch;
        const branchChangeCwd = footerCwd;
        void refreshGitState(branchChangeCwd, branchChangeEpoch).then((updated) => {
          if (updated) {
            rerenderFooter(true);
          }
        });
      });

      return {
        dispose() {
          footerRenderScheduler.clear();
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
    sessionEpoch += 1;
    footerRegistered = false;
    footerRenderScheduler.clear();
    footerCwd = "";
  });

  const handleUiInput = createUiOnlyHandler(async (event: { text: string }, ctx: DynamicCtx) => {
    clearLiveUsage();
    updateActivity("queued", null, 0);
    refreshDynamicFooter(ctx, true);

    const skillName = extractSkillName(event.text, pi.getCommands() as CommandLike[]);
    if (!skillName) {
      return { action: "continue" as const };
    }

    setSkill(skillName);
    rerenderFooter(true);
    return { action: "continue" as const };
  });

  pi.on("input", async (event, ctx) => {
    return (await handleUiInput(event, ctx)) ?? { action: "continue" as const };
  });

  pi.on(
    "agent_start",
    createUiOnlyHandler(async (_event, ctx) => {
      clearLiveUsage();
      updateActivity("running", null, 0);
      refreshDynamicFooter(ctx, true);
    }),
  );

  pi.on(
    "turn_start",
    createUiOnlyHandler(async (_event, ctx) => {
      updateActivity("thinking", null, state.activeToolCount);
      refreshDynamicFooter(ctx, true);
    }),
  );

  pi.on(
    "message_start",
    createUiOnlyHandler(async (event, ctx) => {
      updateLiveUsage((event as { message?: AssistantMessageLike }).message);

      const message = (event as { message?: AssistantMessageLike }).message;
      if (message?.role === "assistant") {
        updateActivity("responding", null, state.activeToolCount);
      }

      refreshDynamicFooter(ctx, true);
    }),
  );

  pi.on(
    "message_update",
    createUiOnlyHandler(async (event, ctx) => {
      updateLiveUsage((event as { message?: AssistantMessageLike }).message);

      const assistantMessageEvent = (event as { assistantMessageEvent?: AssistantMessageEventLike })
        .assistantMessageEvent;
      if (assistantMessageEvent?.type?.startsWith("thinking")) {
        updateActivity("thinking", null, state.activeToolCount);
      } else {
        updateActivity("responding", null, state.activeToolCount);
      }

      refreshDynamicFooter(ctx);
    }),
  );

  pi.on(
    "message_end",
    createUiOnlyHandler(async (event, ctx) => {
      updateLiveUsage((event as { message?: AssistantMessageLike }).message);
      updateActivity(state.activeToolCount > 0 ? "tool" : "running", state.activeToolName, state.activeToolCount);
      refreshDynamicFooter(ctx, true);
    }),
  );

  pi.on(
    "tool_execution_start",
    createUiOnlyHandler(async (event, ctx) => {
      updateActivity("tool", event.toolName, state.activeToolCount + 1);
      refreshDynamicFooter(ctx, true);

      if (event.toolName !== "Skill" && event.toolName !== "skill") {
        return;
      }

      const args = (event as SkillToolEvent).args;
      const toolInput = args ?? (event as SkillToolEvent).tool_input;
      if (typeof toolInput?.skill === "string" && toolInput.skill.length > 0) {
        setSkill(toolInput.skill);
        rerenderFooter(true);
      }
    }),
  );

  pi.on(
    "tool_execution_update",
    createUiOnlyHandler(async (event, ctx) => {
      const activeToolCount = state.activeToolCount > 0 ? state.activeToolCount : 1;
      updateActivity("tool", event.toolName, activeToolCount);
      refreshDynamicFooter(ctx);
    }),
  );

  pi.on(
    "tool_execution_end",
    createUiOnlyHandler(async (event, ctx) => {
      const activeToolCount = Math.max(0, state.activeToolCount - 1);
      const nextPhase = activeToolCount > 0 ? "tool" : "running";
      const nextToolName = activeToolCount > 0 ? event.toolName : null;
      updateActivity(nextPhase, nextToolName, activeToolCount);
      refreshDynamicFooter(ctx, true);
      await refreshGitFooter(ctx);
    }),
  );

  pi.on(
    "agent_end",
    createUiOnlyHandler(async (_event, ctx) => {
      clearLiveUsage();
      updateActivity("idle", null, 0);
      if (await refreshState(ctx)) {
        rerenderFooter(true);
      }
    }),
  );

  pi.on(
    "model_select",
    createUiOnlyHandler(async (_event, ctx) => {
      if (await refreshState(ctx)) {
        rerenderFooter(true);
      }
    }),
  );
}

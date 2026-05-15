import type { ActivityPhase, GitSnapshot, StatuslineState } from "./types.js";

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

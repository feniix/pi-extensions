import { describe, expect, it } from "vitest";
import { createInitialGitSnapshot, createInitialState, getActivityLabel } from "../extensions/state.js";

describe("statusline state helpers", () => {
  it("creates initial git and runtime state", () => {
    expect(createInitialGitSnapshot()).toEqual({
      repoName: null,
      branch: null,
      dirtyCount: 0,
      worktreeLabel: "no git",
    });

    expect(createInitialState()).toMatchObject({
      modelLabel: "Model: none",
      thinkingLabel: "Thinking: off",
      contextLabel: "Ctx: n/a",
      tokenLabel: "↑0/↓0",
      lastSkill: null,
      activityLabel: "Act: idle",
      activityPhase: "idle",
      activeToolCount: 0,
      activeToolName: null,
      liveAssistantUsage: null,
    });
  });

  it("formats activity labels", () => {
    expect(getActivityLabel("idle")).toBe("Act: idle");
    expect(getActivityLabel("tool", "bash", 1)).toBe("Act: bash");
    expect(getActivityLabel("tool", "bash", 2)).toBe("Act: bash x2");
  });
});

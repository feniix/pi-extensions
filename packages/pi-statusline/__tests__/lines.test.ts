import { describe, expect, it } from "vitest";
import { stripAnsi } from "../extensions/format.js";
import { buildLines, getBranchLabel, getDirtyLabel, getWorktreeLabel } from "../extensions/lines.js";
import { createInitialState } from "../extensions/state.js";

describe("statusline line helpers", () => {
  it("formats git labels", () => {
    expect(getBranchLabel("main")).toBe("⎇ main");
    expect(getBranchLabel(null)).toBe("⎇ no git");
    expect(getWorktreeLabel("feature")).toBe("𖠰 feature");
    expect(getDirtyLabel(2)).toBe("dirty: +2");
  });

  it("builds bounded status lines from state", () => {
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
});

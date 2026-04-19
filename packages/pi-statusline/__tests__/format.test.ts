import { describe, expect, it } from "vitest";
import { buildStatusLines, formatCompactNumber, formatModelLabel, formatTokenPair } from "../extensions/format.js";

describe("pi-statusline format helpers", () => {
  it("formats compact numbers", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(1_200)).toBe("1.2k");
    expect(formatCompactNumber(1_000_000)).toBe("1.0M");
  });

  it("formats token pairs", () => {
    expect(formatTokenPair(18_200, 14_200)).toBe("↑18.2k/↓14.2k");
  });

  it("formats model labels with context window", () => {
    expect(formatModelLabel({ name: "Opus 4.6", contextWindow: 1_000_000 })).toBe("Model: Opus 4.6 (1.0M context)");
  });

  it("builds two status lines", () => {
    const lines = buildStatusLines({
      modelLabel: "Model: Opus 4.6",
      thinkingLabel: "Thinking: medium",
      contextLabel: "Ctx: 11.0%",
      branchLabel: "⎇ main",
      dirtyLabel: "dirty: +0",
      tokenLabel: "↑18.2k/↓14.2k",
      repoLabel: "evie-platform",
      cwdLabel: "cwd: /tmp/repo",
      worktreeLabel: "𖠰 none",
      skillLabel: "Skill: release",
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Thinking: medium");
    expect(lines[1]).toContain("Skill: release");
  });
});

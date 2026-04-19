import { describe, expect, it } from "vitest";
import {
  buildStatusLines,
  formatCompactNumber,
  formatModelLabel,
  formatTokenPair,
  stripAnsi,
} from "../extensions/format.js";
import { defaultPalette } from "../extensions/palette.js";

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

  it("exposes the default palette", () => {
    expect(defaultPalette.model).toBe("#008787");
    expect(defaultPalette.activity).toBe("#5FAF00");
  });

  it("builds two colorized status lines", () => {
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
      activityLabel: "Act: responding",
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("\u001B[");
    expect(stripAnsi(lines[0])).toContain("Thinking: medium");
    expect(stripAnsi(lines[1])).toContain("Skill: release");
    expect(stripAnsi(lines[1])).toContain("Act: responding");
  });
});

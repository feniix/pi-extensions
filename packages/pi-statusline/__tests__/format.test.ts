import type { ThemeStyle } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
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
  it("uses semantic theme colors and preserves only explicit concrete overrides", () => {
    const styles: ThemeStyle[] = [];
    let appearance = "dark";
    const theme = {
      style: (text: string, style: ThemeStyle) => {
        styles.push(style);
        return `${appearance}:${text}`;
      },
    };
    const input = {
      modelLabel: "Model: opus",
      thinkingLabel: "Thinking: high",
      contextLabel: "Ctx: 10%",
      branchLabel: "⎇ main",
      dirtyLabel: "dirty: +0",
      tokenLabel: "↑1/↓2",
      repoLabel: "repo",
      cwdLabel: "cwd: /tmp",
      worktreeLabel: "𖠰 main",
      skillLabel: "Skill: none",
      activityLabel: "Act: idle",
    };
    buildStatusLines(input, undefined, { model: "#112233" }, theme);
    expect(styles[0]?.fg).toEqual({ kind: "rgb", r: 17, g: 34, b: 51 });
    expect(styles).toContainEqual({ fg: "muted" });
    expect(styles).toContainEqual({ fg: "thinkingText" });
    appearance = "light";
    expect(buildStatusLines(input, undefined, {}, theme)[0]).toContain("light:Model: opus");
  });
  it("fits Unicode and ANSI text into terminal columns across resizes", () => {
    const input = {
      modelLabel: "Model: 模型🤖e\u0301",
      thinkingLabel: "Thinking: medium",
      contextLabel: "Ctx: 11.0%",
      branchLabel: "⎇ main",
      dirtyLabel: "dirty: +0",
      tokenLabel: "↑18.2k/↓14.2k",
      repoLabel: "\u001B[31m项目🤖\u001B[0m",
      cwdLabel: "cwd: /项目",
      worktreeLabel: "𖠰 main",
      skillLabel: "Skill: release",
      activityLabel: "Act: responding",
    };
    for (const width of [0, 1, 2, 3, 7, 12, 20, 80, 200]) {
      const lines = buildStatusLines(input, width);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        expect(stripAnsi(line)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      }
    }
  });
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

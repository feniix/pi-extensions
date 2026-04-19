import { describe, expect, it } from "vitest";
import { getContextLabel, getThinkingLabel, getTokenLabel, getTokenTotals } from "../extensions/session.js";

describe("pi-statusline session helpers", () => {
  it("sums assistant token usage", () => {
    const totals = getTokenTotals([
      { type: "message", message: { role: "assistant", usage: { input: 1200, output: 300 } } },
      { type: "message", message: { role: "user" } },
      { type: "message", message: { role: "assistant", usage: { input: 800, output: 500 } } },
    ]);

    expect(totals).toEqual({ input: 2000, output: 800 });
  });

  it("replaces the trailing assistant usage with live usage", () => {
    const totals = getTokenTotals(
      [
        { type: "message", message: { role: "assistant", usage: { input: 1200, output: 300 } } },
        { type: "message", message: { role: "assistant", usage: { input: 800, output: 500 } } },
      ],
      { input: 950, output: 700 },
    );

    expect(totals).toEqual({ input: 2150, output: 1000 });
  });

  it("formats token label from session entries", () => {
    const label = getTokenLabel([
      { type: "message", message: { role: "assistant", usage: { input: 18_000, output: 4_200 } } },
    ]);
    expect(label).toBe("↑18.0k/↓4.2k");
  });

  it("formats token label with live assistant usage", () => {
    const label = getTokenLabel(
      [{ type: "message", message: { role: "assistant", usage: { input: 18_000, output: 4_200 } } }],
      { input: 18_500, output: 4_400 },
    );
    expect(label).toBe("↑18.5k/↓4.4k");
  });

  it("formats context label from explicit percent", () => {
    expect(getContextLabel({ percent: 11 }, { contextWindow: 1_000_000 })).toBe("Ctx: 11.0%");
  });

  it("computes context label from tokens and context window", () => {
    expect(getContextLabel({ tokens: 110_000 }, { contextWindow: 1_000_000 })).toBe("Ctx: 11.0%");
  });

  it("formats thinking label", () => {
    expect(getThinkingLabel("medium")).toBe("Thinking: medium");
    expect(getThinkingLabel()).toBe("Thinking: off");
  });
});

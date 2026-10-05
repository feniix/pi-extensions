import { describe, expect, it, vi } from "vitest";
import {
  createUsageTracker,
  formatUsageLabel,
  getContextLabel,
  getThinkingLabel,
  getTokenLabel,
  getTokenTotals,
  getUsageTotals,
} from "../extensions/session.js";
import type { SessionEntryLike } from "../extensions/types.js";

describe("pi-statusline session helpers", () => {
  it("shows optional cumulative cost and cache detail without changing the default token label", () => {
    const totals = { input: 100, output: 40, cacheRead: 2000, cacheWrite: 500, cost: 0.125 };
    expect(formatUsageLabel(totals)).toBe("↑100/↓40");
    expect(formatUsageLabel(totals, { showCost: true, showCache: true })).toBe("↑100/↓40 R2.0k W500 $0.125");
  });
  it("caches completed totals and counts a finalized message once across persistence", () => {
    const tracker = createUsageTracker();
    const entries: SessionEntryLike[] = [
      { type: "message", message: { role: "assistant", usage: { input: 100, output: 40 } } },
    ];
    let leaf = "a";
    const manager = { getBranch: vi.fn(() => entries), getLeafId: () => leaf, getSessionId: () => "session" };
    expect(tracker.read(manager).input).toBe(100);
    const message = { role: "assistant", usage: { input: 25, output: 9 } };
    tracker.update(message);
    expect(tracker.read(manager)).toMatchObject({ input: 125, output: 49 });
    message.usage.output = 12;
    tracker.update(message);
    expect(tracker.read(manager).output).toBe(52);
    expect(manager.getBranch).toHaveBeenCalledTimes(1);
    tracker.finish(message);
    expect(tracker.read(manager).output).toBe(52);
    entries.push({ type: "message", message });
    leaf = "b";
    expect(tracker.read(manager)).toMatchObject({ input: 125, output: 52 });
    expect(manager.getBranch).toHaveBeenCalledTimes(3);
    entries.splice(0, 2, { type: "usage", usage: { input: 3, output: 1 } });
    leaf = "other-branch";
    tracker.clear();
    expect(tracker.read(manager)).toMatchObject({ input: 3, output: 1 });
  });
  it("accounts for all model-attributed usage sources on the selected branch", () => {
    const usage = { input: 10, output: 2, cacheRead: 30, cacheWrite: 4, cost: { total: 0.5 } };
    expect(
      getUsageTotals([
        { type: "message", message: { role: "assistant", usage } },
        { type: "message", message: { role: "toolResult", usage } },
        { type: "compaction", usage },
        { type: "branch_summary", usage },
        { type: "usage", usage },
        { type: "custom", usage },
        { type: "message", message: { role: "user", usage } },
      ]),
    ).toEqual({ input: 50, output: 10, cacheRead: 150, cacheWrite: 20, cost: 2.5 });
  });
  it("sums assistant token usage", () => {
    const totals = getTokenTotals([
      { type: "message", message: { role: "assistant", usage: { input: 1200, output: 300 } } },
      { type: "message", message: { role: "user" } },
      { type: "message", message: { role: "assistant", usage: { input: 800, output: 500 } } },
    ]);

    expect(totals).toEqual({ input: 2000, output: 800 });
  });

  it("adds uncommitted live usage without replacing the previous completed assistant", () => {
    const totals = getTokenTotals(
      [
        { type: "message", message: { role: "assistant", usage: { input: 1200, output: 300 } } },
        { type: "message", message: { role: "assistant", usage: { input: 800, output: 500 } } },
      ],
      { input: 950, output: 700 },
    );

    expect(totals).toEqual({ input: 2950, output: 1500 });
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
    expect(label).toBe("↑36.5k/↓8.6k");
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

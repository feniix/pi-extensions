import { describe, expect, it } from "vitest";
import { isStatusOnlyWorkRequest, selectRuntimeModeForWork } from "../extensions/work-runtime-selection.js";

describe("work runtime selection", () => {
  it.each([
    "show me current workers",
    "show run status",
    "inspect current run",
    "list active task",
    "watch current worker status",
    "open current run output",
    "show tmux sessions",
    "please show active terminals",
    "can you list current panes",
  ])("treats status-only wording as inspection: %s", (request) => {
    expect(isStatusOnlyWorkRequest(request)).toBe(true);
    expect(selectRuntimeModeForWork({ request })).toBeUndefined();
  });

  it.each([
    ["Fix the typo in README.md", undefined],
    ["Run these independent shards in parallel and show me the workers", "iterm-tmux"],
    ["Open a terminal and run this task", "iterm-tmux"],
    ["Run this in tmux so I can watch it", "tmux"],
    ["Run this in iTerm so I can watch it", "iterm-tmux"],
    ["Run these shards without tmux", "headless"],
    ["Run this but do not use iterm", "headless"],
  ] as const)("selects expected runtime for execution wording: %s", (request, expected) => {
    expect(isStatusOnlyWorkRequest(request)).toBe(false);
    expect(selectRuntimeModeForWork({ request })).toBe(expected);
  });

  it("lets explicit runtime mode override natural-language inference", () => {
    expect(
      selectRuntimeModeForWork({
        request: "show me current workers",
        explicitRuntimeMode: "iterm-tmux",
      }),
    ).toBe("iterm-tmux");
    expect(
      selectRuntimeModeForWork({
        request: "Run this in parallel and show me the workers",
        explicitRuntimeMode: "headless",
      }),
    ).toBe("headless");
  });
});

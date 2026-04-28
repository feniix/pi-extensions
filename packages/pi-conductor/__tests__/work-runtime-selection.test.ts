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
    "check current workers",
    "get current run status",
    "what's running?",
    "are any workers active?",
    "current worker status",
    "do I have active tmux sessions?",
    "tail the active run log",
  ])("treats status-only wording as inspection: %s", (request) => {
    expect(isStatusOnlyWorkRequest(request)).toBe(true);
    expect(selectRuntimeModeForWork({ request })).toBeUndefined();
  });

  it.each([
    ["Fix the typo in README.md", undefined],
    ["Run these independent shards in parallel and show me the workers", "iterm-tmux"],
    ["Open a terminal and run this task", "iterm-tmux"],
    ["Open current run output and fix the failure", "iterm-tmux"],
    ["Watch active workers run tests", "iterm-tmux"],
    ["Open all terminals and run this task", "iterm-tmux"],
    ["Open a terminal and run current task", "iterm-tmux"],
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

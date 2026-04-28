import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createObjectiveForRepo, planObjectiveForRepo, selectRuntimeModeForWork } from "../extensions/conductor.js";

describe("conductor objective planner quality gates", () => {
  let conductorHome: string;
  const repoRoot = "/tmp/repo";

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("rejects duplicate task titles", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Quality", prompt: "Validate plans" });

    expect(() =>
      planObjectiveForRepo(repoRoot, {
        objectiveId: objective.objectiveId,
        tasks: [
          { title: "Build", prompt: "Implement the core feature" },
          { title: "Build", prompt: "Implement the other feature" },
        ],
      }),
    ).toThrow(/duplicate task title/i);
  });

  it("infers visible runtime only for unambiguous execution requests", () => {
    expect(
      selectRuntimeModeForWork({
        request: "Run these independent shards in parallel and show me the workers",
      }),
    ).toBe("iterm-tmux");
    expect(selectRuntimeModeForWork({ request: "Run this in tmux so I can watch it" })).toBe("tmux");
    expect(selectRuntimeModeForWork({ request: "show me current workers" })).toBeUndefined();
    expect(selectRuntimeModeForWork({ request: "show tmux sessions" })).toBeUndefined();
    expect(selectRuntimeModeForWork({ request: "show run status" })).toBeUndefined();
    expect(selectRuntimeModeForWork({ request: "inspect current run" })).toBeUndefined();
    expect(selectRuntimeModeForWork({ request: "list active task" })).toBeUndefined();
    expect(selectRuntimeModeForWork({ request: "Run these shards without tmux" })).toBe("headless");
    expect(
      selectRuntimeModeForWork({
        request: "Run this in parallel and show me the workers",
        explicitRuntimeMode: "headless",
      }),
    ).toBe("headless");
  });

  it("rejects unresolved dependencies and vague prompts", () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Quality", prompt: "Validate plans" });

    expect(() =>
      planObjectiveForRepo(repoRoot, {
        objectiveId: objective.objectiveId,
        tasks: [{ title: "Build", prompt: "Do", dependsOn: ["Missing"] }],
      }),
    ).toThrow(/vague prompt|unresolved dependency/i);
  });
});

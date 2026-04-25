import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createObjectiveForRepo, planObjectiveForRepo } from "../extensions/conductor.js";

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

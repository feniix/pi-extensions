import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeNextActions,
  createObjectiveForRepo,
  getOrCreateRunForRepo,
  planObjectiveForRepo,
} from "../extensions/conductor.js";
import { addObjective, createEmptyRun, createObjectiveRecord } from "../extensions/storage.js";

describe("conductor objective planning", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("atomically expands an objective into linked tasks", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, { title: "Autonomous MVP", prompt: "Ship the control plane" });

    const result = planObjectiveForRepo(repoRoot, {
      objectiveId: objective.objectiveId,
      tasks: [
        { title: "Add scheduler", prompt: "Build a scheduler loop" },
        { title: "Add review gate", prompt: "Check evidence before PR", dependsOn: ["Add scheduler"] },
      ],
      rationale: "Split orchestration from review readiness",
    });

    expect(result.objective.taskIds).toHaveLength(2);
    expect(result.tasks.map((task) => task.title)).toEqual(["Add scheduler", "Add review gate"]);
    expect(result.tasks.every((task) => task.objectiveId === objective.objectiveId)).toBe(true);
    expect(result.tasks[1]?.prompt).toContain("Depends on: Add scheduler");
    expect(getOrCreateRunForRepo(repoRoot).events.map((event) => event.type)).toContain("objective.planned");
  });

  it("rejects empty plans", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, { title: "Autonomous MVP", prompt: "Ship the control plane" });

    expect(() => planObjectiveForRepo(repoRoot, { objectiveId: objective.objectiveId, tasks: [] })).toThrow(
      /at least one task/i,
    );
  });

  it("recommends objective planning for active objectives without tasks", () => {
    const run = addObjective(
      createEmptyRun("abc", "/repo"),
      createObjectiveRecord({ objectiveId: "objective-1", title: "Autonomous MVP", prompt: "Ship it" }),
    );

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "high",
      kind: "plan_objective",
      resourceRefs: { objectiveId: "objective-1" },
      toolCall: {
        name: "conductor_plan_objective",
        params: { objectiveId: "objective-1", tasks: "<derive an ordered task list for this objective>" },
      },
    });
  });
});

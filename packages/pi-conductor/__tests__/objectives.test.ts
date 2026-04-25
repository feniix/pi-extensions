import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  linkTaskToObjectiveForRepo,
  updateObjectiveForRepo,
} from "../extensions/conductor.js";
import {
  addObjective,
  createEmptyRun,
  createObjectiveRecord,
  createTaskRecord,
  linkTaskToObjective,
  validateRunRecord,
} from "../extensions/storage.js";

describe("conductor objectives", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("creates empty project records with an objectives collection", () => {
    const run = createEmptyRun("abc", "/repo");

    expect(run.objectives).toEqual([]);
  });

  it("creates objective records and emits objective events", () => {
    const run = createEmptyRun("abc", "/repo");
    const objective = createObjectiveRecord({
      objectiveId: "objective-1",
      title: "Ship orchestration",
      prompt: "Coordinate tasks",
    });

    const updated = addObjective(run, objective);

    expect(updated.objectives[0]).toMatchObject({
      objectiveId: "objective-1",
      title: "Ship orchestration",
      status: "active",
      taskIds: [],
      gateIds: [],
      artifactIds: [],
    });
    expect(updated.events.map((event) => event.type)).toContain("objective.created");
  });

  it("links tasks to objectives from both records", () => {
    let run = addObjective(
      createEmptyRun("abc", "/repo"),
      createObjectiveRecord({ objectiveId: "objective-1", title: "Ship", prompt: "Coordinate" }),
    );
    run = linkTaskToObjective(
      {
        ...run,
        tasks: [createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })],
      },
      "objective-1",
      "task-1",
    );

    expect(run.objectives[0]?.taskIds).toEqual(["task-1"]);
    expect(run.tasks[0]).toMatchObject({ objectiveId: "objective-1" });
    expect(run.events.map((event) => event.type)).toContain("objective.task_linked");
  });

  it("validates objective references", () => {
    const run = {
      ...createEmptyRun("abc", "/repo"),
      objectives: [
        {
          ...createObjectiveRecord({ objectiveId: "objective-1", title: "Ship", prompt: "Coordinate" }),
          taskIds: ["missing-task"],
        },
      ],
    };

    expect(() => validateRunRecord(run)).toThrow(/Objective objective-1 references missing task missing-task/);
  });

  it("creates, links, and updates objectives through repo helpers", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, {
      title: "Autonomous MVP",
      prompt: "Coordinate implementation",
    });
    const task = createTaskForRepo(repoRoot, { title: "Build next actions", prompt: "Implement advice" });

    const linked = linkTaskToObjectiveForRepo(repoRoot, objective.objectiveId, task.taskId);
    const completed = updateObjectiveForRepo(repoRoot, {
      objectiveId: objective.objectiveId,
      status: "completed",
      summary: "Done",
    });
    const project = getOrCreateRunForRepo(repoRoot);

    expect(linked.taskIds).toEqual([task.taskId]);
    expect(completed).toMatchObject({ status: "completed", summary: "Done" });
    expect(project.tasks[0]).toMatchObject({ objectiveId: objective.objectiveId });
    expect(project.events.map((event) => event.type)).toContain("objective.updated");
  });
});

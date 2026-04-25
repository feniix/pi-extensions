import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  refreshObjectiveStatusForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("conductor objective status rollup", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("marks objectives completed when all linked tasks are completed", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, { title: "Ship", prompt: "Done when tasks done" });
    const task = createTaskForRepo(repoRoot, { title: "Task 1", prompt: "Do it", objectiveId: objective.objectiveId });
    const run = getOrCreateRunForRepo(repoRoot);
    run.tasks = run.tasks.map((entry) => (entry.taskId === task.taskId ? { ...entry, state: "completed" } : entry));
    writeRun(run);

    const updated = refreshObjectiveStatusForRepo(repoRoot, objective.objectiveId);

    expect(updated.status).toBe("completed");
    expect(updated.summary).toContain("1/1 tasks completed");
    expect(getOrCreateRunForRepo(repoRoot).events.map((event) => event.type)).toContain("objective.status_refreshed");
  });

  it("marks objectives blocked when linked tasks are blocked or failed", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, { title: "Ship", prompt: "Done when tasks done" });
    const task = createTaskForRepo(repoRoot, { title: "Task 1", prompt: "Do it", objectiveId: objective.objectiveId });
    const run = getOrCreateRunForRepo(repoRoot);
    run.tasks = run.tasks.map((entry) => (entry.taskId === task.taskId ? { ...entry, state: "failed" } : entry));
    writeRun(run);

    const updated = refreshObjectiveStatusForRepo(repoRoot, objective.objectiveId);

    expect(updated.status).toBe("blocked");
  });
});

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  scheduleObjectiveForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

describe("objective DAG scheduler", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  function addIdleWorkers(count: number) {
    const run = getOrCreateRunForRepo(repoRoot);
    const now = new Date().toISOString();
    for (let index = 1; index <= count; index += 1) {
      writeFileSync(join(repoRoot, `session-${index}.jsonl`), "", "utf-8");
    }
    writeRun({
      ...run,
      workers: Array.from({ length: count }, (_, index) => ({
        workerId: `worker-${index + 1}`,
        name: `worker-${index + 1}`,
        branch: null,
        worktreePath: repoRoot,
        sessionFile: join(repoRoot, `session-${index + 1}.jsonl`),
        runtime: { backend: "session_manager" as const, sessionId: null, lastResumedAt: null },
        currentTask: null,
        lifecycle: "idle" as const,
        recoverable: false,
        lastRun: null,
        summary: { text: null, updatedAt: null, stale: false },
        pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
        createdAt: now,
        updatedAt: now,
      })),
    });
  }

  it("assigns runnable objective tasks to idle workers with a concurrency limit", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Schedule", prompt: "Run ready tasks" });
    const first = createTaskForRepo(repoRoot, {
      title: "First",
      prompt: "Do first",
      objectiveId: objective.objectiveId,
    });
    const second = createTaskForRepo(repoRoot, {
      title: "Second",
      prompt: "Do second",
      objectiveId: objective.objectiveId,
    });
    addIdleWorkers(2);

    const result = await scheduleObjectiveForRepo(repoRoot, { objectiveId: objective.objectiveId, maxConcurrency: 1 });

    expect(result.assigned).toHaveLength(1);
    expect([first.taskId, second.taskId]).toContain(result.assigned[0]?.taskId);
    expect(getOrCreateRunForRepo(repoRoot).tasks.filter((task) => task.state === "assigned")).toHaveLength(1);
  });

  it("safe objective scheduling assigns without executing runs", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Schedule safely", prompt: "Assign ready work" });
    createTaskForRepo(repoRoot, { title: "First", prompt: "Do first safely", objectiveId: objective.objectiveId });
    addIdleWorkers(1);

    const result = await scheduleObjectiveForRepo(repoRoot, {
      objectiveId: objective.objectiveId,
      maxConcurrency: 1,
      policy: "safe",
    });

    expect(result.assigned).toHaveLength(1);
    expect(result.executed).toHaveLength(0);
  });

  it("schedules one runnable task per objective across objectives", async () => {
    const firstObjective = createObjectiveForRepo(repoRoot, { title: "First objective", prompt: "Run one" });
    const secondObjective = createObjectiveForRepo(repoRoot, { title: "Second objective", prompt: "Run two" });
    const firstTask = createTaskForRepo(repoRoot, {
      title: "First task",
      prompt: "Do first",
      objectiveId: firstObjective.objectiveId,
    });
    const secondTask = createTaskForRepo(repoRoot, {
      title: "Second task",
      prompt: "Do second",
      objectiveId: secondObjective.objectiveId,
    });
    addIdleWorkers(2);

    const result = await scheduleObjectiveForRepo(repoRoot, { maxConcurrency: 2 });

    expect(result.assigned.map((task) => task.taskId).sort()).toEqual([firstTask.taskId, secondTask.taskId].sort());
  });
});

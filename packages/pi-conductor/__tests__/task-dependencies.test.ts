import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTaskBriefForRepo,
  computeNextActions,
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  planObjectiveForRepo,
} from "../extensions/conductor.js";
import {
  addTask,
  addWorker,
  assignTaskToWorker,
  createEmptyRun,
  createTaskRecord,
  createWorkerRecord,
} from "../extensions/storage.js";

describe("conductor task dependencies", () => {
  let conductorHome: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
  });

  it("stores dependencies when planning an objective", () => {
    const repoRoot = "/tmp/repo";
    const objective = createObjectiveForRepo(repoRoot, { title: "Ship DAG", prompt: "Coordinate dependent tasks" });

    const result = planObjectiveForRepo(repoRoot, {
      objectiveId: objective.objectiveId,
      tasks: [
        { title: "Build core", prompt: "Implement core" },
        { title: "Write docs", prompt: "Document core", dependsOn: ["Build core"] },
      ],
    });

    expect(result.tasks[1]?.dependsOnTaskIds).toEqual([result.tasks[0]?.taskId]);
    expect(getOrCreateRunForRepo(repoRoot).tasks[1]?.dependsOnTaskIds).toEqual([result.tasks[0]?.taskId]);
  });

  it("does not recommend running an assigned task with incomplete dependencies", async () => {
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const first = createTaskRecord({ taskId: "task-1", title: "Build core", prompt: "Implement core" });
    const second = createTaskRecord({
      taskId: "task-2",
      title: "Write docs",
      prompt: "Document core",
      dependsOnTaskIds: [first.taskId],
    });
    const run = assignTaskToWorker(
      addTask(addTask(addWorker(createEmptyRun("abc", "/repo"), worker), first), second),
      second.taskId,
      worker.workerId,
    );

    const result = computeNextActions(run);

    expect(
      result.actions.find((action) => action.kind === "run_task" && action.resourceRefs.taskId === second.taskId),
    ).toBeUndefined();
    expect(result.actions[0]).toMatchObject({
      kind: "wait_for_dependency",
      resourceRefs: { taskId: second.taskId },
      blockedBy: [{ taskId: first.taskId }],
    });
  });

  it("recommends running dependent tasks after dependencies complete", () => {
    const worker = createWorkerRecord({
      workerId: "worker-1",
      name: "backend",
      branch: "conductor/backend",
      worktreePath: "/repo/.worktrees/backend",
      sessionFile: "/tmp/session.jsonl",
    });
    const first = {
      ...createTaskRecord({ taskId: "task-1", title: "Build core", prompt: "Implement core" }),
      state: "completed" as const,
    };
    const second = createTaskRecord({
      taskId: "task-2",
      title: "Write docs",
      prompt: "Document core",
      dependsOnTaskIds: ["task-1"],
    });
    const run = assignTaskToWorker(
      addTask(addTask(addWorker(createEmptyRun("abc", "/repo"), worker), first), second),
      "task-2",
      "worker-1",
    );

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({ kind: "run_task", resourceRefs: { taskId: "task-2" } });
  });

  it("includes dependency status in task briefs", () => {
    const repoRoot = "/tmp/repo";
    const first = createTaskForRepo(repoRoot, { title: "Build core", prompt: "Implement core" });
    const second = createTaskForRepo(repoRoot, {
      title: "Write docs",
      prompt: "Document core",
      dependsOnTaskIds: [first.taskId],
    });

    const brief = buildTaskBriefForRepo(repoRoot, { taskId: second.taskId });

    expect(brief.dependencies).toEqual([{ taskId: first.taskId, title: "Build core", state: "ready" }]);
    expect(brief.markdown).toContain("Dependencies");
  });
});

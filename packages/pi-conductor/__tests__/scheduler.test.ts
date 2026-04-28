import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignTaskForRepo,
  createObjectiveForRepo,
  createTaskForRepo,
  getOrCreateRunForRepo,
  runNextActionForRepo,
  scheduleObjectiveForRepo,
  schedulerTickForRepo,
} from "../extensions/conductor.js";
import { writeRun } from "../extensions/storage.js";

const runtimeTracking = vi.hoisted(() => ({
  runWorkerPromptInputs: [] as Array<{ signal?: AbortSignal | undefined }>,
  preflightError: null as string | null,
}));

vi.mock("../extensions/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extensions/runtime.js")>();
  const preflightWorkerRunRuntime = vi.fn(() => {
    if (runtimeTracking.preflightError) throw new Error(runtimeTracking.preflightError);
  });
  const runWorkerPromptRuntime = vi.fn(async (input) => {
    runtimeTracking.runWorkerPromptInputs.push(input);
    await input.onConductorComplete?.({
      runId: input.taskContract?.runId ?? "run-unknown",
      taskId: input.taskContract?.taskId ?? "task-unknown",
      status: "succeeded",
      completionSummary: "done by scheduler",
      artifact: { type: "completion_report", ref: "completion://scheduler" },
    });
    return { status: "success", finalText: "done", errorMessage: null, sessionId: "session-1" };
  });
  return {
    ...actual,
    preflightWorkerRunRuntime,
    runWorkerPromptRuntime,
    getWorkerRunRuntimeBackend: vi.fn((mode = "headless") => {
      if (mode !== "headless") throw new Error(`${mode} runtime is not implemented yet`);
      return {
        mode,
        preflight: preflightWorkerRunRuntime,
        run: runWorkerPromptRuntime,
      };
    }),
  };
});

describe("conductor scheduler and async next action", () => {
  let conductorHome: string;
  let repoRoot: string;

  beforeEach(() => {
    conductorHome = mkdtempSync(join(tmpdir(), "pi-conductor-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "pi-conductor-repo-"));
    process.env.PI_CONDUCTOR_HOME = conductorHome;
    runtimeTracking.runWorkerPromptInputs.length = 0;
    runtimeTracking.preflightError = null;
  });

  afterEach(() => {
    delete process.env.PI_CONDUCTOR_HOME;
    if (existsSync(conductorHome)) rmSync(conductorHome, { recursive: true, force: true });
    if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true });
  });

  function addUsableWorkerAndAssignedTask() {
    writeFileSync(join(repoRoot, "session.jsonl"), "", "utf-8");
    const task = createTaskForRepo(repoRoot, { title: "Run me", prompt: "Do runnable work" });
    const run = getOrCreateRunForRepo(repoRoot);
    const now = new Date().toISOString();
    writeRun({
      ...run,
      workers: [
        {
          workerId: "worker-1",
          name: "worker",
          branch: null,
          worktreePath: repoRoot,
          sessionFile: join(repoRoot, "session.jsonl"),
          runtime: { backend: "session_manager", sessionId: null, lastResumedAt: null },
          lifecycle: "idle",
          recoverable: false,
          pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
          createdAt: now,
          updatedAt: now,
        },
      ],
      tasks: run.tasks.map((entry) =>
        entry.taskId === task.taskId ? { ...entry, assignedWorkerId: "worker-1", state: "assigned" } : entry,
      ),
    });
    return task;
  }

  it("run next action can execute a runnable task", async () => {
    const task = addUsableWorkerAndAssignedTask();

    const result = await runNextActionForRepo(repoRoot, { executeRuns: true });

    expect(result.executed).toBe(true);
    expect(result.action?.kind).toBe("run_task");
    expect(getOrCreateRunForRepo(repoRoot).tasks.find((entry) => entry.taskId === task.taskId)?.state).toBe(
      "completed",
    );
  });

  it("safe scheduler policy skips model execution", async () => {
    addUsableWorkerAndAssignedTask();

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 1, policy: "safe" });

    expect(result.executed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ reason: "run execution disabled by scheduler policy" });
  });

  it("execute scheduler policy allows model execution", async () => {
    const task = addUsableWorkerAndAssignedTask();

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 1, policy: "execute" });

    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]?.action?.kind).toBe("run_task");
    const run = getOrCreateRunForRepo(repoRoot);
    expect(run.tasks.find((entry) => entry.taskId === task.taskId)?.state).toBe("completed");
    expect(run.events.at(-1)).toMatchObject({
      type: "scheduler.tick_succeeded",
      payload: { operation: "scheduler_tick", policy: "execute", executedCount: 1 },
    });
  });

  it("respects run capacity when executing scheduler ticks", async () => {
    addUsableWorkerAndAssignedTask();

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 2, maxRuns: 0, policy: "execute" });

    expect(result.executed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ reason: "run capacity exhausted" });
    expect(getOrCreateRunForRepo(repoRoot).events.map((event) => event.type)).toContain("scheduler.capacity_exhausted");
  });

  it("round-robin scheduler considers tasks across objectives", async () => {
    const first = createObjectiveForRepo(repoRoot, { title: "First", prompt: "First objective" });
    const second = createObjectiveForRepo(repoRoot, { title: "Second", prompt: "Second objective" });
    const firstTask = createTaskForRepo(repoRoot, {
      title: "First task",
      prompt: "Do first",
      objectiveId: first.objectiveId,
    });
    const secondTask = createTaskForRepo(repoRoot, {
      title: "Second task",
      prompt: "Do second",
      objectiveId: second.objectiveId,
    });
    const run = getOrCreateRunForRepo(repoRoot);
    const now = new Date().toISOString();
    writeRun({
      ...run,
      workers: [
        {
          workerId: "worker-1",
          name: "worker",
          branch: null,
          worktreePath: repoRoot,
          sessionFile: join(repoRoot, "session.jsonl"),
          runtime: { backend: "session_manager", sessionId: null, lastResumedAt: null },
          lifecycle: "idle",
          recoverable: false,
          pr: { url: null, number: null, commitSucceeded: false, pushSucceeded: false, prCreationAttempted: false },
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 2, fairness: "round_robin" });

    expect(result.executed).toHaveLength(2);
    expect(result.executed.map((entry) => entry.action?.resourceRefs.taskId).sort()).toEqual(
      [firstTask.taskId, secondTask.taskId].sort(),
    );
  });

  it("scheduler ticks execute bounded safe actions", async () => {
    addUsableWorkerAndAssignedTask();

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 1, executeRuns: true });

    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]?.action?.kind).toBe("run_task");
  });

  it("passes a linked abort signal through runNextActionForRepo to runtime execution", async () => {
    const controller = new AbortController();
    addUsableWorkerAndAssignedTask();

    await runNextActionForRepo(repoRoot, { executeRuns: true }, controller.signal);

    expect(runtimeTracking.runWorkerPromptInputs).toHaveLength(1);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).not.toBe(controller.signal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal?.aborted).toBe(false);
  });

  it("passes a linked abort signal through schedulerTickForRepo to runtime execution", async () => {
    const controller = new AbortController();
    addUsableWorkerAndAssignedTask();

    await schedulerTickForRepo(repoRoot, { maxActions: 1, executeRuns: true }, controller.signal);

    expect(runtimeTracking.runWorkerPromptInputs).toHaveLength(1);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).not.toBe(controller.signal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal?.aborted).toBe(false);
  });

  it("passes a linked abort signal through scheduleObjectiveForRepo to runtime execution", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Objective", prompt: "Prompt" });
    const task = createTaskForRepo(repoRoot, {
      title: "Run me",
      prompt: "Do work",
      objectiveId: objective.objectiveId,
    });
    const controller = new AbortController();
    addUsableWorkerAndAssignedTask();

    await scheduleObjectiveForRepo(
      repoRoot,
      {
        objectiveId: objective.objectiveId,
        maxConcurrency: 1,
        executeRuns: true,
      },
      controller.signal,
    );

    expect(runtimeTracking.runWorkerPromptInputs).toHaveLength(1);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal).not.toBe(controller.signal);
    expect(runtimeTracking.runWorkerPromptInputs[0]?.signal?.aborted).toBe(false);
    expect(task).toBeTruthy();
  });

  it("cancels run-next-action tasks when runtime preflight fails before run start", async () => {
    const task = addUsableWorkerAndAssignedTask();
    runtimeTracking.preflightError = "runtime disappeared before active run";

    await expect(runNextActionForRepo(repoRoot, { executeRuns: true })).rejects.toThrow(/runtime disappeared/i);

    const run = getOrCreateRunForRepo(repoRoot);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks.find((entry) => entry.taskId === task.taskId)).toMatchObject({
      state: "canceled",
      activeRunId: null,
    });
  });

  it("cancels scheduler tick run-task actions when runtime preflight fails before run start", async () => {
    const task = addUsableWorkerAndAssignedTask();
    runtimeTracking.preflightError = "runtime disappeared before active run";

    await expect(schedulerTickForRepo(repoRoot, { policy: "execute" })).rejects.toThrow(/runtime disappeared/i);

    const run = getOrCreateRunForRepo(repoRoot);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks.find((entry) => entry.taskId === task.taskId)).toMatchObject({
      state: "canceled",
      activeRunId: null,
    });
    expect(run.events.at(-1)).toMatchObject({ type: "scheduler.tick_failed" });
  });

  it("cancels assigned objective tasks when runtime preflight fails before run start", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Objective", prompt: "Prompt" });
    const task = createTaskForRepo(repoRoot, {
      title: "Run me",
      prompt: "Do work",
      objectiveId: objective.objectiveId,
    });
    const unrelated = addUsableWorkerAndAssignedTask();
    runtimeTracking.preflightError = "runtime disappeared before active run";

    await expect(
      scheduleObjectiveForRepo(repoRoot, {
        objectiveId: objective.objectiveId,
        maxConcurrency: 1,
        executeRuns: true,
      }),
    ).rejects.toThrow(/runtime disappeared/i);

    const run = getOrCreateRunForRepo(repoRoot);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks.find((entry) => entry.taskId === task.taskId)).toMatchObject({
      state: "canceled",
      activeRunId: null,
    });
    expect(run.tasks.find((entry) => entry.taskId === unrelated.taskId)).toMatchObject({ state: "assigned" });
  });

  it("does not cancel pre-existing assigned objective tasks on runtime preflight failure", async () => {
    const objective = createObjectiveForRepo(repoRoot, { title: "Objective", prompt: "Prompt" });
    const task = createTaskForRepo(repoRoot, {
      title: "Already assigned",
      prompt: "Do work",
      objectiveId: objective.objectiveId,
    });
    const unrelated = addUsableWorkerAndAssignedTask();
    assignTaskForRepo(repoRoot, task.taskId, "worker-1");
    runtimeTracking.preflightError = "runtime disappeared before active run";

    await expect(
      scheduleObjectiveForRepo(repoRoot, {
        objectiveId: objective.objectiveId,
        maxConcurrency: 1,
        executeRuns: true,
      }),
    ).rejects.toThrow(/runtime disappeared/i);

    const run = getOrCreateRunForRepo(repoRoot);
    expect(run.runs).toHaveLength(0);
    expect(run.tasks.find((entry) => entry.taskId === task.taskId)).toMatchObject({
      state: "assigned",
      activeRunId: null,
    });
    expect(run.tasks.find((entry) => entry.taskId === unrelated.taskId)).toMatchObject({ state: "assigned" });
  });

  it("scheduler ticks skip model execution unless explicitly enabled", async () => {
    addUsableWorkerAndAssignedTask();

    const result = await schedulerTickForRepo(repoRoot, { maxActions: 1 });

    expect(result.executed).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ reason: "run execution disabled by scheduler policy" });
  });
});

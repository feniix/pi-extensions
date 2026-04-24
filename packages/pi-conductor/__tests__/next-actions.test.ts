import { describe, expect, it } from "vitest";
import { computeNextActions } from "../extensions/conductor.js";
import {
  addObjective,
  addTask,
  addWorker,
  assignTaskToWorker,
  createConductorGate,
  createEmptyRun,
  createObjectiveRecord,
  createTaskRecord,
  createWorkerRecord,
  startTaskRun,
} from "../extensions/storage.js";

function usableWorker() {
  return createWorkerRecord({
    workerId: "worker-1",
    name: "backend",
    branch: "conductor/backend",
    worktreePath: "/repo/.worktrees/backend",
    sessionFile: "/tmp/session.jsonl",
  });
}

describe("computeNextActions", () => {
  it("recommends creating a worker for an empty project", () => {
    const result = computeNextActions(createEmptyRun("abc", "/repo"));

    expect(result.summary.status).toBe("empty");
    expect(result.actions[0]).toMatchObject({
      priority: "medium",
      kind: "create_worker",
      toolCall: { name: "conductor_create_worker", params: { name: "worker-1" } },
    });
  });

  it("recommends creating a scoped task for an active objective without tasks", () => {
    const run = addObjective(
      createEmptyRun("abc", "/repo"),
      createObjectiveRecord({ objectiveId: "objective-1", title: "Autonomous MVP", prompt: "Ship it" }),
    );

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "high",
      kind: "create_task",
      resourceRefs: { objectiveId: "objective-1" },
      toolCall: {
        name: "conductor_create_task",
        params: {
          title: "Next task for Autonomous MVP",
          prompt: "<derive the next concrete task for this objective>",
          objectiveId: "objective-1",
        },
      },
    });
  });

  it("recommends assigning a ready task to an idle worker", () => {
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const run = addTask(addWorker(createEmptyRun("abc", "/repo"), usableWorker()), task);

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "medium",
      kind: "assign_task",
      resourceRefs: { taskId: "task-1", workerId: "worker-1" },
      toolCall: { name: "conductor_assign_task", params: { taskId: "task-1", workerId: "worker-1" } },
    });
  });

  it("recommends running an assigned task when the worker is usable", () => {
    const task = createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" });
    const run = assignTaskToWorker(
      addTask(addWorker(createEmptyRun("abc", "/repo"), usableWorker()), task),
      "task-1",
      "worker-1",
    );

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "high",
      kind: "run_task",
      toolCall: { name: "conductor_run_task", params: { taskId: "task-1" } },
    });
  });

  it("recommends reconciliation for an expired active run", () => {
    let run = addWorker(createEmptyRun("abc", "/repo"), usableWorker());
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T00:00:00.000Z",
    });

    const result = computeNextActions(run, { now: "2026-04-24T00:00:01.000Z" });

    expect(result.actions[0]).toMatchObject({
      priority: "critical",
      kind: "reconcile_project",
      resourceRefs: { runId: "run-1" },
      toolCall: { name: "conductor_reconcile_project", params: { dryRun: false } },
    });
  });

  it("does not recommend intervention for an unexpired active run by default", () => {
    let run = addWorker(createEmptyRun("abc", "/repo"), usableWorker());
    run = assignTaskToWorker(
      addTask(run, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" })),
      "task-1",
      "worker-1",
    );
    run = startTaskRun(run, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "worker-1",
      backend: "native",
      leaseExpiresAt: "2026-04-24T01:00:00.000Z",
    });

    const result = computeNextActions(run, { now: "2026-04-24T00:00:00.000Z" });

    expect(result.summary.status).toBe("waiting");
    expect(result.actions.find((action) => action.kind === "wait_for_run")).toBeUndefined();
  });

  it("does not suggest parent approval for human-only gates", () => {
    const run = createConductorGate(createEmptyRun("abc", "/repo"), {
      gateId: "gate-1",
      type: "destructive_cleanup",
      resourceRefs: { projectKey: "abc", workerId: "worker-1" },
      requestedDecision: "Approve cleanup?",
    });

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "critical",
      kind: "await_human_gate",
      requiresHuman: true,
      destructive: true,
      toolCall: null,
    });
  });

  it("suggests resolving parent-resolvable needs_input gates", () => {
    const run = createConductorGate(createEmptyRun("abc", "/repo"), {
      gateId: "gate-1",
      type: "needs_input",
      resourceRefs: { projectKey: "abc", taskId: "task-1" },
      requestedDecision: "Which API shape?",
    });

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "high",
      kind: "resolve_gate",
      requiresHuman: false,
      toolCall: {
        name: "conductor_resolve_gate",
        params: { gateId: "gate-1", status: "approved", actorType: "parent_agent" },
      },
    });
  });

  it("recommends retrying failed tasks with usable assigned workers", () => {
    const task = {
      ...createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }),
      state: "failed" as const,
      assignedWorkerId: "worker-1",
    };
    const run = addTask(addWorker(createEmptyRun("abc", "/repo"), usableWorker()), task);

    const result = computeNextActions(run);

    expect(result.actions[0]).toMatchObject({
      priority: "medium",
      kind: "retry_task",
      toolCall: { name: "conductor_retry_task", params: { taskId: "task-1" } },
    });
  });

  it("sorts by priority and respects maxActions", () => {
    const withGate = createConductorGate(createEmptyRun("abc", "/repo"), {
      gateId: "gate-1",
      type: "destructive_cleanup",
      resourceRefs: { projectKey: "abc", workerId: "worker-1" },
      requestedDecision: "Approve cleanup?",
    });
    const run = addTask(withGate, createTaskRecord({ taskId: "task-1", title: "Build", prompt: "Do it" }));

    const result = computeNextActions(run, { maxActions: 1 });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.priority).toBe("critical");
    expect(result.omitted.count).toBeGreaterThan(0);
  });
});

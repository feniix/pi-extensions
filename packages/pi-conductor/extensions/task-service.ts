import { type ConductorBackendsStatus, inspectConductorBackends } from "./backends.js";
import { refreshObjectiveStatusForRepo } from "./objective-service.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import {
  addTask,
  appendConductorEvent,
  assignTaskToWorker,
  cancelTaskRun,
  createTaskRecord,
  linkTaskToObjective,
  recordTaskCompletion,
  recordTaskProgress,
  startTaskRun,
  updateTask,
} from "./storage.js";
import type { RunAttemptRecord, RunRecord, TaskContractInput, TaskRecord } from "./types.js";

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function leaseExpiryFromNow(leaseSeconds: number): string {
  return new Date(Date.now() + leaseSeconds * 1000).toISOString();
}

export function createTaskForRepo(
  repoRoot: string,
  input: { title: string; prompt: string; objectiveId?: string; dependsOnTaskIds?: string[] },
): TaskRecord {
  let task!: TaskRecord;
  mutateRepoRunSync(repoRoot, (run) => {
    const missingDependency = input.dependsOnTaskIds?.find(
      (taskId) => !run.tasks.some((entry) => entry.taskId === taskId),
    );
    if (missingDependency) {
      throw new Error(`Task dependency ${missingDependency} not found`);
    }
    task = createTaskRecord({
      taskId: createTaskId(),
      title: input.title,
      prompt: input.prompt,
      objectiveId: input.objectiveId,
      dependsOnTaskIds: input.dependsOnTaskIds,
    });
    return input.objectiveId
      ? linkTaskToObjective(addTask(run, task), input.objectiveId, task.taskId)
      : addTask(run, task);
  });
  return task;
}

export function updateTaskForRepo(
  repoRoot: string,
  input: { taskId: string; title?: string; prompt?: string },
): TaskRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => updateTask(run, input));
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during update`);
  }
  return task;
}

export function assignTaskForRepo(repoRoot: string, taskId: string, workerId: string): TaskRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => assignTaskToWorker(run, taskId, workerId));
  const task = updatedRun.tasks.find((entry) => entry.taskId === taskId);
  if (!task) {
    throw new Error(`Task ${taskId} disappeared during assignment`);
  }
  return task;
}

export function recordTaskProgressForRepo(
  repoRoot: string,
  input: {
    runId: string;
    taskId: string;
    progress: string;
    idempotencyKey?: string;
    artifact?: {
      type: "note" | "test_result" | "changed_files" | "log" | "completion_report" | "pr_evidence" | "other";
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
): TaskRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => recordTaskProgress(run, input));
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during progress update`);
  }
  return task;
}

export function recordTaskCompletionForRepo(
  repoRoot: string,
  input: {
    runId: string;
    taskId: string;
    status: "succeeded" | "partial" | "blocked" | "failed" | "aborted";
    completionSummary: string;
    idempotencyKey?: string;
    artifact?: {
      type: "note" | "test_result" | "changed_files" | "log" | "completion_report" | "pr_evidence" | "other";
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
): TaskRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => recordTaskCompletion(run, input));
  const task = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} disappeared during completion update`);
  }
  if (task.objectiveId) {
    refreshObjectiveStatusForRepo(repoRoot, task.objectiveId);
    return getOrCreateRunForRepo(repoRoot).tasks.find((entry) => entry.taskId === input.taskId) ?? task;
  }
  return task;
}

export function startTaskRunForRepo(
  repoRoot: string,
  input: {
    taskId: string;
    workerId?: string;
    leaseSeconds?: number;
    runId?: string;
    backend?: RunAttemptRecord["backend"];
    allowFollowUpTasks?: boolean;
    inspectBackends?: () => ConductorBackendsStatus;
  },
): { run: RunAttemptRecord; taskContract: TaskContractInput } {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  const workerId = input.workerId ?? task.assignedWorkerId;
  if (!workerId) {
    throw new Error(`Task ${input.taskId} is not assigned to a worker`);
  }
  const backend = input.backend ?? "native";
  if (backend === "pi-subagents") {
    const status = (input.inspectBackends ?? inspectConductorBackends)().piSubagents;
    mutateRepoRunSync(repoRoot, (latest) =>
      appendConductorEvent(latest, {
        actor: { type: "backend", id: "pi-subagents" },
        type: "backend.unavailable",
        resourceRefs: { projectKey: latest.projectKey, taskId: input.taskId, workerId },
        payload: {
          backend,
          diagnostic: status.available
            ? "pi-subagents dispatch adapter is not implemented yet"
            : (status.diagnostic ?? "pi-subagents backend is unavailable"),
        },
      }),
    );
    throw new Error(
      `pi-subagents backend unavailable: ${status.available ? "dispatch adapter is not implemented yet" : (status.diagnostic ?? "not available")}`,
    );
  }
  const runId = input.runId ?? createRunId();
  const updatedRun = mutateRepoRunSync(repoRoot, (latest) =>
    startTaskRun(latest, {
      runId,
      taskId: input.taskId,
      workerId,
      backend,
      leaseExpiresAt: leaseExpiryFromNow(input.leaseSeconds ?? 900),
    }),
  );
  const started = updatedRun.runs.find((entry) => entry.runId === runId);
  const updatedTask = updatedRun.tasks.find((entry) => entry.taskId === input.taskId);
  if (!started || !updatedTask) {
    throw new Error(`Run ${runId} disappeared during start`);
  }
  return {
    run: started,
    taskContract: {
      taskId: updatedTask.taskId,
      runId: started.runId,
      taskRevision: started.taskRevision,
      goal: updatedTask.prompt,
      constraints: [],
      explicitCompletionTools: true,
      allowFollowUpTasks: input.allowFollowUpTasks ?? false,
    },
  };
}

export function cancelTaskRunForRepo(repoRoot: string, input: { runId: string; reason: string }): RunRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => cancelTaskRun(run, input));
  const task = updatedRun.tasks.find((entry) => entry.runIds.includes(input.runId));
  if (task?.objectiveId) {
    refreshObjectiveStatusForRepo(repoRoot, task.objectiveId);
    return getOrCreateRunForRepo(repoRoot);
  }
  return updatedRun;
}

export function retryTaskForRepo(
  repoRoot: string,
  input: { taskId: string; workerId?: string; leaseSeconds?: number },
): { run: RunAttemptRecord; taskContract: TaskContractInput } {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  if (task.activeRunId) {
    throw new Error(`Task ${input.taskId} already has an active run`);
  }
  if (!["blocked", "failed", "needs_review", "canceled"].includes(task.state)) {
    throw new Error(`Task ${input.taskId} is ${task.state} and is not eligible for retry`);
  }
  const started = startTaskRunForRepo(repoRoot, input);
  const refreshedTask = getOrCreateRunForRepo(repoRoot).tasks.find((entry) => entry.taskId === input.taskId);
  if (refreshedTask?.objectiveId) {
    refreshObjectiveStatusForRepo(repoRoot, refreshedTask.objectiveId);
  }
  return started;
}

export function createFollowUpTaskForRepo(
  repoRoot: string,
  input: { runId: string; taskId: string; title: string; prompt: string },
): TaskRecord {
  let task!: TaskRecord;
  const withEvent = mutateRepoRunSync(repoRoot, (run) => {
    const runAttempt = run.runs.find((entry) => entry.runId === input.runId);
    if (!runAttempt || runAttempt.taskId !== input.taskId || runAttempt.finishedAt) {
      throw new Error(`Run ${input.runId} is not an active run for task ${input.taskId}`);
    }
    task = createTaskRecord({ taskId: createTaskId(), title: input.title, prompt: input.prompt });
    const withTask = addTask(run, task);
    return appendConductorEvent(withTask, {
      actor: { type: "child_run", id: input.runId },
      type: "task.followup_created",
      resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, runId: input.runId },
      payload: { parentTaskId: input.taskId, title: input.title },
    });
  });
  const created = withEvent.tasks.find((entry) => entry.taskId === task.taskId);
  if (!created) {
    throw new Error(`Follow-up task ${task.taskId} disappeared during creation`);
  }
  return created;
}

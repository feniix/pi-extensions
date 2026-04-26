import { mutateRepoRunSync } from "./repo-run.js";
import {
  addObjective,
  addTask,
  appendConductorEvent,
  createObjectiveRecord,
  createTaskRecord,
  linkTaskToObjective,
  updateObjective,
} from "./storage.js";
import type { ObjectivePlanResult, ObjectiveRecord, ObjectiveStatus, TaskRecord } from "./types.js";

function createObjectiveId(): string {
  return `objective-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateObjectivePlanTasks(tasks: Array<{ title: string; prompt: string; dependsOn?: string[] }>): void {
  const titles = new Set<string>();
  for (const task of tasks) {
    const title = task.title.trim();
    if (titles.has(title)) {
      throw new Error(`Duplicate task title '${title}' in objective plan`);
    }
    titles.add(title);
    if (task.prompt.trim().length < 10) {
      throw new Error(`Vague prompt for task '${title}' in objective plan`);
    }
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!titles.has(dependency)) {
        throw new Error(`Unresolved dependency '${dependency}' for task '${task.title}'`);
      }
      if (dependency === task.title) {
        throw new Error(`Task '${task.title}' cannot depend on itself`);
      }
    }
  }
}

export function createObjectiveForRepo(repoRoot: string, input: { title: string; prompt: string }): ObjectiveRecord {
  let objective!: ObjectiveRecord;
  mutateRepoRunSync(repoRoot, (run) => {
    objective = createObjectiveRecord({
      objectiveId: createObjectiveId(),
      title: input.title,
      prompt: input.prompt,
    });
    return addObjective(run, objective);
  });
  return objective;
}

export function updateObjectiveForRepo(
  repoRoot: string,
  input: { objectiveId: string; title?: string; prompt?: string; status?: ObjectiveStatus; summary?: string | null },
): ObjectiveRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => updateObjective(run, input));
  const objective = updatedRun.objectives.find((entry) => entry.objectiveId === input.objectiveId);
  if (!objective) {
    throw new Error(`Objective ${input.objectiveId} disappeared during update`);
  }
  return objective;
}

export function refreshObjectiveStatusForRepo(repoRoot: string, objectiveId: string): ObjectiveRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => {
    const objective = run.objectives.find((entry) => entry.objectiveId === objectiveId);
    if (!objective) {
      throw new Error(`Objective ${objectiveId} not found`);
    }
    const tasks = run.tasks.filter((task) => objective.taskIds.includes(task.taskId));
    const completed = tasks.filter((task) => task.state === "completed").length;
    const blocked = tasks.filter((task) => ["blocked", "failed", "canceled"].includes(task.state)).length;
    const needsReview = tasks.filter((task) => task.state === "needs_review").length;
    const status =
      tasks.length > 0 && completed === tasks.length
        ? "completed"
        : blocked > 0
          ? "blocked"
          : needsReview > 0
            ? "needs_review"
            : objective.status === "draft"
              ? "draft"
              : "active";
    const summary = `${completed}/${tasks.length} tasks completed; blocked=${blocked}; needs_review=${needsReview}`;
    return appendConductorEvent(
      {
        ...run,
        objectives: run.objectives.map((entry) =>
          entry.objectiveId === objectiveId
            ? { ...entry, status, summary, revision: entry.revision + 1, updatedAt: new Date().toISOString() }
            : entry,
        ),
      },
      {
        actor: { type: "system", id: "conductor" },
        type: "objective.status_refreshed",
        resourceRefs: { projectKey: run.projectKey, objectiveId },
        payload: { status, summary },
      },
    );
  });
  const updated = updatedRun.objectives.find((entry) => entry.objectiveId === objectiveId);
  if (!updated) {
    throw new Error(`Objective ${objectiveId} disappeared during status refresh`);
  }
  return updated;
}

export function linkTaskToObjectiveForRepo(repoRoot: string, objectiveId: string, taskId: string): ObjectiveRecord {
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => linkTaskToObjective(run, objectiveId, taskId));
  const objective = updatedRun.objectives.find((entry) => entry.objectiveId === objectiveId);
  if (!objective) {
    throw new Error(`Objective ${objectiveId} disappeared during link`);
  }
  return objective;
}

export function planObjectiveForRepo(
  repoRoot: string,
  input: {
    objectiveId: string;
    tasks: Array<{ title: string; prompt: string; dependsOn?: string[] }>;
    rationale?: string;
  },
): ObjectivePlanResult {
  if (input.tasks.length === 0) {
    throw new Error("Objective plan must include at least one task");
  }
  validateObjectivePlanTasks(input.tasks);
  const createdTasks: TaskRecord[] = [];
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => {
    const objective = run.objectives.find((entry) => entry.objectiveId === input.objectiveId);
    if (!objective) {
      throw new Error(`Objective ${input.objectiveId} not found`);
    }
    let nextRun = run;
    for (const taskInput of input.tasks) {
      const dependencyText = taskInput.dependsOn?.length ? `\n\nDepends on: ${taskInput.dependsOn.join(", ")}` : "";
      const task = createTaskRecord({
        taskId: createTaskId(),
        title: taskInput.title,
        prompt: `${taskInput.prompt}${dependencyText}`,
        objectiveId: input.objectiveId,
        dependsOnTaskIds: taskInput.dependsOn
          ?.map(
            (dependency) =>
              createdTasks.find((task) => task.title === dependency || task.taskId === dependency)?.taskId,
          )
          .filter((taskId): taskId is string => Boolean(taskId)),
      });
      nextRun = linkTaskToObjective(addTask(nextRun, task), input.objectiveId, task.taskId);
      createdTasks.push(task);
    }
    return appendConductorEvent(nextRun, {
      actor: { type: "parent_agent", id: "conductor" },
      type: "objective.planned",
      resourceRefs: { projectKey: nextRun.projectKey, objectiveId: input.objectiveId },
      payload: { taskIds: createdTasks.map((task) => task.taskId), rationale: input.rationale ?? null },
    });
  });
  const updatedObjective = updatedRun.objectives.find((entry) => entry.objectiveId === input.objectiveId);
  if (!updatedObjective) {
    throw new Error(`Objective ${input.objectiveId} disappeared during planning`);
  }
  return { objective: updatedObjective, tasks: createdTasks };
}

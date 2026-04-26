import { computeNextActions, incompleteDependenciesForTask } from "./next-actions.js";
import { getOrCreateRunForRepo } from "./repo-run.js";
import type { ConductorNextAction, ObjectiveRecord, TaskRecord } from "./types.js";

export function buildBlockingDiagnosisForRepo(
  repoRoot: string,
  input: { objectiveId?: string; taskId?: string } = {},
): {
  markdown: string;
  blockers: Array<{
    kind: string;
    gateId?: string;
    taskId?: string;
    message: string;
    nextToolCall: { name: string; params: Record<string, unknown> } | null;
  }>;
} {
  const run = getOrCreateRunForRepo(repoRoot);
  const taskIds = input.objectiveId
    ? new Set(run.objectives.find((objective) => objective.objectiveId === input.objectiveId)?.taskIds ?? [])
    : null;
  const blockers = [] as Array<{
    kind: string;
    gateId?: string;
    taskId?: string;
    message: string;
    nextToolCall: { name: string; params: Record<string, unknown> } | null;
  }>;
  for (const gate of run.gates.filter(
    (entry) =>
      entry.status === "open" &&
      (!input.objectiveId ||
        entry.resourceRefs.objectiveId === input.objectiveId ||
        (entry.resourceRefs.taskId && taskIds?.has(entry.resourceRefs.taskId))) &&
      (!input.taskId || entry.resourceRefs.taskId === input.taskId),
  )) {
    blockers.push({
      kind: "gate",
      gateId: gate.gateId,
      message: gate.requestedDecision,
      nextToolCall: ["needs_input", "needs_review"].includes(gate.type)
        ? {
            name: "conductor_resolve_gate",
            params: { gateId: gate.gateId, status: "approved", resolutionReason: "<decision>", actorId: "parent" },
          }
        : null,
    });
  }
  const tasks = input.taskId
    ? run.tasks.filter((task) => task.taskId === input.taskId)
    : input.objectiveId
      ? run.tasks.filter((task) => taskIds?.has(task.taskId))
      : run.tasks;
  for (const task of tasks) {
    for (const dependency of incompleteDependenciesForTask(run, task)) {
      blockers.push({
        kind: "dependency",
        taskId: task.taskId,
        message: `Task ${task.taskId} waits for ${dependency.taskId}`,
        nextToolCall: { name: "conductor_task_brief", params: { taskId: dependency.taskId } },
      });
    }
  }
  const markdown = [
    "# Conductor Blocking Diagnosis",
    "",
    blockers.length === 0
      ? "- no blockers"
      : blockers.map((blocker) => `- ${blocker.kind}: ${blocker.message}`).join("\n"),
  ].join("\n");
  return { markdown, blockers };
}

export function prepareHumanReviewForRepo(
  repoRoot: string,
  input: { objectiveId?: string; taskId?: string } = {},
): {
  markdown: string;
  objective: ObjectiveRecord | null;
  task: TaskRecord | null;
  nextActions: ConductorNextAction[];
  blockers: ReturnType<typeof buildBlockingDiagnosisForRepo>["blockers"];
} {
  const run = getOrCreateRunForRepo(repoRoot);
  const objective = input.objectiveId
    ? (run.objectives.find((entry) => entry.objectiveId === input.objectiveId) ?? null)
    : null;
  const task = input.taskId ? (run.tasks.find((entry) => entry.taskId === input.taskId) ?? null) : null;
  const nextActions = computeNextActions(run, { objectiveId: input.objectiveId, maxActions: 5 }).actions;
  const blockers = buildBlockingDiagnosisForRepo(repoRoot, input).blockers;
  const markdown = [
    "# Conductor Human Review Packet",
    "",
    objective
      ? `Objective: ${objective.title} [${objective.objectiveId}] status=${objective.status}`
      : "Objective: project",
    task ? `Task: ${task.title} [${task.taskId}] state=${task.state}` : "Task: none selected",
    "",
    "## Blockers",
    blockers.length === 0 ? "- none" : blockers.map((blocker) => `- ${blocker.kind}: ${blocker.message}`).join("\n"),
    "",
    "## Next Actions",
    nextActions.length === 0 ? "- none" : nextActions.map((action) => `- ${action.kind}: ${action.title}`).join("\n"),
  ].join("\n");
  return { markdown, objective, task, nextActions, blockers };
}

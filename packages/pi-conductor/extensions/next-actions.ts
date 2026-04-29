import { isTerminalRunStatus } from "./run-status.js";
import type {
  ConductorNextAction,
  ConductorNextActionPriority,
  ConductorNextActionsResponse,
  ConductorResourceRefs,
  RunRecord,
  TaskRecord,
  WorkerRecord,
} from "./types.js";

const priorityRank: Record<ConductorNextActionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function nextAction(input: Omit<ConductorNextAction, "actionId">): ConductorNextAction {
  const refs = input.resourceRefs;
  const actionId = [input.kind, refs.objectiveId, refs.workerId, refs.taskId, refs.runId, refs.gateId, refs.artifactId]
    .filter(Boolean)
    .join(":");
  return { ...input, actionId };
}

export function incompleteDependenciesForTask(run: RunRecord, task: TaskRecord): TaskRecord[] {
  const dependencies = task.dependsOnTaskIds
    .map((taskId) => run.tasks.find((entry) => entry.taskId === taskId))
    .filter((entry): entry is TaskRecord => Boolean(entry));
  return dependencies.filter((entry) => entry.state !== "completed");
}

function isUsableIdleWorker(worker: WorkerRecord): boolean {
  return (
    worker.lifecycle === "idle" && !worker.recoverable && Boolean(worker.worktreePath) && Boolean(worker.sessionFile)
  );
}

function sortNextActions(actions: ConductorNextAction[]): ConductorNextAction[] {
  return [...actions].sort(
    (left, right) =>
      priorityRank[left.priority] - priorityRank[right.priority] || left.actionId.localeCompare(right.actionId),
  );
}

export function computeNextActions(
  run: RunRecord,
  input: {
    now?: string;
    maxActions?: number;
    includeLowPriority?: boolean;
    includePrActions?: boolean;
    includeHumanGateActions?: boolean;
    objectiveId?: string;
    reconciledPreview?: boolean;
  } = {},
): ConductorNextActionsResponse {
  const now = input.now ?? new Date().toISOString();
  const maxActions = Math.max(1, Math.min(input.maxActions ?? 10, 25));
  const actions: ConductorNextAction[] = [];
  const objectiveTaskIds = input.objectiveId
    ? new Set(run.objectives.find((objective) => objective.objectiveId === input.objectiveId)?.taskIds ?? [])
    : null;
  const isInObjectiveScope = (refs: ConductorResourceRefs): boolean => {
    if (!input.objectiveId) return true;
    return (
      refs.objectiveId === input.objectiveId ||
      (refs.taskId !== undefined && Boolean(objectiveTaskIds?.has(refs.taskId)))
    );
  };
  const scopedTasks = input.objectiveId
    ? run.tasks.filter((task) => task.objectiveId === input.objectiveId || Boolean(objectiveTaskIds?.has(task.taskId)))
    : run.tasks;
  const openGates = run.gates.filter((gate) => gate.status === "open" && isInObjectiveScope(gate.resourceRefs));
  const activeRuns = run.runs.filter(
    (attempt) =>
      !attempt.finishedAt &&
      !isTerminalRunStatus(attempt.status) &&
      (!input.objectiveId || Boolean(objectiveTaskIds?.has(attempt.taskId))),
  );
  const usableWorkers = run.workers.filter(isUsableIdleWorker);

  for (const objective of run.objectives.filter(
    (entry) => !input.objectiveId || entry.objectiveId === input.objectiveId,
  )) {
    if (["active", "draft"].includes(objective.status) && objective.taskIds.length === 0) {
      actions.push(
        nextAction({
          priority: "high",
          kind: "plan_objective",
          title: `Plan executable tasks for objective ${objective.title}`,
          rationale: "The objective is active but has no scoped task plan for workers to execute.",
          resourceRefs: { projectKey: run.projectKey, objectiveId: objective.objectiveId },
          toolCall: {
            name: "conductor_plan_objective",
            params: {
              objectiveId: objective.objectiveId,
              tasks: "<derive an ordered task list for this objective>",
            },
          },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "medium",
        }),
      );
    }
  }

  if (!input.objectiveId && run.workers.length === 0) {
    actions.push(
      nextAction({
        priority: run.tasks.length === 0 ? "medium" : "high",
        kind: "create_worker",
        title: "Create the first conductor worker",
        rationale: "The project has no usable workers, so tasks cannot run.",
        resourceRefs: { projectKey: run.projectKey },
        toolCall: { name: "conductor_create_worker", params: { name: "worker-1" } },
        requiresHuman: false,
        destructive: false,
        blockedBy: [],
        confidence: "medium",
      }),
    );
  }

  for (const attempt of activeRuns) {
    if (attempt.leaseExpiresAt && attempt.leaseExpiresAt <= now) {
      actions.push(
        nextAction({
          priority: "critical",
          kind: "reconcile_project",
          title: `Reconcile expired run ${attempt.runId}`,
          rationale: "The run lease has expired but the run is not terminal.",
          resourceRefs: {
            projectKey: run.projectKey,
            taskId: attempt.taskId,
            workerId: attempt.workerId,
            runId: attempt.runId,
          },
          toolCall: { name: "conductor_reconcile_project", params: { dryRun: false } },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "high",
        }),
      );
    } else if (input.includeLowPriority) {
      actions.push(
        nextAction({
          priority: "low",
          kind: "wait_for_run",
          title: `Wait for active run ${attempt.runId}`,
          rationale: "The run is active and its lease has not expired.",
          resourceRefs: {
            projectKey: run.projectKey,
            taskId: attempt.taskId,
            workerId: attempt.workerId,
            runId: attempt.runId,
          },
          toolCall:
            attempt.runtime.mode === "tmux" || attempt.runtime.mode === "iterm-tmux"
              ? { name: "conductor_view_active_workers", params: { runId: attempt.runId } }
              : { name: "conductor_list_events", params: { runId: attempt.runId, limit: 20 } },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "high",
        }),
      );
    }
  }

  for (const gate of openGates) {
    const refs = { ...gate.resourceRefs, gateId: gate.gateId };
    if (["approval_required", "ready_for_pr", "destructive_cleanup"].includes(gate.type)) {
      if (input.includeHumanGateActions ?? true) {
        actions.push(
          nextAction({
            priority: gate.type === "destructive_cleanup" ? "critical" : "high",
            kind: "await_human_gate",
            title: `Human decision required for ${gate.type} gate ${gate.gateId}`,
            rationale: "This gate type requires a human actor for approval.",
            resourceRefs: refs,
            toolCall: null,
            requiresHuman: true,
            destructive: gate.type === "destructive_cleanup",
            blockedBy: [{ gateId: gate.gateId }],
            confidence: "high",
          }),
        );
      }
    } else {
      actions.push(
        nextAction({
          priority: gate.type === "needs_input" ? "high" : "medium",
          kind: "resolve_gate",
          title: `Resolve ${gate.type} gate ${gate.gateId}`,
          rationale: gate.requestedDecision,
          resourceRefs: refs,
          toolCall: {
            name: "conductor_resolve_gate",
            params: {
              gateId: gate.gateId,
              status: "approved",
              resolutionReason: "<parent decision required>",
              actorId: "parent",
              actorType: "parent_agent",
            },
          },
          requiresHuman: false,
          destructive: false,
          blockedBy: [{ gateId: gate.gateId }],
          confidence: "medium",
        }),
      );
    }
  }

  for (const worker of run.workers) {
    if (worker.lifecycle === "broken" || worker.recoverable) {
      actions.push(
        nextAction({
          priority: "high",
          kind: "recover_worker",
          title: `Recover worker ${worker.name}`,
          rationale: "The worker is broken or recoverable.",
          resourceRefs: { projectKey: run.projectKey, workerId: worker.workerId },
          toolCall: { name: "conductor_recover_worker", params: { name: worker.name } },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "high",
        }),
      );
    }
  }

  for (const task of scopedTasks) {
    const assignedWorker = run.workers.find((worker) => worker.workerId === task.assignedWorkerId);
    if (task.activeRunId) {
      continue;
    }
    if (task.state === "ready" && !task.assignedWorkerId && usableWorkers[0]) {
      actions.push(
        nextAction({
          priority: "medium",
          kind: "assign_task",
          title: `Assign ready task ${task.taskId}`,
          rationale: "The task is ready and an idle usable worker exists.",
          resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, workerId: usableWorkers[0].workerId },
          toolCall: {
            name: "conductor_assign_task",
            params: { taskId: task.taskId, workerId: usableWorkers[0].workerId },
          },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "medium",
        }),
      );
    }
    const incompleteDependencies = incompleteDependenciesForTask(run, task);
    if (task.state === "assigned" && incompleteDependencies.length > 0) {
      actions.push(
        nextAction({
          priority: "high",
          kind: "wait_for_dependency",
          title: `Wait for dependencies before running task ${task.taskId}`,
          rationale: "The task is assigned but one or more dependency tasks are not completed.",
          resourceRefs: {
            projectKey: run.projectKey,
            taskId: task.taskId,
            workerId: task.assignedWorkerId ?? undefined,
          },
          toolCall: { name: "conductor_task_brief", params: { taskId: task.taskId } },
          requiresHuman: false,
          destructive: false,
          blockedBy: incompleteDependencies.map((dependency) => ({ taskId: dependency.taskId })),
          confidence: "high",
        }),
      );
      continue;
    }
    if (task.state === "assigned" && assignedWorker && isUsableIdleWorker(assignedWorker)) {
      actions.push(
        nextAction({
          priority: "high",
          kind: "run_task",
          title: `Run assigned task ${task.taskId}`,
          rationale: "The task is assigned and the worker is idle.",
          resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, workerId: assignedWorker.workerId },
          toolCall: { name: "conductor_run_task", params: { taskId: task.taskId } },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "high",
        }),
      );
    }
    if (
      ["blocked", "failed", "needs_review", "canceled"].includes(task.state) &&
      assignedWorker &&
      isUsableIdleWorker(assignedWorker)
    ) {
      actions.push(
        nextAction({
          priority: "medium",
          kind: "retry_task",
          title: `Retry task ${task.taskId}`,
          rationale: `The task is ${task.state} and has an idle assigned worker.`,
          resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, workerId: assignedWorker.workerId },
          toolCall: { name: "conductor_retry_task", params: { taskId: task.taskId } },
          requiresHuman: false,
          destructive: false,
          blockedBy: [],
          confidence: "medium",
        }),
      );
    }
  }

  const filtered = input.includeLowPriority ? actions : actions.filter((action) => action.priority !== "low");
  const sorted = sortNextActions(filtered);
  const returned = sorted.slice(0, maxActions);
  const highestPriority = returned[0]?.priority ?? null;
  const status =
    run.workers.length === 0 && run.tasks.length === 0
      ? "empty"
      : returned.some((action) => action.priority === "critical")
        ? "blocked"
        : returned.length > 0
          ? "actionable"
          : openGates.length > 0 || activeRuns.length > 0
            ? "waiting"
            : "healthy_idle";
  const headline =
    status === "empty"
      ? "No conductor workers or tasks exist yet."
      : status === "blocked"
        ? "Critical conductor maintenance or gate decisions are required."
        : status === "actionable"
          ? "Parent orchestration can proceed with recommended tool calls."
          : status === "waiting"
            ? "No safe immediate parent action; waiting on active runs or human gates."
            : "Project is healthy and idle.";
  return {
    project: {
      projectKey: run.projectKey,
      repoRoot: run.repoRoot,
      schemaVersion: run.schemaVersion,
      revision: run.revision,
      reconciledPreview: input.reconciledPreview ?? false,
      counts: {
        workers: run.workers.length,
        tasks: scopedTasks.length,
        runs: run.runs.length,
        gates: run.gates.length,
        artifacts: run.artifacts.length,
        events: run.events.length,
      },
    },
    summary: { status, headline, totalActions: sorted.length, returnedActions: returned.length, highestPriority },
    actions: returned,
    omitted: {
      count: Math.max(0, sorted.length - returned.length),
      reason: sorted.length > returned.length ? "maxActions" : null,
    },
  };
}

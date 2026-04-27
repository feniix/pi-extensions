import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ConductorBackendDispatcher,
  getConductorBackendAdapter,
  getConductorRuntimeModeStatus,
  inspectConductorBackends,
} from "./backends.js";
import { createGateForRepo } from "./gate-service.js";
import {
  commitAllChanges,
  createPullRequest,
  pushBranchToOrigin,
  validatePrPreconditions,
  validatePushPreconditions,
} from "./git-pr.js";
import { computeNextActions } from "./next-actions.js";
import { createObjectiveForRepo, planObjectiveForRepo, refreshObjectiveStatusForRepo } from "./objective-service.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { createWorkerSessionRuntime, getWorkerRunRuntimeBackend, recoverWorkerSessionRuntime } from "./runtime.js";
import { formatRunRuntimeSummary } from "./runtime-metadata.js";
import { type SchedulerFairness, type SchedulerPolicyName, selectSchedulerActions } from "./scheduler-selection.js";
import {
  addConductorArtifact,
  addWorker,
  appendConductorEvent,
  completeTaskRun,
  createWorkerRecord,
  markConductorGateUsed,
  reconcileRunLeases,
  removeWorker,
  setWorkerPrState,
} from "./storage.js";
import {
  assignTaskForRepo,
  cancelTaskRunForRepo as cancelTaskRunStateForRepo,
  createFollowUpTaskForRepo,
  createTaskForRepo,
  recordTaskCompletionForRepo,
  recordTaskProgressForRepo,
  retryTaskForRepo,
  startTaskRunForRepo,
} from "./task-service.js";
import type {
  ConductorEventType,
  ConductorNextAction,
  ConductorNextActionsResponse,
  ConductorProjectBrief,
  ConductorResourceRefs,
  ConductorResourceTimeline,
  ConductorTaskBrief,
  RunAttemptRecord,
  RunRecord,
  RunRuntimeMode,
  TaskContractInput,
  TaskRecord,
  WorkerRecord,
  WorkerRunResult,
} from "./types.js";

export { buildEvidenceBundleForRepo, checkReadinessForRepo } from "./evidence-service.js";
export { createGateForRepo, resolveGateForRepo, resolveGateFromTrustedHumanForRepo } from "./gate-service.js";
export { computeNextActions } from "./next-actions.js";
export {
  createObjectiveForRepo,
  linkTaskToObjectiveForRepo,
  planObjectiveForRepo,
  refreshObjectiveStatusForRepo,
  updateObjectiveForRepo,
} from "./objective-service.js";
export { getOrCreateRunForRepo } from "./repo-run.js";
export { buildBlockingDiagnosisForRepo, prepareHumanReviewForRepo } from "./review-service.js";
export type { SchedulerFairness, SchedulerPolicyName } from "./scheduler-selection.js";
export {
  assignTaskForRepo,
  createFollowUpTaskForRepo,
  createTaskForRepo,
  recordTaskCompletionForRepo,
  recordTaskProgressForRepo,
  retryTaskForRepo,
  startTaskRunForRepo,
  updateTaskForRepo,
} from "./task-service.js";

export type ParallelWorkItemInput = {
  title: string;
  prompt: string;
  workerName?: string;
};

export type ParallelWorkRunner = (
  repoRoot: string,
  taskId: string,
  signal?: AbortSignal,
  input?: { runtimeMode?: RunRuntimeMode },
) => Promise<WorkerRunResult>;

export type WorkRoutingMode = "auto" | "single" | "parallel" | "objective";

export type RunWorkItemInput = ParallelWorkItemInput & {
  writeScope?: string[];
  dependsOn?: string[];
};

export type WorkRoutingDecision = {
  mode: Exclude<WorkRoutingMode, "auto">;
  confidence: number;
  reason: string;
  tasks: RunWorkItemInput[];
  riskFlags: string[];
};

type LiveWorkAbortHandle = {
  runId?: string;
  taskId: string;
  workerId?: string;
  controller: AbortController;
};

const liveWorkAbortHandles = new Set<LiveWorkAbortHandle>();

function createLinkedAbortController(parentSignal?: AbortSignal): {
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!parentSignal) {
    return { controller, signal: controller.signal, dispose: () => undefined };
  }
  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort);
  if (parentSignal.aborted) {
    onAbort();
  }
  return {
    controller,
    signal: controller.signal,
    dispose: () => parentSignal.removeEventListener("abort", onAbort),
  };
}

function registerLiveWorkAbortHandle(handle: LiveWorkAbortHandle): () => void {
  liveWorkAbortHandles.add(handle);
  return () => {
    liveWorkAbortHandles.delete(handle);
  };
}

function liveHandleMatchesFilter(
  handle: LiveWorkAbortHandle,
  filter: { runIds?: Set<string>; taskIds?: Set<string>; workerIds?: Set<string> },
): boolean {
  const runMatches = !filter.runIds || (handle.runId !== undefined && filter.runIds.has(handle.runId));
  const taskMatches = !filter.taskIds || filter.taskIds.has(handle.taskId);
  const workerMatches = !filter.workerIds || (handle.workerId !== undefined && filter.workerIds.has(handle.workerId));
  return runMatches && taskMatches && workerMatches;
}

function abortLiveWorkForFilter(filter: {
  runIds?: Set<string>;
  taskIds?: Set<string>;
  workerIds?: Set<string>;
}): void {
  for (const handle of liveWorkAbortHandles) {
    if (liveHandleMatchesFilter(handle, filter) && !handle.controller.signal.aborted) {
      handle.controller.abort();
    }
  }
}

function resolveSchedulerPolicy(input: { policy?: SchedulerPolicyName; executeRuns?: boolean }): {
  policy: SchedulerPolicyName;
  executeRuns: boolean;
} {
  if (input.policy) {
    return { policy: input.policy, executeRuns: input.policy === "execute" };
  }
  return { policy: input.executeRuns ? "execute" : "safe", executeRuns: input.executeRuns ?? false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventTypeForOperation(status: "succeeded" | "failed", operation: unknown): ConductorEventType {
  const suffix = status === "succeeded" ? "succeeded" : "failed";
  switch (operation) {
    case "scheduler_tick_started":
      return "scheduler.tick_started";
    case "scheduler_tick":
      return status === "succeeded" ? "scheduler.tick_succeeded" : "scheduler.tick_failed";
    case "dispatch_task_run":
      return status === "succeeded" ? "backend.dispatch_succeeded" : "backend.dispatch_failed";
    case "commit_worker":
      return `worker.commit_${suffix}` as ConductorEventType;
    case "push_worker":
      return `worker.push_${suffix}` as ConductorEventType;
    case "create_worker_pr":
      return status === "succeeded" ? "worker.pr_created" : "worker.pr_failed";
    case "recover_worker":
      return status === "succeeded" ? "worker.recovery_succeeded" : "worker.recovery_failed";
    case "cleanup_worker":
      return status === "succeeded" ? "worker.cleanup_succeeded" : "worker.cleanup_failed";
    default:
      return status === "succeeded" ? "external_operation.succeeded" : "external_operation.failed";
  }
}

function appendExternalOperationEvent(
  run: RunRecord,
  input: { status: "succeeded" | "failed"; resourceRefs?: ConductorResourceRefs; payload: Record<string, unknown> },
): RunRecord {
  return appendConductorEvent(run, {
    actor: { type: "system", id: "conductor" },
    type: eventTypeForOperation(input.status, input.payload.operation),
    resourceRefs: { projectKey: run.projectKey, ...(input.resourceRefs ?? {}) },
    payload: input.payload,
  });
}

function recordExternalOperationEvent(
  repoRoot: string,
  input: { status: "succeeded" | "failed"; resourceRefs?: ConductorResourceRefs; payload: Record<string, unknown> },
): void {
  mutateRepoRunSync(repoRoot, (run) => appendExternalOperationEvent(run, input));
}

import { createWorkerId } from "./workers.js";
import {
  createManagedWorktree,
  recreateManagedWorktree,
  removeManagedBranch,
  removeManagedWorktree,
} from "./worktrees.js";

function refsMatchFilter(refs: ConductorResourceRefs, filter: ConductorResourceRefs): boolean {
  return (["objectiveId", "workerId", "taskId", "runId", "gateId", "artifactId"] as const).some(
    (key) => filter[key] !== undefined && refs[key] === filter[key],
  );
}

export function buildResourceTimelineForRepo(
  repoRoot: string,
  input: ConductorResourceRefs & { limit?: number; includeArtifacts?: boolean },
): ConductorResourceTimeline {
  const run = getOrCreateRunForRepo(repoRoot);
  const resourceRefs: ConductorResourceRefs = {
    projectKey: run.projectKey,
    objectiveId: input.objectiveId,
    workerId: input.workerId,
    taskId: input.taskId,
    runId: input.runId,
    gateId: input.gateId,
    artifactId: input.artifactId,
  };
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const matchingEvents = run.events.filter((event) => refsMatchFilter(event.resourceRefs, resourceRefs)).slice(-limit);
  const matchingArtifacts = input.includeArtifacts
    ? run.artifacts.filter(
        (artifact) => refsMatchFilter(artifact.resourceRefs, resourceRefs) || artifact.artifactId === input.artifactId,
      )
    : [];
  const matchingGates = run.gates.filter(
    (gate) => refsMatchFilter(gate.resourceRefs, resourceRefs) || gate.gateId === input.gateId,
  );
  const matchingRuns = run.runs.filter((attempt) => {
    if (input.runId && attempt.runId === input.runId) return true;
    if (input.taskId && attempt.taskId === input.taskId) return true;
    if (input.workerId && attempt.workerId === input.workerId) return true;
    return false;
  });
  const markdown = [
    "# Conductor Resource Timeline",
    "",
    `Resource: ${JSON.stringify(resourceRefs)}`,
    "",
    "## Events",
    matchingEvents.length === 0
      ? "- none"
      : matchingEvents
          .map(
            (event) =>
              `- #${event.sequence} ${event.type} at ${event.occurredAt} refs=${JSON.stringify(event.resourceRefs)}`,
          )
          .join("\n"),
    "",
    "## Artifacts",
    matchingArtifacts.length === 0
      ? "- none"
      : matchingArtifacts.map((artifact) => `- ${artifact.type} ${artifact.ref} [${artifact.artifactId}]`).join("\n"),
  ].join("\n");
  return {
    markdown,
    resourceRefs,
    events: matchingEvents,
    artifacts: matchingArtifacts,
    gates: matchingGates,
    runs: matchingRuns,
  };
}

export function buildObjectiveDagForRepo(
  repoRoot: string,
  objectiveId: string,
): {
  objectiveId: string;
  batches: string[][];
  parallelizableBatches: string[][];
  runnableNow: string[];
  externalDependencies: Array<{ taskId: string; dependsOnTaskId: string }>;
} {
  const run = getOrCreateRunForRepo(repoRoot);
  const objective = run.objectives.find((entry) => entry.objectiveId === objectiveId);
  if (!objective) {
    throw new Error(`Objective ${objectiveId} not found`);
  }
  const tasks = run.tasks.filter((task) => objective.taskIds.includes(task.taskId));
  const taskIdSet = new Set(tasks.map((task) => task.taskId));
  const externalDependencies = tasks.flatMap((task) =>
    task.dependsOnTaskIds
      .filter((dependencyId) => !taskIdSet.has(dependencyId))
      .map((dependencyId) => ({ taskId: task.taskId, dependsOnTaskId: dependencyId })),
  );
  const remaining = new Map(
    tasks.map((task) => [
      task.taskId,
      new Set(task.dependsOnTaskIds.filter((dependencyId) => taskIdSet.has(dependencyId))),
    ]),
  );
  const completed = new Set<string>();
  const batches: string[][] = [];
  while (remaining.size > 0) {
    const batch = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((dep) => completed.has(dep) || !remaining.has(dep)))
      .map(([taskId]) => taskId);
    if (batch.length === 0) {
      throw new Error(`Objective ${objectiveId} has a cyclic task dependency graph`);
    }
    batches.push(batch);
    for (const taskId of batch) {
      remaining.delete(taskId);
      completed.add(taskId);
    }
  }
  const runnableNow = tasks
    .filter(
      (task) =>
        task.state !== "completed" &&
        task.dependsOnTaskIds.every(
          (dependencyId) => run.tasks.find((entry) => entry.taskId === dependencyId)?.state === "completed",
        ),
    )
    .map((task) => task.taskId);
  return { objectiveId, batches, parallelizableBatches: batches, runnableNow, externalDependencies };
}

export function assessTaskForRepo(
  repoRoot: string,
  input: { taskId: string; requireTestEvidence?: boolean; requirePrEvidence?: boolean },
): {
  taskId: string;
  verdict: "ready" | "not_ready" | "blocked" | "needs_review";
  findings: Array<{ code: string; message: string }>;
} {
  const brief = buildTaskBriefForRepo(repoRoot, input);
  const findings: Array<{ code: string; message: string }> = [];
  if (!["completed", "needs_review"].includes(brief.task.state)) {
    findings.push({ code: "task_not_terminal", message: `Task is ${brief.task.state}` });
  }
  if (brief.runs.some((run) => run.status === "failed" || run.status === "stale")) {
    findings.push({ code: "failed_or_stale_run", message: "Task has failed or stale runs" });
  }
  if (!brief.artifacts.some((artifact) => artifact.type === "completion_report")) {
    findings.push({
      code: "missing_completion_report",
      message: "No completion report artifact is linked to this task",
    });
  }
  if (brief.gates.some((gate) => gate.status === "open")) {
    findings.push({ code: "open_gate", message: "Task has open gates" });
  }
  if (brief.dependencies.some((dependency) => dependency.state !== "completed")) {
    findings.push({ code: "incomplete_dependency", message: "Task dependencies are not completed" });
  }
  if (input.requireTestEvidence && !brief.artifacts.some((artifact) => artifact.type === "test_result")) {
    findings.push({ code: "missing_test_result", message: "No test result artifact is linked to this task" });
  }
  if (input.requirePrEvidence && !brief.artifacts.some((artifact) => artifact.type === "pr_evidence")) {
    findings.push({ code: "missing_pr_evidence", message: "No PR evidence artifact is linked to this task" });
  }
  const verdict = findings.some((finding) => finding.code === "open_gate" || finding.code === "incomplete_dependency")
    ? "blocked"
    : findings.length === 0
      ? "ready"
      : brief.task.state === "needs_review"
        ? "needs_review"
        : "not_ready";
  return { taskId: input.taskId, verdict, findings };
}

export function buildTaskBriefForRepo(repoRoot: string, input: { taskId: string }): ConductorTaskBrief {
  const run = getOrCreateRunForRepo(repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.taskId);
  if (!task) {
    throw new Error(`Task ${input.taskId} not found`);
  }
  const objective = task.objectiveId
    ? (run.objectives.find((entry) => entry.objectiveId === task.objectiveId) ?? null)
    : null;
  const worker = task.assignedWorkerId
    ? (run.workers.find((entry) => entry.workerId === task.assignedWorkerId) ?? null)
    : null;
  const runs = run.runs.filter((entry) => task.runIds.includes(entry.runId));
  const gates = run.gates.filter((gate) => gate.resourceRefs.taskId === task.taskId);
  const artifacts = run.artifacts.filter((artifact) => artifact.resourceRefs.taskId === task.taskId);
  const dependencies = task.dependsOnTaskIds.map((taskId) => {
    const dependency = run.tasks.find((entry) => entry.taskId === taskId);
    return { taskId, title: dependency?.title ?? "<missing dependency>", state: dependency?.state ?? "failed" };
  });
  const suggestedNextTool =
    task.state === "assigned" && worker
      ? { name: "conductor_run_task", params: { taskId: task.taskId } }
      : task.state === "ready"
        ? { name: "conductor_assign_task", params: { taskId: task.taskId, workerId: "<workerId>" } }
        : ["failed", "blocked", "needs_review", "canceled"].includes(task.state)
          ? { name: "conductor_retry_task", params: { taskId: task.taskId } }
          : null;
  const markdown = [
    "# Conductor Task Brief",
    "",
    `Task: ${task.title} [${task.taskId}]`,
    `State: ${task.state}`,
    objective ? `Objective: ${objective.title} [${objective.objectiveId}]` : "Objective: none",
    worker ? `Worker: ${worker.name} [${worker.workerId}] lifecycle=${worker.lifecycle}` : "Worker: unassigned",
    "",
    "## Prompt",
    task.prompt,
    "",
    "## Evidence",
    `Runs: ${runs.length}`,
    `Gates: ${gates.length}`,
    `Artifacts: ${artifacts.length}`,
    "",
    "## Runs",
    runs.length === 0
      ? "- none"
      : runs
          .map(
            (attempt) =>
              `- ${attempt.runId} status=${attempt.status} taskRevision=${attempt.taskRevision} ${formatRunRuntimeSummary(attempt.runtime)}`,
          )
          .join("\n"),
    "",
    "## Dependencies",
    dependencies.length === 0
      ? "- none"
      : dependencies
          .map((dependency) => `- ${dependency.title} [${dependency.taskId}] state=${dependency.state}`)
          .join("\n"),
    "",
    "## Suggested Next Tool",
    suggestedNextTool ? `${suggestedNextTool.name} ${JSON.stringify(suggestedNextTool.params)}` : "none",
  ].join("\n");
  return { markdown, task, objective, worker, runs, gates, artifacts, suggestedNextTool, dependencies };
}

export function buildProjectBriefForRepo(
  repoRoot: string,
  input: { maxActions?: number; recentEventLimit?: number } = {},
): ConductorProjectBrief {
  const run = getOrCreateRunForRepo(repoRoot);
  const nextActions = computeNextActions(run, { maxActions: input.maxActions ?? 5 }).actions;
  const blockers = run.gates.filter((gate) => gate.status === "open");
  const objectives = run.objectives.map((objective) => {
    const tasks = run.tasks.filter((task) => objective.taskIds.includes(task.taskId));
    return {
      objectiveId: objective.objectiveId,
      title: objective.title,
      status: objective.status,
      taskCount: tasks.length,
      completedTaskCount: tasks.filter((task) => task.state === "completed").length,
      blockedTaskCount: tasks.filter((task) => ["blocked", "failed", "needs_review"].includes(task.state)).length,
    };
  });
  const recentEventLimit = Math.max(1, Math.min(input.recentEventLimit ?? 10, 50));
  const recentEvents = run.events.slice(-recentEventLimit);
  const activeRuns = run.runs.filter(isActiveRunAttempt);
  const lines = [
    "# Conductor Project Brief",
    "",
    `Project: ${run.projectKey}`,
    `Revision: ${run.revision}`,
    `Counts: workers=${run.workers.length} objectives=${run.objectives.length} tasks=${run.tasks.length} runs=${run.runs.length} gates=${run.gates.length} artifacts=${run.artifacts.length}`,
    "",
    "## Objectives",
    objectives.length === 0
      ? "- none"
      : objectives
          .map(
            (objective) =>
              `- ${objective.title} [${objective.objectiveId}] status=${objective.status} tasks=${objective.taskCount} completed=${objective.completedTaskCount} blocked=${objective.blockedTaskCount}`,
          )
          .join("\n"),
    "",
    "## Blockers",
    blockers.length === 0
      ? "- none"
      : blockers
          .map((gate) => `- ${gate.type} [${gate.gateId}] ${gate.requestedDecision} operation=${gate.operation}`)
          .join("\n"),
    "",
    "## Active Runs",
    activeRuns.length === 0
      ? "- none"
      : activeRuns
          .map(
            (attempt) =>
              `- ${attempt.runId} task=${attempt.taskId} worker=${attempt.workerId} status=${attempt.status} ${formatRunRuntimeSummary(attempt.runtime)} cancel=conductor_cancel_task_run({"runId":"${attempt.runId}","reason":"<reason>"})`,
          )
          .join("\n"),
    "",
    "## Recommended Next Actions",
    nextActions.length === 0
      ? "- none"
      : nextActions.map((action) => `- [${action.priority}] ${action.kind}: ${action.title}`).join("\n"),
  ];
  return {
    markdown: lines.join("\n"),
    project: {
      projectKey: run.projectKey,
      repoRoot: run.repoRoot,
      revision: run.revision,
      counts: {
        workers: run.workers.length,
        objectives: run.objectives.length,
        tasks: run.tasks.length,
        runs: run.runs.length,
        gates: run.gates.length,
        artifacts: run.artifacts.length,
        events: run.events.length,
      },
    },
    objectives,
    blockers,
    nextActions,
    recentEvents,
  };
}

async function executeConductorAction(
  repoRoot: string,
  action: ConductorNextAction,
  input: { executeRuns: boolean },
  signal?: AbortSignal,
): Promise<{ executed: boolean; reason: string | null; action: ConductorNextAction; result: unknown }> {
  if (action.requiresHuman) return { executed: false, reason: "action requires human", action, result: null };
  if (action.destructive) return { executed: false, reason: "action is destructive", action, result: null };
  const mediumConfidenceAllowed = new Set(["assign_task", "retry_task", "refresh_objective_status"]);
  if (action.confidence !== "high" && action.kind !== "plan_objective" && !mediumConfidenceAllowed.has(action.kind)) {
    return { executed: false, reason: "action confidence is not high", action, result: null };
  }
  if (action.kind === "plan_objective" && action.resourceRefs.objectiveId) {
    const objective = getOrCreateRunForRepo(repoRoot).objectives.find(
      (entry) => entry.objectiveId === action.resourceRefs.objectiveId,
    );
    const result = planObjectiveForRepo(repoRoot, {
      objectiveId: action.resourceRefs.objectiveId,
      tasks: [
        {
          title: `Next task for ${objective?.title ?? "objective"}`,
          prompt: objective?.prompt ?? "Execute the objective",
        },
      ],
      rationale: "Generated from conductor_run_next_action",
    });
    return { executed: true, reason: null, action, result };
  }
  if (action.kind === "reconcile_project") {
    return { executed: true, reason: null, action, result: reconcileProjectForRepo(repoRoot, { dryRun: false }) };
  }
  if (action.kind === "run_task" && typeof action.toolCall?.params.taskId === "string") {
    if (!input.executeRuns) {
      return { executed: false, reason: "run execution disabled by scheduler policy", action, result: null };
    }
    return {
      executed: true,
      reason: null,
      action,
      result: await runTaskForRepo(repoRoot, action.toolCall.params.taskId, signal),
    };
  }
  if (action.kind === "retry_task" && typeof action.toolCall?.params.taskId === "string") {
    return {
      executed: true,
      reason: null,
      action,
      result: retryTaskForRepo(repoRoot, { taskId: action.toolCall.params.taskId }),
    };
  }
  if (action.kind === "recover_worker" && typeof action.toolCall?.params.name === "string") {
    return {
      executed: true,
      reason: null,
      action,
      result: await recoverWorkerForRepo(repoRoot, action.toolCall.params.name),
    };
  }
  if (
    action.kind === "assign_task" &&
    typeof action.toolCall?.params.taskId === "string" &&
    typeof action.toolCall.params.workerId === "string"
  ) {
    return {
      executed: true,
      reason: null,
      action,
      result: assignTaskForRepo(repoRoot, action.toolCall.params.taskId, action.toolCall.params.workerId),
    };
  }
  return { executed: false, reason: `unsupported action ${action.kind}`, action, result: null };
}

export async function runNextActionForRepo(
  repoRoot: string,
  input: { objectiveId?: string; executeRuns?: boolean; policy?: SchedulerPolicyName } = {},
  signal?: AbortSignal,
): Promise<{ executed: boolean; reason: string | null; action: ConductorNextAction | null; result: unknown }> {
  const schedulerPolicy = resolveSchedulerPolicy(input);
  const action =
    getNextActionsForRepo(repoRoot, { objectiveId: input.objectiveId, maxActions: 1, reconcile: false }).actions[0] ??
    null;
  return action
    ? executeConductorAction(repoRoot, action, schedulerPolicy, signal)
    : { executed: false, reason: "no action", action, result: null };
}

export async function scheduleObjectiveForRepo(
  repoRoot: string,
  input: {
    objectiveId?: string;
    objectiveIds?: string[];
    maxConcurrency?: number;
    executeRuns?: boolean;
    policy?: SchedulerPolicyName;
    runtimeMode?: RunRuntimeMode;
  },
  signal?: AbortSignal,
): Promise<{
  objectiveId: string | null;
  assigned: TaskRecord[];
  executed: Array<{ taskId: string; result: unknown }>;
  skipped: string[];
}> {
  const schedulerPolicy = resolveSchedulerPolicy(input);
  const maxConcurrency = Math.max(1, Math.min(input.maxConcurrency ?? 1, 10));
  const initialRun = getOrCreateRunForRepo(repoRoot);
  const objectiveIds =
    input.objectiveIds ??
    (input.objectiveId ? [input.objectiveId] : initialRun.objectives.map((objective) => objective.objectiveId));
  const runnableTaskIds = objectiveIds.flatMap((objectiveId) =>
    buildObjectiveDagForRepo(repoRoot, objectiveId).runnableNow.slice(0, 1),
  );
  const run = getOrCreateRunForRepo(repoRoot);
  const runnableTasks = runnableTaskIds
    .map((taskId) => run.tasks.find((task) => task.taskId === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
    .filter((task) => task.state === "ready" || task.state === "assigned")
    .slice(0, maxConcurrency);
  const idleWorkers = run.workers.filter(
    (worker) => worker.lifecycle === "idle" && !worker.recoverable && worker.worktreePath && worker.sessionFile,
  );
  const assigned: TaskRecord[] = [];
  const executed: Array<{ taskId: string; result: unknown }> = [];
  const skipped: string[] = [];
  for (const task of runnableTasks) {
    let schedulableTask = task;
    if (!schedulableTask.assignedWorkerId) {
      const worker = idleWorkers.shift();
      if (!worker) {
        skipped.push(task.taskId);
        continue;
      }
      schedulableTask = assignTaskForRepo(repoRoot, task.taskId, worker.workerId);
      assigned.push(schedulableTask);
    }
    if (schedulerPolicy.executeRuns) {
      const result = await runTaskForRepo(repoRoot, schedulableTask.taskId, signal, { runtimeMode: input.runtimeMode });
      executed.push({ taskId: schedulableTask.taskId, result });
    }
  }
  return { objectiveId: input.objectiveId ?? null, assigned, executed, skipped };
}

function recordSchedulerActionEvent(
  repoRoot: string,
  type: ConductorEventType,
  action: ConductorNextAction | null,
  payload: Record<string, unknown>,
): void {
  mutateRepoRunSync(repoRoot, (run) =>
    appendConductorEvent(run, {
      actor: { type: "system", id: "conductor" },
      type,
      resourceRefs: { projectKey: run.projectKey, ...(action?.resourceRefs ?? {}) },
      payload: { actionId: action?.actionId ?? null, actionKind: action?.kind ?? null, ...payload },
    }),
  );
}

export async function schedulerTickForRepo(
  repoRoot: string,
  input: {
    objectiveId?: string;
    maxActions?: number;
    maxRuns?: number;
    perObjectiveLimit?: number;
    fairness?: SchedulerFairness;
    executeRuns?: boolean;
    policy?: SchedulerPolicyName;
  } = {},
  signal?: AbortSignal,
): Promise<{
  executed: Array<{ action: ConductorNextAction | null; result: unknown }>;
  skipped: Array<{ action: ConductorNextAction | null; reason: string | null }>;
}> {
  const schedulerPolicy = resolveSchedulerPolicy(input);
  const maxActions = Math.max(1, Math.min(input.maxActions ?? 1, 10));
  const maxRuns = Math.max(0, Math.min(input.maxRuns ?? maxActions, maxActions));
  const perObjectiveLimit = Math.max(1, Math.min(input.perObjectiveLimit ?? maxActions, maxActions));
  const fairness = input.fairness ?? "priority";
  const executed: Array<{ action: ConductorNextAction | null; result: unknown }> = [];
  const skipped: Array<{ action: ConductorNextAction | null; reason: string | null }> = [];
  recordExternalOperationEvent(repoRoot, {
    status: "succeeded",
    resourceRefs: { objectiveId: input.objectiveId },
    payload: { operation: "scheduler_tick_started", policy: schedulerPolicy.policy, fairness, maxActions, maxRuns },
  });
  try {
    const runSnapshot = getOrCreateRunForRepo(repoRoot);
    const taskObjectiveIds = new Map(runSnapshot.tasks.map((task) => [task.taskId, task.objectiveId]));
    const actions = getNextActionsForRepo(repoRoot, {
      objectiveId: input.objectiveId,
      maxActions: 100,
      reconcile: false,
    }).actions;
    const selection = selectSchedulerActions({
      actions,
      taskObjectiveIds,
      maxActions,
      maxRuns,
      perObjectiveLimit,
      fairness,
      executeRuns: schedulerPolicy.executeRuns,
    });
    skipped.push(...selection.skipped);
    for (const action of selection.selected) {
      recordSchedulerActionEvent(repoRoot, "scheduler.action_selected", action, {
        fairness,
        policy: schedulerPolicy.policy,
      });
      const result = await executeConductorAction(repoRoot, action, schedulerPolicy, signal);
      if (result.executed) {
        executed.push({ action, result: result.result });
      } else {
        skipped.push({ action, reason: result.reason });
        recordSchedulerActionEvent(repoRoot, "scheduler.action_skipped", action, { reason: result.reason });
      }
    }
    for (const entry of skipped) {
      if (entry.action)
        recordSchedulerActionEvent(repoRoot, "scheduler.action_skipped", entry.action, { reason: entry.reason });
      if (entry.reason?.includes("capacity")) {
        recordSchedulerActionEvent(repoRoot, "scheduler.capacity_exhausted", entry.action, { reason: entry.reason });
      }
    }
    recordExternalOperationEvent(repoRoot, {
      status: "succeeded",
      resourceRefs: { objectiveId: input.objectiveId },
      payload: {
        operation: "scheduler_tick",
        policy: schedulerPolicy.policy,
        fairness,
        executeRuns: schedulerPolicy.executeRuns,
        maxActions,
        maxRuns,
        perObjectiveLimit,
        executedCount: executed.length,
        skippedCount: skipped.length,
        executedActions: executed.map((entry) => entry.action?.kind ?? null),
        skipped: skipped.map((entry) => ({ action: entry.action?.kind ?? null, reason: entry.reason })),
      },
    });
    return { executed, skipped };
  } catch (error) {
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { objectiveId: input.objectiveId },
      payload: {
        operation: "scheduler_tick",
        policy: schedulerPolicy.policy,
        fairness,
        maxActions,
        errorMessage: errorMessage(error),
      },
    });
    throw error;
  }
}

export function getNextActionsForRepo(
  repoRoot: string,
  input: {
    maxActions?: number;
    includeLowPriority?: boolean;
    includePrActions?: boolean;
    includeHumanGateActions?: boolean;
    objectiveId?: string;
    reconcile?: boolean;
  } = {},
): ConductorNextActionsResponse {
  const run =
    (input.reconcile ?? true) ? reconcileProjectForRepo(repoRoot, { dryRun: true }) : getOrCreateRunForRepo(repoRoot);
  return computeNextActions(run, { ...input, reconciledPreview: input.reconcile ?? true });
}

export async function dispatchTaskRunForRepo(
  repoRoot: string,
  input: {
    taskId: string;
    workerId?: string;
    leaseSeconds?: number;
    runId?: string;
    backend?: RunAttemptRecord["backend"];
    runtimeMode?: RunRuntimeMode;
    allowFollowUpTasks?: boolean;
    dispatcher?: ConductorBackendDispatcher;
    resolvePackage?: (specifier: string) => string | null;
  },
): Promise<{
  run: RunAttemptRecord;
  taskContract: TaskContractInput;
  dispatch: { backendRunId: string | null; diagnostic: string | null } | null;
}> {
  const backend = input.backend ?? "native";
  if (backend !== "pi-subagents") {
    const started = startTaskRunForRepo(repoRoot, input);
    recordExternalOperationEvent(repoRoot, {
      status: "succeeded",
      resourceRefs: { taskId: input.taskId, workerId: started.run.workerId, runId: started.run.runId },
      payload: { operation: "dispatch_task_run", backend, dispatchBackendRunId: null, diagnostic: null },
    });
    return { ...started, dispatch: null };
  }
  const adapter = getConductorBackendAdapter("pi-subagents", {
    dispatcher: input.dispatcher,
    resolvePackage: input.resolvePackage,
  });
  const preflight = adapter.preflight();
  if (!preflight.available) {
    startTaskRunForRepo(repoRoot, {
      ...input,
      inspectBackends: () => ({ native: inspectConductorBackends().native, piSubagents: preflight }),
    });
  }
  const started = startTaskRunForRepo(repoRoot, { ...input, backend: "native" });
  let result: { ok: boolean; diagnostic: string | null; backendRunId?: string | null };
  try {
    result = await adapter.dispatch({
      cwd: resolve(repoRoot),
      taskContract: started.taskContract,
      run: started.run,
    });
  } catch (error) {
    const diagnostic = errorMessage(error);
    recordTaskCompletionForRepo(repoRoot, {
      runId: started.run.runId,
      taskId: input.taskId,
      status: "failed",
      completionSummary: diagnostic,
    });
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { taskId: input.taskId, workerId: started.run.workerId, runId: started.run.runId },
      payload: {
        operation: "dispatch_task_run",
        backend: "pi-subagents",
        diagnostic,
        errorMessage: diagnostic,
      },
    });
    throw error;
  }
  if (!result.ok) {
    recordTaskCompletionForRepo(repoRoot, {
      runId: started.run.runId,
      taskId: input.taskId,
      status: "failed",
      completionSummary: result.diagnostic ?? "pi-subagents dispatch failed",
    });
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { taskId: input.taskId, workerId: started.run.workerId, runId: started.run.runId },
      payload: {
        operation: "dispatch_task_run",
        backend: "pi-subagents",
        diagnostic: result.diagnostic ?? "pi-subagents dispatch failed",
        errorMessage: result.diagnostic ?? "pi-subagents dispatch failed",
      },
    });
    throw new Error(`pi-subagents dispatch failed: ${result.diagnostic ?? "unknown error"}`);
  }
  const updatedRun = mutateRepoRunSync(repoRoot, (run) =>
    appendExternalOperationEvent(
      {
        ...run,
        runs: run.runs.map((entry) =>
          entry.runId === started.run.runId
            ? { ...entry, backend: "pi-subagents", backendRunId: result.backendRunId ?? null }
            : entry,
        ),
      },
      {
        status: "succeeded",
        resourceRefs: { taskId: input.taskId, workerId: started.run.workerId, runId: started.run.runId },
        payload: {
          operation: "dispatch_task_run",
          backend: "pi-subagents",
          dispatchBackendRunId: result.backendRunId ?? null,
          diagnostic: result.diagnostic,
        },
      },
    ),
  );
  return {
    run: updatedRun.runs.find((entry) => entry.runId === started.run.runId) ?? started.run,
    taskContract: started.taskContract,
    dispatch: { backendRunId: result.backendRunId ?? null, diagnostic: result.diagnostic },
  };
}

export async function delegateTaskForRepo(
  repoRoot: string,
  input: {
    title: string;
    prompt: string;
    workerName: string;
    startRun?: boolean;
    leaseSeconds?: number;
    runtimeMode?: RunRuntimeMode;
  },
): Promise<{
  worker: WorkerRecord;
  task: TaskRecord;
  run: RunAttemptRecord | null;
  taskContract: TaskContractInput | null;
}> {
  const initialRun = getOrCreateRunForRepo(repoRoot);
  const worker =
    initialRun.workers.find((entry) => entry.name === input.workerName) ??
    (await createWorkerForRepo(repoRoot, input.workerName));
  const task = createTaskForRepo(repoRoot, { title: input.title, prompt: input.prompt });
  const assigned = assignTaskForRepo(repoRoot, task.taskId, worker.workerId);

  if (!input.startRun) {
    return { worker, task: assigned, run: null, taskContract: null };
  }

  const started = startTaskRunForRepo(repoRoot, {
    taskId: assigned.taskId,
    workerId: worker.workerId,
    leaseSeconds: input.leaseSeconds,
    runtimeMode: input.runtimeMode,
  });
  const current = getOrCreateRunForRepo(repoRoot);
  return {
    worker,
    task: current.tasks.find((entry) => entry.taskId === assigned.taskId) ?? assigned,
    run: started.run,
    taskContract: started.taskContract,
  };
}

export function cancelTaskRunForRepo(repoRoot: string, input: { runId: string; reason: string }): RunRecord {
  const project = cancelTaskRunStateForRepo(repoRoot, input);
  const run = project.runs.find((entry) => entry.runId === input.runId);
  if (run?.status === "aborted") {
    abortLiveWorkForFilter({ runIds: new Set([input.runId]) });
  }
  return project;
}

export function cancelActiveWorkForRepo(
  repoRoot: string,
  input: {
    reason?: string;
    taskIds?: string[];
    workerIds?: string[];
  } = {},
): { canceledRuns: string[]; canceledTasks: string[]; project: RunRecord } {
  const reason = input.reason?.trim() || "Canceled active conductor work";
  let project = getOrCreateRunForRepo(repoRoot);
  const taskIds = new Set(input.taskIds ?? []);
  const workerIds = new Set(input.workerIds ?? []);
  const activeRuns = project.runs.filter(
    (run) =>
      isActiveRunAttempt(run) &&
      (taskIds.size === 0 || taskIds.has(run.taskId)) &&
      (workerIds.size === 0 || workerIds.has(run.workerId)),
  );
  const canceledRuns: string[] = [];
  const canceledTasks = new Set<string>();
  const liveTaskIds =
    taskIds.size > 0 ? taskIds : activeRuns.length > 0 ? new Set(activeRuns.map((run) => run.taskId)) : undefined;
  const liveWorkerIds =
    workerIds.size > 0 ? workerIds : activeRuns.length > 0 ? new Set(activeRuns.map((run) => run.workerId)) : undefined;
  abortLiveWorkForFilter({
    taskIds: liveTaskIds,
    workerIds: liveWorkerIds,
  });

  for (const run of activeRuns) {
    project = cancelTaskRunForRepo(repoRoot, { runId: run.runId, reason });
    canceledRuns.push(run.runId);
    canceledTasks.add(run.taskId);
  }

  const pending = cancelPendingWorkForRepo(repoRoot, { reason, taskIds, workerIds });
  project = pending.project;
  for (const taskId of pending.canceledTasks) canceledTasks.add(taskId);

  return { canceledRuns, canceledTasks: [...canceledTasks], project };
}

export async function runParallelWorkForRepo(
  repoRoot: string,
  input: {
    tasks: ParallelWorkItemInput[];
    workerPrefix?: string;
    runtimeMode?: RunRuntimeMode;
  },
  signal?: AbortSignal,
  runner: ParallelWorkRunner = runTaskForRepo,
): Promise<{
  workers: WorkerRecord[];
  tasks: TaskRecord[];
  results: Array<{
    taskId: string;
    status: "fulfilled" | "rejected";
    result: WorkerRunResult | null;
    error: string | null;
  }>;
  canceledRuns: string[];
  canceledTasks: string[];
}> {
  if (input.tasks.length === 0) {
    throw new Error("At least one parallel work item is required");
  }
  const workerPrefix = input.workerPrefix?.trim() || "parallel-worker";
  const items = input.tasks.map((item, index) => {
    const title = item.title.trim();
    const prompt = item.prompt.trim();
    if (!title || !prompt) {
      throw new Error(`Parallel work item ${index + 1} requires title and prompt`);
    }
    return {
      title,
      prompt,
      workerName: item.workerName?.trim() || `${workerPrefix}-${index + 1}`,
    };
  });
  const workerNames = new Set<string>();
  for (const item of items) {
    if (workerNames.has(item.workerName)) {
      throw new Error(`Duplicate parallel worker name '${item.workerName}'`);
    }
    workerNames.add(item.workerName);
  }
  const workers: WorkerRecord[] = [];
  const tasks: TaskRecord[] = [];

  for (const item of items) {
    const current = getOrCreateRunForRepo(repoRoot);
    const existingWorker = current.workers.find((entry) => entry.name === item.workerName);
    if (existingWorker) {
      if (
        existingWorker.lifecycle !== "idle" ||
        existingWorker.recoverable ||
        !existingWorker.worktreePath ||
        !existingWorker.sessionFile
      ) {
        throw new Error(`Parallel worker '${item.workerName}' is not idle and ready for dispatch`);
      }
    }
    const worker = existingWorker ?? (await createWorkerForRepo(repoRoot, item.workerName));
    const task = createTaskForRepo(repoRoot, { title: item.title, prompt: item.prompt });
    const assigned = assignTaskForRepo(repoRoot, task.taskId, worker.workerId);
    workers.push(worker);
    tasks.push(assigned);
  }

  const cancelReason = "Parent conductor parallel work was interrupted";
  const cancelOwnedWork = () =>
    cancelActiveWorkForRepo(repoRoot, {
      reason: cancelReason,
      taskIds: tasks.map((task) => task.taskId),
      workerIds: workers.map((worker) => worker.workerId),
    });

  let canceledRuns: string[] = [];
  let canceledTasks: string[] = [];
  const collectOwnedCanceledWork = () => {
    const project = getOrCreateRunForRepo(repoRoot);
    const taskIds = new Set(tasks.map((task) => task.taskId));
    const workerIds = new Set(workers.map((worker) => worker.workerId));
    canceledRuns = [
      ...new Set([
        ...canceledRuns,
        ...project.runs
          .filter((run) => taskIds.has(run.taskId) && workerIds.has(run.workerId) && run.status === "aborted")
          .map((run) => run.runId),
      ]),
    ];
    canceledTasks = [
      ...new Set([
        ...canceledTasks,
        ...project.tasks
          .filter((task) => taskIds.has(task.taskId) && task.state === "canceled")
          .map((task) => task.taskId),
      ]),
    ];
  };
  const onAbort = () => {
    const canceled = cancelOwnedWork();
    canceledRuns = [...new Set([...canceledRuns, ...canceled.canceledRuns])];
    canceledTasks = [...new Set([...canceledTasks, ...canceled.canceledTasks])];
  };
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) onAbort();

  const liveControllers = tasks.map((task, index) => {
    const linked = createLinkedAbortController(signal);
    const unregister = registerLiveWorkAbortHandle({
      taskId: task.taskId,
      workerId: workers[index]?.workerId,
      controller: linked.controller,
    });
    return {
      signal: linked.signal,
      dispose: () => {
        unregister();
        linked.dispose();
      },
    };
  });

  try {
    if (signal?.aborted) {
      return { workers, tasks, results: [], canceledRuns, canceledTasks };
    }
    const settled = await Promise.allSettled(
      tasks.map((task, index) =>
        runner(repoRoot, task.taskId, liveControllers[index]?.signal ?? signal, { runtimeMode: input.runtimeMode }),
      ),
    );
    if (signal?.aborted) onAbort();
    collectOwnedCanceledWork();
    const results = settled.map((entry, index) =>
      entry.status === "fulfilled"
        ? { taskId: tasks[index]?.taskId ?? "", status: "fulfilled" as const, result: entry.value, error: null }
        : {
            taskId: tasks[index]?.taskId ?? "",
            status: "rejected" as const,
            result: null,
            error: errorMessage(entry.reason),
          },
    );
    return { workers, tasks, results, canceledRuns, canceledTasks };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    for (const controller of liveControllers) {
      controller.dispose();
    }
  }
}

function hasParallelIntent(request: string): boolean {
  return /\b(parallel|split|many|multiple|workers|fan[- ]?out|deep[- ]?dive|all)\b/i.test(request);
}

function hasSingleIntent(request: string): boolean {
  return /\b(single|one worker|do not split|don't split|dont split|same worker|small|typo)\b/i.test(request);
}

function deriveWorkTitle(request: string): string {
  const trimmed = request.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "Conductor work";
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function normalizeRunWorkItems(input: { request: string; tasks?: RunWorkItemInput[] }): RunWorkItemInput[] {
  const candidates = input.tasks?.length
    ? input.tasks
    : [{ title: deriveWorkTitle(input.request), prompt: input.request }];
  return candidates.map((task, index) => ({
    ...task,
    title: task.title.trim() || `Work item ${index + 1}`,
    prompt: task.prompt.trim() || input.request.trim(),
    workerName: task.workerName?.trim() || undefined,
    writeScope: task.writeScope?.map((scope) => scope.trim()).filter(Boolean),
    dependsOn: task.dependsOn?.map((dependency) => dependency.trim()).filter(Boolean),
  }));
}

function normalizeWriteScope(scope: string): string {
  return scope.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function writeScopesOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeWriteScope(left);
  const normalizedRight = normalizeWriteScope(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function findOverlappingWriteScopes(tasks: RunWorkItemInput[]): boolean {
  const seen: string[] = [];
  for (const task of tasks) {
    for (const scope of task.writeScope ?? []) {
      if (seen.some((knownScope) => writeScopesOverlap(knownScope, scope))) {
        return true;
      }
      seen.push(scope);
    }
  }
  return false;
}

function combineWorkItems(tasks: RunWorkItemInput[], request: string): RunWorkItemInput {
  if (tasks.length === 1 && tasks[0]) {
    return tasks[0];
  }
  return {
    title: deriveWorkTitle(request),
    prompt: [
      request.trim(),
      "",
      "Run these work items coherently in one conductor worker because splitting is unsafe:",
      ...tasks.map((task, index) => `${index + 1}. ${task.title}\n${task.prompt}`),
    ].join("\n"),
    writeScope: [...new Set(tasks.flatMap((task) => task.writeScope ?? []))],
    dependsOn: [...new Set(tasks.flatMap((task) => task.dependsOn ?? []))],
  };
}

function capParallelWorkItems(tasks: RunWorkItemInput[], maxWorkers: number): RunWorkItemInput[] {
  if (tasks.length <= maxWorkers) {
    return tasks;
  }
  const buckets = Array.from({ length: maxWorkers }, () => [] as RunWorkItemInput[]);
  for (const [index, task] of tasks.entries()) {
    buckets[index % maxWorkers]?.push(task);
  }
  return buckets.map((bucket, index) => ({
    title: bucket.length === 1 ? (bucket[0]?.title ?? `Work shard ${index + 1}`) : `Work shard ${index + 1}`,
    prompt:
      bucket.length === 1
        ? (bucket[0]?.prompt ?? "")
        : bucket.map((task, taskIndex) => `${taskIndex + 1}. ${task.title}\n${task.prompt}`).join("\n\n"),
    workerName: bucket.length === 1 ? bucket[0]?.workerName : undefined,
    writeScope: [...new Set(bucket.flatMap((task) => task.writeScope ?? []))],
  }));
}

export function planWorkRouting(input: {
  request: string;
  mode?: WorkRoutingMode;
  tasks?: RunWorkItemInput[];
  maxWorkers?: number;
}): WorkRoutingDecision {
  const request = input.request.trim();
  if (!request) {
    throw new Error("conductor_run_work requires a natural-language request");
  }
  const maxWorkers = Math.max(1, Math.floor(input.maxWorkers ?? 4));
  const tasks = normalizeRunWorkItems({ request, tasks: input.tasks });
  const riskFlags: string[] = [];
  const hasDependencies = tasks.some((task) => (task.dependsOn?.length ?? 0) > 0);
  const hasScopeOverlap = findOverlappingWriteScopes(tasks);
  if (hasScopeOverlap) {
    riskFlags.push("overlapping_write_scope");
  }
  if (tasks.length > maxWorkers) {
    riskFlags.push("worker_cap_applied");
  }

  const requestedMode = input.mode ?? "auto";
  if (requestedMode === "single") {
    return {
      mode: "single",
      confidence: 1,
      reason: "Single-worker mode was requested explicitly.",
      tasks: [combineWorkItems(tasks, request)],
      riskFlags,
    };
  }
  if (requestedMode === "objective" || hasDependencies) {
    return {
      mode: "objective",
      confidence: requestedMode === "objective" ? 1 : 0.9,
      reason:
        requestedMode === "objective"
          ? "Objective mode was requested explicitly."
          : "Dependent work requires objective scheduling instead of parallel fan-out.",
      tasks,
      riskFlags,
    };
  }

  if (tasks.length <= 1 || hasSingleIntent(request) || hasScopeOverlap || maxWorkers === 1) {
    return {
      mode: "single",
      confidence: tasks.length <= 1 ? 0.95 : 0.8,
      reason:
        tasks.length <= 1
          ? "Single coherent work item; splitting would add coordination overhead."
          : "Work should stay in one worker because parallel splitting is unsafe or was discouraged.",
      tasks: [combineWorkItems(tasks, request)],
      riskFlags,
    };
  }

  if (requestedMode === "parallel" || hasParallelIntent(request)) {
    return {
      mode: "parallel",
      confidence: requestedMode === "parallel" ? 1 : 0.85,
      reason: "Independent work items can run in parallel under one foreground cancellation boundary.",
      tasks: capParallelWorkItems(tasks, maxWorkers),
      riskFlags,
    };
  }

  return {
    mode: "single",
    confidence: 0.65,
    reason: "No explicit parallel intent; defaulting to one coherent worker.",
    tasks: [combineWorkItems(tasks, request)],
    riskFlags,
  };
}

export async function runWorkForRepo(
  repoRoot: string,
  input: {
    request: string;
    mode?: WorkRoutingMode;
    tasks?: RunWorkItemInput[];
    workerPrefix?: string;
    maxWorkers?: number;
    execute?: boolean;
    runtimeMode?: RunRuntimeMode;
  },
  signal?: AbortSignal,
  runner: ParallelWorkRunner = runTaskForRepo,
): Promise<{
  decision: WorkRoutingDecision;
  workers: WorkerRecord[];
  tasks: TaskRecord[];
  single: { worker: WorkerRecord; task: TaskRecord; result: WorkerRunResult | null } | null;
  parallel: Awaited<ReturnType<typeof runParallelWorkForRepo>> | null;
  objective: {
    objective: ReturnType<typeof createObjectiveForRepo>;
    tasks: TaskRecord[];
    schedule: Awaited<ReturnType<typeof scheduleObjectiveForRepo>> | null;
  } | null;
}> {
  const decision = planWorkRouting(input);
  const workerPrefix = input.workerPrefix?.trim() || "run-work";
  const execute = input.execute ?? true;

  if (decision.mode === "parallel") {
    const parallel = await runParallelWorkForRepo(
      repoRoot,
      {
        workerPrefix,
        runtimeMode: input.runtimeMode,
        tasks: decision.tasks.map((task) => ({
          title: task.title,
          prompt: task.prompt,
          workerName: task.workerName,
        })),
      },
      signal,
      runner,
    );
    return { decision, workers: parallel.workers, tasks: parallel.tasks, single: null, parallel, objective: null };
  }

  if (decision.mode === "objective") {
    const objective = createObjectiveForRepo(repoRoot, {
      title: deriveWorkTitle(input.request),
      prompt: input.request,
    });
    const planned = planObjectiveForRepo(repoRoot, {
      objectiveId: objective.objectiveId,
      tasks: decision.tasks.map((task) => ({ title: task.title, prompt: task.prompt, dependsOn: task.dependsOn })),
      rationale: decision.reason,
    });
    let workers: WorkerRecord[] = [];
    if (execute) {
      const current = getOrCreateRunForRepo(repoRoot);
      workers = current.workers.filter(
        (worker) => worker.lifecycle === "idle" && !worker.recoverable && worker.worktreePath && worker.sessionFile,
      );
      if (workers.length === 0) {
        workers = [await createWorkerForRepo(repoRoot, `${workerPrefix}-objective-1`)];
      }
    }
    const schedule = execute
      ? await scheduleObjectiveForRepo(
          repoRoot,
          {
            objectiveId: objective.objectiveId,
            policy: "execute",
            maxConcurrency: input.maxWorkers,
            runtimeMode: input.runtimeMode,
          },
          signal,
        )
      : null;
    const scheduledWorkerIds = new Set(schedule?.assigned.map((task) => task.assignedWorkerId).filter(Boolean));
    return {
      decision,
      workers:
        schedule && scheduledWorkerIds.size > 0
          ? getOrCreateRunForRepo(repoRoot).workers.filter((worker) => scheduledWorkerIds.has(worker.workerId))
          : workers,
      tasks: planned.tasks,
      single: null,
      parallel: null,
      objective: { ...planned, schedule },
    };
  }

  const taskInput = decision.tasks[0];
  if (!taskInput) {
    throw new Error("conductor_run_work could not derive a work item");
  }
  const delegated = await delegateTaskForRepo(repoRoot, {
    title: taskInput.title,
    prompt: taskInput.prompt,
    workerName: taskInput.workerName ?? `${workerPrefix}-1`,
    startRun: false,
  });
  if (signal?.aborted) {
    cancelActiveWorkForRepo(repoRoot, {
      reason: "Parent conductor work was interrupted",
      taskIds: [delegated.task.taskId],
      workerIds: [delegated.worker.workerId],
    });
    return {
      decision,
      workers: [delegated.worker],
      tasks: [delegated.task],
      single: { worker: delegated.worker, task: delegated.task, result: null },
      parallel: null,
      objective: null,
    };
  }
  const result = execute
    ? await runner(repoRoot, delegated.task.taskId, signal, { runtimeMode: input.runtimeMode })
    : null;
  return {
    decision,
    workers: [delegated.worker],
    tasks: [delegated.task],
    single: { worker: delegated.worker, task: delegated.task, result },
    parallel: null,
    objective: null,
  };
}

function cancelPendingWorkForRepo(
  repoRoot: string,
  input: {
    reason: string;
    taskIds: Set<string>;
    workerIds: Set<string>;
  },
): { canceledTasks: string[]; project: RunRecord } {
  const cancelableStates = new Set<TaskRecord["state"]>(["draft", "ready", "assigned"]);
  const canceledTasks: string[] = [];
  const affectedObjectiveIds = new Set<string>();
  let project = mutateRepoRunSync(repoRoot, (run) => {
    const now = new Date().toISOString();
    let updated = run;
    const tasks = run.tasks.map((task) => {
      const matchesTask = input.taskIds.size === 0 || input.taskIds.has(task.taskId);
      const matchesWorker =
        input.workerIds.size === 0 || (task.assignedWorkerId !== null && input.workerIds.has(task.assignedWorkerId));
      if (!matchesTask || !matchesWorker || task.activeRunId || !cancelableStates.has(task.state)) {
        return task;
      }
      canceledTasks.push(task.taskId);
      if (task.objectiveId) affectedObjectiveIds.add(task.objectiveId);
      return { ...task, state: "canceled" as const, activeRunId: null, updatedAt: now };
    });
    if (canceledTasks.length === 0) {
      return run;
    }
    updated = { ...run, tasks, updatedAt: now };
    for (const taskId of canceledTasks) {
      const task = tasks.find((entry) => entry.taskId === taskId);
      updated = appendConductorEvent(updated, {
        actor: { type: "parent_agent", id: "conductor" },
        type: "task.canceled",
        resourceRefs: {
          projectKey: run.projectKey,
          taskId,
          workerId: task?.assignedWorkerId ?? undefined,
        },
        payload: { reason: input.reason },
      });
    }
    return updated;
  });

  for (const objectiveId of affectedObjectiveIds) {
    refreshObjectiveStatusForRepo(repoRoot, objectiveId);
    project = getOrCreateRunForRepo(repoRoot);
  }

  return { canceledTasks, project };
}

export async function createWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const workerId = createWorkerId();
  const worktree = createManagedWorktree(run.repoRoot, {
    workerId,
    workerName,
  });
  const runtime = await createWorkerSessionRuntime(worktree.worktreePath);
  const worker = createWorkerRecord({
    workerId,
    name: workerName,
    branch: worktree.branch,
    worktreePath: worktree.worktreePath,
    sessionFile: runtime.sessionFile,
    sessionId: runtime.sessionId,
  });
  try {
    mutateRepoRunSync(repoRoot, (latest) => addWorker(latest, worker));
  } catch (error) {
    if (worker.worktreePath && existsSync(worker.worktreePath)) {
      removeManagedWorktree(run.repoRoot, worker.worktreePath);
    }
    if (worker.sessionFile && existsSync(worker.sessionFile)) {
      rmSync(worker.sessionFile, { force: true });
    }
    if (worker.branch) {
      removeManagedBranch(run.repoRoot, worker.branch);
    }
    throw error;
  }
  return worker;
}

export function reconcileProjectForRepo(repoRoot: string, input: { now?: string; dryRun?: boolean } = {}): RunRecord {
  const healthReconciled = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const leaseReconciled = reconcileRunLeases(healthReconciled, input);
  if (!input.dryRun) {
    return mutateRepoRunSync(repoRoot, (latest) => reconcileRunLeases(reconcileWorkerHealth(latest), input));
  }
  return leaseReconciled;
}

export function reconcileWorkerHealth(run: RunRecord): RunRecord {
  const workers = run.workers.map((worker) => {
    const worktreeMissing = !worker.worktreePath || !existsSync(worker.worktreePath);
    const sessionMissing = !worker.sessionFile || !existsSync(worker.sessionFile);
    if (!worktreeMissing && !sessionMissing) {
      return worker;
    }
    return {
      ...worker,
      lifecycle: "broken" as const,
      recoverable: true,
      updatedAt: new Date().toISOString(),
    };
  });
  return {
    ...run,
    workers,
    updatedAt: new Date().toISOString(),
  };
}

export function removeWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const cleanupGate = run.gates.find(
    (gate) =>
      gate.type === "destructive_cleanup" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.operation === "destructive_cleanup" &&
      gate.status !== "canceled" &&
      gate.usedAt === null,
  );
  const wrongOperationGate = run.gates.find(
    (gate) =>
      gate.type === "destructive_cleanup" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.status === "approved" &&
      gate.operation !== "destructive_cleanup" &&
      gate.usedAt === null,
  );
  if (wrongOperationGate) {
    throw new Error(`Worker ${worker.name} requires a destructive_cleanup gate scoped to destructive_cleanup`);
  }
  if (cleanupGate?.status !== "approved") {
    if (!cleanupGate) {
      createGateForRepo(repoRoot, {
        type: "destructive_cleanup",
        resourceRefs: { workerId: worker.workerId },
        requestedDecision: `Approve deleting worker ${worker.name}, its worktree, session link, and managed branch`,
      });
    }
    throw new Error(`Worker ${worker.name} requires an approved destructive_cleanup gate before cleanup`);
  }
  if (worker.worktreePath && existsSync(worker.worktreePath)) {
    removeManagedWorktree(run.repoRoot, worker.worktreePath);
  }
  if (worker.sessionFile && existsSync(worker.sessionFile)) {
    rmSync(worker.sessionFile, { force: true });
  }
  if (worker.branch) {
    removeManagedBranch(run.repoRoot, worker.branch);
  }
  const updatedRun = mutateRepoRunSync(repoRoot, (latest) => {
    const latestGate = latest.gates.find((gate) => gate.gateId === cleanupGate.gateId);
    if (!latestGate || latestGate.status !== "approved" || latestGate.usedAt !== null) {
      throw new Error(`Worker ${worker.name} requires a fresh destructive_cleanup gate before cleanup finalization`);
    }
    return appendExternalOperationEvent(
      removeWorker(markConductorGateUsed(latest, cleanupGate.gateId), worker.workerId),
      {
        status: "succeeded",
        resourceRefs: { workerId: worker.workerId, gateId: cleanupGate.gateId },
        payload: {
          operation: "cleanup_worker",
          name: worker.name,
          worktreePath: worker.worktreePath,
          branch: worker.branch,
        },
      },
    );
  });
  return updatedRun.archivedWorkers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function commitWorkerForRepo(repoRoot: string, workerName: string, message: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree`);
  }
  try {
    commitAllChanges(worker.worktreePath, message);
  } catch (error) {
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { workerId: worker.workerId },
      payload: {
        operation: "commit_worker",
        name: worker.name,
        worktreePath: worker.worktreePath,
        branch: worker.branch,
        message,
        errorMessage: errorMessage(error),
      },
    });
    throw error;
  }
  const updatedRun = mutateRepoRunSync(repoRoot, (latest) =>
    appendExternalOperationEvent(
      setWorkerPrState(latest, worker.workerId, {
        commitSucceeded: true,
        pushSucceeded: false,
        prCreationAttempted: false,
        url: null,
        number: null,
      }),
      {
        status: "succeeded",
        resourceRefs: { workerId: worker.workerId },
        payload: {
          operation: "commit_worker",
          name: worker.name,
          worktreePath: worker.worktreePath,
          branch: worker.branch,
          message,
        },
      },
    ),
  );
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function pushWorkerForRepo(repoRoot: string, workerName: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath) || !worker.branch) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree or branch`);
  }
  try {
    validatePushPreconditions(run.repoRoot);
    pushBranchToOrigin(worker.worktreePath, worker.branch);
  } catch (error) {
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { workerId: worker.workerId },
      payload: {
        operation: "push_worker",
        name: worker.name,
        worktreePath: worker.worktreePath,
        branch: worker.branch,
        remote: "origin",
        errorMessage: errorMessage(error),
      },
    });
    throw error;
  }
  const updatedRun = mutateRepoRunSync(repoRoot, (latest) =>
    appendExternalOperationEvent(
      setWorkerPrState(latest, worker.workerId, {
        pushSucceeded: true,
      }),
      {
        status: "succeeded",
        resourceRefs: { workerId: worker.workerId },
        payload: {
          operation: "push_worker",
          name: worker.name,
          worktreePath: worker.worktreePath,
          branch: worker.branch,
          remote: "origin",
        },
      },
    ),
  );
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function createWorkerPrForRepo(
  repoRoot: string,
  workerName: string,
  title: string,
  body?: string,
): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath) || !worker.branch) {
    throw new Error(`Worker named ${workerName} does not have a valid worktree or branch`);
  }
  const readyGate = run.gates.find(
    (gate) =>
      gate.type === "ready_for_pr" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.operation === "create_worker_pr" &&
      gate.status !== "canceled" &&
      gate.usedAt === null,
  );
  const wrongOperationGate = run.gates.find(
    (gate) =>
      gate.type === "ready_for_pr" &&
      gate.resourceRefs.workerId === worker.workerId &&
      gate.status === "approved" &&
      gate.operation !== "create_worker_pr" &&
      gate.usedAt === null,
  );
  if (wrongOperationGate) {
    throw new Error(`Worker ${worker.name} requires a ready_for_pr gate scoped to create_worker_pr`);
  }
  if (readyGate?.status !== "approved") {
    if (!readyGate) {
      createGateForRepo(repoRoot, {
        type: "ready_for_pr",
        resourceRefs: { workerId: worker.workerId },
        requestedDecision: `Approve creating a pull request for worker ${worker.name}`,
      });
    }
    const consumedGate = run.gates.find(
      (gate) => gate.type === "ready_for_pr" && gate.resourceRefs.workerId === worker.workerId && gate.usedAt !== null,
    );
    if (consumedGate) {
      throw new Error(`Worker ${worker.name} requires a fresh ready_for_pr gate before PR creation`);
    }
    throw new Error(`Worker ${worker.name} requires an approved ready_for_pr gate before PR creation`);
  }
  const prBody = body?.trim() || `PR for ${worker.name}`;
  try {
    validatePrPreconditions(run.repoRoot);
  } catch (error) {
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { workerId: worker.workerId, gateId: readyGate.gateId },
      payload: {
        operation: "create_worker_pr",
        phase: "preflight",
        name: worker.name,
        branch: worker.branch,
        title,
        errorMessage: errorMessage(error),
      },
    });
    throw error;
  }
  try {
    const pr = createPullRequest({
      repoRoot: run.repoRoot,
      worktreePath: worker.worktreePath,
      branch: worker.branch,
      title,
      body: prBody,
    });
    const withEvent = mutateRepoRunSync(repoRoot, (latest) => {
      const latestGate = latest.gates.find((gate) => gate.gateId === readyGate.gateId);
      if (!latestGate || latestGate.status !== "approved" || latestGate.usedAt !== null) {
        throw new Error(`Worker ${worker.name} requires a fresh ready_for_pr gate before PR finalization`);
      }
      const updatedRun = markConductorGateUsed(
        setWorkerPrState(latest, worker.workerId, {
          prCreationAttempted: true,
          url: pr.url,
          number: pr.number,
        }),
        readyGate.gateId,
      );
      const completedTasks = updatedRun.tasks.filter(
        (task) => task.assignedWorkerId === worker.workerId && ["completed", "needs_review"].includes(task.state),
      );
      const taskIds = completedTasks.map((task) => task.taskId);
      const runIds = completedTasks.flatMap((task) => task.runIds);
      const withEvidence = pr.url
        ? addConductorArtifact(updatedRun, {
            type: "pr_evidence",
            ref: pr.url,
            resourceRefs: { workerId: worker.workerId, taskId: taskIds[0], runId: runIds[0] },
            producer: { type: "system", id: "github-cli" },
            metadata: { number: pr.number, branch: worker.branch ?? null, title, taskIds, runIds },
          })
        : updatedRun;
      return appendExternalOperationEvent(withEvidence, {
        status: "succeeded",
        resourceRefs: { workerId: worker.workerId, gateId: readyGate.gateId, taskId: taskIds[0], runId: runIds[0] },
        payload: {
          operation: "create_worker_pr",
          name: worker.name,
          branch: worker.branch,
          title,
          url: pr.url,
          number: pr.number,
          taskIds,
          runIds,
        },
      });
    });
    return withEvent.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
  } catch (error) {
    mutateRepoRunSync(repoRoot, (latest) =>
      appendExternalOperationEvent(
        setWorkerPrState(latest, worker.workerId, {
          prCreationAttempted: true,
          url: null,
          number: null,
        }),
        {
          status: "failed",
          resourceRefs: { workerId: worker.workerId, gateId: readyGate.gateId },
          payload: {
            operation: "create_worker_pr",
            name: worker.name,
            branch: worker.branch,
            title,
            errorMessage: errorMessage(error),
          },
        },
      ),
    );
    throw error;
  }
}

function isTerminalRunAttemptStatus(status: RunAttemptRecord["status"]): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
}

function isActiveRunAttempt(attempt: RunAttemptRecord): boolean {
  return !attempt.finishedAt && !isTerminalRunAttemptStatus(attempt.status);
}

function mapWorkerRunStatusToRunStatus(status: WorkerRunResult["status"]): "succeeded" | "failed" | "aborted" {
  switch (status) {
    case "success":
      return "succeeded";
    case "aborted":
      return "aborted";
    default:
      return "failed";
  }
}

export async function runTaskForRepo(
  repoRoot: string,
  taskId: string,
  signal?: AbortSignal,
  input: { runtimeMode?: RunRuntimeMode } = {},
): Promise<WorkerRunResult> {
  const runtimeMode = input.runtimeMode ?? "headless";
  const runtimeStatus = getConductorRuntimeModeStatus(runtimeMode);
  if (!runtimeStatus.available) {
    throw new Error(
      `Runtime mode ${runtimeMode} unavailable: ${runtimeStatus.diagnostic ?? "not available"}. Use conductor_backend_status to inspect available runtime modes; headless is available.`,
    );
  }
  const runtimeBackend = getWorkerRunRuntimeBackend(runtimeMode);
  const currentRun = getOrCreateRunForRepo(repoRoot);
  const task = currentRun.tasks.find((entry) => entry.taskId === taskId);
  const workerId = task?.assignedWorkerId;
  const worker = workerId ? currentRun.workers.find((entry) => entry.workerId === workerId) : null;
  if (!worker || !task) {
    throw new Error(`Task ${taskId} has invalid worker/run references`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker ${worker.name} is missing its session file; recover the worker first`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker ${worker.name} is missing its worktree; recover the worker first`);
  }
  await runtimeBackend.preflight({ worktreePath: worker.worktreePath, sessionFile: worker.sessionFile });

  const started = startTaskRunForRepo(repoRoot, { taskId, workerId: worker.workerId, runtimeMode });
  const linkedSignal = createLinkedAbortController(signal);
  const unregisterLiveRun = registerLiveWorkAbortHandle({
    runId: started.run.runId,
    taskId,
    workerId: worker.workerId,
    controller: linkedSignal.controller,
  });

  try {
    const runtimeResult = await runtimeBackend.run({
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
      task: task.prompt,
      signal: linkedSignal.signal,
      taskContract: started.taskContract,
      onConductorProgress: async (progress) => {
        recordTaskProgressForRepo(repoRoot, progress);
      },
      onConductorComplete: async (completion) => {
        recordTaskCompletionForRepo(repoRoot, completion);
      },
      onConductorGate: async (gate) => {
        createGateForRepo(repoRoot, {
          type: gate.type,
          resourceRefs: { taskId: gate.taskId, runId: gate.runId, workerId: worker.workerId },
          requestedDecision: gate.requestedDecision,
        });
      },
      onConductorFollowUpTask: async (followUp) => {
        createFollowUpTaskForRepo(repoRoot, followUp);
      },
    });

    let createdFallbackCompletion = false;
    mutateRepoRunSync(repoRoot, (latest) => {
      const runAttempt = latest.runs.find((entry) => entry.runId === started.run.runId);
      if (!runAttempt || runAttempt.finishedAt) {
        return latest;
      }
      const semanticStatus =
        runtimeResult.status === "success" ? "partial" : mapWorkerRunStatusToRunStatus(runtimeResult.status);
      createdFallbackCompletion = true;
      return completeTaskRun(latest, {
        runId: started.run.runId,
        status: semanticStatus,
        completionSummary: runtimeResult.finalText,
        errorMessage: runtimeResult.errorMessage,
      });
    });
    if (createdFallbackCompletion && runtimeResult.status === "success") {
      createGateForRepo(repoRoot, {
        type: "needs_review",
        resourceRefs: { taskId, runId: started.run.runId, workerId: worker.workerId },
        requestedDecision: `Review task ${taskId}: native worker exited without explicit conductor_child_complete`,
      });
    }

    return {
      workerName: worker.name,
      status: runtimeResult.status,
      finalText: runtimeResult.finalText,
      errorMessage: runtimeResult.errorMessage,
      sessionId: runtimeResult.sessionId,
    };
  } finally {
    unregisterLiveRun();
    linkedSignal.dispose();
  }
}

export async function recoverWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }

  let worktreePath = worker.worktreePath;
  let runtime = null;
  try {
    if (!worktreePath || !existsSync(worktreePath)) {
      if (!worker.branch) {
        throw new Error(`Worker named ${workerName} cannot be recovered without a valid branch`);
      }
      worktreePath = recreateManagedWorktree(run.repoRoot, {
        workerName: worker.name,
        branch: worker.branch,
      }).worktreePath;
    }

    if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
      runtime = await recoverWorkerSessionRuntime(worktreePath);
    }
  } catch (error) {
    recordExternalOperationEvent(repoRoot, {
      status: "failed",
      resourceRefs: { workerId: worker.workerId },
      payload: {
        operation: "recover_worker",
        name: worker.name,
        branch: worker.branch,
        worktreePath,
        worktreeMissing: !worker.worktreePath || !existsSync(worker.worktreePath),
        sessionMissing: !worker.sessionFile || !existsSync(worker.sessionFile),
        errorMessage: errorMessage(error),
      },
    });
    throw error;
  }

  const updatedRun = mutateRepoRunSync(repoRoot, (latest) => {
    const workers = latest.workers.map((entry) =>
      entry.workerId === worker.workerId
        ? {
            ...entry,
            worktreePath,
            sessionFile: runtime?.sessionFile ?? entry.sessionFile,
            runtime: {
              ...entry.runtime,
              sessionId: runtime?.sessionId ?? entry.runtime.sessionId,
              lastResumedAt: runtime?.lastResumedAt ?? entry.runtime.lastResumedAt,
            },
            lifecycle: "idle" as const,
            recoverable: false,
            updatedAt: new Date().toISOString(),
          }
        : entry,
    );
    return appendExternalOperationEvent(
      {
        ...latest,
        workers,
        updatedAt: new Date().toISOString(),
      },
      {
        status: "succeeded",
        resourceRefs: { workerId: worker.workerId },
        payload: {
          operation: "recover_worker",
          name: worker.name,
          branch: worker.branch,
          worktreePath,
          worktreeRecreated: worktreePath !== worker.worktreePath,
          sessionRecovered: runtime !== null,
          sessionFile: runtime?.sessionFile ?? worker.sessionFile,
          sessionId: runtime?.sessionId ?? worker.runtime.sessionId,
          lastResumedAt: runtime?.lastResumedAt ?? worker.runtime.lastResumedAt,
          lifecycle: "idle",
          recoverable: false,
        },
      },
    );
  });
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during recovery`);
  }
  return updatedWorker;
}

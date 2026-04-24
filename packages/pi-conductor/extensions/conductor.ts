import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ConductorBackendDispatcher,
  type ConductorBackendsStatus,
  getConductorBackendAdapter,
  inspectConductorBackends,
} from "./backends.js";
import {
  commitAllChanges,
  createPullRequest,
  pushBranchToOrigin,
  validatePrPreconditions,
  validatePushPreconditions,
} from "./git-pr.js";
import { deriveProjectKey } from "./project-key.js";
import {
  createWorkerSessionRuntime,
  preflightWorkerRunRuntime,
  recoverWorkerSessionRuntime,
  resumeWorkerSessionRuntime,
  runWorkerPromptRuntime,
  summarizeWorkerSessionRuntime,
} from "./runtime.js";
import {
  addConductorArtifact,
  addObjective,
  addTask,
  addWorker,
  appendConductorEvent,
  assignTaskToWorker,
  cancelTaskRun,
  completeTaskRun,
  createConductorGate,
  createObjectiveRecord,
  createTaskRecord,
  createWorkerRecord,
  finishWorkerRun,
  linkTaskToObjective,
  markConductorGateUsed,
  mutateRunWithFileLockSync,
  readRun,
  reconcileRunLeases,
  recordTaskCompletion,
  recordTaskProgress,
  removeWorker,
  resolveConductorGate,
  setWorkerLifecycle,
  setWorkerPrState,
  setWorkerRunSessionId,
  setWorkerRuntimeState,
  setWorkerSummary,
  setWorkerTask,
  startTaskRun,
  startWorkerRun,
  updateObjective,
  updateTask,
  writeRun,
} from "./storage.js";
import type {
  ConductorActor,
  ConductorNextAction,
  ConductorNextActionPriority,
  ConductorNextActionsResponse,
  ConductorProjectBrief,
  ConductorResourceRefs,
  ConductorResourceTimeline,
  ConductorTaskBrief,
  EvidenceBundle,
  EvidenceBundlePurpose,
  GateRecord,
  GateStatus,
  ObjectivePlanResult,
  ObjectiveRecord,
  ObjectiveStatus,
  ReadinessCheck,
  ReadinessPurpose,
  RunAttemptRecord,
  RunRecord,
  TaskContractInput,
  TaskRecord,
  WorkerLifecycleState,
  WorkerRecord,
  WorkerRunResult,
} from "./types.js";

export type SchedulerPolicyName = "safe" | "execute";

function resolveSchedulerPolicy(input: { policy?: SchedulerPolicyName; executeRuns?: boolean }): {
  policy: SchedulerPolicyName;
  executeRuns: boolean;
} {
  if (input.policy) {
    return { policy: input.policy, executeRuns: input.policy === "execute" };
  }
  return { policy: input.executeRuns ? "execute" : "safe", executeRuns: input.executeRuns ?? false };
}

function mutateRepoRunSync(repoRoot: string, mutator: (run: RunRecord) => RunRecord): RunRecord {
  const normalizedRoot = resolve(repoRoot);
  return mutateRunWithFileLockSync(deriveProjectKey(normalizedRoot), normalizedRoot, mutator);
}

import { createWorkerId } from "./workers.js";
import {
  createManagedWorktree,
  recreateManagedWorktree,
  removeManagedBranch,
  removeManagedWorktree,
} from "./worktrees.js";

const priorityRank: Record<ConductorNextActionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const terminalRunStatuses = new Set([
  "succeeded",
  "partial",
  "blocked",
  "failed",
  "aborted",
  "stale",
  "interrupted",
  "unknown_dispatch",
]);

function nextAction(input: Omit<ConductorNextAction, "actionId">): ConductorNextAction {
  const refs = input.resourceRefs;
  const actionId = [input.kind, refs.objectiveId, refs.workerId, refs.taskId, refs.runId, refs.gateId, refs.artifactId]
    .filter(Boolean)
    .join(":");
  return { ...input, actionId };
}

function incompleteDependenciesForTask(run: RunRecord, task: TaskRecord): TaskRecord[] {
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
      !terminalRunStatuses.has(attempt.status) &&
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
          toolCall: { name: "conductor_list_events", params: { runId: attempt.runId, limit: 20 } },
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

export async function runNextActionForRepo(
  repoRoot: string,
  input: { objectiveId?: string; executeRuns?: boolean; policy?: SchedulerPolicyName } = {},
): Promise<{ executed: boolean; reason: string | null; action: ConductorNextAction | null; result: unknown }> {
  const schedulerPolicy = resolveSchedulerPolicy(input);
  const recommendation = getNextActionsForRepo(repoRoot, {
    objectiveId: input.objectiveId,
    maxActions: 1,
    reconcile: false,
  });
  const action = recommendation.actions[0] ?? null;
  if (!action) return { executed: false, reason: "no action", action, result: null };
  if (action.requiresHuman) return { executed: false, reason: "action requires human", action, result: null };
  if (action.destructive) return { executed: false, reason: "action is destructive", action, result: null };
  const mediumConfidenceAllowed = new Set(["retry_task", "refresh_objective_status"]);
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
    if (!schedulerPolicy.executeRuns) {
      return { executed: false, reason: "run execution disabled by scheduler policy", action, result: null };
    }
    return {
      executed: true,
      reason: null,
      action,
      result: await runTaskForRepo(repoRoot, action.toolCall.params.taskId),
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

export async function scheduleObjectiveForRepo(
  repoRoot: string,
  input: {
    objectiveId?: string;
    objectiveIds?: string[];
    maxConcurrency?: number;
    executeRuns?: boolean;
    policy?: SchedulerPolicyName;
  },
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
    let currentTask = task;
    if (!currentTask.assignedWorkerId) {
      const worker = idleWorkers.shift();
      if (!worker) {
        skipped.push(task.taskId);
        continue;
      }
      currentTask = assignTaskForRepo(repoRoot, task.taskId, worker.workerId);
      assigned.push(currentTask);
    }
    if (schedulerPolicy.executeRuns) {
      const result = await runTaskForRepo(repoRoot, currentTask.taskId);
      executed.push({ taskId: currentTask.taskId, result });
    }
  }
  return { objectiveId: input.objectiveId ?? null, assigned, executed, skipped };
}

export async function schedulerTickForRepo(
  repoRoot: string,
  input: { objectiveId?: string; maxActions?: number; executeRuns?: boolean; policy?: SchedulerPolicyName } = {},
): Promise<{
  executed: Array<{ action: ConductorNextAction | null; result: unknown }>;
  skipped: Array<{ action: ConductorNextAction | null; reason: string | null }>;
}> {
  const schedulerPolicy = resolveSchedulerPolicy(input);
  const maxActions = Math.max(1, Math.min(input.maxActions ?? 1, 10));
  const executed: Array<{ action: ConductorNextAction | null; result: unknown }> = [];
  const skipped: Array<{ action: ConductorNextAction | null; reason: string | null }> = [];
  for (let index = 0; index < maxActions; index += 1) {
    const result = await runNextActionForRepo(repoRoot, {
      objectiveId: input.objectiveId,
      executeRuns: schedulerPolicy.executeRuns,
    });
    if (!result.executed) {
      skipped.push({ action: result.action, reason: result.reason });
      break;
    }
    executed.push({ action: result.action, result: result.result });
  }
  return { executed, skipped };
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

export function getOrCreateRunForRepo(repoRoot: string): RunRecord {
  const normalizedRoot = resolve(repoRoot);
  const projectKey = deriveProjectKey(normalizedRoot);
  const existing = readRun(projectKey);
  return existing ?? mutateRepoRunSync(normalizedRoot, (run) => run);
}

function createObjectiveId(): string {
  return `objective-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function leaseExpiryFromNow(leaseSeconds: number): string {
  return new Date(Date.now() + leaseSeconds * 1000).toISOString();
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

export function createGateForRepo(
  repoRoot: string,
  input: {
    type: GateRecord["type"];
    resourceRefs: ConductorResourceRefs;
    requestedDecision: string;
    gateId?: string;
    operation?: GateRecord["operation"];
    targetRevision?: number | null;
    expiresAt?: string | null;
  },
): GateRecord {
  const gateId = input.gateId ?? `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => createConductorGate(run, { ...input, gateId }));
  const gate = updatedRun.gates.find((entry) => entry.gateId === gateId);
  if (!gate) {
    throw new Error(`Gate ${gateId} disappeared during creation`);
  }
  return gate;
}

export function resolveGateForRepo(
  repoRoot: string,
  input: { gateId: string; status: Exclude<GateStatus, "open">; actor: ConductorActor; resolutionReason: string },
): GateRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = resolveConductorGate(run, input);
  writeRun(updatedRun);
  const gate = updatedRun.gates.find((entry) => entry.gateId === input.gateId);
  if (!gate) {
    throw new Error(`Gate ${input.gateId} disappeared during resolution`);
  }
  return gate;
}

export function resolveGateFromTrustedHumanForRepo(
  repoRoot: string,
  input: { gateId: string; status: Exclude<GateStatus, "open">; humanId: string; resolutionReason: string },
): GateRecord {
  if (!input.humanId.trim()) {
    throw new Error("Trusted human resolver requires a non-empty humanId");
  }
  return resolveGateForRepo(repoRoot, {
    gateId: input.gateId,
    status: input.status,
    resolutionReason: input.resolutionReason,
    actor: { type: "human", id: input.humanId },
  });
}

export async function dispatchTaskRunForRepo(
  repoRoot: string,
  input: {
    taskId: string;
    workerId?: string;
    leaseSeconds?: number;
    runId?: string;
    backend?: RunAttemptRecord["backend"];
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
  const result = await adapter.dispatch({
    cwd: resolve(repoRoot),
    taskContract: started.taskContract,
    run: started.run,
  });
  if (!result.ok) {
    recordTaskCompletionForRepo(repoRoot, {
      runId: started.run.runId,
      taskId: input.taskId,
      status: "failed",
      completionSummary: result.diagnostic ?? "pi-subagents dispatch failed",
    });
    throw new Error(`pi-subagents dispatch failed: ${result.diagnostic ?? "unknown error"}`);
  }
  const updatedRun = mutateRepoRunSync(repoRoot, (run) => ({
    ...run,
    runs: run.runs.map((entry) =>
      entry.runId === started.run.runId
        ? { ...entry, backend: "pi-subagents", backendRunId: result.backendRunId ?? null }
        : entry,
    ),
  }));
  return {
    run: updatedRun.runs.find((entry) => entry.runId === started.run.runId) ?? started.run,
    taskContract: started.taskContract,
    dispatch: { backendRunId: result.backendRunId ?? null, diagnostic: result.diagnostic },
  };
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
  const run = getOrCreateRunForRepo(repoRoot);
  const updatedRun = cancelTaskRun(run, input);
  writeRun(updatedRun);
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
  const run = getOrCreateRunForRepo(repoRoot);
  const runAttempt = run.runs.find((entry) => entry.runId === input.runId);
  if (!runAttempt || runAttempt.taskId !== input.taskId || runAttempt.finishedAt) {
    throw new Error(`Run ${input.runId} is not an active run for task ${input.taskId}`);
  }
  const task = createTaskRecord({ taskId: createTaskId(), title: input.title, prompt: input.prompt });
  const withTask = addTask(run, task);
  const withEvent = appendConductorEvent(withTask, {
    actor: { type: "child_run", id: input.runId },
    type: "task.followup_created",
    resourceRefs: { projectKey: run.projectKey, taskId: task.taskId, runId: input.runId },
    payload: { parentTaskId: input.taskId, title: input.title },
  });
  writeRun(withEvent);
  const created = withEvent.tasks.find((entry) => entry.taskId === task.taskId);
  if (!created) {
    throw new Error(`Follow-up task ${task.taskId} disappeared during creation`);
  }
  return created;
}

export async function delegateTaskForRepo(
  repoRoot: string,
  input: { title: string; prompt: string; workerName: string; startRun?: boolean; leaseSeconds?: number },
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
  });
  const current = getOrCreateRunForRepo(repoRoot);
  return {
    worker,
    task: current.tasks.find((entry) => entry.taskId === assigned.taskId) ?? assigned,
    run: started.run,
    taskContract: started.taskContract,
  };
}

function isTerminalStatus(status: string): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
}

export function buildEvidenceBundleForRepo(
  repoRoot: string,
  input: {
    workerId?: string;
    workerName?: string;
    objectiveId?: string;
    taskId?: string;
    runId?: string;
    purpose?: EvidenceBundlePurpose;
    includeEvents?: boolean;
    persistArtifact?: boolean;
  },
): EvidenceBundle {
  const run = getOrCreateRunForRepo(repoRoot);
  const selectedRun = input.runId ? run.runs.find((entry) => entry.runId === input.runId) : null;
  const objective = input.objectiveId
    ? (run.objectives.find((entry) => entry.objectiveId === input.objectiveId) ?? null)
    : null;
  const task = input.taskId
    ? run.tasks.find((entry) => entry.taskId === input.taskId)
    : selectedRun
      ? run.tasks.find((entry) => entry.taskId === selectedRun.taskId)
      : null;
  const worker = input.workerId
    ? (run.workers.find((entry) => entry.workerId === input.workerId) ?? null)
    : input.workerName
      ? (run.workers.find((entry) => entry.name === input.workerName) ?? null)
      : selectedRun
        ? (run.workers.find((entry) => entry.workerId === selectedRun.workerId) ?? null)
        : task?.assignedWorkerId
          ? (run.workers.find((entry) => entry.workerId === task.assignedWorkerId) ?? null)
          : null;
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
  if (objective) {
    for (const taskId of objective.taskIds) taskIds.add(taskId);
  }
  if (task) taskIds.add(task.taskId);
  if (selectedRun) runIds.add(selectedRun.runId);
  if (worker) {
    for (const entry of run.tasks.filter((candidate) => candidate.assignedWorkerId === worker.workerId)) {
      taskIds.add(entry.taskId);
    }
  }
  for (const entry of run.runs) {
    if (taskIds.has(entry.taskId) || runIds.has(entry.runId)) {
      taskIds.add(entry.taskId);
      runIds.add(entry.runId);
    }
  }
  const tasks = run.tasks.filter((entry) => taskIds.has(entry.taskId));
  const runs = run.runs.filter((entry) => runIds.has(entry.runId) || taskIds.has(entry.taskId));
  const gates = run.gates.filter(
    (gate) =>
      (worker && gate.resourceRefs.workerId === worker.workerId) ||
      (objective && gate.resourceRefs.objectiveId === objective.objectiveId) ||
      (gate.resourceRefs.taskId !== undefined && taskIds.has(gate.resourceRefs.taskId)) ||
      (gate.resourceRefs.runId !== undefined && runIds.has(gate.resourceRefs.runId)),
  );
  const artifacts = run.artifacts.filter(
    (artifact) =>
      (worker && artifact.resourceRefs.workerId === worker.workerId) ||
      (objective && artifact.resourceRefs.objectiveId === objective.objectiveId) ||
      (artifact.resourceRefs.taskId !== undefined && taskIds.has(artifact.resourceRefs.taskId)) ||
      (artifact.resourceRefs.runId !== undefined && runIds.has(artifact.resourceRefs.runId)),
  );
  const eventMatches = (refs: { workerId?: string; objectiveId?: string; taskId?: string; runId?: string }) =>
    (worker && refs.workerId === worker.workerId) ||
    (objective && refs.objectiveId === objective.objectiveId) ||
    (refs.taskId !== undefined && taskIds.has(refs.taskId)) ||
    (refs.runId !== undefined && runIds.has(refs.runId));
  const bundle: EvidenceBundle = {
    purpose: input.purpose ?? "task_review",
    generatedAt: new Date().toISOString(),
    resourceRefs: {
      projectKey: run.projectKey,
      objectiveId: objective?.objectiveId,
      workerId: worker?.workerId,
      taskId: task?.taskId,
      runId: selectedRun?.runId,
    },
    objective,
    worker,
    tasks,
    runs,
    gates,
    artifacts,
    events: input.includeEvents ? run.events.filter((event) => eventMatches(event.resourceRefs)) : undefined,
    pr: worker?.pr ?? null,
    summary: {
      taskCount: tasks.length,
      runCount: runs.length,
      openGateCount: gates.filter((gate) => gate.status === "open").length,
      artifactCount: artifacts.length,
      terminalRunCount: runs.filter((entry) => isTerminalStatus(entry.status)).length,
      completedTaskCount: tasks.filter((entry) => entry.state === "completed").length,
      needsReviewTaskCount: tasks.filter((entry) => entry.state === "needs_review").length,
      blockedTaskCount: tasks.filter((entry) => entry.state === "blocked").length,
      failedTaskCount: tasks.filter((entry) => entry.state === "failed").length,
    },
  };
  if (input.persistArtifact) {
    const withArtifact = addConductorArtifact(run, {
      type: "other",
      ref: `evidence://${bundle.purpose}/${task?.taskId ?? worker?.workerId ?? objective?.objectiveId ?? selectedRun?.runId ?? run.projectKey}/${Date.now().toString(36)}`,
      resourceRefs: bundle.resourceRefs,
      producer: { type: "parent_agent", id: "conductor" },
      metadata: {
        purpose: bundle.purpose,
        taskIds: tasks.map((entry) => entry.taskId),
        runIds: runs.map((entry) => entry.runId),
        artifactIds: artifacts.map((entry) => entry.artifactId),
        summary: bundle.summary,
      },
    });
    writeRun(withArtifact);
    bundle.persistedArtifact = withArtifact.artifacts.at(-1);
  }
  return bundle;
}

export function checkReadinessForRepo(
  repoRoot: string,
  input: {
    workerId?: string;
    workerName?: string;
    taskId?: string;
    purpose: ReadinessPurpose;
    requireCompletionReport?: boolean;
    requireTestEvidence?: boolean;
    requireNoOpenGates?: boolean;
    requireCommit?: boolean;
    requirePush?: boolean;
    requireApprovedReadyForPrGate?: boolean;
  },
): ReadinessCheck {
  const bundle = buildEvidenceBundleForRepo(repoRoot, { ...input, purpose: input.purpose });
  const blockers: ReadinessCheck["blockers"] = [];
  const warnings: ReadinessCheck["warnings"] = [];
  if (input.purpose === "task_review") {
    const task = bundle.tasks[0];
    if (!task)
      blockers.push({ code: "missing_task", message: "Task was not found", resourceRefs: bundle.resourceRefs });
    if (task && !["completed", "needs_review"].includes(task.state)) {
      blockers.push({
        code: "task_not_terminal",
        message: `Task is ${task.state}`,
        resourceRefs: { taskId: task.taskId },
      });
    }
    if (
      (input.requireNoOpenGates ?? true) &&
      bundle.gates.some((gate) => gate.status === "open" && gate.type !== "needs_review")
    ) {
      blockers.push({ code: "open_gate", message: "Open blocking gate exists", resourceRefs: bundle.resourceRefs });
    }
    if (
      (input.requireCompletionReport ?? true) &&
      !bundle.artifacts.some((artifact) => artifact.type === "completion_report")
    ) {
      blockers.push({
        code: "missing_completion_report",
        message: "Completion report artifact is required",
        resourceRefs: bundle.resourceRefs,
      });
    }
    if (input.requireTestEvidence && !bundle.artifacts.some((artifact) => artifact.type === "test_result")) {
      blockers.push({
        code: "missing_test_result",
        message: "Test result artifact is required",
        resourceRefs: bundle.resourceRefs,
      });
    }
  } else {
    if (!bundle.worker)
      blockers.push({ code: "missing_worker", message: "Worker was not found", resourceRefs: bundle.resourceRefs });
    if (bundle.tasks.filter((task) => ["completed", "needs_review"].includes(task.state)).length === 0) {
      blockers.push({
        code: "task_not_terminal",
        message: "No completed or reviewable worker tasks found",
        resourceRefs: bundle.resourceRefs,
      });
    }
    if ((input.requireCommit ?? true) && !bundle.worker?.pr.commitSucceeded) {
      blockers.push({
        code: "missing_commit",
        message: "Worker commit is required",
        resourceRefs: bundle.resourceRefs,
      });
    }
    if ((input.requirePush ?? true) && !bundle.worker?.pr.pushSucceeded) {
      blockers.push({ code: "missing_push", message: "Worker push is required", resourceRefs: bundle.resourceRefs });
    }
    const readyGate = bundle.gates.find((gate) => gate.type === "ready_for_pr" && gate.status === "approved");
    if ((input.requireApprovedReadyForPrGate ?? true) && !readyGate) {
      blockers.push({
        code: "missing_ready_for_pr_gate",
        message: "Approved ready_for_pr gate is required",
        resourceRefs: bundle.resourceRefs,
      });
    }
    if (bundle.worker?.pr.url)
      warnings.push({
        code: "pr_already_created",
        message: "Worker already has a PR",
        resourceRefs: bundle.resourceRefs,
      });
  }
  const status =
    blockers.length === 0
      ? "ready"
      : blockers.some((blocker) => blocker.code === "open_gate")
        ? "blocked"
        : "not_ready";
  return {
    purpose: input.purpose,
    status,
    generatedAt: new Date().toISOString(),
    resourceRefs: bundle.resourceRefs,
    bundle,
    blockers,
    warnings,
  };
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
  const updatedRun = addWorker(run, worker);
  writeRun(updatedRun);
  return worker;
}

export function updateWorkerTaskForRepo(repoRoot: string, workerName: string, task: string): WorkerRecord {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const updatedRun = setWorkerLifecycle(setWorkerTask(run, worker.workerId, task), worker.workerId, "idle");
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during task update`);
  }
  return updatedWorker;
}

export async function resumeWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (worker.lifecycle === "broken") {
    throw new Error(`Worker named ${workerName} is broken and must be recovered before resume`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} does not have a valid session file`);
  }

  const runtime = await resumeWorkerSessionRuntime(worker.sessionFile);
  // Resume in the current MVP means "reopen and re-link the persisted worker
  // session" rather than "continue an autonomous running agent". For that
  // reason, resume intentionally normalizes the worker back to idle.
  const updatedRun = setWorkerLifecycle(
    setWorkerRuntimeState(run, worker.workerId, {
      sessionFile: runtime.sessionFile,
      sessionId: runtime.sessionId,
      lastResumedAt: runtime.lastResumedAt,
    }),
    worker.workerId,
    "idle",
  );
  writeRun(updatedRun);
  return updatedRun.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
}

export function updateWorkerLifecycleForRepo(
  repoRoot: string,
  workerName: string,
  lifecycle: WorkerLifecycleState,
): WorkerRecord {
  if (lifecycle === "broken") {
    throw new Error("Broken lifecycle is reserved for detected health failures");
  }
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  const updatedRun = setWorkerLifecycle(run, worker.workerId, lifecycle);
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during lifecycle update`);
  }
  return updatedWorker;
}

export function reconcileProjectForRepo(repoRoot: string, input: { now?: string; dryRun?: boolean } = {}): RunRecord {
  const healthReconciled = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const leaseReconciled = reconcileRunLeases(healthReconciled, input);
  if (!input.dryRun) {
    writeRun(leaseReconciled);
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

export async function refreshWorkerSummaryForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} does not have a valid session file`);
  }
  const summaryText = await summarizeWorkerSessionRuntime(worker.sessionFile);
  const updatedRun = setWorkerSummary(run, worker.workerId, summaryText);
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during summary refresh`);
  }
  return updatedWorker;
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
  const updatedRun = removeWorker(markConductorGateUsed(run, cleanupGate.gateId), worker.workerId);
  writeRun(updatedRun);
  return worker;
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
  commitAllChanges(worker.worktreePath, message);
  const updatedRun = setWorkerPrState(run, worker.workerId, {
    commitSucceeded: true,
    pushSucceeded: false,
    prCreationAttempted: false,
    url: null,
    number: null,
  });
  writeRun(updatedRun);
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
  validatePushPreconditions(run.repoRoot);
  pushBranchToOrigin(worker.worktreePath, worker.branch);
  const updatedRun = setWorkerPrState(run, worker.workerId, {
    pushSucceeded: true,
  });
  writeRun(updatedRun);
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
  validatePrPreconditions(run.repoRoot);
  const prBody = body?.trim() || worker.summary.text || worker.currentTask || `PR for ${worker.name}`;
  try {
    const pr = createPullRequest({
      repoRoot: run.repoRoot,
      worktreePath: worker.worktreePath,
      branch: worker.branch,
      title,
      body: prBody,
    });
    const updatedRun = markConductorGateUsed(
      setWorkerPrState(run, worker.workerId, {
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
    writeRun(withEvidence);
    return withEvidence.workers.find((entry) => entry.workerId === worker.workerId) ?? worker;
  } catch (error) {
    const updatedRun = setWorkerPrState(run, worker.workerId, {
      prCreationAttempted: true,
      url: null,
      number: null,
    });
    writeRun(updatedRun);
    throw error;
  }
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

function createGateId(): string {
  return `gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runTaskForRepo(repoRoot: string, taskId: string): Promise<WorkerRunResult> {
  const started = startTaskRunForRepo(repoRoot, { taskId });
  let currentRun = getOrCreateRunForRepo(repoRoot);
  const worker = currentRun.workers.find((entry) => entry.workerId === started.run.workerId);
  const task = currentRun.tasks.find((entry) => entry.taskId === taskId);
  if (!worker || !task) {
    throw new Error(`Task ${taskId} has invalid worker/run references`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker ${worker.name} is missing its session file; recover the worker first`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker ${worker.name} is missing its worktree; recover the worker first`);
  }

  await preflightWorkerRunRuntime({ worktreePath: worker.worktreePath, sessionFile: worker.sessionFile });

  const runtimeResult = await runWorkerPromptRuntime({
    worktreePath: worker.worktreePath,
    sessionFile: worker.sessionFile,
    task: task.prompt,
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

  currentRun = getOrCreateRunForRepo(repoRoot);
  const runAttempt = currentRun.runs.find((entry) => entry.runId === started.run.runId);
  if (runAttempt && !runAttempt.finishedAt) {
    const semanticStatus =
      runtimeResult.status === "success" ? "partial" : mapWorkerRunStatusToRunStatus(runtimeResult.status);
    const completedRun = completeTaskRun(currentRun, {
      runId: started.run.runId,
      status: semanticStatus,
      completionSummary: runtimeResult.finalText,
      errorMessage: runtimeResult.errorMessage,
    });
    writeRun(completedRun);
    if (runtimeResult.status === "success") {
      createGateForRepo(repoRoot, {
        gateId: createGateId(),
        type: "needs_review",
        resourceRefs: { taskId, runId: started.run.runId, workerId: worker.workerId },
        requestedDecision: `Review task ${taskId}: native worker exited without explicit conductor_child_complete`,
      });
    }
  }

  return {
    workerName: worker.name,
    status: runtimeResult.status,
    finalText: runtimeResult.finalText,
    errorMessage: runtimeResult.errorMessage,
    sessionId: runtimeResult.sessionId,
  };
}

export async function runWorkerForRepo(repoRoot: string, workerName: string, task: string): Promise<WorkerRunResult> {
  const run = reconcileWorkerHealth(getOrCreateRunForRepo(repoRoot));
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }
  if (worker.lifecycle === "broken") {
    throw new Error(`Worker named ${workerName} is broken and must recover the worker first`);
  }
  if (worker.lifecycle === "running") {
    throw new Error(`Worker named ${workerName} is already running and cannot accept overlapping runs`);
  }
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    throw new Error(`Worker named ${workerName} is missing its session file; recover the worker first`);
  }
  if (!worker.worktreePath || !existsSync(worker.worktreePath)) {
    throw new Error(`Worker named ${workerName} is missing its worktree; recover the worker first`);
  }

  await preflightWorkerRunRuntime({
    worktreePath: worker.worktreePath,
    sessionFile: worker.sessionFile,
  });

  const runningRun = startWorkerRun(run, worker.workerId, {
    task,
    sessionId: null,
  });
  writeRun(runningRun);

  // latestRun is intentionally captured by the onSessionReady callback so the
  // single foreground run can durably record the execution session id before the
  // prompt completes. This path is single-session and single-threaded.
  let latestRun = runningRun;

  try {
    const runtimeResult = await runWorkerPromptRuntime({
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
      task,
      onSessionReady: async (sessionId) => {
        latestRun = setWorkerRunSessionId(latestRun, worker.workerId, sessionId);
        writeRun(latestRun);
      },
    });

    if (
      runtimeResult.sessionId &&
      latestRun.workers.find((entry) => entry.workerId === worker.workerId)?.lastRun?.sessionId !==
        runtimeResult.sessionId
    ) {
      latestRun = setWorkerRunSessionId(latestRun, worker.workerId, runtimeResult.sessionId);
    }
    const completedRun = finishWorkerRun(latestRun, worker.workerId, {
      status: runtimeResult.status,
      errorMessage: runtimeResult.errorMessage,
    });
    writeRun(completedRun);

    return {
      workerName: worker.name,
      status: runtimeResult.status,
      finalText: runtimeResult.finalText,
      errorMessage: runtimeResult.errorMessage,
      sessionId: runtimeResult.sessionId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      const completedRun = finishWorkerRun(latestRun, worker.workerId, {
        status: "error",
        errorMessage: message,
      });
      writeRun(completedRun);
    } catch (persistenceError) {
      const persistenceMessage =
        persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
      throw new Error(`${message} (Additionally failed to persist worker run error state: ${persistenceMessage})`);
    }

    return {
      workerName: worker.name,
      status: "error",
      finalText: null,
      errorMessage: message,
      sessionId: null,
    };
  }
}

export async function recoverWorkerForRepo(repoRoot: string, workerName: string): Promise<WorkerRecord> {
  const run = getOrCreateRunForRepo(repoRoot);
  const worker = run.workers.find((entry) => entry.name === workerName);
  if (!worker) {
    throw new Error(`Worker named ${workerName} not found`);
  }

  let worktreePath = worker.worktreePath;
  if (!worktreePath || !existsSync(worktreePath)) {
    if (!worker.branch) {
      throw new Error(`Worker named ${workerName} cannot be recovered without a valid branch`);
    }
    worktreePath = recreateManagedWorktree(run.repoRoot, {
      workerName: worker.name,
      branch: worker.branch,
    }).worktreePath;
  }

  let runtime = null;
  if (!worker.sessionFile || !existsSync(worker.sessionFile)) {
    runtime = await recoverWorkerSessionRuntime(worktreePath);
  }

  const workers = run.workers.map((entry) =>
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
  const updatedRun = {
    ...run,
    workers,
    updatedAt: new Date().toISOString(),
  };
  writeRun(updatedRun);
  const updatedWorker = updatedRun.workers.find((entry) => entry.workerId === worker.workerId);
  if (!updatedWorker) {
    throw new Error(`Worker named ${workerName} disappeared during recovery`);
  }
  return updatedWorker;
}

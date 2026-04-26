import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { addConductorArtifact } from "./storage.js";
import type { EvidenceBundle, EvidenceBundlePurpose, ReadinessCheck, ReadinessPurpose } from "./types.js";

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
    const withArtifact = mutateRepoRunSync(repoRoot, (latest) =>
      addConductorArtifact(latest, {
        type: "other",
        ref: `evidence://${bundle.purpose}/${task?.taskId ?? worker?.workerId ?? objective?.objectiveId ?? selectedRun?.runId ?? latest.projectKey}/${Date.now().toString(36)}`,
        resourceRefs: bundle.resourceRefs,
        producer: { type: "parent_agent", id: "conductor" },
        metadata: {
          purpose: bundle.purpose,
          taskIds: tasks.map((entry) => entry.taskId),
          runIds: runs.map((entry) => entry.runId),
          artifactIds: artifacts.map((entry) => entry.artifactId),
          summary: bundle.summary,
        },
      }),
    );
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

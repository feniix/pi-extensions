export const CONDUCTOR_SCHEMA_VERSION = 1;

export type WorkerLifecycleState = "idle" | "running" | "blocked" | "ready_for_pr" | "done" | "broken" | "archived";
export type ObjectiveStatus = "draft" | "active" | "blocked" | "needs_review" | "completed" | "canceled";
export type WorkerRunStatus = "success" | "error" | "aborted";

export type TaskState =
  | "draft"
  | "ready"
  | "assigned"
  | "running"
  | "needs_review"
  | "blocked"
  | "completed"
  | "failed"
  | "canceled";
export type RunStatus =
  | "dispatch_pending"
  | "queued"
  | "starting"
  | "running"
  | "completing"
  | "succeeded"
  | "partial"
  | "blocked"
  | "failed"
  | "aborted"
  | "stale"
  | "interrupted"
  | "unknown_dispatch";
export type GateStatus = "open" | "approved" | "rejected" | "canceled";
export type GateOperation = "create_worker_pr" | "destructive_cleanup" | "resolve_blocker" | "generic";
export type ArtifactType =
  | "note"
  | "test_result"
  | "changed_files"
  | "log"
  | "completion_report"
  | "pr_evidence"
  | "other";

export interface ConductorActor {
  type: "parent_agent" | "child_run" | "human" | "backend" | "system" | "test";
  id: string;
}

export type ConductorNextActionPriority = "critical" | "high" | "medium" | "low";
export type ConductorNextActionKind =
  | "reconcile_project"
  | "recover_worker"
  | "create_worker"
  | "create_task"
  | "plan_objective"
  | "assign_task"
  | "run_task"
  | "wait_for_run"
  | "wait_for_dependency"
  | "resolve_gate"
  | "await_human_gate"
  | "review_task"
  | "retry_task"
  | "refresh_objective_status"
  | "commit_worker"
  | "push_worker"
  | "create_ready_for_pr_gate"
  | "create_worker_pr"
  | "no_action";

export interface ConductorNextAction {
  actionId: string;
  priority: ConductorNextActionPriority;
  kind: ConductorNextActionKind;
  title: string;
  rationale: string;
  resourceRefs: ConductorResourceRefs;
  toolCall: null | { name: string; params: Record<string, unknown> };
  requiresHuman: boolean;
  destructive: boolean;
  blockedBy: ConductorResourceRefs[];
  confidence: "high" | "medium" | "low";
}

export type EvidenceBundlePurpose = "task_review" | "pr_readiness" | "handoff";
export type ReadinessPurpose = "task_review" | "pr_readiness";
export type ReadinessStatus = "ready" | "blocked" | "needs_review" | "not_ready";

export interface EvidenceBundle {
  purpose: EvidenceBundlePurpose;
  generatedAt: string;
  resourceRefs: ConductorResourceRefs;
  objective: ObjectiveRecord | null;
  worker: WorkerRecord | null;
  tasks: TaskRecord[];
  runs: RunAttemptRecord[];
  gates: GateRecord[];
  artifacts: ArtifactRecord[];
  events?: ConductorEvent[];
  pr: WorkerPrState | null;
  summary: {
    taskCount: number;
    runCount: number;
    openGateCount: number;
    artifactCount: number;
    terminalRunCount: number;
    completedTaskCount: number;
    needsReviewTaskCount: number;
    blockedTaskCount: number;
    failedTaskCount: number;
  };
  persistedArtifact?: ArtifactRecord;
}

export interface ObjectivePlanResult {
  objective: ObjectiveRecord;
  tasks: TaskRecord[];
}

export interface ReadinessCheck {
  purpose: ReadinessPurpose;
  status: ReadinessStatus;
  generatedAt: string;
  resourceRefs: ConductorResourceRefs;
  bundle: EvidenceBundle;
  blockers: Array<{ code: string; message: string; resourceRefs?: ConductorResourceRefs }>;
  warnings: Array<{ code: string; message: string; resourceRefs?: ConductorResourceRefs }>;
}

export interface ConductorResourceTimeline {
  markdown: string;
  resourceRefs: ConductorResourceRefs;
  events: ConductorEvent[];
  artifacts: ArtifactRecord[];
  gates: GateRecord[];
  runs: RunAttemptRecord[];
}

export interface ConductorTaskBrief {
  markdown: string;
  task: TaskRecord;
  objective: ObjectiveRecord | null;
  worker: WorkerRecord | null;
  runs: RunAttemptRecord[];
  gates: GateRecord[];
  artifacts: ArtifactRecord[];
  suggestedNextTool: null | { name: string; params: Record<string, unknown> };
  dependencies: Array<{ taskId: string; title: string; state: TaskState }>;
}

export interface ConductorProjectBrief {
  markdown: string;
  project: {
    projectKey: string;
    repoRoot: string;
    revision: number;
    counts: {
      workers: number;
      objectives: number;
      tasks: number;
      runs: number;
      gates: number;
      artifacts: number;
      events: number;
    };
  };
  objectives: Array<{
    objectiveId: string;
    title: string;
    status: ObjectiveStatus;
    taskCount: number;
    completedTaskCount: number;
    blockedTaskCount: number;
  }>;
  blockers: GateRecord[];
  nextActions: ConductorNextAction[];
  recentEvents: ConductorEvent[];
}

export interface ConductorNextActionsResponse {
  project: {
    projectKey: string;
    repoRoot: string;
    schemaVersion: number;
    revision: number;
    reconciledPreview: boolean;
    counts: { workers: number; tasks: number; runs: number; gates: number; artifacts: number; events: number };
  };
  summary: {
    status: "actionable" | "waiting" | "healthy_idle" | "empty" | "blocked" | "error";
    headline: string;
    totalActions: number;
    returnedActions: number;
    highestPriority: ConductorNextActionPriority | null;
  };
  actions: ConductorNextAction[];
  omitted: { count: number; reason: string | null };
}

export interface ConductorResourceRefs {
  projectKey?: string;
  workerId?: string;
  taskId?: string;
  runId?: string;
  gateId?: string;
  artifactId?: string;
  objectiveId?: string;
}

export type ConductorEventType =
  | "artifact.created"
  | "backend.unavailable"
  | "backend.dispatch_failed"
  | "backend.dispatch_succeeded"
  | "external_operation.failed"
  | "external_operation.succeeded"
  | "gate.created"
  | "gate.resolved"
  | "gate.used"
  | "objective.created"
  | "objective.planned"
  | "objective.status_refreshed"
  | "objective.task_linked"
  | "objective.updated"
  | "project.created"
  | "run.cancel_rejected"
  | "run.canceled"
  | "run.completed"
  | "run.heartbeat"
  | "run.lease_expired"
  | "run.progress_reported"
  | "run.started"
  | "scheduler.action_selected"
  | "scheduler.action_skipped"
  | "scheduler.capacity_exhausted"
  | "scheduler.tick_failed"
  | "scheduler.tick_started"
  | "scheduler.tick_succeeded"
  | "task.assigned"
  | "task.completion_rejected"
  | "task.created"
  | "task.followup_created"
  | "task.progress"
  | "task.progress_rejected"
  | "task.updated"
  | "worker.archived"
  | "worker.cleanup_failed"
  | "worker.cleanup_succeeded"
  | "worker.commit_failed"
  | "worker.commit_succeeded"
  | "worker.created"
  | "worker.lifecycle_changed"
  | "worker.pr_created"
  | "worker.pr_failed"
  | "worker.pr_updated"
  | "worker.push_failed"
  | "worker.push_succeeded"
  | "worker.recovery_failed"
  | "worker.recovery_succeeded"
  | "worker.resume_failed"
  | "worker.resume_succeeded"
  | "worker.summary_refresh_failed"
  | "worker.summary_refreshed";

export interface ConductorEvent {
  eventId: string;
  sequence: number;
  schemaVersion: number;
  projectRevision: number;
  occurredAt: string;
  actor: ConductorActor;
  type: ConductorEventType;
  resourceRefs: ConductorResourceRefs;
  payload: Record<string, unknown>;
}

export interface ObjectiveRecord {
  objectiveId: string;
  title: string;
  prompt: string;
  status: ObjectiveStatus;
  revision: number;
  taskIds: string[];
  gateIds: string[];
  artifactIds: string[];
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  taskId: string;
  title: string;
  prompt: string;
  state: TaskState;
  revision: number;
  assignedWorkerId: string | null;
  activeRunId: string | null;
  runIds: string[];
  artifactIds: string[];
  gateIds: string[];
  objectiveId: string | null;
  dependsOnTaskIds: string[];
  latestProgress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunAttemptRecord {
  runId: string;
  taskId: string;
  workerId: string;
  taskRevision: number;
  status: RunStatus;
  backend: "native" | "pi-subagents";
  backendRunId: string | null;
  sessionId: string | null;
  leaseGeneration: number;
  leaseStartedAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completionSummary: string | null;
  errorMessage: string | null;
  artifactIds: string[];
  gateIds: string[];
}

export interface GateRecord {
  gateId: string;
  type: "needs_input" | "needs_review" | "approval_required" | "ready_for_pr" | "destructive_cleanup";
  status: GateStatus;
  resourceRefs: ConductorResourceRefs;
  requestedDecision: string;
  operation: GateOperation;
  targetRevision: number | null;
  expiresAt: string | null;
  usedAt: string | null;
  resolvedBy: ConductorActor | null;
  resolutionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  artifactId: string;
  type: ArtifactType;
  ref: string;
  resourceRefs: ConductorResourceRefs;
  producer: ConductorActor;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerSummary {
  text: string | null;
  updatedAt: string | null;
  stale: boolean;
}

export interface WorkerPrState {
  url: string | null;
  number: number | null;
  commitSucceeded: boolean;
  pushSucceeded: boolean;
  prCreationAttempted: boolean;
}

export interface WorkerRuntimeState {
  backend: "session_manager";
  sessionId: string | null;
  lastResumedAt: string | null;
}

export interface WorkerLastRun {
  task: string;
  status: WorkerRunStatus | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  sessionId: string | null;
}

export interface WorkerRecord {
  workerId: string;
  name: string;
  branch: string | null;
  worktreePath: string | null;
  sessionFile: string | null;
  runtime: WorkerRuntimeState;
  currentTask: string | null;
  lifecycle: WorkerLifecycleState;
  recoverable: boolean;
  lastRun: WorkerLastRun | null;
  summary: WorkerSummary;
  pr: WorkerPrState;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  schemaVersion: number;
  revision: number;
  projectKey: string;
  repoRoot: string;
  storageDir: string;
  workers: WorkerRecord[];
  archivedWorkers: WorkerRecord[];
  objectives: ObjectiveRecord[];
  tasks: TaskRecord[];
  runs: RunAttemptRecord[];
  gates: GateRecord[];
  artifacts: ArtifactRecord[];
  events: ConductorEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRunResult {
  workerName: string;
  status: WorkerRunStatus;
  finalText: string | null;
  errorMessage: string | null;
  sessionId: string | null;
}

export interface RuntimeRunResult {
  status: WorkerRunStatus;
  finalText: string | null;
  errorMessage: string | null;
  sessionId: string | null;
}

export interface TaskContractInput {
  taskId: string;
  runId: string;
  taskRevision: number;
  goal: string;
  constraints?: string[];
  explicitCompletionTools: boolean;
  allowFollowUpTasks?: boolean;
}

export interface ConductorProgressReportInput {
  runId: string;
  taskId: string;
  progress: string;
  idempotencyKey?: string;
  artifact?: { type: ArtifactType; ref: string; metadata?: Record<string, unknown> };
}

export interface ConductorCompletionReportInput {
  runId: string;
  taskId: string;
  status: "succeeded" | "partial" | "blocked" | "failed" | "aborted";
  completionSummary: string;
  idempotencyKey?: string;
  artifact?: { type: ArtifactType; ref: string; metadata?: Record<string, unknown> };
}

export interface ConductorGateReportInput {
  runId: string;
  taskId: string;
  type: "needs_input" | "needs_review";
  requestedDecision: string;
}

export interface ConductorFollowUpTaskInput {
  runId: string;
  taskId: string;
  title: string;
  prompt: string;
}

export interface RuntimeRunContext {
  worktreePath: string;
  sessionFile: string;
  task: string;
  taskContract?: TaskContractInput;
  onSessionReady?: (sessionId: string) => void | Promise<void>;
  onConductorProgress?: (input: ConductorProgressReportInput) => void | Promise<void>;
  onConductorComplete?: (input: ConductorCompletionReportInput) => void | Promise<void>;
  onConductorGate?: (input: ConductorGateReportInput) => void | Promise<void>;
  onConductorFollowUpTask?: (input: ConductorFollowUpTaskInput) => void | Promise<void>;
}

export interface RuntimeRunPreflightContext {
  worktreePath: string;
  sessionFile: string;
}

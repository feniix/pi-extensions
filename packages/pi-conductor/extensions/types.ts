export const CONDUCTOR_SCHEMA_VERSION = 1;

export type WorkerLifecycleState = "idle" | "running" | "blocked" | "ready_for_pr" | "done" | "broken";
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
  | "assign_task"
  | "run_task"
  | "wait_for_run"
  | "resolve_gate"
  | "await_human_gate"
  | "review_task"
  | "retry_task"
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
}

export interface ConductorEvent {
  eventId: string;
  sequence: number;
  schemaVersion: number;
  projectRevision: number;
  occurredAt: string;
  actor: ConductorActor;
  type: string;
  resourceRefs: ConductorResourceRefs;
  payload: Record<string, unknown>;
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

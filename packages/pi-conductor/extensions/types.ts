export type WorkerLifecycleState = "idle" | "running" | "blocked" | "ready_for_pr" | "done" | "broken";
export type WorkerRunStatus = "success" | "error" | "aborted";

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
  projectKey: string;
  repoRoot: string;
  storageDir: string;
  workers: WorkerRecord[];
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

export interface RuntimeRunContext {
  worktreePath: string;
  sessionFile: string;
  task: string;
  onSessionReady?: (sessionId: string) => void | Promise<void>;
}

export interface RuntimeRunPreflightContext {
  worktreePath: string;
  sessionFile: string;
}

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createGateForRepo } from "./gate-service.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { recordRunHeartbeat } from "./storage.js";
import { createFollowUpTaskForRepo, recordTaskCompletionForRepo, recordTaskProgressForRepo } from "./task-service.js";
import type {
  ConductorCompletionReportInput,
  ConductorFollowUpTaskInput,
  ConductorGateReportInput,
  ConductorProgressReportInput,
  RuntimeRunContext,
  RuntimeRunResult,
  TaskContractInput,
} from "./types.js";

export const RUNNER_CONTRACT_SCHEMA_VERSION = 1;

export interface RunnerContract {
  schemaVersion: number;
  repoRoot: string;
  worktreePath: string;
  sessionFile: string;
  taskContract: TaskContractInput;
  nonce: string;
  createdAt: string;
  heartbeatIntervalMs?: number;
}

type RuntimeRunner = (input: RuntimeRunContext) => Promise<RuntimeRunResult>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTerminalRunStatus(status: string): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function withStateLockRetry<T>(operation: () => T): Promise<T> {
  const delays = [10, 25, 50, 100, 200];
  for (const [attempt, delay] of delays.entries()) {
    try {
      return operation();
    } catch (error) {
      if (!/is locked/i.test(errorMessage(error)) || attempt === delays.length - 1) {
        throw error;
      }
      await sleep(delay);
    }
  }
  return operation();
}

export function createRunnerContract(input: {
  repoRoot: string;
  worktreePath: string;
  sessionFile: string;
  taskContract: TaskContractInput;
  nonce: string;
  createdAt?: string;
  heartbeatIntervalMs?: number;
}): RunnerContract {
  return {
    schemaVersion: RUNNER_CONTRACT_SCHEMA_VERSION,
    repoRoot: resolve(input.repoRoot),
    worktreePath: resolve(input.worktreePath),
    sessionFile: resolve(input.sessionFile),
    taskContract: input.taskContract,
    nonce: input.nonce,
    createdAt: input.createdAt ?? new Date().toISOString(),
    heartbeatIntervalMs: input.heartbeatIntervalMs,
  };
}

export function writeRunnerContract(contractPath: string, contract: RunnerContract): void {
  mkdirSync(dirname(contractPath), { recursive: true, mode: 0o700 });
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

export function readRunnerContract(contractPath: string): RunnerContract {
  if (!existsSync(contractPath)) {
    throw new Error(`Runner contract ${contractPath} not found`);
  }
  const parsed = JSON.parse(readFileSync(contractPath, "utf-8")) as unknown;
  return assertRunnerContract(parsed);
}

function assertStringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Runner contract ${field} must be a string`);
  }
  return value;
}

function assertRunnerContract(value: unknown): RunnerContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runner contract must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== RUNNER_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported runner contract schemaVersion ${String(record.schemaVersion)}`);
  }
  const taskContract = record.taskContract;
  if (!taskContract || typeof taskContract !== "object" || Array.isArray(taskContract)) {
    throw new Error("Runner contract taskContract must be an object");
  }
  const taskScope = taskContract as Record<string, unknown>;
  if (!Number.isInteger(taskScope.taskRevision) || Number(taskScope.taskRevision) < 1) {
    throw new Error("Runner contract taskContract.taskRevision must be a positive integer");
  }
  const taskRevision = Number(taskScope.taskRevision);
  const explicitCompletionTools = taskScope.explicitCompletionTools;
  if (typeof explicitCompletionTools !== "boolean") {
    throw new Error("Runner contract taskContract.explicitCompletionTools must be a boolean");
  }
  const allowFollowUpTasks = taskScope.allowFollowUpTasks;
  if (allowFollowUpTasks !== undefined && typeof allowFollowUpTasks !== "boolean") {
    throw new Error("Runner contract taskContract.allowFollowUpTasks must be a boolean");
  }
  const constraints = taskScope.constraints;
  if (
    constraints !== undefined &&
    (!Array.isArray(constraints) || constraints.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error("Runner contract taskContract.constraints must be an array of strings");
  }
  if (
    record.heartbeatIntervalMs !== undefined &&
    (!Number.isInteger(record.heartbeatIntervalMs) || Number(record.heartbeatIntervalMs) < 1)
  ) {
    throw new Error("Runner contract heartbeatIntervalMs must be a positive integer");
  }
  const heartbeatIntervalMs = record.heartbeatIntervalMs === undefined ? undefined : Number(record.heartbeatIntervalMs);
  return {
    schemaVersion: RUNNER_CONTRACT_SCHEMA_VERSION,
    repoRoot: assertStringField(record.repoRoot, "repoRoot"),
    worktreePath: assertStringField(record.worktreePath, "worktreePath"),
    sessionFile: assertStringField(record.sessionFile, "sessionFile"),
    taskContract: {
      taskId: assertStringField(taskScope.taskId, "taskContract.taskId"),
      runId: assertStringField(taskScope.runId, "taskContract.runId"),
      taskRevision,
      goal: assertStringField(taskScope.goal, "taskContract.goal"),
      constraints: constraints as string[] | undefined,
      explicitCompletionTools,
      allowFollowUpTasks,
    },
    nonce: assertStringField(record.nonce, "nonce"),
    createdAt: assertStringField(record.createdAt, "createdAt"),
    heartbeatIntervalMs,
  };
}

function hashRunnerNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function validateRunnerContractForRepo(input: {
  repoRoot: string;
  contract: RunnerContract;
  nonce: string;
  contractPath?: string;
  requireActive?: boolean;
}): void {
  if (input.nonce !== input.contract.nonce) {
    throw new Error("Runner contract nonce mismatch");
  }
  if (resolve(input.contract.repoRoot) !== resolve(input.repoRoot)) {
    throw new Error("Runner contract repoRoot mismatch");
  }
  const run = getOrCreateRunForRepo(input.repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.contract.taskContract.taskId);
  const runAttempt = run.runs.find((entry) => entry.runId === input.contract.taskContract.runId);
  if (!task || !runAttempt) {
    throw new Error("Runner contract references missing task or run");
  }
  const worker = run.workers.find((entry) => entry.workerId === runAttempt.workerId);
  if (runAttempt.taskId !== task.taskId || runAttempt.taskRevision !== input.contract.taskContract.taskRevision) {
    throw new Error("Runner contract is stale for the current task/run revision");
  }
  if (task.prompt !== input.contract.taskContract.goal) {
    throw new Error("Runner contract goal mismatch");
  }
  if (worker?.worktreePath && resolve(worker.worktreePath) !== resolve(input.contract.worktreePath)) {
    throw new Error("Runner contract worktreePath mismatch");
  }
  if (worker?.sessionFile && resolve(worker.sessionFile) !== resolve(input.contract.sessionFile)) {
    throw new Error("Runner contract sessionFile mismatch");
  }
  if (input.requireActive && (!runAttempt.runtime.nonceHash || !runAttempt.runtime.contractPath)) {
    throw new Error("Runner contract nonce metadata is not recorded for this run");
  }
  if (runAttempt.runtime.nonceHash && runAttempt.runtime.nonceHash !== hashRunnerNonce(input.nonce)) {
    throw new Error("Runner contract nonce mismatch");
  }
  if (
    runAttempt.runtime.contractPath &&
    (!input.contractPath || resolve(runAttempt.runtime.contractPath) !== resolve(input.contractPath))
  ) {
    throw new Error("Runner contract path mismatch");
  }
  if (input.requireActive && (task.activeRunId !== runAttempt.runId || isTerminalRunStatus(runAttempt.status))) {
    throw new Error(`Run ${runAttempt.runId} is not active for runner contract`);
  }
}

function createScopedRunnerCallbacks(contract: RunnerContract, nonce: string, contractPath: string) {
  const repoRoot = contract.repoRoot;
  const assertIdentity = () => validateRunnerContractForRepo({ repoRoot, contract, nonce, contractPath });
  const assertActiveIdentity = () =>
    validateRunnerContractForRepo({ repoRoot, contract, nonce, contractPath, requireActive: true });

  return {
    async onConductorProgress(input: ConductorProgressReportInput) {
      await withStateLockRetry(() => {
        assertIdentity();
        recordTaskProgressForRepo(repoRoot, input);
      });
    },
    async onConductorComplete(input: ConductorCompletionReportInput) {
      await withStateLockRetry(() => {
        assertIdentity();
        recordTaskCompletionForRepo(repoRoot, input);
      });
    },
    async onConductorGate(input: ConductorGateReportInput) {
      await withStateLockRetry(() => {
        assertActiveIdentity();
        createGateForRepo(repoRoot, {
          type: input.type,
          resourceRefs: { taskId: input.taskId, runId: input.runId },
          requestedDecision: input.requestedDecision,
        });
      });
    },
    async onConductorFollowUpTask(input: ConductorFollowUpTaskInput) {
      await withStateLockRetry(() => {
        assertActiveIdentity();
        createFollowUpTaskForRepo(repoRoot, input);
      });
    },
  };
}

export function finalizeRunnerExitForRepo(input: {
  repoRoot: string;
  contract: RunnerContract;
  result: RuntimeRunResult;
}): void {
  const run = getOrCreateRunForRepo(input.repoRoot);
  const runAttempt = run.runs.find((entry) => entry.runId === input.contract.taskContract.runId);
  if (!runAttempt || runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    return;
  }

  const completionSummary =
    input.result.finalText ?? input.result.errorMessage ?? "tmux runner exited without explicit conductor completion";
  const status =
    input.result.status === "success" ? "partial" : input.result.status === "aborted" ? "aborted" : "failed";
  recordTaskCompletionForRepo(input.repoRoot, {
    runId: input.contract.taskContract.runId,
    taskId: input.contract.taskContract.taskId,
    status,
    completionSummary,
  });
  if (input.result.status === "success") {
    createGateForRepo(input.repoRoot, {
      type: "needs_review",
      resourceRefs: { taskId: input.contract.taskContract.taskId, runId: input.contract.taskContract.runId },
      requestedDecision: `Review task ${input.contract.taskContract.taskId}: tmux runner exited without explicit conductor_child_complete`,
    });
  }
}

async function defaultRuntimeRunner(input: RuntimeRunContext): Promise<RuntimeRunResult> {
  const runtime = await import("./runtime.js");
  return runtime.runWorkerPromptRuntime(input);
}

function startRunnerHeartbeat(input: { repoRoot: string; runId: string; heartbeatIntervalMs?: number }): () => void {
  const heartbeatIntervalMs = input.heartbeatIntervalMs;
  if (heartbeatIntervalMs === undefined || heartbeatIntervalMs <= 0) {
    return () => undefined;
  }
  const timer = setInterval(() => {
    void withStateLockRetry(() =>
      mutateRepoRunSync(input.repoRoot, (run) => recordRunHeartbeat(run, { runId: input.runId })),
    ).catch(() => undefined);
  }, heartbeatIntervalMs);
  return () => clearInterval(timer);
}

export async function runRunnerFromContract(input: {
  contractPath: string;
  nonce: string;
  signal?: AbortSignal;
  heartbeatIntervalMs?: number;
  runWorker?: RuntimeRunner;
}): Promise<RuntimeRunResult> {
  const contract = readRunnerContract(input.contractPath);
  validateRunnerContractForRepo({
    repoRoot: contract.repoRoot,
    contract,
    nonce: input.nonce,
    contractPath: input.contractPath,
    requireActive: true,
  });
  const callbacks = createScopedRunnerCallbacks(contract, input.nonce, input.contractPath);
  const runWorker = input.runWorker ?? defaultRuntimeRunner;
  const stopHeartbeat = startRunnerHeartbeat({
    repoRoot: contract.repoRoot,
    runId: contract.taskContract.runId,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? contract.heartbeatIntervalMs,
  });
  try {
    const result = await runWorker({
      repoRoot: contract.repoRoot,
      worktreePath: contract.worktreePath,
      sessionFile: contract.sessionFile,
      task: contract.taskContract.goal,
      taskContract: contract.taskContract,
      signal: input.signal,
      ...callbacks,
    });
    finalizeRunnerExitForRepo({ repoRoot: contract.repoRoot, contract, result });
    return result;
  } catch (error) {
    finalizeRunnerExitForRepo({
      repoRoot: contract.repoRoot,
      contract,
      result: { status: "error", finalText: null, errorMessage: errorMessage(error), sessionId: null },
    });
    throw error;
  } finally {
    stopHeartbeat();
  }
}

function parseRunnerArgs(args: string[]): { contractPath: string; nonce: string } {
  const normalized = args[0] === "run" ? args.slice(1) : args;
  let contractPath: string | null = null;
  let nonce: string | null = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--contract") {
      contractPath = normalized[index + 1] ?? null;
      index += 1;
    } else if (arg === "--nonce") {
      nonce = normalized[index + 1] ?? null;
      index += 1;
    }
  }
  if (!contractPath || !nonce) {
    throw new Error("Usage: pi-conductor-runner run --contract <path> --nonce <nonce>");
  }
  return { contractPath, nonce };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseRunnerArgs(args);
  const result = await runRunnerFromContract(parsed);
  if (result.status !== "success") {
    process.exitCode = result.status === "aborted" ? 130 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

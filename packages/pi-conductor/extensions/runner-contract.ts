import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getOrCreateRunForRepo } from "./repo-run.js";
import { isTerminalRunStatus } from "./run-status.js";
import type { TaskContractInput } from "./types.js";

export const RUNNER_CONTRACT_SCHEMA_VERSION = 1;

export interface RunnerContract {
  schemaVersion: number;
  repoRoot: string;
  worktreePath: string;
  sessionFile: string;
  taskContract: TaskContractInput;
  nonceHash: string;
  createdAt: string;
  heartbeatIntervalMs?: number;
}

export function hashRunnerNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
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
    nonceHash: hashRunnerNonce(input.nonce),
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
    nonceHash: assertStringField(record.nonceHash, "nonceHash"),
    createdAt: assertStringField(record.createdAt, "createdAt"),
    heartbeatIntervalMs,
  };
}

export function validateRunnerContractForRepo(input: {
  repoRoot: string;
  contract: RunnerContract;
  nonce: string;
  contractPath?: string;
  requireActive?: boolean;
}): void {
  if (input.contract.nonceHash !== hashRunnerNonce(input.nonce)) {
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

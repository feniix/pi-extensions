import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createGateForRepo } from "./gate-service.js";
import { getOrCreateRunForRepo } from "./repo-run.js";
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
}): RunnerContract {
  return {
    schemaVersion: RUNNER_CONTRACT_SCHEMA_VERSION,
    repoRoot: resolve(input.repoRoot),
    worktreePath: resolve(input.worktreePath),
    sessionFile: resolve(input.sessionFile),
    taskContract: input.taskContract,
    nonce: input.nonce,
    createdAt: input.createdAt ?? new Date().toISOString(),
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
  const parsed = JSON.parse(readFileSync(contractPath, "utf-8")) as RunnerContract;
  if (parsed.schemaVersion !== RUNNER_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported runner contract schemaVersion ${parsed.schemaVersion}`);
  }
  if (!parsed.nonce || !parsed.taskContract?.runId || !parsed.taskContract.taskId) {
    throw new Error("Runner contract is missing required run scope");
  }
  return parsed;
}

export function validateRunnerContractForRepo(input: {
  repoRoot: string;
  contract: RunnerContract;
  nonce: string;
  requireActive?: boolean;
}): void {
  if (input.nonce !== input.contract.nonce) {
    throw new Error("Runner contract nonce mismatch");
  }
  const run = getOrCreateRunForRepo(input.repoRoot);
  const task = run.tasks.find((entry) => entry.taskId === input.contract.taskContract.taskId);
  const runAttempt = run.runs.find((entry) => entry.runId === input.contract.taskContract.runId);
  if (!task || !runAttempt) {
    throw new Error("Runner contract references missing task or run");
  }
  if (runAttempt.taskId !== task.taskId || runAttempt.taskRevision !== input.contract.taskContract.taskRevision) {
    throw new Error("Runner contract is stale for the current task/run revision");
  }
  if (input.requireActive && (task.activeRunId !== runAttempt.runId || isTerminalRunStatus(runAttempt.status))) {
    throw new Error(`Run ${runAttempt.runId} is not active for runner contract`);
  }
}

function createScopedRunnerCallbacks(contract: RunnerContract, nonce: string) {
  const repoRoot = contract.repoRoot;
  const assertIdentity = () => validateRunnerContractForRepo({ repoRoot, contract, nonce });
  const assertActiveIdentity = () => validateRunnerContractForRepo({ repoRoot, contract, nonce, requireActive: true });

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

export async function runRunnerFromContract(input: {
  contractPath: string;
  nonce: string;
  signal?: AbortSignal;
  runWorker?: RuntimeRunner;
}): Promise<RuntimeRunResult> {
  const contract = readRunnerContract(input.contractPath);
  validateRunnerContractForRepo({ repoRoot: contract.repoRoot, contract, nonce: input.nonce, requireActive: true });
  const callbacks = createScopedRunnerCallbacks(contract, input.nonce);
  const runWorker = input.runWorker ?? defaultRuntimeRunner;
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

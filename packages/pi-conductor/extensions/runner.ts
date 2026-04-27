import { readFileSync, rmSync } from "node:fs";
import { createGateForRepo } from "./gate-service.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { withStateLockRetry } from "./repo-run-retry.js";
import { isTerminalRunStatus } from "./run-status.js";
import {
  createRunnerContract,
  RUNNER_CONTRACT_SCHEMA_VERSION,
  type RunnerContract,
  readRunnerContract,
  validateRunnerContractForRepo,
  writeRunnerContract,
} from "./runner-contract.js";
import { releaseTerminalTmuxWorkerForRepo } from "./runtime-worker-release.js";
import { recordRunHeartbeat } from "./storage.js";
import { createFollowUpTaskForRepo, recordTaskCompletionForRepo, recordTaskProgressForRepo } from "./task-service.js";
import type {
  ConductorCompletionReportInput,
  ConductorFollowUpTaskInput,
  ConductorGateReportInput,
  ConductorProgressReportInput,
  RuntimeRunContext,
  RuntimeRunResult,
} from "./types.js";

export type { RunnerContract };
export {
  createRunnerContract,
  RUNNER_CONTRACT_SCHEMA_VERSION,
  readRunnerContract,
  validateRunnerContractForRepo,
  writeRunnerContract,
};

type RuntimeRunner = (input: RuntimeRunContext) => Promise<RuntimeRunResult>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createScopedRunnerCallbacks(contract: RunnerContract, nonce: string, contractPath: string) {
  const repoRoot = contract.repoRoot;
  const assertIdentity = () => validateRunnerContractForRepo({ repoRoot, contract, nonce, contractPath });
  const assertActiveIdentity = () =>
    validateRunnerContractForRepo({ repoRoot, contract, nonce, contractPath, requireActive: true });
  const assertScopedInput = (input: { runId: string; taskId: string }) => {
    if (input.runId !== contract.taskContract.runId || input.taskId !== contract.taskContract.taskId) {
      throw new Error("Runner contract scope mismatch");
    }
  };

  return {
    async onConductorProgress(input: ConductorProgressReportInput) {
      await withStateLockRetry(() => {
        assertIdentity();
        assertScopedInput(input);
        recordTaskProgressForRepo(repoRoot, input);
      });
    },
    async onConductorComplete(input: ConductorCompletionReportInput) {
      await withStateLockRetry(() => {
        assertIdentity();
        assertScopedInput(input);
        recordTaskCompletionForRepo(repoRoot, input);
      });
    },
    async onConductorGate(input: ConductorGateReportInput) {
      await withStateLockRetry(() => {
        assertActiveIdentity();
        assertScopedInput(input);
        createGateForRepo(repoRoot, {
          type: input.type,
          resourceRefs: { taskId: input.taskId, runId: input.runId },
          requestedDecision: input.requestedDecision,
          requireActiveRun: true,
        });
      });
    },
    async onConductorFollowUpTask(input: ConductorFollowUpTaskInput) {
      await withStateLockRetry(() => {
        assertActiveIdentity();
        assertScopedInput(input);
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
  if (!runAttempt) {
    return;
  }
  if (runAttempt.finishedAt || isTerminalRunStatus(runAttempt.status)) {
    if (runAttempt.runtime.mode === "tmux") {
      releaseTerminalTmuxWorkerForRepo({
        repoRoot: input.repoRoot,
        runId: input.contract.taskContract.runId,
        diagnostic: "tmux runner exited after terminal conductor state",
      });
    }
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
  releaseTerminalTmuxWorkerForRepo({
    repoRoot: input.repoRoot,
    runId: input.contract.taskContract.runId,
    diagnostic: "tmux runner exited after fallback completion",
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
    ).catch((error) => {
      console.error(`pi-conductor runner heartbeat failed for ${input.runId}: ${errorMessage(error)}`);
    });
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
    await withStateLockRetry(() => finalizeRunnerExitForRepo({ repoRoot: contract.repoRoot, contract, result }));
    return result;
  } catch (error) {
    await withStateLockRetry(() =>
      finalizeRunnerExitForRepo({
        repoRoot: contract.repoRoot,
        contract,
        result: { status: "error", finalText: null, errorMessage: errorMessage(error), sessionId: null },
      }),
    );
    throw error;
  } finally {
    stopHeartbeat();
  }
}

export function parseRunnerArgs(args: string[]): { contractPath: string; nonce: string } {
  const normalized = args[0] === "run" ? args.slice(1) : args;
  let contractPath: string | null = null;
  let nonce: string | null = null;
  let nonceFile: string | null = null;
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--contract") {
      contractPath = normalized[index + 1] ?? null;
      index += 1;
    } else if (arg === "--nonce") {
      nonce = normalized[index + 1] ?? null;
      index += 1;
    } else if (arg === "--nonce-file") {
      nonceFile = normalized[index + 1] ?? null;
      index += 1;
    }
  }
  if (!nonce && nonceFile) {
    nonce = readFileSync(nonceFile, "utf-8").trim();
    rmSync(nonceFile, { force: true });
  }
  if (!contractPath || !nonce) {
    throw new Error("Usage: pi-conductor-runner run --contract <path> (--nonce <nonce> | --nonce-file <path>)");
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

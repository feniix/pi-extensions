import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deriveProjectKey } from "./project-key.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { createRunnerContract, writeRunnerContract } from "./runner.js";
import { getConductorProjectDir } from "./storage.js";
import type {
  RunAttemptRecord,
  RunRecord,
  RunRuntimeMetadata,
  RunRuntimeMode,
  RuntimeRunContext,
  RuntimeRunPreflightContext,
  RuntimeRunResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface TmuxCommandAdapter {
  execFile(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }>;
}

export interface TmuxRuntimeOptions {
  mode?: Extract<RunRuntimeMode, "tmux" | "iterm-tmux">;
  commandAdapter?: TmuxCommandAdapter;
  runnerCommand?: string[];
  waitForCompletion?: boolean;
  pollIntervalMs?: number;
  now?: () => string;
  randomHex?: (bytes: number) => string;
}

type TmuxRuntimePaths = {
  runtimeDir: string;
  contractPath: string;
  logPath: string;
  socketPath: string;
};

const defaultCommandAdapter: TmuxCommandAdapter = {
  async execFile(command, args, options) {
    const result = await execFileAsync(command, args, { cwd: options?.cwd, env: options?.env });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function defaultRandomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function buildRunnerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowedKeys = ["PATH", "HOME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "PI_CONDUCTOR_HOME"];
  return Object.fromEntries(
    allowedKeys.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])),
  ) as NodeJS.ProcessEnv;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function isTerminalRunStatus(status: RunAttemptRecord["status"]): boolean {
  return ["succeeded", "partial", "blocked", "failed", "aborted", "stale", "interrupted", "unknown_dispatch"].includes(
    status,
  );
}

function mapTerminalRunToRuntimeResult(run: RunAttemptRecord): RuntimeRunResult {
  if (run.status === "aborted" || run.status === "interrupted") {
    return {
      status: "aborted",
      finalText: run.completionSummary,
      errorMessage: run.errorMessage,
      sessionId: run.sessionId,
    };
  }
  if (["succeeded", "partial", "blocked"].includes(run.status)) {
    return {
      status: "success",
      finalText: run.completionSummary,
      errorMessage: run.errorMessage,
      sessionId: run.sessionId,
    };
  }
  return {
    status: "error",
    finalText: run.completionSummary,
    errorMessage: run.errorMessage,
    sessionId: run.sessionId,
  };
}

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolveRunnerCommand(): string[] | null {
  const runnerCli = fileURLToPath(new URL("./runner-cli.mjs", import.meta.url));
  if (!existsSync(runnerCli)) {
    return null;
  }
  return [process.execPath, runnerCli, "run"];
}

export function inspectTmuxRuntimeAvailability(input: { runnerCommand?: string[] } = {}): {
  available: boolean;
  diagnostic: string | null;
} {
  const runnerCommand = input.runnerCommand ?? resolveRunnerCommand();
  if (!runnerCommand) {
    return { available: false, diagnostic: "pi-conductor-runner is not resolvable from pi-conductor" };
  }
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
  } catch {
    return { available: false, diagnostic: "tmux executable is not available on PATH" };
  }
  return { available: true, diagnostic: null };
}

export function buildTmuxSessionName(input: { projectKey: string; runId: string; nonce: string }): string {
  const safeProject = input.projectKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  const safeRun = input.runId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  return `pi-cond-${safeProject}-${safeRun}-${input.nonce.slice(0, 8)}`.slice(0, 100);
}

export function createTmuxRuntimePaths(input: { repoRoot: string; runId: string }): TmuxRuntimePaths {
  const projectKey = deriveProjectKey(resolve(input.repoRoot));
  const runtimeDir = join(getConductorProjectDir(projectKey), "runtime", input.runId);
  return {
    runtimeDir,
    contractPath: join(runtimeDir, "contract.json"),
    logPath: join(runtimeDir, "runner.log"),
    socketPath: join(runtimeDir, "tmux.sock"),
  };
}

export function buildTmuxLaunch(input: {
  tmuxSocketPath: string;
  sessionName: string;
  worktreePath: string;
  runnerCommand: string[];
  contractPath: string;
  nonce: string;
  logPath: string;
}): { args: string[]; command: string; attachCommand: string } {
  const runnerArgv = [...input.runnerCommand, "--contract", input.contractPath, "--nonce", input.nonce];
  const command = `${runnerArgv.map(shellQuote).join(" ")} >> ${shellQuote(input.logPath)} 2>&1`;
  return {
    args: [
      "-S",
      input.tmuxSocketPath,
      "new-session",
      "-d",
      "-s",
      input.sessionName,
      "-n",
      "pi-conductor",
      "-c",
      input.worktreePath,
      command,
    ],
    command,
    attachCommand: `tmux -S ${shellQuote(input.tmuxSocketPath)} attach-session -r -t ${shellQuote(input.sessionName)}`,
  };
}

async function inspectProcessGroupId(input: {
  adapter: TmuxCommandAdapter;
  runnerPid: number | null;
}): Promise<number | null> {
  if (input.runnerPid === null) {
    return null;
  }
  try {
    const result = await input.adapter.execFile("ps", ["-p", String(input.runnerPid), "-o", "pgid="]);
    const pgid = result.stdout.trim();
    return /^\d+$/.test(pgid) ? Number(pgid) : null;
  } catch {
    return null;
  }
}

async function inspectTmuxPaneMetadata(input: {
  adapter: TmuxCommandAdapter;
  socketPath: string;
  sessionName: string;
}): Promise<{
  windowId: string | null;
  paneId: string | null;
  runnerPid: number | null;
  processGroupId: number | null;
  diagnostic: string | null;
}> {
  try {
    const result = await input.adapter.execFile("tmux", [
      "-S",
      input.socketPath,
      "display-message",
      "-p",
      "-t",
      input.sessionName,
      "#{window_id} #{pane_id} #{pane_pid}",
    ]);
    const [windowId, paneId, panePid] = result.stdout.trim().split(/\s+/);
    const runnerPid = panePid && /^\d+$/.test(panePid) ? Number(panePid) : null;
    const processGroupId = await inspectProcessGroupId({ adapter: input.adapter, runnerPid });
    return { windowId: windowId || null, paneId: paneId || null, runnerPid, processGroupId, diagnostic: null };
  } catch (error) {
    return {
      windowId: null,
      paneId: null,
      runnerPid: null,
      processGroupId: null,
      diagnostic: `tmux pane metadata unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function waitForTerminalRun(input: {
  repoRoot: string;
  runId: string;
  signal?: AbortSignal;
  pollIntervalMs: number;
}): Promise<RuntimeRunResult> {
  while (!input.signal?.aborted) {
    const run = getOrCreateRunForRepo(input.repoRoot);
    const attempt = run.runs.find((entry) => entry.runId === input.runId);
    if (!attempt) {
      return { status: "error", finalText: null, errorMessage: `Run ${input.runId} disappeared`, sessionId: null };
    }
    if (attempt.finishedAt || isTerminalRunStatus(attempt.status)) {
      return mapTerminalRunToRuntimeResult(attempt);
    }
    await sleep(input.pollIntervalMs);
  }
  return { status: "aborted", finalText: null, errorMessage: null, sessionId: null };
}

export async function cancelTmuxRuntime(input: {
  adapter?: TmuxCommandAdapter;
  runtime: RunRuntimeMetadata;
}): Promise<{ cleanupStatus: "succeeded" | "failed"; diagnostic: string | null }> {
  const tmux = input.runtime.tmux;
  if (!tmux?.socketPath || !tmux.sessionName) {
    return { cleanupStatus: "succeeded", diagnostic: "tmux metadata was not present" };
  }
  try {
    const adapter = input.adapter ?? defaultCommandAdapter;
    if (input.runtime.command) {
      const currentPaneCommand = await inspectPaneCurrentCommand({
        adapter,
        socketPath: tmux.socketPath,
        paneTarget: tmux.paneId ?? tmux.sessionName,
      });
      if (currentPaneCommand && !input.runtime.command.includes(currentPaneCommand)) {
        return {
          cleanupStatus: "failed",
          diagnostic: `tmux pane command verification failed before cancel: ${currentPaneCommand}`,
        };
      }
    }
    await adapter.execFile("tmux", ["-S", tmux.socketPath, "kill-session", "-t", tmux.sessionName]);
    return { cleanupStatus: "succeeded", diagnostic: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/can't find session|no server running|not found/i.test(message)) {
      return { cleanupStatus: "succeeded", diagnostic: message };
    }
    return { cleanupStatus: "failed", diagnostic: message };
  }
}

async function isRunnerPidAlive(input: { adapter: TmuxCommandAdapter; runnerPid: number | null }): Promise<boolean> {
  if (input.runnerPid === null) {
    return false;
  }
  try {
    await input.adapter.execFile("ps", ["-p", String(input.runnerPid), "-o", "pid="]);
    return true;
  } catch {
    return false;
  }
}

async function inspectPaneCurrentCommand(input: {
  adapter: TmuxCommandAdapter;
  socketPath: string;
  paneTarget: string;
}): Promise<string | null> {
  try {
    const result = await input.adapter.execFile("tmux", [
      "-S",
      input.socketPath,
      "display-message",
      "-p",
      "-t",
      input.paneTarget,
      "#{pane_current_command}",
    ]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function markTmuxRunStale(input: {
  repoRoot: string;
  attempt: RunAttemptRecord;
  now: string;
  diagnostic: string;
}): RunRecord {
  return mutateRepoRunSync(input.repoRoot, (latest) => ({
    ...latest,
    tasks: latest.tasks.map((task) =>
      task.taskId === input.attempt.taskId && task.activeRunId === input.attempt.runId
        ? { ...task, state: "needs_review" as const, activeRunId: null, updatedAt: input.now }
        : task,
    ),
    workers: latest.workers.map((worker) =>
      worker.workerId === input.attempt.workerId
        ? { ...worker, lifecycle: "idle" as const, updatedAt: input.now }
        : worker,
    ),
    runs: latest.runs.map((entry) =>
      entry.runId === input.attempt.runId
        ? {
            ...entry,
            status: "stale" as const,
            runtime: {
              ...entry.runtime,
              status: "exited_error" as const,
              diagnostics: [...entry.runtime.diagnostics, input.diagnostic],
              finishedAt: input.now,
              cleanupStatus: entry.runtime.cleanupStatus === "pending" ? "failed" : entry.runtime.cleanupStatus,
            },
            finishedAt: input.now,
            leaseExpiresAt: null,
            errorMessage: input.diagnostic,
          }
        : entry,
    ),
    updatedAt: input.now,
  }));
}

function heartbeatIsStale(input: { heartbeatAt: string | null; now: string; staleHeartbeatMs?: number }): boolean {
  if (!input.heartbeatAt || input.staleHeartbeatMs === undefined) {
    return false;
  }
  return Date.parse(input.now) - Date.parse(input.heartbeatAt) > input.staleHeartbeatMs;
}

export async function reconcileTmuxRuntimeForRepo(input: {
  repoRoot: string;
  runId: string;
  adapter?: TmuxCommandAdapter;
  now?: string;
  staleHeartbeatMs?: number;
}): Promise<RunRecord> {
  const adapter = input.adapter ?? defaultCommandAdapter;
  const run = getOrCreateRunForRepo(input.repoRoot);
  const attempt = run.runs.find((entry) => entry.runId === input.runId);
  if (!attempt || attempt.finishedAt || isTerminalRunStatus(attempt.status) || !attempt.runtime.tmux?.socketPath) {
    return run;
  }
  try {
    await adapter.execFile("tmux", [
      "-S",
      attempt.runtime.tmux.socketPath,
      "has-session",
      "-t",
      attempt.runtime.tmux.sessionName ?? "",
    ]);
    const now = input.now ?? new Date().toISOString();
    const currentPaneCommand = await inspectPaneCurrentCommand({
      adapter,
      socketPath: attempt.runtime.tmux.socketPath,
      paneTarget: attempt.runtime.tmux.paneId ?? attempt.runtime.tmux.sessionName ?? "",
    });
    if (currentPaneCommand && attempt.runtime.command && !attempt.runtime.command.includes(currentPaneCommand)) {
      return markTmuxRunStale({
        repoRoot: input.repoRoot,
        attempt,
        now,
        diagnostic: `tmux pane command changed from runner command to ${currentPaneCommand}`,
      });
    }
    if (attempt.runtime.logPath && !existsSync(attempt.runtime.logPath)) {
      const diagnostic = `tmux log path missing during reconciliation: ${attempt.runtime.logPath}`;
      return mutateRepoRunSync(input.repoRoot, (latest) => ({
        ...latest,
        runs: latest.runs.map((entry) =>
          entry.runId === attempt.runId
            ? {
                ...entry,
                runtime: { ...entry.runtime, diagnostics: [...entry.runtime.diagnostics, diagnostic] },
                updatedAt: now,
              }
            : entry,
        ),
        updatedAt: now,
      }));
    }
    if (heartbeatIsStale({ heartbeatAt: attempt.runtime.heartbeatAt, now, staleHeartbeatMs: input.staleHeartbeatMs })) {
      const runnerAlive = await isRunnerPidAlive({ adapter, runnerPid: attempt.runtime.runnerPid });
      if (runnerAlive) {
        const diagnostic = `tmux runner heartbeat stale but runner pid ${attempt.runtime.runnerPid} is still alive`;
        return mutateRepoRunSync(input.repoRoot, (latest) => ({
          ...latest,
          runs: latest.runs.map((entry) =>
            entry.runId === attempt.runId
              ? {
                  ...entry,
                  runtime: { ...entry.runtime, diagnostics: [...entry.runtime.diagnostics, diagnostic] },
                  updatedAt: now,
                }
              : entry,
          ),
          updatedAt: now,
        }));
      }
      const diagnostic = `tmux runner heartbeat stale and runner pid ${attempt.runtime.runnerPid ?? "unknown"} is not alive`;
      return markTmuxRunStale({ repoRoot: input.repoRoot, attempt, now, diagnostic });
    }
    return run;
  } catch (error) {
    const now = input.now ?? new Date().toISOString();
    const diagnostic = `tmux session missing during reconciliation: ${error instanceof Error ? error.message : String(error)}`;
    return mutateRepoRunSync(input.repoRoot, (latest) => ({
      ...latest,
      tasks: latest.tasks.map((task) =>
        task.taskId === attempt.taskId && task.activeRunId === attempt.runId
          ? { ...task, state: "needs_review" as const, activeRunId: null, updatedAt: now }
          : task,
      ),
      workers: latest.workers.map((worker) =>
        worker.workerId === attempt.workerId ? { ...worker, lifecycle: "idle" as const, updatedAt: now } : worker,
      ),
      runs: latest.runs.map((entry) =>
        entry.runId === attempt.runId
          ? {
              ...entry,
              status: "stale" as const,
              runtime: {
                ...entry.runtime,
                status: "exited_error" as const,
                diagnostics: [...entry.runtime.diagnostics, diagnostic],
                finishedAt: now,
                cleanupStatus: entry.runtime.cleanupStatus === "pending" ? "failed" : entry.runtime.cleanupStatus,
              },
              finishedAt: now,
              leaseExpiresAt: null,
              errorMessage: diagnostic,
            }
          : entry,
      ),
      updatedAt: now,
    }));
  }
}

export function createTmuxWorkerRunRuntimeBackend(options: TmuxRuntimeOptions = {}) {
  const mode = options.mode ?? "tmux";
  const adapter = options.commandAdapter ?? defaultCommandAdapter;
  const waitForCompletion = options.waitForCompletion ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const now = options.now ?? (() => new Date().toISOString());
  const randomHex = options.randomHex ?? defaultRandomHex;

  return {
    mode,
    async preflight(input: RuntimeRunPreflightContext): Promise<void> {
      if (!input.worktreePath || !existsSync(input.worktreePath)) {
        throw new Error("Worker worktree is not available for a tmux run");
      }
      if (!input.sessionFile || !existsSync(input.sessionFile)) {
        throw new Error("Worker session file is not available for a tmux run");
      }
      const runnerCommand = options.runnerCommand ?? resolveRunnerCommand();
      if (!runnerCommand) {
        throw new Error("pi-conductor-runner is not resolvable from pi-conductor");
      }
      await adapter.execFile("tmux", ["-V"]);
    },
    async run(input: RuntimeRunContext): Promise<RuntimeRunResult> {
      if (!input.repoRoot) {
        throw new Error("tmux runtime requires the conductor repo root");
      }
      if (!input.taskContract) {
        throw new Error("tmux runtime requires a scoped task contract");
      }
      const runnerCommand = options.runnerCommand ?? resolveRunnerCommand();
      if (!runnerCommand) {
        throw new Error("pi-conductor-runner is not resolvable from pi-conductor");
      }
      const nonce = randomHex(16);
      const paths = createTmuxRuntimePaths({ repoRoot: input.repoRoot, runId: input.taskContract.runId });
      mkdirSync(paths.runtimeDir, { recursive: true, mode: 0o700 });
      const contract = createRunnerContract({
        repoRoot: input.repoRoot,
        worktreePath: input.worktreePath,
        sessionFile: input.sessionFile,
        taskContract: input.taskContract,
        nonce,
        createdAt: now(),
      });
      writeRunnerContract(paths.contractPath, contract);
      writeFileSync(paths.logPath, "", { encoding: "utf-8", flag: "a", mode: 0o600 });
      const projectKey = deriveProjectKey(resolve(input.repoRoot));
      const sessionName = buildTmuxSessionName({ projectKey, runId: input.taskContract.runId, nonce });
      const launch = buildTmuxLaunch({
        tmuxSocketPath: paths.socketPath,
        sessionName,
        worktreePath: input.worktreePath,
        runnerCommand,
        contractPath: paths.contractPath,
        nonce,
        logPath: paths.logPath,
      });
      await adapter.execFile("tmux", launch.args, { cwd: input.worktreePath, env: buildRunnerEnvironment() });
      const paneMetadata = await inspectTmuxPaneMetadata({ adapter, socketPath: paths.socketPath, sessionName });
      await input.onRuntimeMetadata?.({
        mode,
        status: "running",
        cwd: input.worktreePath,
        command: launch.command,
        runnerPid: paneMetadata.runnerPid,
        processGroupId: paneMetadata.processGroupId,
        tmux: {
          socketPath: paths.socketPath,
          sessionName,
          windowId: paneMetadata.windowId,
          paneId: paneMetadata.paneId,
        },
        logPath: paths.logPath,
        viewerCommand: launch.attachCommand,
        viewerStatus: "pending",
        cleanupStatus: "pending",
        diagnostics: [
          `tmux session ${sessionName} launched`,
          ...(paneMetadata.diagnostic ? [paneMetadata.diagnostic] : []),
        ],
        heartbeatAt: now(),
      });

      const onAbort = () => {
        void (async () => {
          const cleanup = await cancelTmuxRuntime({
            adapter,
            runtime: {
              mode,
              status: "aborted",
              sessionId: null,
              cwd: input.worktreePath,
              command: launch.command,
              runnerPid: null,
              processGroupId: null,
              tmux: { socketPath: paths.socketPath, sessionName, windowId: null, paneId: null },
              logPath: paths.logPath,
              viewerCommand: launch.attachCommand,
              viewerStatus: "pending",
              diagnostics: [],
              heartbeatAt: null,
              cleanupStatus: "pending",
              startedAt: null,
              finishedAt: null,
            },
          });
          await input.onRuntimeMetadata?.({
            status: "aborted",
            cleanupStatus: cleanup.cleanupStatus,
            finishedAt: now(),
            diagnostics: cleanup.diagnostic ? [cleanup.diagnostic] : [`tmux session ${sessionName} cleanup succeeded`],
          });
        })();
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (!waitForCompletion) {
          return { status: "success", finalText: "tmux runtime launched", errorMessage: null, sessionId: sessionName };
        }
        return await waitForTerminalRun({
          repoRoot: input.repoRoot,
          runId: input.taskContract.runId,
          signal: input.signal,
          pollIntervalMs,
        });
      } finally {
        input.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

import { execFile, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type ItermViewerCommandAdapter, openItermTmuxViewer } from "./iterm-viewer.js";
import { deriveProjectKey } from "./project-key.js";
import { getOrCreateRunForRepo, mutateRepoRunSync } from "./repo-run.js";
import { isTerminalRunStatus, isTmuxRuntimeMode } from "./run-status.js";
import { createRunnerContract, hashRunnerNonce, writeRunnerContract } from "./runner-contract.js";
import { markRunAttemptStale } from "./runtime-stale.js";
import { releaseTerminalTmuxWorkerForRepo } from "./runtime-worker-release.js";
import { getConductorProjectDir } from "./storage.js";
import { applyTmuxReconciliationState } from "./tmux-reconcile-policy.js";
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
const TMUX_COMMAND_TIMEOUT_MS = 10_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTmuxMissingSessionMessage(message: string): boolean {
  return /can't find session|no server running|not found/i.test(message);
}

function errorWithCleanupStatus(
  error: unknown,
  cleanupStatus: "succeeded" | "failed",
): Error & { cleanupStatus: "succeeded" | "failed" } {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  return Object.assign(wrapped, { cleanupStatus });
}

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
  runnerHeartbeatIntervalMs?: number;
  now?: () => string;
  randomHex?: (bytes: number) => string;
  itermViewerAdapter?: ItermViewerCommandAdapter;
  itermPlatform?: NodeJS.Platform | string;
}

type TmuxRuntimePaths = {
  runtimeDir: string;
  contractPath: string;
  noncePath: string;
  logPath: string;
  socketPath: string;
};

const defaultCommandAdapter: TmuxCommandAdapter = {
  async execFile(command, args, options) {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      timeout: TMUX_COMMAND_TIMEOUT_MS,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function defaultRandomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function buildRunnerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const defaultAllowedKeys = [
    "PATH",
    "HOME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PI_CONDUCTOR_HOME",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "GIT_SSH_COMMAND",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ];
  const configuredAllowedKeys = (env.PI_CONDUCTOR_RUNNER_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => /^[A-Z_][A-Z0-9_]*$/.test(key));
  const allowedKeys = [...new Set([...defaultAllowedKeys, ...configuredAllowedKeys])];
  return Object.fromEntries(
    allowedKeys.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])),
  ) as NodeJS.ProcessEnv;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
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

function durableRunIsActive(input: { repoRoot: string; runId: string }): boolean {
  const latest = getOrCreateRunForRepo(input.repoRoot).runs.find((entry) => entry.runId === input.runId);
  return Boolean(latest && !latest.finishedAt && !isTerminalRunStatus(latest.status));
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
    execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: TMUX_COMMAND_TIMEOUT_MS });
  } catch {
    return { available: false, diagnostic: "tmux executable is not available on PATH" };
  }
  return { available: true, diagnostic: null };
}

export function buildTmuxSessionName(input: { projectKey: string; runId: string; nonce: string }): string {
  const safeProject = input.projectKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  const safeRun = input.runId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32);
  const nonceHashSuffix = createHash("sha256").update(input.nonce).digest("hex").slice(0, 8);
  return `pi-cond-${safeProject}-${safeRun}-${nonceHashSuffix}`.slice(0, 100);
}

export function createTmuxRuntimePaths(input: { repoRoot: string; runId: string }): TmuxRuntimePaths {
  const projectKey = deriveProjectKey(resolve(input.repoRoot));
  const runtimeDir = join(getConductorProjectDir(projectKey), "runtime", input.runId);
  return {
    runtimeDir,
    contractPath: join(runtimeDir, "contract.json"),
    noncePath: join(runtimeDir, "nonce"),
    logPath: join(runtimeDir, "runner.log"),
    socketPath: join(runtimeDir, "tmux.sock"),
  };
}

function redactTmuxRunnerCommand(command: string, nonce: string): string {
  return command.replace(shellQuote(nonce), "<redacted>");
}

export function buildTmuxLaunch(input: {
  tmuxSocketPath: string;
  sessionName: string;
  worktreePath: string;
  runnerCommand: string[];
  contractPath: string;
  noncePath: string;
  logPath: string;
}): { args: string[]; command: string; attachCommand: string } {
  const runnerArgv = [...input.runnerCommand, "--contract", input.contractPath, "--nonce-file", input.noncePath];
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
  adapter?: TmuxCommandAdapter;
  staleHeartbeatMs?: number;
  onAbort?: () => Promise<void>;
}): Promise<RuntimeRunResult> {
  while (!input.signal?.aborted) {
    const run = getOrCreateRunForRepo(input.repoRoot);
    const attempt = run.runs.find((entry) => entry.runId === input.runId);
    if (!attempt) {
      return { status: "error", finalText: null, errorMessage: `Run ${input.runId} disappeared`, sessionId: null };
    }
    if (attempt.finishedAt || isTerminalRunStatus(attempt.status)) {
      if (isTmuxRuntimeMode(attempt.runtime.mode) && input.adapter && attempt.runtime.cleanupStatus === "pending") {
        const cleanup = await cancelTmuxRuntime({ adapter: input.adapter, runtime: attempt.runtime });
        releaseTerminalTmuxWorkerForRepo({
          repoRoot: input.repoRoot,
          runId: input.runId,
          diagnostic: cleanup.diagnostic ?? "tmux terminal run cleanup completed",
          cleanupStatus: cleanup.cleanupStatus,
          workerLifecycle: cleanup.cleanupStatus === "succeeded" ? "idle" : "broken",
          workerRecoverable: cleanup.cleanupStatus !== "succeeded",
        });
      }
      return mapTerminalRunToRuntimeResult(
        getOrCreateRunForRepo(input.repoRoot).runs.find((entry) => entry.runId === input.runId) ?? attempt,
      );
    }
    if (isTmuxRuntimeMode(attempt.runtime.mode) && input.adapter) {
      const reconciled = await reconcileTmuxRuntimeForRepo({
        repoRoot: input.repoRoot,
        runId: input.runId,
        adapter: input.adapter,
        staleHeartbeatMs: input.staleHeartbeatMs,
      });
      const reconciledAttempt = reconciled.runs.find((entry) => entry.runId === input.runId);
      if (reconciledAttempt && (reconciledAttempt.finishedAt || isTerminalRunStatus(reconciledAttempt.status))) {
        return mapTerminalRunToRuntimeResult(reconciledAttempt);
      }
    }
    await sleep(input.pollIntervalMs);
  }
  await input.onAbort?.();
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
      let currentPaneCommand: string | null = null;
      try {
        const result = await adapter.execFile("tmux", [
          "-S",
          tmux.socketPath,
          "display-message",
          "-p",
          "-t",
          tmux.paneId ?? tmux.sessionName,
          "#{pane_current_command}",
        ]);
        currentPaneCommand = result.stdout.trim() || null;
      } catch (error) {
        const message = errorMessage(error);
        if (isTmuxMissingSessionMessage(message)) {
          return { cleanupStatus: "succeeded", diagnostic: message };
        }
        return {
          cleanupStatus: "failed",
          diagnostic: `tmux pane command verification failed before cancel: ${message}`,
        };
      }
      if (currentPaneCommand && !input.runtime.command.includes(currentPaneCommand)) {
        return {
          cleanupStatus: "failed",
          diagnostic: `tmux pane command verification differed before cancel: ${currentPaneCommand}`,
        };
      }
    }
    await adapter.execFile("tmux", ["-S", tmux.socketPath, "kill-session", "-t", tmux.sessionName]);
    return { cleanupStatus: "succeeded", diagnostic: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTmuxMissingSessionMessage(message)) {
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
  return mutateRepoRunSync(input.repoRoot, (latest) => {
    const latestAttempt = latest.runs.find((entry) => entry.runId === input.attempt.runId);
    const latestTask = latest.tasks.find((entry) => entry.taskId === input.attempt.taskId);
    if (
      !latestAttempt ||
      latestAttempt.finishedAt ||
      isTerminalRunStatus(latestAttempt.status) ||
      latestTask?.activeRunId !== latestAttempt.runId ||
      latestAttempt.runtime.heartbeatAt !== input.attempt.runtime.heartbeatAt
    ) {
      return latest;
    }
    return markRunAttemptStale({ run: latest, attempt: latestAttempt, now: input.now, diagnostic: input.diagnostic });
  });
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
    const runnerAlive =
      input.staleHeartbeatMs === undefined
        ? false
        : await isRunnerPidAlive({ adapter, runnerPid: attempt.runtime.runnerPid });
    const reconciled = applyTmuxReconciliationState({
      run,
      attempt,
      now,
      staleHeartbeatMs: input.staleHeartbeatMs ?? Number.POSITIVE_INFINITY,
      runnerAlive,
      currentPaneCommand,
      paneChangedDiagnostic: (command) => `tmux pane command changed from runner command to ${command}`,
    });
    if (reconciled.action === "stale") {
      const persisted = markTmuxRunStale({
        repoRoot: input.repoRoot,
        attempt,
        now,
        diagnostic: reconciled.diagnostic ?? "tmux runtime reconciled stale",
      });
      const persistedAttempt = persisted.runs.find((entry) => entry.runId === attempt.runId);
      if (persistedAttempt?.status !== "stale") return persisted;
      const cleanup = await cancelTmuxRuntime({ adapter, runtime: persistedAttempt.runtime });
      return mutateRepoRunSync(input.repoRoot, (latest) => ({
        ...latest,
        runs: latest.runs.map((entry) =>
          entry.runId === attempt.runId
            ? {
                ...entry,
                runtime: {
                  ...entry.runtime,
                  cleanupStatus: cleanup.cleanupStatus,
                  diagnostics: cleanup.diagnostic
                    ? [...entry.runtime.diagnostics, cleanup.diagnostic]
                    : entry.runtime.diagnostics,
                },
              }
            : entry,
        ),
      }));
    }
    if (reconciled.action === "diagnostic") {
      return mutateRepoRunSync(input.repoRoot, () => reconciled.run);
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
    if (reconciled.action === "lease_cleared") {
      return mutateRepoRunSync(input.repoRoot, () => reconciled.run);
    }
    return run;
  } catch (error) {
    const now = input.now ?? new Date().toISOString();
    const diagnostic = `tmux session missing during reconciliation: ${error instanceof Error ? error.message : String(error)}`;
    return markTmuxRunStale({ repoRoot: input.repoRoot, attempt, now, diagnostic });
  }
}

export function createTmuxWorkerRunRuntimeBackend(options: TmuxRuntimeOptions = {}) {
  const mode = options.mode ?? "tmux";
  const adapter = options.commandAdapter ?? defaultCommandAdapter;
  const waitForCompletion = options.waitForCompletion ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const now = options.now ?? (() => new Date().toISOString());
  const runnerHeartbeatIntervalMs = options.runnerHeartbeatIntervalMs ?? 30_000;
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
      if (input.signal?.aborted) {
        return { status: "aborted", finalText: null, errorMessage: null, sessionId: null };
      }
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
        heartbeatIntervalMs: runnerHeartbeatIntervalMs,
      });
      writeRunnerContract(paths.contractPath, contract);
      writeFileSync(paths.noncePath, `${nonce}\n`, { encoding: "utf-8", mode: 0o600 });
      writeFileSync(paths.logPath, "", { encoding: "utf-8", flag: "a", mode: 0o600 });
      const projectKey = deriveProjectKey(resolve(input.repoRoot));
      const sessionName = buildTmuxSessionName({ projectKey, runId: input.taskContract.runId, nonce });
      const launch = buildTmuxLaunch({
        tmuxSocketPath: paths.socketPath,
        sessionName,
        worktreePath: input.worktreePath,
        runnerCommand,
        contractPath: paths.contractPath,
        noncePath: paths.noncePath,
        logPath: paths.logPath,
      });
      const redactedCommand = redactTmuxRunnerCommand(launch.command, nonce);
      const baseRuntime = {
        mode,
        cwd: input.worktreePath,
        command: redactedCommand,
        contractPath: paths.contractPath,
        nonceHash: hashRunnerNonce(nonce),
        tmux: { socketPath: paths.socketPath, sessionName, windowId: null, paneId: null },
        logPath: paths.logPath,
        viewerCommand: launch.attachCommand,
        viewerStatus: "pending" as const,
        cleanupStatus: "pending" as const,
      };
      const buildCancellationRuntime = (): RunRuntimeMetadata => ({
        ...baseRuntime,
        status: "aborted",
        sessionId: null,
        runnerPid: null,
        processGroupId: null,
        diagnostics: [],
        heartbeatAt: null,
        startedAt: null,
        finishedAt: null,
      });
      await input.onRuntimeMetadata?.({
        ...baseRuntime,
        status: "starting",
        diagnostics: [`tmux session ${sessionName} prepared`],
        heartbeatAt: now(),
      });
      if (input.signal?.aborted) {
        return { status: "aborted", finalText: null, errorMessage: null, sessionId: null };
      }
      const latestBeforeLaunch = getOrCreateRunForRepo(input.repoRoot).runs.find(
        (entry) => entry.runId === input.taskContract?.runId,
      );
      if (latestBeforeLaunch?.finishedAt || isTerminalRunStatus(latestBeforeLaunch?.status)) {
        return latestBeforeLaunch
          ? mapTerminalRunToRuntimeResult(latestBeforeLaunch)
          : { status: "aborted", finalText: null, errorMessage: null, sessionId: null };
      }
      try {
        await adapter.execFile("tmux", launch.args, { cwd: input.worktreePath, env: buildRunnerEnvironment() });
      } catch (error) {
        const cleanup = await cancelTmuxRuntime({ adapter, runtime: buildCancellationRuntime() });
        await input.onRuntimeMetadata?.({
          status: "aborted",
          cleanupStatus: cleanup.cleanupStatus,
          finishedAt: now(),
          diagnostics: cleanup.diagnostic
            ? [cleanup.diagnostic]
            : [`tmux session ${sessionName} cleanup after launch error`],
        });
        throw errorWithCleanupStatus(error, cleanup.cleanupStatus);
      }
      try {
        const durableRun = getOrCreateRunForRepo(input.repoRoot).runs.find(
          (entry) => entry.runId === input.taskContract?.runId,
        );
        if (durableRun && (durableRun.finishedAt || isTerminalRunStatus(durableRun.status))) {
          const cleanup = await cancelTmuxRuntime({
            adapter,
            runtime: {
              ...durableRun.runtime,
              ...baseRuntime,
              sessionId: durableRun.runtime.sessionId,
              status: "aborted",
              runnerPid: durableRun.runtime.runnerPid,
              processGroupId: durableRun.runtime.processGroupId,
              diagnostics: durableRun.runtime.diagnostics,
              heartbeatAt: durableRun.runtime.heartbeatAt,
              startedAt: durableRun.runtime.startedAt,
              finishedAt: durableRun.runtime.finishedAt,
            },
          });
          await input.onRuntimeMetadata?.({
            status: "aborted",
            cleanupStatus: cleanup.cleanupStatus,
            finishedAt: now(),
            diagnostics: cleanup.diagnostic ? [cleanup.diagnostic] : [`tmux session ${sessionName} cleanup succeeded`],
          });
          return mapTerminalRunToRuntimeResult(durableRun);
        }
        const paneMetadata = await inspectTmuxPaneMetadata({ adapter, socketPath: paths.socketPath, sessionName });
        const runningDiagnostics = [
          `tmux session ${sessionName} launched`,
          ...(paneMetadata.diagnostic ? [paneMetadata.diagnostic] : []),
        ];
        await input.onRuntimeMetadata?.({
          ...baseRuntime,
          status: "running",
          runnerPid: paneMetadata.runnerPid,
          processGroupId: paneMetadata.processGroupId,
          tmux: {
            socketPath: paths.socketPath,
            sessionName,
            windowId: paneMetadata.windowId,
            paneId: paneMetadata.paneId,
          },
          diagnostics: runningDiagnostics,
          heartbeatAt: now(),
        });
        if (
          mode === "iterm-tmux" &&
          !input.signal?.aborted &&
          durableRunIsActive({ repoRoot: input.repoRoot, runId: input.taskContract.runId })
        ) {
          try {
            const viewer = await openItermTmuxViewer({
              attachCommand: launch.attachCommand,
              title: `pi-conductor ${input.taskContract.runId}`,
              adapter: options.itermViewerAdapter,
              platform: options.itermPlatform,
            });
            if (
              !input.signal?.aborted &&
              durableRunIsActive({ repoRoot: input.repoRoot, runId: input.taskContract.runId })
            ) {
              try {
                await input.onRuntimeMetadata?.({
                  viewerCommand: viewer.command,
                  viewerStatus: viewer.status,
                  diagnostics: [
                    ...runningDiagnostics,
                    viewer.status === "opened"
                      ? "iTerm2 viewer opened"
                      : (viewer.diagnostic ?? "iTerm2 viewer unavailable"),
                  ],
                });
              } catch (error) {
                console.error(
                  `pi-conductor viewer metadata persistence failed for ${input.taskContract.runId}: ${errorMessage(error)}`,
                );
              }
            }
          } catch (error) {
            console.error(
              `pi-conductor iTerm2 viewer launch failed for ${input.taskContract.runId}: ${errorMessage(error)}`,
            );
          }
        }
      } catch (error) {
        const cleanup = await cancelTmuxRuntime({ adapter, runtime: buildCancellationRuntime() });
        throw errorWithCleanupStatus(error, cleanup.cleanupStatus);
      }

      const onAbort = async () => {
        const cleanup = await cancelTmuxRuntime({ adapter, runtime: buildCancellationRuntime() });
        await input.onRuntimeMetadata?.({
          status: "aborted",
          cleanupStatus: cleanup.cleanupStatus,
          finishedAt: now(),
          diagnostics: cleanup.diagnostic ? [cleanup.diagnostic] : [`tmux session ${sessionName} cleanup succeeded`],
        });
      };
      if (!waitForCompletion) {
        return { status: "success", finalText: "tmux runtime launched", errorMessage: null, sessionId: sessionName };
      }
      return await waitForTerminalRun({
        repoRoot: input.repoRoot,
        runId: input.taskContract.runId,
        signal: input.signal,
        pollIntervalMs,
        adapter,
        staleHeartbeatMs: runnerHeartbeatIntervalMs * 4,
        onAbort,
      });
    },
  };
}

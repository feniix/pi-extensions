import { resolve } from "node:path";
import { deriveProjectKey } from "./project-key.js";
import { isTerminalRunStatus } from "./run-status.js";
import { readRun } from "./storage.js";
import type { RunAttemptRecord, RunRuntimeMetadata, RunRuntimeMode, TaskRecord, WorkerRecord } from "./types.js";

export type ActiveWorkerViewerInput = {
  taskId?: string;
  workerId?: string;
  runId?: string;
};

export type ActiveWorkerViewerEntry = {
  taskId: string;
  taskTitle: string;
  workerId: string;
  workerName: string;
  runId: string;
  runStatus: RunAttemptRecord["status"];
  runtimeMode: RunRuntimeMode;
  runtimeStatus: RunRuntimeMetadata["status"];
  viewerStatus: RunRuntimeMetadata["viewerStatus"];
  viewerCommand: string | null;
  attachCommand: string | null;
  logPath: string | null;
  logTailCommand: string | null;
  latestProgress: string | null;
  diagnostic: string | null;
  cancelTool: { name: "conductor_cancel_task_run"; params: { runId: string; reason: string } };
};

export type ActiveWorkerViewerSummary = {
  entries: ActiveWorkerViewerEntry[];
  filters: ActiveWorkerViewerInput;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isSupervisedRuntime(mode: RunRuntimeMode): boolean {
  return mode === "tmux" || mode === "iterm-tmux";
}

function isActiveRun(run: RunAttemptRecord): boolean {
  return (
    !run.finishedAt &&
    !isTerminalRunStatus(run.status) &&
    !["unavailable", "exited_success", "exited_error", "aborted"].includes(run.runtime.status)
  );
}

function fallbackAttachCommand(runtime: RunRuntimeMetadata): string | null {
  if (runtime.viewerCommand) return runtime.viewerCommand;
  const tmux = runtime.tmux;
  if (!tmux?.socketPath || !tmux.sessionName) return null;
  return `tmux -S ${shellQuote(tmux.socketPath)} attach-session -r -t ${shellQuote(tmux.sessionName)}`;
}

function logTailCommand(logPath: string | null): string | null {
  return logPath ? `tail -f ${shellQuote(logPath)}` : null;
}

function matchesFilters(run: RunAttemptRecord, input: ActiveWorkerViewerInput): boolean {
  return (
    (!input.runId || run.runId === input.runId) &&
    (!input.taskId || run.taskId === input.taskId) &&
    (!input.workerId || run.workerId === input.workerId)
  );
}

export function summarizeActiveWorkerViewersForRepo(
  repoRoot: string,
  input: ActiveWorkerViewerInput = {},
): ActiveWorkerViewerSummary {
  const project = readRun(deriveProjectKey(resolve(repoRoot)));
  if (!project) return { entries: [], filters: input };
  const tasksById = new Map(project.tasks.map((task) => [task.taskId, task] as const));
  const workersById = new Map(project.workers.map((worker) => [worker.workerId, worker] as const));
  const entries = project.runs
    .filter((run) => isActiveRun(run) && isSupervisedRuntime(run.runtime.mode) && matchesFilters(run, input))
    .map((run) => {
      const task = tasksById.get(run.taskId) as TaskRecord | undefined;
      const worker = workersById.get(run.workerId) as WorkerRecord | undefined;
      return {
        taskId: run.taskId,
        taskTitle: task?.title ?? "<missing task>",
        workerId: run.workerId,
        workerName: worker?.name ?? "<missing worker>",
        runId: run.runId,
        runStatus: run.status,
        runtimeMode: run.runtime.mode,
        runtimeStatus: run.runtime.status,
        viewerStatus: run.runtime.viewerStatus,
        viewerCommand: run.runtime.viewerCommand,
        attachCommand: fallbackAttachCommand(run.runtime),
        logPath: run.runtime.logPath,
        logTailCommand: logTailCommand(run.runtime.logPath),
        latestProgress: task?.latestProgress ?? null,
        diagnostic: run.runtime.diagnostics.at(-1) ?? null,
        cancelTool: {
          name: "conductor_cancel_task_run" as const,
          params: { runId: run.runId, reason: "Parent requested cancellation" },
        },
      };
    });
  return { entries, filters: input };
}

function cell(value: string | null | undefined): string {
  return (value ?? "none").replace(/\r\n?/g, "\n").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
}

export function formatActiveWorkerViewerSummary(summary: ActiveWorkerViewerSummary): string {
  if (summary.entries.length === 0) {
    return "no active supervised conductor workers matched the requested scope";
  }
  const rows = summary.entries.map(
    (entry) =>
      `| ${cell(entry.workerName)} | ${cell(entry.workerId)} | ${cell(entry.taskTitle)} | ${cell(entry.taskId)} | ${cell(entry.runId)} | ${cell(entry.runStatus)} | ${cell(entry.runtimeMode)} | ${cell(entry.runtimeStatus)} | ${cell(entry.viewerStatus)} | ${cell(entry.attachCommand)} | ${cell(entry.logTailCommand)} | ${cell(entry.latestProgress)} | ${cell(entry.diagnostic)} | ${cell(`${entry.cancelTool.name}(${JSON.stringify(entry.cancelTool.params)})`)} |`,
  );
  return [
    `active supervised conductor workers: ${summary.entries.length}`,
    "| Worker | workerId | Task | taskId | runId | Run status | Runtime | Runtime status | Viewer | Attach command | Log tail | Latest progress | Diagnostic | Cancel |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

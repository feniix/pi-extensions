import { truncateUtf8 } from "./artifact-content.js";
import { getOrCreateRunForRepo } from "./repo-run.js";
import type { RunAttemptRecord, TaskRecord } from "./types.js";

export type ParallelTaskResultSummary = {
  taskId: string;
  taskTitle: string;
  workerId: string | null;
  workerName: string | null;
  runId: string | null;
  taskState: TaskRecord["state"] | null;
  runStatus: RunAttemptRecord["status"] | null;
  latestProgress: string | null;
  latestProgressTruncated: boolean;
  completionSummary: string | null;
  completionSummaryTruncated: boolean;
  errorMessage: string | null;
  errorMessageTruncated: boolean;
  launchError: string | null;
  launchErrorTruncated: boolean;
  missingTask: boolean;
  nextToolCalls: Array<{ name: string; params: Record<string, unknown>; purpose: "evidence" | "action" }>;
};

function previewText(value: string | null | undefined, maxBytes = 240): { text: string | null; truncated: boolean } {
  if (!value) return { text: null, truncated: false };
  const preview = truncateUtf8(value, maxBytes);
  return { text: preview.content, truncated: preview.truncated };
}

function stateAwareNextToolCalls(input: {
  taskId: string;
  task: TaskRecord | null;
  latestRun: RunAttemptRecord | null;
}): ParallelTaskResultSummary["nextToolCalls"] {
  const evidence = [
    { name: "conductor_task_brief", params: { taskId: input.taskId }, purpose: "evidence" as const },
    ...(input.latestRun
      ? [
          {
            name: "conductor_resource_timeline",
            params: { taskId: input.taskId, runId: input.latestRun.runId },
            purpose: "evidence" as const,
          },
        ]
      : []),
  ];
  if (!input.task) return evidence;
  if (input.task.state === "failed" || input.task.state === "canceled" || input.task.state === "blocked") {
    return [...evidence, { name: "conductor_retry_task", params: { taskId: input.taskId }, purpose: "action" }];
  }
  if (input.task.state === "needs_review") {
    return [...evidence, { name: "conductor_diagnose_blockers", params: { taskId: input.taskId }, purpose: "action" }];
  }
  if (input.latestRun && input.task.state === "running") {
    return [
      ...evidence,
      {
        name: "conductor_cancel_task_run",
        params: { runId: input.latestRun.runId, reason: "<reason>" },
        purpose: "action",
      },
    ];
  }
  return evidence;
}

export function summarizeParallelTaskResults(
  repoRoot: string,
  taskIds: string[],
  launchErrors: Record<string, string | null> = {},
): ParallelTaskResultSummary[] {
  const project = getOrCreateRunForRepo(repoRoot);
  return taskIds.map((taskId) => {
    const task = project.tasks.find((entry) => entry.taskId === taskId) ?? null;
    const latestRun = task?.runIds.length
      ? (project.runs.find((entry) => entry.runId === task.runIds.at(-1)) ?? null)
      : null;
    const worker = latestRun?.workerId
      ? (project.workers.find((entry) => entry.workerId === latestRun.workerId) ?? null)
      : task?.assignedWorkerId
        ? (project.workers.find((entry) => entry.workerId === task.assignedWorkerId) ?? null)
        : null;
    const progress = previewText(task?.latestProgress);
    const completion = previewText(latestRun?.completionSummary);
    const error = previewText(latestRun?.errorMessage);
    const launchError = previewText(launchErrors[taskId]);
    return {
      taskId,
      taskTitle: task?.title ?? "<missing task>",
      workerId: worker?.workerId ?? null,
      workerName: worker?.name ?? null,
      runId: latestRun?.runId ?? null,
      taskState: task?.state ?? null,
      runStatus: latestRun?.status ?? null,
      latestProgress: progress.text,
      latestProgressTruncated: progress.truncated,
      completionSummary: completion.text,
      completionSummaryTruncated: completion.truncated,
      errorMessage: error.text,
      errorMessageTruncated: error.truncated,
      launchError: launchError.text,
      launchErrorTruncated: launchError.truncated,
      missingTask: task === null,
      nextToolCalls: stateAwareNextToolCalls({ taskId, task, latestRun }),
    };
  });
}

function markdownCell(value: string | null | undefined): string {
  return (value ?? "none").replace(/\r\n?/g, "\n").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
}

function previewCell(value: string | null, truncated: boolean): string {
  return markdownCell(value ? `${value}${truncated ? "…" : ""}` : null);
}

export function formatParallelTaskResultsTable(taskResults: ParallelTaskResultSummary[]): string {
  const rows = taskResults.map((entry) => {
    const next = entry.nextToolCalls.map((call) => `${call.name}(${JSON.stringify(call.params)})`).join("; ");
    const issue = entry.launchError ?? entry.errorMessage;
    const issueTruncated = entry.launchError ? entry.launchErrorTruncated : entry.errorMessageTruncated;
    return `| ${markdownCell(entry.taskTitle)} | ${markdownCell(entry.taskId)} | ${markdownCell(entry.workerName)} | ${markdownCell(entry.workerId)} | ${markdownCell(entry.runId)} | ${markdownCell(entry.taskState)} | ${markdownCell(entry.runStatus)} | ${previewCell(entry.latestProgress, entry.latestProgressTruncated)} | ${previewCell(entry.completionSummary, entry.completionSummaryTruncated)} | ${previewCell(issue, issueTruncated)} | ${markdownCell(next)} |`;
  });
  return [
    "",
    "| Task | taskId | Worker | workerId | runId | Task state | Run status | Latest progress | Completion summary | Error | Next tools |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

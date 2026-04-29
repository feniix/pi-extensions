import { truncateUtf8 } from "./artifact-content.js";
import { getOrCreateRunForRepo } from "./repo-run.js";
import type { RunAttemptRecord, TaskRecord } from "./types.js";

export type ParallelTaskResultSummary = {
  taskId: string;
  taskTitle: string;
  workerId: string | null;
  workerName: string | null;
  runId: string | null;
  taskState: TaskRecord["state"];
  runStatus: RunAttemptRecord["status"] | null;
  latestProgress: string | null;
  completionSummary: string | null;
  completionSummaryTruncated: boolean;
  nextToolCalls: Array<{ name: string; params: Record<string, unknown> }>;
};

function previewText(value: string | null | undefined, maxBytes = 240): { text: string | null; truncated: boolean } {
  if (!value) return { text: null, truncated: false };
  const preview = truncateUtf8(value, maxBytes);
  return { text: preview.content, truncated: preview.truncated };
}

export function summarizeParallelTaskResults(repoRoot: string, taskIds: string[]): ParallelTaskResultSummary[] {
  const project = getOrCreateRunForRepo(repoRoot);
  return taskIds.map((taskId) => {
    const task = project.tasks.find((entry) => entry.taskId === taskId);
    const latestRun = task?.runIds.length
      ? (project.runs.find((entry) => entry.runId === task.runIds.at(-1)) ?? null)
      : null;
    const worker = latestRun?.workerId
      ? (project.workers.find((entry) => entry.workerId === latestRun.workerId) ?? null)
      : task?.assignedWorkerId
        ? (project.workers.find((entry) => entry.workerId === task.assignedWorkerId) ?? null)
        : null;
    const completion = previewText(latestRun?.completionSummary);
    return {
      taskId,
      taskTitle: task?.title ?? "<missing task>",
      workerId: worker?.workerId ?? null,
      workerName: worker?.name ?? null,
      runId: latestRun?.runId ?? null,
      taskState: task?.state ?? "failed",
      runStatus: latestRun?.status ?? null,
      latestProgress: task?.latestProgress ?? null,
      completionSummary: completion.text,
      completionSummaryTruncated: completion.truncated,
      nextToolCalls: [
        { name: "conductor_task_brief", params: { taskId } },
        ...(latestRun ? [{ name: "conductor_resource_timeline", params: { taskId, runId: latestRun.runId } }] : []),
      ],
    };
  });
}

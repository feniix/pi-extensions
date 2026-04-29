import { truncateUtf8 } from "./artifact-content.js";
import { getOrCreateRunForRepo } from "./repo-run.js";
import { isTerminalRunStatus } from "./run-status.js";
import type { RunRecord, WorkerRecord } from "./types.js";

const CLEANUP_NOTE =
  "Cleanup is gate-protected: call conductor_cleanup_worker to request/perform cleanup, approve the destructive_cleanup gate through /conductor human dashboard if prompted, then retry the cleanup tool.";

export type WorkerCleanupRecommendation = {
  workerId: string;
  workerName: string;
  branch: string | null;
  worktreePath: string | null;
  sessionFile: string | null;
  cleanupToolCall: { name: "conductor_cleanup_worker"; params: { name: string } };
  gateType: "destructive_cleanup";
  note: string;
};

export function assertWorkerCleanupReady(run: RunRecord, workerId: string, workerName: string): WorkerRecord {
  const worker = run.workers.find((entry) => entry.workerId === workerId);
  if (!worker) throw new Error(`Worker named ${workerName} not found`);
  const hasOpenTask = run.tasks.some(
    (task) => task.assignedWorkerId === worker.workerId && !["completed", "failed", "canceled"].includes(task.state),
  );
  const hasActiveRun = run.runs.some(
    (entry) => entry.workerId === worker.workerId && !isTerminalRunStatus(entry.status),
  );
  if (worker.lifecycle !== "idle" || worker.recoverable || hasOpenTask || hasActiveRun) {
    throw new Error(`Worker ${worker.name} is not idle and ready for destructive cleanup`);
  }
  return worker;
}

export function summarizeWorkerCleanupRecommendations(
  repoRoot: string,
  workerIds: Array<string | null | undefined>,
): WorkerCleanupRecommendation[] {
  const ids = new Set(workerIds.filter((workerId): workerId is string => Boolean(workerId)));
  if (ids.size === 0) return [];
  const project = getOrCreateRunForRepo(repoRoot);
  const terminalTaskStates = new Set(["completed", "failed", "canceled"]);
  return project.workers
    .filter((worker) => {
      const hasOpenAssignedTask = project.tasks.some(
        (task) => task.assignedWorkerId === worker.workerId && !terminalTaskStates.has(task.state),
      );
      return (
        ids.has(worker.workerId) &&
        worker.lifecycle === "idle" &&
        !worker.recoverable &&
        !hasOpenAssignedTask &&
        Boolean(worker.branch || worker.worktreePath || worker.sessionFile)
      );
    })
    .map((worker) => ({
      workerId: worker.workerId,
      workerName: worker.name,
      branch: worker.branch,
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
      cleanupToolCall: { name: "conductor_cleanup_worker", params: { name: worker.name } },
      gateType: "destructive_cleanup",
      note: CLEANUP_NOTE,
    }));
}

function markdownCell(value: string | null | undefined): string {
  const bounded = truncateUtf8(value ?? "none", 160).content;
  return bounded.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
}

export function formatWorkerCleanupGuidance(recommendations: WorkerCleanupRecommendation[]): string {
  if (recommendations.length === 0) return "";
  const visible = recommendations.slice(0, 10);
  const rows = visible.map(
    (entry) =>
      `| ${markdownCell(entry.workerName)} | ${markdownCell(entry.workerId)} | ${markdownCell(entry.branch)} | ${markdownCell(entry.worktreePath)} | ${markdownCell(`conductor_cleanup_worker(${JSON.stringify(entry.cleanupToolCall.params)})`)} |`,
  );
  if (recommendations.length > visible.length)
    rows.push(
      `| ${recommendations.length - visible.length} more | details.cleanupRecommendations | none | none | none |`,
    );
  return [
    "",
    "Cleanup guidance: conductor keeps durable worker branches, worktrees, and sessions so task evidence remains inspectable. For short-lived/read-only work, cleanup is available through the gate-protected destructive cleanup flow.",
    "| Worker | workerId | Branch | Worktree | Cleanup tool |",
    "|---|---|---|---|---|",
    ...rows,
    "After calling cleanup, approve the `destructive_cleanup` gate through `/conductor human dashboard` when prompted, then rerun the cleanup tool.",
  ].join("\n");
}

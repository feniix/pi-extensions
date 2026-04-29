import { getOrCreateRunForRepo } from "./repo-run.js";

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

export function summarizeWorkerCleanupRecommendations(
  repoRoot: string,
  workerIds: Array<string | null | undefined>,
): WorkerCleanupRecommendation[] {
  const ids = new Set(workerIds.filter((workerId): workerId is string => Boolean(workerId)));
  if (ids.size === 0) return [];
  const project = getOrCreateRunForRepo(repoRoot);
  return project.workers
    .filter(
      (worker) =>
        ids.has(worker.workerId) &&
        worker.lifecycle === "idle" &&
        !worker.recoverable &&
        Boolean(worker.branch || worker.worktreePath || worker.sessionFile),
    )
    .map((worker) => ({
      workerId: worker.workerId,
      workerName: worker.name,
      branch: worker.branch,
      worktreePath: worker.worktreePath,
      sessionFile: worker.sessionFile,
      cleanupToolCall: { name: "conductor_cleanup_worker", params: { name: worker.name } },
      gateType: "destructive_cleanup",
      note: "Cleanup is gate-protected: call conductor_cleanup_worker to request/perform cleanup, approve the destructive_cleanup gate through the trusted human UI if prompted, then retry the cleanup tool.",
    }));
}

function markdownCell(value: string | null | undefined): string {
  return (value ?? "none").replace(/\r\n?/g, "\n").replace(/\n/g, "<br>").replace(/\|/g, "\\|");
}

export function formatWorkerCleanupGuidance(recommendations: WorkerCleanupRecommendation[]): string {
  if (recommendations.length === 0) return "";
  const rows = recommendations.map(
    (entry) =>
      `| ${markdownCell(entry.workerName)} | ${markdownCell(entry.workerId)} | ${markdownCell(entry.branch)} | ${markdownCell(entry.worktreePath)} | ${markdownCell(`conductor_cleanup_worker(${JSON.stringify(entry.cleanupToolCall.params)})`)} |`,
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

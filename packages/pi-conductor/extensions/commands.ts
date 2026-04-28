import {
  createTaskForRepo,
  createWorkerForRepo,
  getOrCreateRunForRepo,
  reconcileProjectForRepo,
  reconcileWorkerHealth,
} from "./conductor.js";
import { isTerminalRunStatus } from "./run-status.js";
import { formatRunRuntimeSummary } from "./runtime-metadata.js";
import { formatRunStatus } from "./status.js";
import { queryConductorEvents } from "./storage.js";
import type { RunAttemptRecord } from "./types.js";

function isActiveRun(attempt: RunAttemptRecord): boolean {
  return !attempt.finishedAt && !isTerminalRunStatus(attempt.status);
}

function formatRunInspection(attempt: RunAttemptRecord): string {
  const cancelCommand = isActiveRun(attempt)
    ? ` cancel=conductor_cancel_task_run({"runId":"${attempt.runId}","reason":"<reason>"})`
    : "";
  return (
    `${attempt.runId} task=${attempt.taskId} worker=${attempt.workerId} status=${attempt.status} ` +
    `backend=${attempt.backend} ${formatRunRuntimeSummary(attempt.runtime)}${cancelCommand}`
  );
}

function getUsage(): string {
  return [
    "usage:",
    "  /conductor get project|workers|worker <id-or-name>|tasks|task <task-id>|runs|run <run-id>|gates|events|artifacts",
    "  /conductor create worker <worker-name>",
    "  /conductor create task <title> <prompt>",
    "  /conductor status",
    "  /conductor history [project|worker|task|run|gate|artifact] [id] [--after N] [--limit N]",
    "  /conductor reconcile [--dry-run]",
    "  /conductor human gates [reason]",
    "  /conductor human dashboard",
    "  /conductor human decide gate <gate-id> [reason]",
    "  /conductor human approve gate <gate-id> [reason]",
    "  human gate commands require interactive UI; non-UI callers should inspect with conductor_list_gates and evidence/readiness tools",
  ].join("\n");
}

export async function runConductorCommand(cwd: string, args: string): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help") {
    return getUsage();
  }

  const [subcommand, ...rest] = trimmed.split(/\s+/);
  if (subcommand === "get") {
    const [resource, idOrName] = rest;
    const run = reconcileWorkerHealth(getOrCreateRunForRepo(cwd));
    if (resource === "project") {
      return formatRunStatus(run);
    }
    if (resource === "workers") {
      const active = run.workers.map((worker) => `${worker.name} [${worker.workerId}] state=${worker.lifecycle}`);
      const archived = run.archivedWorkers.map(
        (worker) => `${worker.name} [${worker.workerId}] state=archived archived=true`,
      );
      return active.length === 0 && archived.length === 0 ? "workers: none" : [...active, ...archived].join("\n");
    }
    if (resource === "worker") {
      const worker = [...run.workers, ...run.archivedWorkers].find(
        (entry) => entry.workerId === idOrName || entry.name === idOrName,
      );
      return worker
        ? `${worker.name} [${worker.workerId}] state=${worker.lifecycle} archived=${worker.lifecycle === "archived"} branch=${worker.branch ?? "none"} worktree=${worker.worktreePath ?? "none"}`
        : `worker not found: ${idOrName ?? ""}`;
    }
    if (resource === "tasks") {
      return run.tasks.length === 0
        ? "tasks: none"
        : run.tasks
            .map(
              (task) =>
                `${task.title} [${task.taskId}] state=${task.state} assignedWorker=${task.assignedWorkerId ?? "none"}`,
            )
            .join("\n");
    }
    if (resource === "task") {
      const task = run.tasks.find((entry) => entry.taskId === idOrName);
      return task
        ? `${task.title} [${task.taskId}] state=${task.state} assignedWorker=${task.assignedWorkerId ?? "none"} activeRun=${task.activeRunId ?? "none"}`
        : `task not found: ${idOrName ?? ""}`;
    }
    if (resource === "runs") {
      return run.runs.length === 0 ? "runs: none" : run.runs.map(formatRunInspection).join("\n");
    }
    if (resource === "run") {
      const attempt = run.runs.find((entry) => entry.runId === idOrName);
      return attempt ? formatRunInspection(attempt) : `run not found: ${idOrName ?? ""}`;
    }
    if (resource === "gates") {
      return run.gates.length === 0
        ? "gates: none"
        : run.gates
            .map((gate) => `${gate.gateId} type=${gate.type} status=${gate.status} decision=${gate.requestedDecision}`)
            .join("\n");
    }
    if (resource === "events") {
      return run.events.length === 0
        ? "events: none"
        : run.events.map((event) => `#${event.sequence} ${event.type} ${event.occurredAt}`).join("\n");
    }
    if (resource === "artifacts") {
      return run.artifacts.length === 0
        ? "artifacts: none"
        : run.artifacts.map((artifact) => `${artifact.artifactId} ${artifact.type} ${artifact.ref}`).join("\n");
    }
    return `${getUsage()}\n\nerror: unknown resource '${resource ?? ""}'`;
  }
  if (subcommand === "create") {
    const [resource, first, ...restParts] = rest;
    if (resource === "worker") {
      const workerName = [first, ...restParts].filter(Boolean).join(" ").trim();
      if (!workerName) {
        return `${getUsage()}\n\nerror: missing worker name`;
      }
      const worker = await createWorkerForRepo(cwd, workerName);
      return `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}`;
    }
    if (resource === "task") {
      const title = first;
      const prompt = restParts.join(" ").trim();
      if (!title || !prompt) {
        return `${getUsage()}\n\nerror: missing task title or prompt`;
      }
      const task = createTaskForRepo(cwd, { title, prompt });
      return `created task ${task.title} [${task.taskId}]`;
    }
    return `${getUsage()}\n\nerror: unknown resource '${resource ?? ""}'`;
  }
  if (subcommand === "status") {
    return formatRunStatus(reconcileWorkerHealth(getOrCreateRunForRepo(cwd)));
  }
  if (subcommand === "history") {
    const [scope, id, ...flags] = rest;
    const limitFlagIndex = flags.indexOf("--limit");
    const afterFlagIndex = flags.indexOf("--after");
    const limit = limitFlagIndex >= 0 ? Number.parseInt(flags[limitFlagIndex + 1] ?? "", 10) : undefined;
    const afterSequence = afterFlagIndex >= 0 ? Number.parseInt(flags[afterFlagIndex + 1] ?? "", 10) : undefined;
    const page = queryConductorEvents(getOrCreateRunForRepo(cwd), {
      limit: Number.isFinite(limit) ? limit : undefined,
      afterSequence: Number.isFinite(afterSequence) ? afterSequence : undefined,
      workerId: scope === "worker" ? id : undefined,
      taskId: scope === "task" ? id : undefined,
      runId: scope === "run" ? id : undefined,
      gateId: scope === "gate" ? id : undefined,
      artifactId: scope === "artifact" ? id : undefined,
    });
    const lines = page.events.map((event) => `#${event.sequence} ${event.type} ${event.occurredAt}`);
    return [
      `history: count=${page.events.length} hasMore=${page.hasMore} lastSequence=${page.lastSequence ?? "none"}`,
      ...lines,
    ].join("\n");
  }
  if (subcommand === "reconcile") {
    const dryRun = rest.includes("--dry-run");
    const before = getOrCreateRunForRepo(cwd);
    const after = reconcileProjectForRepo(cwd, { dryRun });
    const changed = after.revision !== before.revision || after.updatedAt !== before.updatedAt;
    return `${dryRun ? "previewed" : "reconciled"} project ${after.projectKey}: changed=${changed} workers=${after.workers.length} tasks=${after.tasks.length} runs=${after.runs.length}`;
  }

  return `${getUsage()}\n\nerror: unknown subcommand '${subcommand}'`;
}

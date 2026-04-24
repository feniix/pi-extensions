import {
  commitWorkerForRepo,
  createTaskForRepo,
  createWorkerForRepo,
  createWorkerPrForRepo,
  getOrCreateRunForRepo,
  pushWorkerForRepo,
  reconcileProjectForRepo,
  reconcileWorkerHealth,
  recoverWorkerForRepo,
  refreshWorkerSummaryForRepo,
  removeWorkerForRepo,
  resumeWorkerForRepo,
  runWorkerForRepo,
  updateWorkerLifecycleForRepo,
  updateWorkerTaskForRepo,
} from "./conductor.js";
import { formatRunStatus } from "./status.js";
import { queryConductorEvents } from "./storage.js";

const LEGACY_SLASH_DEPRECATION =
  "deprecated: legacy /conductor worker subcommands will be removed; prefer resource-native conductor_* tools.\n";

function legacySlashResponse(text: string): string {
  return `${LEGACY_SLASH_DEPRECATION}${text}`;
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
    "  /conductor start <worker-name> (deprecated)",
    "  /conductor task <worker-name> <task> (deprecated)",
    "  /conductor resume <worker-name> (deprecated)",
    "  /conductor run <worker-name> <task> (deprecated)",
    "  /conductor state <worker-name> <lifecycle> (deprecated)",
    "  /conductor recover <worker-name> (deprecated)",
    "  /conductor summarize <worker-name> (deprecated)",
    "  /conductor cleanup <worker-name> (deprecated)",
    "  /conductor commit <worker-name> <message> (deprecated)",
    "  /conductor push <worker-name> (deprecated)",
    "  /conductor pr <worker-name> <title> (deprecated)",
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
      return run.workers.length === 0
        ? "workers: none"
        : run.workers.map((worker) => `${worker.name} [${worker.workerId}] state=${worker.lifecycle}`).join("\n");
    }
    if (resource === "worker") {
      const worker = run.workers.find((entry) => entry.workerId === idOrName || entry.name === idOrName);
      return worker
        ? `${worker.name} [${worker.workerId}] state=${worker.lifecycle} branch=${worker.branch ?? "none"} worktree=${worker.worktreePath ?? "none"}`
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
      return run.runs.length === 0
        ? "runs: none"
        : run.runs
            .map(
              (attempt) =>
                `${attempt.runId} task=${attempt.taskId} worker=${attempt.workerId} status=${attempt.status}`,
            )
            .join("\n");
    }
    if (resource === "run") {
      const attempt = run.runs.find((entry) => entry.runId === idOrName);
      return attempt
        ? `${attempt.runId} task=${attempt.taskId} worker=${attempt.workerId} status=${attempt.status} backend=${attempt.backend}`
        : `run not found: ${idOrName ?? ""}`;
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
  if (subcommand === "start") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await createWorkerForRepo(cwd, workerName);
    return legacySlashResponse(`created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}`);
  }
  if (subcommand === "task") {
    const [workerName, ...taskParts] = rest;
    const task = taskParts.join(" ").trim();
    if (!workerName || !task) {
      return `${getUsage()}\n\nerror: missing worker name or task`;
    }
    const worker = updateWorkerTaskForRepo(cwd, workerName, task);
    return legacySlashResponse(`updated task for ${worker.name}: ${worker.currentTask}`);
  }
  if (subcommand === "resume") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await resumeWorkerForRepo(cwd, workerName);
    return legacySlashResponse(`resumed worker ${worker.name}: session=${worker.sessionFile}`);
  }
  if (subcommand === "run") {
    const [workerName, ...taskParts] = rest;
    const task = taskParts.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    if (!task) {
      return `${getUsage()}\n\nerror: missing task`;
    }
    const result = await runWorkerForRepo(cwd, workerName, task);
    const summary = result.finalText ?? result.errorMessage ?? "Run completed without a final assistant summary";
    return legacySlashResponse(`ran worker ${result.workerName}: outcome=${result.status} result=${summary}`);
  }
  if (subcommand === "state") {
    const [workerName, lifecycle] = rest;
    if (!workerName || !lifecycle) {
      return `${getUsage()}\n\nerror: missing worker name or lifecycle state`;
    }
    const worker = updateWorkerLifecycleForRepo(cwd, workerName, lifecycle as never);
    return legacySlashResponse(`updated worker ${worker.name} state to ${worker.lifecycle}`);
  }
  if (subcommand === "recover") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await recoverWorkerForRepo(cwd, workerName);
    return legacySlashResponse(`recovered worker ${worker.name}: session=${worker.sessionFile}`);
  }
  if (subcommand === "summarize") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await refreshWorkerSummaryForRepo(cwd, workerName);
    return legacySlashResponse(`refreshed summary for ${worker.name}: ${worker.summary.text}`);
  }
  if (subcommand === "cleanup") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = removeWorkerForRepo(cwd, workerName);
    return legacySlashResponse(`removed worker ${worker.name} [${worker.workerId}]`);
  }
  if (subcommand === "commit") {
    const [workerName, ...messageParts] = rest;
    const message = messageParts.join(" ").trim();
    if (!workerName || !message) {
      return `${getUsage()}\n\nerror: missing worker name or commit message`;
    }
    const worker = commitWorkerForRepo(cwd, workerName, message);
    return legacySlashResponse(`committed worker ${worker.name}: ${message}`);
  }
  if (subcommand === "push") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = pushWorkerForRepo(cwd, workerName);
    return legacySlashResponse(`pushed worker ${worker.name} on branch ${worker.branch}`);
  }
  if (subcommand === "pr") {
    const [workerName, ...titleParts] = rest;
    const title = titleParts.join(" ").trim();
    if (!workerName || !title) {
      return `${getUsage()}\n\nerror: missing worker name or PR title`;
    }
    const worker = createWorkerPrForRepo(cwd, workerName, title);
    return legacySlashResponse(`created PR for ${worker.name}: ${worker.pr.url}`);
  }

  return `${getUsage()}\n\nerror: unknown subcommand '${subcommand}'`;
}

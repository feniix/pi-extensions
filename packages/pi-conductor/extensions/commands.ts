import {
  commitWorkerForRepo,
  createWorkerForRepo,
  createWorkerPrForRepo,
  getOrCreateRunForRepo,
  pushWorkerForRepo,
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

function getUsage(): string {
  return [
    "usage:",
    "  /conductor status",
    "  /conductor start <worker-name>",
    "  /conductor task <worker-name> <task>",
    "  /conductor resume <worker-name>",
    "  /conductor run <worker-name> <task>",
    "  /conductor state <worker-name> <lifecycle>",
    "  /conductor recover <worker-name>",
    "  /conductor summarize <worker-name>",
    "  /conductor cleanup <worker-name>",
    "  /conductor commit <worker-name> <message>",
    "  /conductor push <worker-name>",
    "  /conductor pr <worker-name> <title>",
  ].join("\n");
}

export async function runConductorCommand(cwd: string, args: string): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help") {
    return getUsage();
  }

  const [subcommand, ...rest] = trimmed.split(/\s+/);
  if (subcommand === "status") {
    return formatRunStatus(reconcileWorkerHealth(getOrCreateRunForRepo(cwd)));
  }
  if (subcommand === "start") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await createWorkerForRepo(cwd, workerName);
    return `created worker ${worker.name} [${worker.workerId}] on branch ${worker.branch}`;
  }
  if (subcommand === "task") {
    const [workerName, ...taskParts] = rest;
    const task = taskParts.join(" ").trim();
    if (!workerName || !task) {
      return `${getUsage()}\n\nerror: missing worker name or task`;
    }
    const worker = updateWorkerTaskForRepo(cwd, workerName, task);
    return `updated task for ${worker.name}: ${worker.currentTask}`;
  }
  if (subcommand === "resume") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await resumeWorkerForRepo(cwd, workerName);
    return `resumed worker ${worker.name}: session=${worker.sessionFile}`;
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
    return `ran worker ${result.workerName}: outcome=${result.status} result=${summary}`;
  }
  if (subcommand === "state") {
    const [workerName, lifecycle] = rest;
    if (!workerName || !lifecycle) {
      return `${getUsage()}\n\nerror: missing worker name or lifecycle state`;
    }
    const worker = updateWorkerLifecycleForRepo(cwd, workerName, lifecycle as never);
    return `updated worker ${worker.name} state to ${worker.lifecycle}`;
  }
  if (subcommand === "recover") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await recoverWorkerForRepo(cwd, workerName);
    return `recovered worker ${worker.name}: session=${worker.sessionFile}`;
  }
  if (subcommand === "summarize") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = await refreshWorkerSummaryForRepo(cwd, workerName);
    return `refreshed summary for ${worker.name}: ${worker.summary.text}`;
  }
  if (subcommand === "cleanup") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = removeWorkerForRepo(cwd, workerName);
    return `removed worker ${worker.name} [${worker.workerId}]`;
  }
  if (subcommand === "commit") {
    const [workerName, ...messageParts] = rest;
    const message = messageParts.join(" ").trim();
    if (!workerName || !message) {
      return `${getUsage()}\n\nerror: missing worker name or commit message`;
    }
    const worker = commitWorkerForRepo(cwd, workerName, message);
    return `committed worker ${worker.name}: ${message}`;
  }
  if (subcommand === "push") {
    const workerName = rest.join(" ").trim();
    if (!workerName) {
      return `${getUsage()}\n\nerror: missing worker name`;
    }
    const worker = pushWorkerForRepo(cwd, workerName);
    return `pushed worker ${worker.name} on branch ${worker.branch}`;
  }
  if (subcommand === "pr") {
    const [workerName, ...titleParts] = rest;
    const title = titleParts.join(" ").trim();
    if (!workerName || !title) {
      return `${getUsage()}\n\nerror: missing worker name or PR title`;
    }
    const worker = createWorkerPrForRepo(cwd, workerName, title);
    return `created PR for ${worker.name}: ${worker.pr.url}`;
  }

  return `${getUsage()}\n\nerror: unknown subcommand '${subcommand}'`;
}

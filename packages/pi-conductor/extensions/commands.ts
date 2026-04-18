import { createWorkerForRepo, getOrCreateRunForRepo, updateWorkerTaskForRepo } from "./conductor.js";
import { formatRunStatus } from "./status.js";

function getUsage(): string {
	return [
		"usage:",
		"  /conductor status",
		"  /conductor start <worker-name>",
		"  /conductor task <worker-name> <task>",
	].join("\n");
}

export function runConductorCommand(cwd: string, args: string): string {
	const trimmed = args.trim();
	if (!trimmed || trimmed === "help") {
		return getUsage();
	}

	const [subcommand, ...rest] = trimmed.split(/\s+/);
	if (subcommand === "status") {
		return formatRunStatus(getOrCreateRunForRepo(cwd));
	}
	if (subcommand === "start") {
		const workerName = rest.join(" ").trim();
		if (!workerName) {
			return `${getUsage()}\n\nerror: missing worker name`;
		}
		const worker = createWorkerForRepo(cwd, workerName);
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

	return `${getUsage()}\n\nerror: unknown subcommand '${subcommand}'`;
}

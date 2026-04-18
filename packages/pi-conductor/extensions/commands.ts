import {
	createWorkerForRepo,
	getOrCreateRunForRepo,
	reconcileWorkerHealth,
	recoverWorkerForRepo,
	updateWorkerTaskForRepo,
} from "./conductor.js";
import { formatRunStatus } from "./status.js";

function getUsage(): string {
	return [
		"usage:",
		"  /conductor status",
		"  /conductor start <worker-name>",
		"  /conductor task <worker-name> <task>",
		"  /conductor recover <worker-name>",
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
	if (subcommand === "recover") {
		const workerName = rest.join(" ").trim();
		if (!workerName) {
			return `${getUsage()}\n\nerror: missing worker name`;
		}
		const worker = await recoverWorkerForRepo(cwd, workerName);
		return `recovered worker ${worker.name}: session=${worker.sessionFile}`;
	}

	return `${getUsage()}\n\nerror: unknown subcommand '${subcommand}'`;
}
